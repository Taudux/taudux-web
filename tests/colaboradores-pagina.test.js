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
// La misma copia deliberada existe una tercera vez, en Slides: ver
// slides.fondo.js. Se compara acá y no en un archivo propio de esa página
// porque es el mismo literal que ya vigila este test, no uno nuevo.
const SLIDES_FONDO = read("src/app/features/slides/slides.fondo.js");
// Y una cuarta, en el Generador de QR (qr.fondo.js), por la misma razón.
const QR_FONDO = read("src/app/features/qr/qr.fondo.js");
// Y una quinta, en la página puente de los decks subidos: el cielo que dibuja
// en pantalla completa (ver subida.fondo.js).
const SUBIDA_FONDO = read("src/content/slides/_subida/subida.fondo.js");

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
  // QUITAR ESTA ASERCIÓN cuando "Mi ficha" deje a cada colaborador llenar su
  // ficha desde el sitio. La página ya pinta la ficha real (0039), pero
  // mientras nadie pueda cargarla, casi todos muestran sólo su nombre: la
  // página está a medias y no debe indexarse.
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
  El enlace a "Mi ficha" vive en la FICHA de quien mira, dentro del roster: no
  está en el markup estático ni cuelga de los rótulos "Perfil", que vuelven a
  estar solos. Lo crea colaboradores.js con la lista, una vez por celda.
*/
test("the Perfil headings stand alone and the edit link is built by the script", () => {
  const html = sinComentariosHtml(HTML);
  assert.doesNotMatch(html, /colaboradores__editar|colaboradores__fila-etiqueta|resumenEditar|perfilEditar/,
    "el enlace lo monta el script en la ficha, no el HTML");
  assert.equal(
    (html.match(/<h2 class="colaboradores__etiqueta">Perfil<\/h2>/g) || []).length,
    2,
    "los dos rótulos quedan solos, como el resto de las etiquetas",
  );

  const js = sinComentariosJs(JS);
  assert.match(js, /createElement\("a"\)/);
  assert.match(js, /"\/app\/features\/colaboradores\/mi-ficha\/"/, "la ruta a Mi ficha, literal");
  assert.match(js, /"Editar mi ficha"/, '"Editar" a secas no dice de quién: el nombre accesible sí');
});

/*
  El anillo cian es de la ficha bajo el CURSOR y de la enfocada con teclado
  (`:focus-visible`, que además lleva el contorno del sistema). La ficha es un
  círculo, así que el anillo es un box-shadow que sigue el border-radius.

  Y el script no marca a la ficha elegida: esa marca era la que quedaba pegada
  al volver de un perfil.
*/
test("the cyan ring belongs to the cursor and to keyboard focus, as a circle", () => {
  const css = sinComentariosCss(CSS);

  const encendida = css.match(/([^{}]+)\{([^}]*0 0 0 3px var\(--color-accent\)[^}]*)\}/);
  assert.ok(encendida, "falta la regla de la ficha encendida");
  assert.deepEqual(
    encendida[1].split(",").map((selector) => selector.trim()).filter(Boolean),
    [".colaboradores__ficha--activa"],
    "el anillo del cursor lo enciende `--activa` y nadie más",
  );
  assert.match(encendida[2], /box-shadow/);

  const base = css.match(/\.colaboradores__ficha\s*\{([^}]*)\}/);
  assert.ok(base, "falta la regla de la ficha");
  assert.match(base[1], /border-radius:\s*50%/, "la ficha es un círculo");
  assert.match(base[1], /scale:\s*var\(--escala/, "la escala del panal");
  assert.match(base[1], /transition:\s*box-shadow/, "sólo se anima el box-shadow");
  assert.doesNotMatch(base[1], /transition:[^;]*scale/, "la escala no se anima: la mueve el script cuadro a cuadro");

  // Quien navega con teclado tiene que ver dónde está: el anillo del sistema.
  const enfocada = css.match(/\.colaboradores__ficha:focus-visible\s*\{([^}]*)\}/);
  assert.ok(enfocada, "falta la regla de la ficha enfocada con teclado");
  assert.match(enfocada[1], /outline:\s*var\(--focus-ring\)/);
  assert.match(enfocada[1], /0 0 0 3px var\(--color-accent\)/);

  assert.doesNotMatch(css, /\.colaboradores__ficha--seleccionada/, "la marca fija de la elegida se fue");
  assert.doesNotMatch(sinComentariosJs(JS), /seleccionada|aria-current/,
    "el script ya no marca la ficha elegida: la elección sólo decide la vista previa");
});

/*
  El enlace se apila SOBRE la ficha —que es un <button>, y un <a> adentro sería
  HTML inválido—, así que vive en la celda y se ancla en ella. Va al pie y al
  centro del círculo, fuera del recorte redondo de la ficha.
*/
test("the tile edit link is a pill at the bottom center of the circle, above the tile", () => {
  const css = sinComentariosCss(CSS);

  const celda = css.match(/\.colaboradores__celda\s*\{([^}]*)\}/);
  assert.ok(celda, "falta la regla de la celda");
  assert.match(celda[1], /position:\s*absolute/, "la celda la coloca el panal");
  assert.doesNotMatch(celda[1], /(?:^|[\s;])(?:translate|transform)\s*:|z-index/,
    "sin translate ni z-index: crearían un contexto de apilamiento que encierra a la ficha activa");

  const enlace = css.match(/\.colaboradores__editar\s*\{([^}]*)\}/);
  assert.ok(enlace, "falta la regla del enlace de editar");
  assert.match(enlace[1], /position:\s*absolute/);
  assert.match(enlace[1], /inset-inline-start:\s*calc\(50% \+ 35\.36% \* var\(--escala, 1\)\)/,
    "sobre el borde del círculo escalado, a la derecha");
  assert.match(enlace[1], /inset-block-start:\s*calc\(50% \+ 35\.36% \* var\(--escala, 1\)\)/, "y abajo");
  assert.match(enlace[1], /border-radius:\s*50%/, "una insignia redonda");
  assert.match(enlace[1], /z-index:\s*var\(--z-highlight\)/,
    "por encima de la ficha, que sube a --z-elevated cuando está activa");
  assert.match(css, /\.colaboradores__editar svg\s*\{[^}]*stroke:\s*currentColor/, "el lápiz toma el cian del enlace");

  assert.match(css, /\.colaboradores__editar:focus-visible/,
    "con teclado, el anillo es el mismo que el del resto de los enlaces");
  assert.doesNotMatch(css, /\.colaboradores__fila-etiqueta/, "la fila del rótulo ya no existe");
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

/*
  La modalidad de trabajo (presencial / híbrido / remoto) no tiene bueno ni
  malo: remoto no es peor que presencial. Un semáforo de color ahí se leería
  como una calificación de la persona, así que el valor queda como texto
  plano, igual que cualquier otro <dd> de la ficha.
*/
test("the work modality value is plain text, with no status dot", () => {
  const html = sinComentariosHtml(HTML);
  assert.doesNotMatch(html, /id="perfilPunto"/, "el punto de modalidad de trabajo ya no debe existir");

  const css = sinComentariosCss(CSS);
  assert.doesNotMatch(css, /\.colaboradores__punto\b/, "no debe quedar ninguna regla del punto");
  assert.doesNotMatch(css, /\.colaboradores__disponibilidad\b/, "no debe quedar el flex que alineaba punto y texto");

  const dd = html.match(/<dd[^>]*id="perfilModalidadTrabajo"[^>]*>/);
  assert.ok(dd, "falta el <dd> de modalidad de trabajo");
  assert.doesNotMatch(dd[0], /class="[^"]*colaboradores__(disponibilidad|punto)[^"]*"/, "el <dd> no debe traer clase de estado");
});

test("the page script never writes markup from data", () => {
  const js = sinComentariosJs(JS);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML/);
  // Las fichas son botones de verdad, con nombre accesible propio.
  assert.match(js, /createElement\("button"\)/);
  assert.match(js, /aria-label/);
  // Ningún estado visual (como el extinto punto de disponibilidad) se pinta
  // con estilos en línea: el color siempre vive en la hoja, vía clases. La
  // ÚNICA excepción es la geometría del panal (posición, diámetro, escala y el
  // alto propio en móvil), que es un cálculo y no un estado.
  const estilos = js.match(/\.style\b[^;]*/g) || [];
  const geometria = /^\.style\.(?:left|top|blockSize|minBlockSize)\s*=|^\.style\.setProperty\(`?"?--(?:diametro|escala)/;
  assert.deepEqual(estilos.filter((uso) => !geometria.test(uso)), [],
    "el script cambia de estado por clase; en línea sólo va la geometría del panal");
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

test("the tile grid is a honeycomb canvas placed by script, not a CSS grid", () => {
  const css = sinComentariosCss(CSS);
  const grilla = css.match(/\.colaboradores__grilla\s*\{([^}]*)\}/);
  assert.ok(grilla, "falta la regla de la grilla");
  assert.match(grilla[1], /position:\s*relative/, "es el ancla de las celdas absolutas");
  assert.doesNotMatch(grilla[1], /display:\s*grid|grid-template/,
    "las celdas se colocan con posicionesDelPanal(), no con columnas CSS");
  assert.match(css, /\.colaboradores__marco\s*\{[^}]*overflow:\s*hidden/,
    "el marco recorta: nada del panal mete scroll horizontal");
  assert.match(sinComentariosJs(JS), /posicionesDelPanal\(/);
  assert.match(sinComentariosJs(JS), /new ResizeObserver/);
});

/*
  El roster es una pantalla de selección: en escritorio entra ENTERO en el alto
  de la ventana, sin scroll de página, como el prototipo. La primera versión lo
  dejaba fluir y a 1907×1040 "¿Quién?" y la tarjeta de perfil caían bajo el
  pliegue. El alto sale de la ventana menos el despeje del navbar (el token) y
  el aire inferior; las filas de fichas se reparten ese alto por igual, así que
  el panal de círculos llena el marco, que es lo elástico.

  En ≤760px no hay forma de meter previa + panal + tarjeta en una pantalla:
  ahí la página vuelve a fluir y el panal se da su propio alto.
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

  assert.doesNotMatch(regla(".colaboradores__ficha"), /aspect-ratio/,
    "la ficha es un círculo de diámetro fijo por script: un 1:1 acá se pelearía con él");

  const movil = css.indexOf("@media (max-width: 760px)");
  assert.notEqual(movil, -1);
  assert.match(regla(".colaboradores__roster", movil), /block-size:\s*auto/,
    "en móvil el roster vuelve a fluir");
  assert.match(regla(".colaboradores__grilla", movil), /min-block-size:\s*\d+px/,
    "en móvil el panal se da su propio alto (script) y tiene un piso de respaldo");
  assert.match(regla(".colaboradores__previa", movil), /min-block-size:\s*3\d\dpx/,
    "la previa móvil es más alta para que el círculo sea grande");
});

test("motion is switched off for people who asked for less of it", () => {
  assert.match(sinComentariosCss(CSS), /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

/*
  colaboradores.fondo.js (y ahora slides.fondo.js y qr.fondo.js) copian a propósito las
  opciones de cargarParticulasFondo() para no tocar home.js. Una copia sin
  vigilancia se desfasa en silencio: acá se comparan los tres literales y el
  primero que cambie solo rompe la suite.
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
  const delHogar = opcionesDelFondo(HOME_JS, "home.js");
  assert.equal(propias, delHogar);
  // Slides es la tercera copia: si alguna de las tres se desajusta, la suite
  // debe fallar acá y no dejar que el cielo se vea distinto en una página.
  assert.equal(opcionesDelFondo(SLIDES_FONDO, "slides.fondo.js"), delHogar);
  assert.equal(opcionesDelFondo(QR_FONDO, "qr.fondo.js"), delHogar);
  assert.equal(opcionesDelFondo(SUBIDA_FONDO, "subida.fondo.js"), delHogar);
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

  const auth = posicion("/app/core/auth/auth.service.js");
  assert.ok(auth < navbar);
  assert.ok(auth < pagina, "la página le pregunta a auth quién está mirando");
  assert.ok(cliente < servicio, "el servicio usa supabaseClient");
  assert.ok(servicio < pagina, "la página le pide la lista al servicio");
  assert.ok(particulas < fondo, "tsParticles va antes del fondo que lo usa");
  assert.ok(datos < pagina, "la lógica del roster va antes de la página que la usa");
});

/*
  Las tres filas de etiquetas del perfil. Herramientas es obligatoria y su
  fila siempre tiene algo que mostrar; habilidades e idiomas son opcionales y
  su celda arranca `hidden` en el HTML estático —así una página sin JS, o el
  instante anterior al primer pintado, no muestra un rótulo vacío— y
  colaboradores.js la enciende cuando la lista trae algo.
*/
test("the profile has one wide row per tag list, and only the optional ones start hidden", () => {
  const celda = (id) => HTML.match(new RegExp(`<div[^>]*\\sid="${id}"[^>]*>`));

  for (const id of ["perfilHabilidadesCelda", "perfilIdiomasCelda"]) {
    const encontrada = celda(id);
    assert.ok(encontrada, `falta la celda #${id}`);
    assert.match(encontrada[0], /colaboradores__dato--ancho/, `#${id} tiene que ser fila ancha`);
    assert.match(encontrada[0], /\shidden[\s>]/, `#${id} tiene que arrancar oculta`);
  }

  // Herramientas no lleva celda con id: no hay nada que ocultar.
  assert.equal(HTML.includes("perfilHerramientasCelda"), false);

  // Habilidades va ARRIBA de Herramientas: primero lo que la persona sabe
  // hacer, después con qué lo hace. Idiomas cierra el grupo. El orden es del
  // marcado, no del pintado, así que se fija acá.
  const orden = ["perfilHabilidades", "perfilHerramientas", "perfilIdiomas"].map((id) => {
    const indice = HTML.indexOf(`id="${id}"`);
    assert.notEqual(indice, -1, `falta #${id}`);
    return indice;
  });
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, "habilidades tiene que ir antes que herramientas");

  // Las tres listas comparten la misma clase de píldoras, y cada una se
  // nombra a sí misma para el lector de pantalla.
  for (const [id, etiqueta] of [
    ["perfilHerramientas", "Herramientas"],
    ["perfilHabilidades", "Habilidades"],
    ["perfilIdiomas", "Idiomas"],
  ]) {
    const lista = HTML.match(new RegExp(`<ul[^>]*\\sid="${id}"[^>]*>`));
    assert.ok(lista, `falta la lista #${id}`);
    assert.match(lista[0], /class="colaboradores__etiquetas"/, `#${id} no usa la clase compartida`);
    assert.match(lista[0], new RegExp(`aria-label="${etiqueta}"`), `#${id} no se nombra`);
  }
});

/*
  La celda de la empresa va entre Puesto y Sector —se lee de corrido y
  completa las dos filas de tres— y arranca oculta, como las dos filas
  opcionales de etiquetas: sin nombre no hay nada que mostrar y quedan las
  cinco celdas de antes.
*/
test("the sector cell starts hidden and is a normal cell, not a wide row", () => {
  const celda = HTML.match(/<div[^>]*\sid="perfilSectorCelda"[^>]*>/);
  assert.ok(celda, "falta la celda #perfilSectorCelda");
  assert.match(celda[0], /\shidden[\s>]/, "opcional desde la 0042: arranca oculta");
  assert.equal(/colaboradores__dato--ancho/.test(celda[0]), false, "es una celda normal");
});

test("the company cell sits between the role and the sector, and starts hidden", () => {
  const celda = HTML.match(/<div[^>]*\sid="perfilEmpresaCelda"[^>]*>/);
  assert.ok(celda, "falta la celda #perfilEmpresaCelda");
  assert.match(celda[0], /\shidden[\s>]/, "la celda tiene que arrancar oculta");
  assert.equal(/colaboradores__dato--ancho/.test(celda[0]), false, "es una celda normal, no una fila ancha");

  const orden = ["perfilPuesto", "perfilEmpresa", "perfilSector"].map((id) => {
    const indice = HTML.indexOf(`id="${id}"`);
    assert.notEqual(indice, -1, `falta #${id}`);
    return indice;
  });
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, "la empresa no está entre el puesto y el sector");
});

test("the frame is a grab surface on desktop and takes the finger on mobile", () => {
  const css = sinComentariosCss(CSS);
  const marco = css.match(/\.colaboradores__marco\s*\{([^}]*)\}/);
  assert.match(marco[1], /cursor:\s*grab/);
  assert.doesNotMatch(marco[1], /touch-action/, "en escritorio el marco no le quita el gesto a la página");
  assert.match(css, /\.colaboradores__marco--arrastrando\s*\{[^}]*cursor:\s*grabbing[^}]*user-select:\s*none/);
  // En móvil el dedo arrastra el panal en vez de scrollear la página (pedido
  // del 14 de octubre): sólo dentro del marco.
  const movil = css.match(/@media \(max-width: 760px\)[\s\S]*?\.colaboradores__marco\s*\{([^}]*)\}/);
  assert.ok(movil, "hay regla del marco en el bloque móvil");
  assert.match(movil[1], /cursor:\s*auto/);
  assert.match(movil[1], /touch-action:\s*none/);
});

test("the script drags with the mouse's left button and, on mobile, with a finger or pen", () => {
  const js = sinComentariosJs(JS);
  assert.match(js, /evento\.pointerType === "mouse" \? evento\.button !== 0 : !esMovil/);
  // Un segundo dedo no arranca otro arrastre.
  assert.match(js, /if \(arrastre\) return;/);
  assert.match(js, /UMBRAL_ARRASTRE_TACTIL/);
});

test("on mobile a held finger in the honeycomb never selects text or opens the system menu", () => {
  // iPhone, 14 de octubre: mantener el dedo sobre una letra sacaba «Copiar ·
  // Traducir» y sobre la foto, «Guardar en Fotos».
  const css = sinComentariosCss(CSS);
  const regla = css.match(/@media \(max-width: 760px\)[\s\S]*?\.colaboradores__marco,\s*\.colaboradores__marco \*\s*\{([^}]*)\}/);
  assert.ok(regla, "el marco y todo lo que contiene tienen su regla en el bloque móvil");
  assert.match(regla[1], /-webkit-touch-callout:\s*none/);
  assert.match(regla[1], /-webkit-user-select:\s*none/);
  assert.match(regla[1], /(^|[^-])user-select:\s*none/);
  const js = sinComentariosJs(JS);
  assert.match(js, /el\.marco\.addEventListener\("contextmenu",\s*\(evento\) => evento\.preventDefault\(\)\)/);
});

test("on mobile the honeycomb is capped to part of the window, so the page can still scroll around it", () => {
  const js = sinComentariosJs(JS);
  const fraccion = Number(js.match(/const ALTO_MAXIMO_MOVIL = ([\d.]+);/)?.[1]);
  assert.ok(fraccion > 0 && fraccion <= 0.7, `el tope deja página fuera del marco (${fraccion})`);
  assert.match(js, /Math\.min\(necesario, tope\)/);
});

test("the script keeps clicks after a drag and stops its animation loop", () => {
  const js = sinComentariosJs(JS);
  assert.match(js, /addEventListener\("wheel",\s*hacerZoom,\s*\{\s*passive:\s*false\s*\}\)/);
  assert.match(js, /addEventListener\("click"[\s\S]*?,\s*true\)/, "el clic tras arrastrar se traga en captura");
  // El rAF sólo se vuelve a pedir si algo sigue moviéndose.
  assert.match(js, /if \(sigue\) cuadro = requestAnimationFrame/);
});

test("the summary has a fixed height on desktop, so hovering a card never resizes the honeycomb", () => {
  // Con alto libre, una bio larga encogía el marco, el panal se reacomodaba
  // bajo el cursor y la ficha "vibraba" (reporte del 14 de octubre).
  const regla = CSS.match(/\.colaboradores__resumen\s*\{([^}]*)\}/);
  assert.ok(regla, "existe la regla base del resumen");
  assert.match(regla[1], /block-size:\s*\d/);
  assert.match(regla[1], /overflow-y:\s*auto/);
});

test("photos and the edit link in the honeycomb never start a native drag", () => {
  // Empezar a arrastrar el panal sobre una foto sacaba la copia fantasma del
  // navegador y el panal no se movía (reporte del 14 de octubre).
  assert.match(JS, /imagen\.setAttribute\("draggable", "false"\)/);
  assert.match(JS, /enlace\.setAttribute\("draggable", "false"\)/);
  assert.match(JS, /el\.marco\.addEventListener\("dragstart", \(evento\) => evento\.preventDefault\(\)\)/);
  const foto = CSS.match(/\.colaboradores__ficha-foto\s*\{([^}]*)\}/);
  assert.match(foto[1], /-webkit-user-drag:\s*none/);
});

test("the large portrait photos never start a native drag either", () => {
  // Mismo fantasma que en el panal, pero en la vista previa y el perfil.
  for (const id of ["previaFoto", "perfilFoto"]) {
    assert.match(HTML, new RegExp(`<img[^>]*id="${id}"[^>]*draggable="false"`));
  }
  const regla = CSS.match(/\.colaboradores__retrato-foto\s*\{([^}]*)\}/);
  assert.match(regla[1], /-webkit-user-drag:\s*none/);
});
