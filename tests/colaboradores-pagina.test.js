const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

/*
  La página de colaboradores. Como el resto de las pruebas de maquetado del
  repo, éstas leen la fuente: lo que fijan son invariantes de texto del sistema
  de layout y de seguridad que ningún test de comportamiento notaría si se
  rompen. La lógica pura del roster se prueba en colaboradores-datos.test.js.
*/

const HTML = read("src/app/features/colaboradores/index.html");
const CSS = read("src/app/features/colaboradores/colaboradores.css");
const JS = read("src/app/features/colaboradores/colaboradores.js");
const FONDO = read("src/app/features/colaboradores/colaboradores.fondo.js");
const HOME_JS = read("src/app/features/home/home.js");

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
// Comentarios de bloque y de línea. El `[^:]` deja pasar los `//` de una URL.
const sinComentariosJs = (js) => js
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the page loads the shared stylesheets and mounts the navbar without a hardcoded state", () => {
  for (const hoja of [
    "/styles.css",
    "/app/shared/floating-menu/floating-menu.css",
    "/app/shared/navbar/navbar.css",
    "/app/features/colaboradores/colaboradores.css",
  ]) {
    assert.ok(HTML.includes(`<link rel="stylesheet" href="${hoja}">`), `falta la hoja ${hoja}`);
  }

  assert.ok(HTML.includes('<nav class="navbar"'), "la página debe montar el navbar compartido");
  // El estado por scroll lo calcula navbar.js; escrito en el markup queda
  // clavado aunque la página esté arriba del todo.
  assert.ok(!HTML.includes("navbar--scrolled"));
});

test("the content sits in the shared container", () => {
  assert.ok(HTML.includes('class="colaboradores__contenido u-contenedor"'));
  assert.ok(HTML.includes('<main class="colaboradores">'),
    "el <main> lleva sólo el bloque: el contenedor va en un hijo");
});

test("the unfinished page is kept out of search engines", () => {
  // QUITAR ESTA ASERCIÓN cuando existan las fichas de perfil reales ("Mi
  // ficha"): mientras cada persona muestre sólo su nombre, la página está a
  // medias y no debe indexarse.
  assert.match(HTML, /<meta name="robots" content="noindex">/);
});

test("the markup has no dead links and no inline styles", () => {
  const html = sinComentariosHtml(HTML);
  assert.doesNotMatch(html, /href="#"/, 'un href="#" es un enlace muerto');
  assert.doesNotMatch(html, /\sstyle="/, "los estilos van en colaboradores.css, no en atributos");
});

test("the profile view starts hidden and both views exist", () => {
  assert.match(HTML, /<section[^>]*id="colaboradoresRoster"/);
  const perfil = HTML.match(/<section[^>]*id="colaboradoresPerfil"[^>]*>/);
  assert.ok(perfil, "falta la sección del perfil");
  assert.match(perfil[0], /\shidden(?:\s|>)/);
});

/*
  La tarjeta "Perfil" del roster muestra la ficha de perfil de quien se está
  viendo. Arranca oculta: colaboradores.js la muestra sólo si alguien de la
  lista cargada tiene ficha, así no queda una tarjeta vacía para nadie.
*/
test("the roster profile card starts hidden", () => {
  const resumen = sinComentariosHtml(HTML).match(/<div[^>]*id="colaboradoresResumen"[^>]*>/);
  assert.ok(resumen, "falta la tarjeta de perfil del roster");
  assert.match(resumen[0], /class="colaboradores__resumen panel"/);
  assert.match(resumen[0], /\shidden(?:\s|>)/);
});

/*
  Carga, error y lista vacía comparten una región: un aviso cortés (`status`,
  no `alert`, porque también anuncia "Cargando…") que puede recibir el foco
  cuando un reintento falla, y el botón de reintentar, oculto hasta un error.
*/
test("the load notice is a focusable status region that holds a hidden retry button", () => {
  const html = sinComentariosHtml(HTML);
  const aviso = html.match(/<div[^>]*id="colaboradoresAviso"[^>]*>/);
  assert.ok(aviso, "falta la región del aviso de carga");
  assert.match(aviso[0], /\srole="status"/);
  assert.match(aviso[0], /\stabindex="-1"/);
  assert.match(aviso[0], /\shidden(?:\s|>)/);
  assert.match(html, /<p[^>]*id="colaboradoresAvisoMensaje"/);

  const boton = html.match(/<button([^>]*)id="colaboradoresReintentar"([^>]*)>([^<]*)<\/button>/);
  assert.ok(boton, "falta el botón de reintentar");
  const atributos = `${boton[1]} ${boton[2]}`;
  assert.match(atributos, /type="button"/);
  assert.match(atributos, /\shidden(?:\s|$)/);
  assert.equal(boton[3].trim(), "Reintentar carga");
});

/*
  Del perfil se vuelve con el botón atrás del navegador (el perfil vive en el
  hash), así que no hay botón propio. El foco que antes recibía ese botón al
  abrir un perfil pasa al nombre, y un <h1> sólo lo acepta con tabindex.
*/
test("the regions that change with the selection are live, there is no back button and the profile name can take focus", () => {
  const html = sinComentariosHtml(HTML);
  assert.ok((html.match(/aria-live="polite"/g) || []).length >= 2,
    "la vista previa y el perfil deben anunciar sus cambios");
  assert.doesNotMatch(html, /perfilVolver/, "volver al roster es el atrás del navegador, no un botón");

  const nombre = html.match(/<h1[^>]*id="perfilNombre"[^>]*>/);
  assert.ok(nombre, "falta el nombre del perfil");
  assert.match(nombre[0], /\stabindex="-1"/, "el nombre recibe el foco al abrir un perfil, sin entrar al orden del Tab");
});

/*
  Retirados por decisión de producto (2026-09-19): los atributos 1–5 con sus
  barras, la "clase" (ESTRATEGA, TANQUE…), el botón "Contactar", "Suele
  trabajar con" y la fila de Proyectos (apagados en todo el producto hasta que
  tengan infraestructura). Esto impide que vuelvan pegados desde el prototipo.
*/
test("the retired profile pieces are gone from the markup, the script and the stylesheet", () => {
  const html = sinComentariosHtml(HTML);
  for (const [patron, que] of [
    [/previaClase|colaboradores__clase|Sin selección/, "la clase de la vista previa"],
    [/previaAtributos|perfilAtributos|colaboradores__atributo|>Atributos</, "los atributos"],
    [/Contactar|colaboradores__contactar/, "el botón Contactar"],
    [/perfilColega|colaboradores__colega|Suele trabajar con/, "el colega sugerido"],
    [/perfilProyectos|>Proyectos</, "la fila de Proyectos"],
  ]) {
    assert.doesNotMatch(html, patron, `el HTML todavía tiene ${que}`);
  }

  const js = sinComentariosJs(JS);
  for (const patron of [
    /previaClase/, /Sin selección/, /\.clase\b/,
    /ETIQUETAS_ATRIBUTOS/, /etiquetaDeAtributo/, /Atributos/, /\.stats\b/,
    /Contactar/,
    /perfilColega/, /colegaSugerido/, /verColega/, /location\.replace/,
    /perfilProyectos/, /\.proyectos\b/,
  ]) {
    assert.doesNotMatch(js, patron, `el script todavía usa ${patron}`);
  }

  const css = sinComentariosCss(CSS);
  for (const patron of [
    /\.colaboradores__clase\b/,
    /\.colaboradores__atributo/, /\.colaboradores__barra-segmentos/, /\.colaboradores__segmento/,
    /\.colaboradores__contactar/,
    /\.colaboradores__colega/,
    // Su único consumidor era la cifra de Proyectos.
    /\.colaboradores__dato-valor--cifra/,
  ]) {
    assert.doesNotMatch(css, patron, `la hoja todavía tiene ${patron}`);
  }
});

/*
  La tarjeta "Perfil" del roster y el detalle del perfil tenían una segunda
  columna para los atributos. Sin ella, un grid de dos columnas dejaría la bio
  apretada en la mitad de la tarjeta junto a un hueco vacío.
*/
test("the roster card and the profile detail lost their attributes column", () => {
  const css = sinComentariosCss(CSS);
  for (const selector of [".colaboradores__resumen", ".colaboradores__detalle"]) {
    const reglas = [...css.matchAll(new RegExp(`${selector.replace(".", "\\.")}\\s*[,{][^}]*\\}`, "g"))];
    assert.ok(reglas.length > 0, `falta la regla ${selector}`);
    for (const [regla] of reglas) {
      assert.doesNotMatch(regla, /grid-template-columns/, `${selector} ya no reparte columnas`);
    }
  }
  const html = sinComentariosHtml(HTML);
  assert.doesNotMatch(html, /colaboradores__resumen-texto|colaboradores__detalle-columna/,
    "sin segunda columna, el envoltorio de la primera sobra");
});

test("the page script never writes markup from data", () => {
  const js = sinComentariosJs(JS);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML/);
  // Las fichas son botones de verdad, con nombre accesible propio.
  assert.match(js, /createElement\("button"\)/);
  assert.match(js, /aria-label/);
});

test("the stylesheet lives in the features layer", () => {
  const css = sinComentariosCss(CSS).trim();
  assert.match(css, /^@layer features\s*\{/);

  // Una sola capa que envuelve TODO: al cerrar su llave no queda nada afuera.
  let profundidad = 0;
  let cierre = -1;
  for (let i = css.indexOf("{"); i < css.length; i += 1) {
    if (css[i] === "{") profundidad += 1;
    if (css[i] === "}") profundidad -= 1;
    if (profundidad === 0) { cierre = i; break; }
  }
  assert.equal(cierre, css.length - 1, "hay reglas fuera de @layer features");
});

test("the stylesheet only uses the documented breakpoints", () => {
  const BREAKPOINTS_DOCUMENTADOS = [360, 760, 900];
  const css = sinComentariosCss(CSS);
  const fueraDelSet = [];

  for (const preludio of css.matchAll(/@media\s*\(([^)]*)\)/g)) {
    const condiciones = preludio[1];
    assert.doesNotMatch(condiciones, /min-width/, `min-width no es parte del sistema: ${condiciones}`);
    for (const match of condiciones.matchAll(/max-width:\s*(\d+)px/g)) {
      if (!BREAKPOINTS_DOCUMENTADOS.includes(Number(match[1]))) fueraDelSet.push(match[0]);
    }
  }

  assert.deepEqual(fueraDelSet, []);
});

test("the top offset derives from the navbar token and the side padding lives on the parent", () => {
  const css = sinComentariosCss(CSS);
  const regla = css.match(/\.colaboradores\s*\{([^}]*)\}/);
  assert.ok(regla, "falta la regla .colaboradores");
  assert.match(regla[1], /padding-block:\s*var\(--espacio-bajo-navbar\)/);
  assert.match(regla[1], /padding-inline:/);

  assert.doesNotMatch(css, /\.u-contenedor\s*\{/, "la hoja no redeclara el contenedor compartido");
  assert.doesNotMatch(
    css,
    /\.[\w-]*(?:__container|__panel|__content|__contenido|__contenedor)[\w-]*\s*\{[^}]*(?:max-width|max-inline-size)\s*:\s*\d+px/,
    "el ancho de página lo pone .u-contenedor, no un px suelto",
  );
});

test("the tile grid keeps the four columns moverSeleccion() assumes", () => {
  const { COLUMNAS_ROSTER } = require("../src/app/features/colaboradores/colaboradores.datos.js");
  const reglas = [...sinComentariosCss(CSS).matchAll(/\.colaboradores__grilla\s*[,{]([^}]*)\}/g)];
  // Las COLUMNAS se declaran una sola vez, fuera de todo breakpoint:
  // moverSeleccion() salta de a COLUMNAS_ROSTER y un ancho con otra cantidad de
  // columnas rompería ↑/↓ el día que se conecten las flechas (hoy la página no
  // escucha keydown). Un breakpoint sí puede tocar las FILAS (en móvil
  // dejan de repartirse el alto de la ventana), pero nunca las columnas.
  const conColumnas = reglas.filter(([, cuerpo]) => /grid-template-columns/.test(cuerpo));
  assert.equal(conColumnas.length, 1, "las columnas de la grilla se declaran una vez y ningún breakpoint las toca");
  assert.match(conColumnas[0][1], new RegExp(`grid-template-columns:\\s*repeat\\(${COLUMNAS_ROSTER},`));
});

/*
  El roster es una pantalla de selección: en escritorio entra ENTERO en el alto
  de la ventana, sin scroll de página, como el prototipo. La primera versión lo
  dejaba fluir y a 1907×1040 "¿Quién?" y la tarjeta de perfil caían bajo el
  pliegue. El alto sale de la ventana menos el despeje del navbar (el token) y
  el aire inferior; las filas de fichas se reparten ese alto por igual, así que
  las fichas dejan de ser cuadradas y pasan a llenar su celda.

  En ≤760px no hay forma de meter previa + 12 fichas + tarjeta en una pantalla:
  ahí la página vuelve a fluir y las fichas recuperan su proporción 1:1.
*/
test("the roster fits the viewport height on desktop and flows again on mobile", () => {
  const css = sinComentariosCss(CSS);
  const regla = (selector, desde = 0) => {
    const inicio = css.indexOf(`${selector} {`, desde);
    assert.notEqual(inicio, -1, `falta la regla ${selector}`);
    return css.slice(inicio, css.indexOf("}", inicio));
  };

  const roster = regla(".colaboradores__roster");
  assert.match(roster, /block-size:\s*calc\(100dvh\s*-\s*var\(--espacio-bajo-navbar\)\s*-\s*var\(--colaboradores-aire-inferior\)\)/,
    "el alto del roster es la ventana menos el despeje del navbar y el aire inferior, todo por tokens");
  assert.match(roster, /min-block-size:\s*\d+px/,
    "con un piso: en una ventana muy baja se prefiere scrollear a aplastar las fichas");

  const grilla = regla(".colaboradores__grilla");
  assert.match(grilla, /grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    "tres filas fijas: con pocas fichas, una sola no se estira al alto entero de la grilla");
  assert.match(grilla, /grid-auto-rows:\s*minmax\(0,\s*1fr\)/,
    "las filas de más, si las hay, se reparten el mismo alto");
  assert.doesNotMatch(regla(".colaboradores__ficha"), /aspect-ratio/,
    "en escritorio la ficha llena su celda; un 1:1 acá volvería a desbordar el alto");

  const movil = css.indexOf("@media (max-width: 760px)");
  assert.notEqual(movil, -1);
  assert.match(regla(".colaboradores__roster", movil), /block-size:\s*auto/,
    "en móvil el roster vuelve a fluir");
  assert.match(regla(".colaboradores__grilla", movil), /grid-template-rows:\s*none/,
    "sin alto que repartir, tres filas `fr` quedarían como filas cuadradas vacías");
  assert.match(regla(".colaboradores__ficha", movil), /aspect-ratio:\s*1\s*\/\s*1/,
    "y las fichas recuperan el cuadrado");
});

test("motion is switched off for people who asked for less of it", () => {
  assert.match(sinComentariosCss(CSS), /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

/*
  colaboradores.fondo.js copia a propósito las opciones de cargarParticulasFondo()
  para no tocar home.js. Una copia sin vigilancia se desfasa en silencio: acá se
  comparan los dos literales y el primero que cambie solo rompe la suite.
*/
function opcionesDelFondo(fuente, nombre) {
  const marca = 'tsParticles.load("particles-fondo",';
  const inicioLlamada = fuente.indexOf(marca);
  assert.notEqual(inicioLlamada, -1, `${nombre} no carga el fondo en #particles-fondo`);

  const inicio = fuente.indexOf("{", inicioLlamada + marca.length);
  let profundidad = 0;
  for (let i = inicio; i < fuente.length; i += 1) {
    if (fuente[i] === "{") profundidad += 1;
    if (fuente[i] === "}") profundidad -= 1;
    if (profundidad === 0) return fuente.slice(inicio, i + 1).replace(/\s+/g, " ").trim();
  }
  assert.fail(`${nombre}: el objeto de opciones no cierra`);
}

test("the starfield options are the same literal the home uses", () => {
  const propias = opcionesDelFondo(FONDO, "colaboradores.fondo.js");
  assert.ok(propias.includes("fpsLimit: 30"), "la extracción debe traer el literal completo");
  assert.equal(propias, opcionesDelFondo(HOME_JS, "home.js"));
});

test("the starfield loader is a no-op without the library", () => {
  assert.match(FONDO, /function cargarFondoColaboradores\(\)\s*\{\s*if \(!window\.tsParticles\) return;/);
});

test("scripts load in dependency order", () => {
  const posicion = (src) => {
    const indice = HTML.indexOf(`<script src="${src}"></script>`);
    assert.notEqual(indice, -1, `falta el script ${src}`);
    return indice;
  };

  const cliente = posicion("/app/core/supabase/supabase-client.js");
  const servicio = posicion("/app/core/colaboradores/colaboradores.service.js");
  const navbar = posicion("/app/shared/navbar/navbar.js");
  const particulas = posicion("https://cdn.jsdelivr.net/npm/tsparticles@2/tsparticles.bundle.min.js");
  const datos = posicion("/app/features/colaboradores/colaboradores.datos.js");
  const fondo = posicion("/app/features/colaboradores/colaboradores.fondo.js");
  const pagina = posicion("/app/features/colaboradores/colaboradores.js");

  assert.ok(posicion("/app/core/auth/auth.service.js") < navbar);
  assert.ok(cliente < servicio, "el servicio usa supabaseClient");
  assert.ok(servicio < pagina, "la página le pide la lista al servicio");
  assert.ok(particulas < fondo, "tsParticles va antes del fondo que lo usa");
  assert.ok(datos < pagina, "la lógica del roster va antes de la página que la usa");
});
