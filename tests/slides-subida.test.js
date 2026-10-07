const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const PUENTE = path.join(ROOT, "src/content/slides/_subida");
const leer = (nombre) => fs.readFileSync(path.join(PUENTE, nombre), "utf8");

const puente = require(path.join(PUENTE, "subida.logica.js"));

/*
  La página puente de los decks subidos: lo que le quita al HTML ajeno, cómo
  navega las láminas, qué contrato le da al visor y que respete la CSP de
  /content/slides. No hay DOM en Node, así que la lógica se prueba con nodos
  de mentira que sólo implementan lo que ella les pide.
*/

/* ------------------------------------------------------------------ */
/* Nodos de mentira                                                    */
/* ------------------------------------------------------------------ */

function nodo(tagName, atributos = {}) {
  const mapa = new Map(Object.entries(atributos));
  return {
    tagName: tagName.toLowerCase(),
    quitado: false,
    remove() { this.quitado = true; },
    getAttribute: (nombre) => (mapa.has(nombre) ? mapa.get(nombre) : null),
    setAttribute: (nombre, valor) => { mapa.set(nombre, String(valor)); },
    removeAttribute: (nombre) => { mapa.delete(nombre); },
    get attributes() { return [...mapa].map(([name, value]) => ({ name, value })); },
  };
}

/* Un documento cuyo querySelectorAll entiende justo los tres selectores que
   usa sanearDocumento (la lista de peligrosos, "link" y "*"). */
function documentoDe(nodos) {
  const peligrosas = new Set(["script", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "base"]);
  return {
    nodos,
    querySelectorAll(selector) {
      const vivos = nodos.filter((n) => !n.quitado);
      if (selector === puente.SELECTOR_DE_NODOS_PELIGROSOS) {
        return vivos.filter((n) => peligrosas.has(n.tagName) || (n.tagName === "meta" && n.getAttribute("http-equiv") !== null));
      }
      if (selector === "link") return vivos.filter((n) => n.tagName === "link");
      if (selector === "*") return vivos;
      throw new Error(`selector no previsto: ${selector}`);
    },
  };
}

/* ------------------------------------------------------------------ */
/* sanearDocumento                                                     */
/* ------------------------------------------------------------------ */

test("el selector de nodos peligrosos cubre todo lo que puede ejecutar o redirigir", () => {
  for (const etiqueta of ["script", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta[http-equiv]"]) {
    assert.ok(puente.SELECTOR_DE_NODOS_PELIGROSOS.includes(etiqueta), `falta ${etiqueta}`);
  }
});

test("sanearDocumento quita scripts (inline y de CDN), iframes, base y meta http-equiv", () => {
  const documento = documentoDe([
    nodo("script"),
    nodo("script", { src: "https://cdn.jsdelivr.net/npm/tsparticles@2.12.0/tsparticles.bundle.min.js" }),
    nodo("noscript"),
    nodo("iframe", { src: "/otra" }),
    nodo("object"),
    nodo("embed"),
    nodo("base", { href: "https://malo.test/" }),
    nodo("meta", { "http-equiv": "refresh", content: "0;url=https://malo.test" }),
    nodo("meta", { charset: "utf-8" }),
    nodo("style"),
    nodo("section", { class: "slide" }),
  ]);

  const retirados = puente.sanearDocumento(documento);

  const vivos = documento.nodos.filter((n) => !n.quitado).map((n) => n.tagName);
  assert.deepEqual(vivos, ["meta", "style", "section"]);
  assert.equal(retirados, 8);
});

test("sanearDocumento conserva sólo las hojas de estilo de Google Fonts entre los <link>", () => {
  const fuentes = nodo("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Orbitron" });
  const preconnect = nodo("link", { rel: "preconnect", href: "https://fonts.googleapis.com" });
  const ajena = nodo("link", { rel: "stylesheet", href: "https://malo.test/estilo.css" });
  const icono = nodo("link", { rel: "icon", href: "/x.png" });
  const documento = documentoDe([fuentes, preconnect, ajena, icono]);

  puente.sanearDocumento(documento);

  assert.equal(fuentes.quitado, false);
  assert.equal(preconnect.quitado, true);
  assert.equal(ajena.quitado, true);
  assert.equal(icono.quitado, true);
});

test("sanearDocumento quita handlers on*, srcdoc y javascript:, también disfrazado", () => {
  const boton = nodo("button", { onclick: "robar()", id: "ok", ONMOUSEOVER: "x()" });
  const enlace = nodo("a", { href: "javascript:alert(1)", target: "_blank" });
  const disfrazado = nodo("a", { href: " java\tscript:alert(1)" });
  const marco = nodo("div", { srcdoc: "<script>1</script>" });
  const normal = nodo("a", { href: "https://taudux.com" });
  const documento = documentoDe([boton, enlace, disfrazado, marco, normal]);

  puente.sanearDocumento(documento);

  assert.equal(boton.getAttribute("onclick"), null);
  assert.equal(boton.getAttribute("ONMOUSEOVER"), null);
  assert.equal(boton.getAttribute("id"), "ok", "lo inocuo se queda");
  assert.equal(enlace.getAttribute("href"), null);
  assert.equal(disfrazado.getAttribute("href"), null);
  assert.equal(marco.getAttribute("srcdoc"), null);
  assert.equal(normal.getAttribute("href"), "https://taudux.com");
});

test("sanearDocumento protege a la página de los enlaces que abren pestaña nueva", () => {
  const enlace = nodo("a", { href: "https://taudux.com", target: "_blank" });
  puente.sanearDocumento(documentoDe([enlace]));
  assert.equal(enlace.getAttribute("rel"), "noopener noreferrer");
});

test("sanearDocumento tolera lo que no es un documento", () => {
  assert.equal(puente.sanearDocumento(null), 0);
  assert.equal(puente.sanearDocumento({}), 0);
});

/* ------------------------------------------------------------------ */
/* prepararDeck                                                        */
/* ------------------------------------------------------------------ */

test("prepararDeck parsea sin ejecutar, sanea y separa estilos, cuerpo y láminas", () => {
  const estilo = nodo("style");
  const hijo = nodo("section", { class: "slide" });
  const script = nodo("script");
  const todos = [script, estilo, hijo];
  const documento = {
    ...documentoDe(todos),
    title: "  QR de sesión ",
    head: { querySelectorAll: () => [estilo] },
    body: { className: "is-idle x", childNodes: [hijo] },
  };
  const consulta = documento.querySelectorAll;
  documento.querySelectorAll = (selector) => (selector === "section.slide" ? [hijo, hijo] : consulta(selector));
  let textoRecibido = null;
  let tipoRecibido = null;
  const parser = { parseFromString: (texto, tipo) => { textoRecibido = texto; tipoRecibido = tipo; return documento; } };

  const deck = puente.prepararDeck("<html>…</html>", parser);

  assert.equal(textoRecibido, "<html>…</html>");
  assert.equal(tipoRecibido, "text/html");
  assert.equal(script.quitado, true, "el script se quitó antes de entregar nada");
  assert.equal(deck.titulo, "QR de sesión");
  assert.deepEqual(deck.estilos, [estilo]);
  assert.deepEqual(deck.cuerpo, [hijo]);
  assert.equal(deck.clasesDelCuerpo, "is-idle x");
  assert.equal(deck.laminas, 2);
  assert.equal(deck.retirados, 1);
});

/* ------------------------------------------------------------------ */
/* Navegación: el mismo contrato que slidesDeck                        */
/* ------------------------------------------------------------------ */

function lamina() {
  const clases = new Set();
  const atributos = new Map();
  return {
    clases,
    atributos,
    classList: {
      toggle: (clase, activa) => { if (activa) clases.add(clase); else clases.delete(clase); },
    },
    setAttribute: (nombre, valor) => { atributos.set(nombre, valor); },
    removeAttribute: (nombre) => { atributos.delete(nombre); },
  };
}

test("crearNavegacion marca is-active / is-before / is-after y avisa cada cambio", () => {
  const laminas = [lamina(), lamina(), lamina()];
  const cambios = [];
  const nav = puente.crearNavegacion(laminas, (i, total) => cambios.push([i, total]));

  assert.equal(nav.total, 3);
  assert.equal(nav.indice(), 0);

  nav.ir(1);

  assert.deepEqual([...laminas[0].clases], ["is-before"]);
  assert.deepEqual([...laminas[1].clases], ["is-active"]);
  assert.deepEqual([...laminas[2].clases], ["is-after"]);
  assert.equal(laminas[1].atributos.get("aria-hidden"), "false");
  assert.equal(laminas[0].atributos.get("aria-hidden"), "true");
  assert.equal(laminas[1].atributos.has("inert"), false);
  assert.equal(laminas[0].atributos.get("inert"), "");
  assert.deepEqual(cambios, [[1, 3]]);
  assert.equal(nav.indice(), 1);
});

test("crearNavegacion acota el índice a [0, total - 1]", () => {
  const nav = puente.crearNavegacion([lamina(), lamina()]);
  nav.ir(99);
  assert.equal(nav.indice(), 1);
  nav.ir(-5);
  assert.equal(nav.indice(), 0);
  nav.ir(NaN);
  assert.equal(nav.indice(), 0);
});

test("crearNavegacion sin láminas no hace nada ni falla", () => {
  const nav = puente.crearNavegacion([]);
  nav.ir(0);
  assert.equal(nav.total, 0);
  assert.equal(nav.indice(), 0);
});

test("accionDeTeclaDeDeck mapea las teclas de los decks y deja pasar los atajos del navegador", () => {
  assert.equal(puente.accionDeTeclaDeDeck({ key: "ArrowRight" }), "siguiente");
  assert.equal(puente.accionDeTeclaDeDeck({ key: " " }), "siguiente");
  assert.equal(puente.accionDeTeclaDeDeck({ key: "ArrowUp" }), "anterior");
  assert.equal(puente.accionDeTeclaDeDeck({ key: "Home" }), "primera");
  assert.equal(puente.accionDeTeclaDeDeck({ key: "End" }), "ultima");
  assert.equal(puente.accionDeTeclaDeDeck({ key: "ArrowRight", ctrlKey: true }), null);
  assert.equal(puente.accionDeTeclaDeDeck({ key: "ArrowRight", metaKey: true }), null);
  assert.equal(puente.accionDeTeclaDeDeck({ key: "x" }), null);
  // F es del visor: si el puente también la atendiera, la pantalla completa
  // se alternaría dos veces por tecla.
  assert.equal(puente.accionDeTeclaDeDeck({ key: "f" }), null);
  assert.equal(puente.accionDeTeclaDeDeck(null), null);
});

/* ------------------------------------------------------------------ */
/* Controles propios del deck (la forma del de QR de sesión)           */
/* ------------------------------------------------------------------ */

function boton(atributos = {}) {
  const escuchas = {};
  const atrib = new Map(Object.entries(atributos));
  return {
    disabled: false,
    addEventListener: (tipo, funcion) => { escuchas[tipo] = funcion; },
    getAttribute: (n) => (atrib.has(n) ? atrib.get(n) : null),
    setAttribute: (n, v) => { atrib.set(n, String(v)); },
    clic: () => escuchas.click(),
  };
}

function raizCon({ prev, next, fs, puntos = [] }) {
  const porId = { prev, next, fs };
  return {
    getElementById: (id) => porId[id] || null,
    querySelectorAll: (selector) => {
      assert.equal(selector, "[data-go]");
      return puntos;
    },
  };
}

test("conectarControlesDelDeck cablea #prev, #next, [data-go] y #fs", () => {
  const prev = boton();
  const next = boton();
  const fs = boton();
  const inicio = boton({ "data-go": "0" });
  const cierre = boton({ "data-go": "1" });
  const laminas = [lamina(), lamina(), lamina()];
  const nav = puente.crearNavegacion(laminas);
  let pantallas = 0;

  const controles = puente.conectarControlesDelDeck(
    raizCon({ prev, next, fs, puntos: [inicio, cierre] }),
    nav,
    () => { pantallas += 1; }
  );

  assert.equal(controles.controlesPropios, true);

  next.clic();
  assert.equal(nav.indice(), 1);
  prev.clic();
  assert.equal(nav.indice(), 0);
  cierre.clic();
  assert.equal(nav.indice(), 1, "[data-go=1] va a la lámina 1");
  fs.clic();
  assert.equal(pantallas, 1);
});

test("reflejar deshabilita las flechas en los extremos y marca aria-current en el punto actual", () => {
  const prev = boton();
  const next = boton();
  const inicio = boton({ "data-go": "0" });
  const cierre = boton({ "data-go": "1" });
  const controles = puente.conectarControlesDelDeck(
    raizCon({ prev, next, puntos: [inicio, cierre] }),
    puente.crearNavegacion([lamina(), lamina()]),
    null
  );

  controles.reflejar(0, 2);
  assert.equal(prev.disabled, true);
  assert.equal(next.disabled, false);
  assert.equal(inicio.getAttribute("aria-current"), "true");
  assert.equal(cierre.getAttribute("aria-current"), "false");

  controles.reflejar(1, 2);
  assert.equal(prev.disabled, false);
  assert.equal(next.disabled, true);
  assert.equal(inicio.getAttribute("aria-current"), "false");
  assert.equal(cierre.getAttribute("aria-current"), "true");
});

test("un deck sin flechas propias deja los botones del visor (sólo #fs no alcanza)", () => {
  const solo = puente.conectarControlesDelDeck(
    raizCon({ fs: boton() }),
    puente.crearNavegacion([lamina()]),
    () => {}
  );
  assert.equal(solo.controlesPropios, false);

  const ninguno = puente.conectarControlesDelDeck(raizCon({}), puente.crearNavegacion([lamina()]), () => {});
  assert.equal(ninguno.controlesPropios, false);
  assert.doesNotThrow(() => ninguno.reflejar(0, 1));
});

test("crearInactividad pone body.is-idle tras la espera y lo quita al despertar", () => {
  const clases = new Set();
  const cuerpo = { classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c) } };
  const pendientes = new Map();
  let siguiente = 1;
  const inactividad = puente.crearInactividad(cuerpo, {
    espera: 3000,
    programar: (funcion, ms) => { const id = siguiente++; pendientes.set(id, { funcion, ms }); return id; },
    cancelar: (id) => pendientes.delete(id),
  });

  inactividad.despertar();
  assert.equal(pendientes.size, 1);
  assert.equal([...pendientes.values()][0].ms, 3000);

  [...pendientes.values()][0].funcion();
  assert.equal(clases.has("is-idle"), true);

  inactividad.despertar();
  assert.equal(clases.has("is-idle"), false);
  assert.equal(pendientes.size, 1, "el temporizador anterior se canceló");
});

test("slugDelHash acepta sólo slugs kebab-case", () => {
  assert.equal(puente.slugDelHash("#qr-de-sesion"), "qr-de-sesion");
  assert.equal(puente.slugDelHash("#QR-De-Sesion"), "qr-de-sesion");
  assert.equal(puente.slugDelHash("#../secreto"), "");
  assert.equal(puente.slugDelHash("#a/b"), "");
  assert.equal(puente.slugDelHash(""), "");
  assert.equal(puente.slugDelHash(undefined), "");
});

/* ------------------------------------------------------------------ */
/* La página: CSP, color-scheme, cielo y contrato con el visor         */
/* ------------------------------------------------------------------ */

const HTML = leer("index.html");
const CSS = leer("subida.css");
const JS = leer("subida.js");
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

test("la página puente cae bajo la regla de /content/slides de vercel.json", () => {
  const regla = VERCEL.headers.find((r) => r.source === "/content/slides(.*)");
  assert.ok(regla, "existe la regla de /content/slides");
  assert.match("/content/slides/_subida/", /^\/content\/slides(.*)$/);
  const csp = regla.headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /frame-ancestors 'self'/, "el visor la puede enmarcar");
  // El puente depende de que NO haya 'unsafe-inline' en script-src: es lo que
  // vuelve inertes los scripts inline y los handlers que se le escapen.
  const scriptSrc = /script-src ([^;]*)/.exec(csp)[1];
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
});

test("la página puente no trae scripts inline y sólo carga del sitio o de jsdelivr", () => {
  assert.doesNotMatch(HTML, /<script(?![^>]*\ssrc=)[^>]*>/i, "trae un <script> inline");
  assert.doesNotMatch(HTML, /<\w+[^>]*\son(?:click|load|error)\s*=/i, "trae un handler inline");

  const fuentes = [...HTML.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]);
  assert.ok(fuentes.length > 0);
  fuentes.forEach((src) => {
    if (src.startsWith("https://cdn.jsdelivr.net/")) return;
    assert.ok(src.startsWith("/"), `${src} no es del sitio ni de jsdelivr`);
    assert.ok(fs.existsSync(path.join(ROOT, "src", src.replace(/^\//, ""))), `no existe ${src}`);
  });
});

test("el cielo usa tsParticles 2.12.0, la versión del deck de QR, y sus scripts van en orden", () => {
  assert.match(HTML, /cdn\.jsdelivr\.net\/npm\/tsparticles@2\.12\.0\/tsparticles\.bundle\.min\.js/);
  const posicion = (fragmento) => {
    const indice = HTML.indexOf(fragmento);
    assert.notEqual(indice, -1, `falta ${fragmento}`);
    return indice;
  };
  const cliente = posicion("/app/core/supabase/supabase-client.js");
  const particulas = posicion("tsparticles@2.12.0");
  const logicaSlides = posicion("/app/features/slides/slides.logica.js");
  const logicaPuente = posicion("subida.logica.js");
  const fondo = posicion("subida.fondo.js");
  const pagina = posicion("subida.js\"");
  assert.ok(cliente < pagina);
  assert.ok(particulas < fondo);
  assert.ok(logicaSlides < pagina && logicaPuente < pagina && fondo < pagina);
});

test("la página puente NO declara color-scheme: igualaría al de la página que la contiene", () => {
  // Un color-scheme distinto entre el iframe y su contenedor hace que Chrome
  // pinte un fondo opaco detrás y tape el cielo de Slides, que no declara
  // ninguno. El `color-scheme: dark` del deck se anula en subida.js.
  assert.doesNotMatch(HTML.replace(/<!--[\s\S]*?-->/g, ""), /color-scheme/i);
  assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ""), /color-scheme/i);
  const slidesCss = fs.readFileSync(path.join(ROOT, "src/app/features/slides/slides.css"), "utf8");
  assert.doesNotMatch(slidesCss.replace(/\/\*[\s\S]*?\*\//g, ""), /color-scheme/i);
  assert.match(JS, /color-scheme: normal !important/, "el color-scheme del deck se anula");
});

test("html y body quedan transparentes: el fondo del archivo se ignora siempre", () => {
  const sinComentarios = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(sinComentarios, /html,\s*body\s*\{[^}]*background:\s*transparent/);
  assert.match(JS, /html, body \{ background: transparent !important; \}/);
});

test("el cielo sólo existe en pantalla completa y queda detrás del deck", () => {
  const sinComentarios = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(sinComentarios, /#subidaCielo,\s*#particles-fondo\s*\{[^}]*display:\s*none/);
  assert.match(sinComentarios, /body\.en-pantalla-completa #subidaCielo,\s*body\.en-pantalla-completa #particles-fondo\s*\{[^}]*display:\s*block/);
  assert.match(sinComentarios, /z-index:\s*-1/);
});

test("subida.js publica slidesDeck antes de descargar nada, con el contrato del visor", () => {
  const publicacion = JS.indexOf("window.slidesDeck = {");
  const descarga = JS.indexOf("async function descargarDeck");
  const arranque = JS.lastIndexOf("iniciar();");
  assert.notEqual(publicacion, -1);
  assert.ok(publicacion < descarga && descarga < arranque);

  for (const miembro of ["get total()", "indice:", "ir:", "get controlesPropios()"]) {
    assert.ok(JS.includes(miembro), `slidesDeck no expone ${miembro}`);
  }
  assert.match(JS, /EVENTO_DE_CAMBIO[\s\S]{0,80}controlesPropios/, "el primer cambio avisa si hay botones propios");
});

test("subida.js no ejecuta ni inyecta HTML crudo", () => {
  const sinComentarios = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const peligro of [/\beval\s*\(/, /new Function/, /\.innerHTML\s*=/, /document\.write/, /insertAdjacentHTML/, /\.outerHTML\s*=/]) {
    assert.doesNotMatch(sinComentarios, peligro, `subida.js usa ${peligro}`);
  }
  assert.match(sinComentarios, /new DOMParser\(\)/);
});

test("pantalla completa: el cielo se pausa al salir y al ocultarse la pestaña", () => {
  assert.match(JS, /addEventListener\("fullscreenchange"/);
  assert.match(JS, /addEventListener\("visibilitychange"/);
  assert.match(JS, /alternarCieloDeSubida\(completa && !document\.hidden\)/);
  const fondo = leer("subida.fondo.js");
  assert.match(fondo, /instancia\.pause\(\)/);
  assert.match(fondo, /instancia\.play\(\)/);
});

test("el botón de pantalla completa del deck se lo pide al visor, dueño del marco", () => {
  assert.match(JS, /slides:alternar-pantalla-completa/);
  const visor = fs.readFileSync(path.join(ROOT, "src/app/features/slides/slides.js"), "utf8");
  assert.match(visor, /slides:alternar-pantalla-completa/);
});

/* ------------------------------------------------------------------ */
/* subida.js en un contexto aislado                                    */
/* ------------------------------------------------------------------ */

test("sin slug en el hash, el puente avisa y ya expone un slidesDeck vacío", () => {
  const estado = { hidden: true, textContent: "" };
  const escuchasDeDocumento = [];
  const contexto = {
    window: null,
    document: {
      getElementById: (id) => (id === "subidaEstado" ? estado : null),
      addEventListener: (tipo) => escuchasDeDocumento.push(tipo),
      body: { classList: { toggle() {} } },
    },
    console,
  };
  contexto.window = {
    location: { hash: "" },
    addEventListener() {},
    parent: null,
  };
  contexto.window.parent = contexto.window;
  vm.createContext(contexto);
  // Los globals de las lógicas se cargan antes, como en la página.
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/app/features/slides/slides.logica.js"), "utf8"), contexto);
  vm.runInContext(leer("subida.logica.js"), contexto);
  vm.runInContext(leer("subida.fondo.js"), contexto);
  vm.runInContext(JS, contexto);

  const deck = contexto.window.slidesDeck;
  assert.equal(deck.total, 0);
  assert.equal(deck.indice(), 0);
  assert.equal(deck.controlesPropios, false);
  assert.doesNotThrow(() => deck.ir(3));
  assert.equal(deck.indice(), 0);
  assert.equal(typeof deck.ir, "function");
  assert.ok(escuchasDeDocumento.includes("fullscreenchange"));
  return Promise.resolve().then(() => {
    assert.equal(estado.hidden, false);
    assert.match(estado.textContent, /No se indicó qué presentación abrir/);
  });
});

/* ------------------------------------------------------------------ */
/* Ajustar la lámina al marco                                          */
/* ------------------------------------------------------------------ */

test("una lámina que cabe no se achica, ni por una fracción de píxel", () => {
  assert.equal(puente.escalaParaCaber(594, 594), 1);
  assert.equal(puente.escalaParaCaber(593.6, 594), 1);
  assert.equal(puente.escalaParaCaber(790, 400), 1);
});

test("una lámina que no cabe se achica justo hasta entrar entera", () => {
  // El QR de sesión en una ventana de 500 × 888: 1170 px de lámina en 790.
  const escala = puente.escalaParaCaber(790, 1170);
  assert.equal(escala, 0.673);
  assert.ok(1170 * escala <= 790 - puente.HOLGURA_DE_AJUSTE);
});

test("al achicar deja holgura para que el redondeo del zoom no saque una barra", () => {
  // Computadora: la lámina se pasaba por pocos píxeles y al 99,2 % sobraba uno.
  const escala = puente.escalaParaCaber(650, 655);
  assert.ok(escala < 650 / 655);
  assert.ok(655 * escala <= 650 - puente.HOLGURA_DE_AJUSTE);
});

test("si aún sobra contenido, el siguiente intento baja un punto sin pasar el mínimo", () => {
  assert.equal(puente.siguienteEscala(0.992), 0.982);
  assert.equal(puente.siguienteEscala(0.505), null);
  assert.equal(puente.siguienteEscala(0.51), 0.5);
});

test("nunca se achica por debajo del mínimo legible: ahí la lámina scrollea", () => {
  assert.equal(puente.escalaParaCaber(200, 2000), puente.ESCALA_MINIMA);
});

test("sin medidas válidas (lámina oculta o sin layout) no se toca la escala", () => {
  assert.equal(puente.escalaParaCaber(0, 1000), 1);
  assert.equal(puente.escalaParaCaber(500, 0), 1);
  assert.equal(puente.escalaParaCaber(NaN, 1000), 1);
});

test("el puente ajusta la lámina al cambiar, al redimensionar y al llegar las fuentes", () => {
  const fuente = leer("subida.js");
  assert.match(fuente, /escalaParaCaber\(lamina\.clientHeight, lamina\.scrollHeight\)/);
  assert.match(fuente, /lamina\.style\.zoom = ""/);
  assert.match(fuente, /lamina\.scrollHeight > lamina\.clientHeight/);
  assert.match(fuente, /siguienteEscala\(escala\)/);
  assert.match(fuente, /addEventListener\("resize"/);
  assert.match(fuente, /document\.fonts\.ready/);
});

test("fuera de pantalla completa, sólo el marco de los decks de la excepción llena el alto en vez de 16:9", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/app/features/slides/slides.css"), "utf8");
  assert.doesNotMatch(css, /\.slides__marco--subida:not\(:fullscreen\) \{/, "un subido cualquiera va en 16:9");
  const regla = css.match(/\.slides__marco--llena:not\(:fullscreen\) \{([^}]*)\}/);
  assert.ok(regla, "falta la regla del marco de los decks que llenan el visor");
  assert.match(regla[1], /aspect-ratio: auto/);
  assert.match(regla[1], /block-size: calc\(100dvh - var\(--slides-reservado/);
  assert.match(css, /\.slides__visor:has\(\.slides__controles\[hidden\]\) \.slides__marco--llena:not\(:fullscreen\)/);
});
