/*
  La página "Mi ficha". Como colaboradores-pagina.test.js, éstas leen la
  fuente: fijan invariantes de maquetado, accesibilidad y seguridad que ningún
  test de comportamiento notaría si se rompen. El comportamiento se prueba en
  mi-ficha.interaccion.test.js y la lógica pura en mi-ficha.logica.test.js.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

const CARPETA = "src/app/features/colaboradores/mi-ficha";
const HTML = read(`${CARPETA}/index.html`);
const CSS = read(`${CARPETA}/mi-ficha.css`);
const JS = read(`${CARPETA}/mi-ficha.js`);
const LOGICA = read(`${CARPETA}/mi-ficha.logica.js`);

const { CAMPOS_MI_FICHA, MODALIDADES_TRABAJO_MI_FICHA } = require(`../${CARPETA}/mi-ficha.logica.js`);

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
// Comentarios de bloque y de línea. El `[^:]` deja pasar los `//` de una URL.
const sinComentariosJs = (js) => js
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const MARCADO = sinComentariosHtml(HTML);

// Las etiquetas de apertura de un tipo, con sus atributos.
const etiquetas = (nombre) => [...MARCADO.matchAll(new RegExp(`<${nombre}\\b[^>]*>`, "g"))].map(([etiqueta]) => etiqueta);
const atributo = (etiqueta, nombre) => etiqueta.match(new RegExp(`\\s${nombre}="([^"]*)"`))?.[1] ?? null;
const tieneAtributo = (etiqueta, nombre) => new RegExp(`\\s${nombre}(?:[\\s=>]|$)`).test(etiqueta);
const porId = (id) => {
  const encontrada = MARCADO.match(new RegExp(`<\\w+\\b[^>]*\\sid="${id}"[^>]*>`));
  assert.ok(encontrada, `falta #${id}`);
  return encontrada[0];
};

/* ---------- Cabecera ---------- */

test("the page stays out of the index", () => {
  assert.match(HTML, /<meta name="robots" content="noindex">/);
});

test("the page loads the shared stylesheets its markup uses, then its own", () => {
  const hojas = [
    "/styles.css",
    "/app/shared/floating-menu/floating-menu.css",
    "/app/shared/navbar/navbar.css",
    "/app/shared/button/button.css",
    "/app/shared/panel/panel.css",
    "/app/shared/field/field.css",
    "/app/shared/toast/toast.css",
    "/app/features/colaboradores/mi-ficha/mi-ficha.css",
  ];
  const posiciones = hojas.map((hoja) => {
    const indice = HTML.indexOf(`<link rel="stylesheet" href="${hoja}">`);
    assert.notEqual(indice, -1, `falta la hoja ${hoja}`);
    return indice;
  });
  assert.equal(Math.max(...posiciones), posiciones.at(-1), "la hoja propia va al final: le gana a las compartidas en la misma capa");
});

test("the page mounts the shared navbar without a hardcoded state", () => {
  assert.ok(HTML.includes('<nav class="navbar" aria-label="Navegación principal">'));
  // El href real es el respaldo si navbar.js no corre; acá no va un "#".
  assert.match(MARCADO, /<a href="\/app\/features\/auth\/login\/" id="accessBtn" class="navbar__link button button--access">Acceder<\/a>/);
  assert.ok(!HTML.includes("navbar--scrolled"));
});

test("scripts load in dependency order", () => {
  const orden = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
    "/app/core/supabase/supabase-client.js",
    "/app/core/auth/auth.service.js",
    "/app/shared/navbar/navbar.js",
    "/app/shared/toast/toast.js",
    "/app/features/auth/auth-ui.js",
    "/app/core/colaboradores/ficha.service.js",
    "/app/features/colaboradores/mi-ficha/mi-ficha.logica.js",
    "/app/core/tecnologias/catalogo.service.js",
    "/app/features/colaboradores/mi-ficha/mi-ficha.stack.logica.js",
    "/app/features/colaboradores/mi-ficha/mi-ficha.js",
  ];
  const posiciones = orden.map((src) => {
    const indice = HTML.indexOf(`<script src="${src}"></script>`);
    assert.notEqual(indice, -1, `falta el script ${src}`);
    return indice;
  });
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, "los scripts no están en orden de dependencia");

  // Ni un script más que los de la lista: cada uno declara globales, y uno de
  // más puede chocar con otro sin que nada lo anuncie.
  const todos = [...MARCADO.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map(([, src]) => src);
  assert.deepEqual(todos, orden);
});

/*
  Los scripts clásicos comparten el ámbito global: un `const` repetido en dos
  archivos tira un SyntaxError al cargar el segundo, y la página queda muerta.
  mi-ficha.js vive en un IIFE; su lógica, no.
*/
test("the pure logic declares no global that another script of the page already declares", () => {
  const globalesDe = (fuente) => new Set(
    [...fuente.matchAll(/^(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)].map(([, nombre]) => nombre),
  );
  const propias = globalesDe(LOGICA);
  assert.ok(propias.has("validarMiFicha"), "premisa: el barrido encuentra las declaraciones");

  for (const otro of [
    "src/app/core/supabase/supabase-client.js",
    "src/app/core/auth/auth.service.js",
    "src/app/shared/navbar/navbar.js",
    "src/app/shared/toast/toast.js",
    "src/app/features/auth/auth-ui.js",
    "src/app/core/colaboradores/ficha.service.js",
  ]) {
    const repetidas = [...globalesDe(read(otro))].filter((nombre) => propias.has(nombre));
    assert.deepEqual(repetidas, [], `${otro} ya declara ${repetidas.join(", ")}`);
  }

  assert.deepEqual([...globalesDe(JS)], [], "mi-ficha.js no deja nada en el ámbito global");
});

test("no inline scripts or on* handlers, no inline styles and no dead links", () => {
  assert.doesNotMatch(MARCADO, /<script(?![^>]*\ssrc=)[^>]*>/i);
  assert.doesNotMatch(MARCADO, /<\w+[^>]*\son[a-z]+\s*=/i);
  assert.doesNotMatch(MARCADO, /\sstyle="/);
  assert.doesNotMatch(MARCADO, /href="#"/);
});

/* ---------- Scripts ---------- */

test("the page never reports failures through the global operation channel", () => {
  // reportarFallo dispara un toast genérico en navbar.js: sumado al aviso
  // propio de la página serían dos avisos por un mismo fallo.
  assert.doesNotMatch(JS, /reportarFallo/);
  assert.doesNotMatch(LOGICA, /reportarFallo/);
});

test("the scripts never write markup from data", () => {
  for (const fuente of [JS, LOGICA]) {
    assert.doesNotMatch(sinComentariosJs(fuente), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  }
  assert.doesNotMatch(sinComentariosJs(JS), /\.style\b/, "los estados cambian por atributo o clase, no con estilos en línea");
});

test("the pure logic touches no DOM and exports through the module guard", () => {
  const logica = sinComentariosJs(LOGICA);
  assert.doesNotMatch(logica, /\b(?:document|window|localStorage|fetch)\b/);
  assert.match(LOGICA, /if \(typeof module === "object" && module\.exports\) \{/);
});

test("the page gates on a session and reads the collaborator mark from the profile", () => {
  const js = sinComentariosJs(JS);
  assert.match(js, /requerirSesion\(/);
  assert.match(js, /obtenerPerfil\(/);
  assert.match(js, /es_colaborador/);
  assert.match(js, /obtenerMiFicha\(/);
  assert.match(js, /guardarMiFicha\(/);
  assert.match(js, /establecerFormularioOcupado\(/);
});

/*
  obtenerPerfil() es la única lectura del perfil propio que tiene la página:
  sin estas dos columnas, nadie sería colaborador y no habría enlace al
  perfil público.
*/
test("the auth service's profile select brings the collaborator mark and the slug", () => {
  const servicio = read("src/app/core/auth/auth.service.js");
  const cuerpo = servicio.slice(servicio.indexOf("async function obtenerPerfil("));
  const select = cuerpo.match(/\.select\(\s*"([^"]*)"\s*\)/);
  assert.ok(select, "obtenerPerfil no tiene un select literal");
  const columnas = select[1].split(",").map((columna) => columna.trim());
  for (const columna of ["nombre", "apellidos", "telefono", "rol", "avisos_curso_nuevo", "es_colaborador", "slug"]) {
    assert.ok(columnas.includes(columna), `obtenerPerfil no lee ${columna}`);
  }
});

/* ---------- Estructura ---------- */

test("the content sits in the shared container and the offset derives from the navbar token", () => {
  assert.ok(HTML.includes('<main class="mi-ficha">'), "el <main> lleva sólo el bloque: el contenedor va en un hijo");
  assert.match(MARCADO, /class="mi-ficha__contenido u-contenedor u-contenedor--lectura"/);

  const css = sinComentariosCss(CSS);
  const regla = css.match(/\.mi-ficha\s*\{([^}]*)\}/);
  assert.ok(regla, "falta la regla .mi-ficha");
  assert.match(regla[1], /padding-block-start:\s*var\(--espacio-bajo-navbar\)/);
  assert.match(regla[1], /padding-inline:/);
  assert.doesNotMatch(css, /\.u-contenedor\s*\{/, "la hoja no redeclara el contenedor compartido");
});

test("the loading notice is a focusable status region with a hidden retry button and a hidden link to Colaboradores", () => {
  const aviso = porId("miFichaAviso");
  assert.equal(atributo(aviso, "role"), "status");
  assert.equal(atributo(aviso, "tabindex"), "-1");
  assert.ok(!tieneAtributo(aviso, "hidden"), "el aviso de carga se ve desde el primer momento");

  const reintentar = porId("miFichaReintentar");
  assert.equal(atributo(reintentar, "type"), "button");
  assert.ok(tieneAtributo(reintentar, "hidden"));

  const colaboradores = porId("miFichaIrColaboradores");
  assert.equal(atributo(colaboradores, "href"), "/app/features/colaboradores/");
  assert.ok(tieneAtributo(colaboradores, "hidden"));
});

test("the form panel starts hidden, the form skips native validation and has a focusable alert for server errors", () => {
  assert.ok(tieneAtributo(porId("miFichaContenido"), "hidden"));

  const form = porId("formMiFicha");
  assert.match(form, /^<form\b/);
  assert.ok(tieneAtributo(form, "novalidate"));

  const estado = porId("miFichaStatus");
  assert.equal(atributo(estado, "role"), "alert");
  assert.equal(atributo(estado, "tabindex"), "-1");
  assert.ok(tieneAtributo(estado, "hidden"));
});

test("the public-data warning comes before any field and the form points to it", () => {
  const aviso = "Todo lo que escribas aquí se muestra en la página pública de Colaboradores.";
  const posicion = MARCADO.indexOf(aviso);
  assert.notEqual(posicion, -1, "falta el aviso de datos públicos");
  assert.ok(posicion < MARCADO.indexOf("<input"), "el aviso va antes del primer campo");

  const publico = porId("miFichaPublico");
  assert.equal(atributo(publico, "tabindex"), "-1", "recibe el foco al mostrarse el formulario tras un reintento");
  assert.match(atributo(porId("formMiFicha"), "aria-describedby") || "", /\bmiFichaPublico\b/);
});

test("the name is read-only text with a link to change it in Mi cuenta", () => {
  // El destino es el mismo "Mi cuenta" del menú, en su sección de perfil.
  const navbar = read("src/app/shared/navbar/navbar.js");
  const miCuenta = navbar.match(/texto: "Mi cuenta",\s*href: "([^"]+)"/);
  assert.ok(miCuenta, "no se encontró la entrada Mi cuenta del navbar");

  const enlace = MARCADO.match(/<a\b[^>]*href="([^"]*)"[^>]*>Cambia tu nombre en Mi cuenta<\/a>/);
  assert.ok(enlace, "falta el enlace para cambiar el nombre");
  assert.equal(enlace[1], `${miCuenta[1]}#perfil`);

  const nombre = porId("miFichaNombre");
  assert.doesNotMatch(nombre, /^<(?:input|textarea|select)\b/, "el nombre no es un campo de este formulario");
});

test("the named controls follow the card order, so the first invalid field is the first on screen", () => {
  const nombres = [];
  for (const [etiqueta] of MARCADO.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)) {
    const nombre = atributo(etiqueta, "name");
    if (nombre && nombres.at(-1) !== nombre) nombres.push(nombre);
  }
  assert.deepEqual(nombres, [...CAMPOS_MI_FICHA]);
});

test("every control has a label tied by for", () => {
  const controles = [...MARCADO.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)].map(([etiqueta]) => etiqueta);
  assert.ok(controles.length >= 12, "premisa: el barrido encuentra los campos");
  for (const control of controles) {
    const id = atributo(control, "id");
    assert.ok(id, `un control sin id no se puede etiquetar: ${control}`);
    assert.match(MARCADO, new RegExp(`<label\\b[^>]*\\sfor="${id}"`), `#${id} no tiene <label for>`);
  }
});

test("every text control describes its hint and has a hidden error slot", () => {
  const campos = CAMPOS_MI_FICHA.filter((campo) => campo !== "modalidad_trabajo");
  for (const campo of campos) {
    const control = MARCADO.match(new RegExp(`<(?:input|textarea)\\b[^>]*\\sname="${campo}"[^>]*>`));
    assert.ok(control, `falta el control ${campo}`);
    const id = atributo(control[0], "id");

    const error = porId(`${id}Error`);
    assert.ok(tieneAtributo(error, "hidden"), `el error de ${campo} arranca oculto`);

    const describe = atributo(control[0], "aria-describedby");
    assert.ok(describe, `${campo} no describe su ayuda`);
    for (const referido of describe.split(/\s+/)) porId(referido);
  }
});

test("the bio is a textarea and the texts are plain text inputs, with the right input types for links", () => {
  assert.match(MARCADO, /<textarea\b[^>]*\sclass="field field--textarea"[^>]*\sname="bio"/);
  const tipoDe = (campo) => atributo(MARCADO.match(new RegExp(`<input\\b[^>]*\\sname="${campo}"[^>]*>`))[0], "type");
  for (const campo of ["puesto", "sector", "ubicacion", "stack"]) assert.equal(tipoDe(campo), "text", campo);
  assert.equal(tipoDe("anio_inicio"), "text", "type=number cambia con la rueda del mouse y acepta 1e3");
  assert.equal(atributo(MARCADO.match(/<input\b[^>]*\sname="anio_inicio"[^>]*>/)[0], "inputmode"), "numeric");
  assert.equal(tipoDe("linkedin"), "url");
  assert.equal(tipoDe("github"), "url");
  assert.equal(tipoDe("correo"), "email");
});

test("the stack field is a combobox wired to a listbox of suggestions and a tag list, with its own live region", () => {
  const stackInput = MARCADO.match(/<input\b[^>]*\sname="stack"[^>]*>/)[0];
  assert.equal(atributo(stackInput, "role"), "combobox");
  assert.equal(atributo(stackInput, "aria-autocomplete"), "list");
  assert.equal(atributo(stackInput, "aria-expanded"), "false");
  assert.equal(atributo(stackInput, "aria-controls"), "miFichaStackOpciones");

  const opciones = porId("miFichaStackOpciones");
  assert.match(opciones, /^<ul\b/);
  assert.equal(atributo(opciones, "role"), "listbox");
  assert.ok(tieneAtributo(opciones, "hidden"), "el desplegable arranca oculto");

  const lista = porId("miFichaStackLista");
  assert.match(lista, /^<ul\b/);

  // Región propia del widget, distinta de la de errores del servidor
  // (#miFichaStatus, que sigue existiendo con su propio role="alert").
  const estado = porId("miFichaStackEstado");
  assert.equal(atributo(estado, "role"), "status");
  assert.equal(atributo(estado, "aria-live"), "polite");
  assert.equal(atributo(porId("miFichaStatus"), "role"), "alert");
});

test("work modality is a radio group in a fieldset with a legend, with exactly the card values", () => {
  const fieldset = MARCADO.match(/<fieldset\b[^>]*\sid="miFichaModalidadTrabajo"[^>]*>([\s\S]*?)<\/fieldset>/);
  assert.ok(fieldset, "falta el fieldset de modalidad de trabajo");
  assert.match(fieldset[1], /<legend\b[^>]*>[^<]*Modalidad de trabajo/);

  const radios = [...fieldset[1].matchAll(/<input\b[^>]*>/g)].map(([etiqueta]) => etiqueta);
  assert.deepEqual(radios.map((radio) => atributo(radio, "type")), radios.map(() => "radio"));
  assert.deepEqual(radios.map((radio) => atributo(radio, "name")), radios.map(() => "modalidad_trabajo"));
  assert.deepEqual(radios.map((radio) => atributo(radio, "value")), [...MODALIDADES_TRABAJO_MI_FICHA]);
  assert.ok(radios.every((radio) => !tieneAtributo(radio, "checked")), "ninguna opción arranca marcada");

  // Los value del HTML tienen que coincidir byte a byte con la constante: si
  // "Híbrido" quedara en NFD (i + U+0301) se vería idéntico en pantalla, pero
  // dejaría de ser el mismo texto que espera la base (ver la 0040).
  for (const radio of radios) {
    const valor = atributo(radio, "value");
    assert.equal(valor, valor.normalize("NFC"), `el value "${valor}" no está en NFC`);
  }

  assert.ok(tieneAtributo(porId("miFichaModalidadTrabajoError"), "hidden"));
});

test("Proyectos is a disabled field with a note, and it is never sent", () => {
  const proyectos = porId("miFichaProyectos");
  assert.match(proyectos, /^<input\b/);
  assert.ok(tieneAtributo(proyectos, "disabled"));
  assert.equal(atributo(proyectos, "name"), null, "sin name no viaja con el formulario");
  assert.match(MARCADO, /<label\b[^>]*for="miFichaProyectos"[^>]*>Proyectos<\/label>/);

  const nota = porId(atributo(proyectos, "aria-describedby"));
  assert.ok(nota);
  assert.match(MARCADO, /Llegará cuando exista la sección de proyectos\./);
});

test("the submit button shows a loading text and the profile link starts hidden", () => {
  const boton = MARCADO.match(/<button\b[^>]*type="submit"[^>]*>([^<]*)<\/button>/);
  assert.ok(boton, "falta el botón de guardar");
  assert.match(boton[0], /class="button button--glow"/);
  assert.match(boton[0], /data-loading-text="Guardando…"/);
  assert.equal(boton[1].trim(), "Guardar ficha");

  const verPerfil = porId("miFichaVerPerfil");
  assert.match(verPerfil, /^<a\b/);
  assert.ok(tieneAtributo(verPerfil, "hidden"));
  assert.equal(atributo(verPerfil, "href"), "/app/features/colaboradores/");
});

test("visible copy uses tuteo, never voseo", () => {
  const texto = MARCADO.replace(/<[^>]+>/g, " ").toLowerCase();
  const palabras = texto.split(/[^\p{L}]+/u);
  for (const voseo of ["escribí", "elegí", "usá", "revisá", "poné", "podés", "tenés", "cambiá", "separalas", "separá"]) {
    assert.ok(!palabras.includes(voseo), `la página dice "${voseo}"`);
  }
});

/* ---------- Hoja de estilos ---------- */

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
  const fueraDelSet = [];
  for (const [, condiciones] of sinComentariosCss(CSS).matchAll(/@media\s*\(([^)]*)\)/g)) {
    assert.doesNotMatch(condiciones, /min-width/, `min-width no es parte del sistema: ${condiciones}`);
    for (const [texto, valor] of condiciones.matchAll(/max-width:\s*(\d+)px/g)) {
      if (!BREAKPOINTS_DOCUMENTADOS.includes(Number(valor))) fueraDelSet.push(texto);
    }
  }
  assert.deepEqual(fueraDelSet, []);
});

test("the stylesheet takes its colors, radii and focus ring from the tokens", () => {
  const css = sinComentariosCss(CSS);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "los colores salen de los tokens de styles.css");
  assert.match(css, /outline:\s*var\(--focus-ring\)/);
  assert.match(css, /outline-offset:\s*var\(--focus-ring-offset\)/);
  // Ninguna regla de la página redefine el navbar compartido.
  assert.doesNotMatch(css, /\.(?:navbar|nav-menu)/);
});

test("the disabled field style is scoped to this page, not to the shared .field", () => {
  const css = sinComentariosCss(CSS);
  // Lo que precede a cada `{`: selectores de regla y preludios de @layer/@media.
  const selectores = [...css.matchAll(/([^{};]+)\{/g)].map(([, selector]) => selector.trim());
  const deField = selectores.flatMap((lista) => lista.split(",").map((selector) => selector.trim()))
    .filter((selector) => /\.field\b/.test(selector));
  assert.ok(deField.length > 0, "premisa: la página le da estilo al campo apagado");
  for (const selector of deField) {
    assert.match(selector, /^\.mi-ficha/, `"${selector}" toca .field fuera de la página`);
  }
});

/*
  `element.children` es una HTMLCollection: se puede indexar y recorrer con
  for...of, pero NO tiene .map, .filter, .forEach ni .slice. El DOM falso de
  tests/mi-ficha.interaccion.test.js la finge con un arreglo de verdad, así
  que un `.children.map(...)` pasa la suite en verde y revienta en el
  navegador — y justo el arrastre, que es lo único que los tests no ejercitan.
  Por eso el guardián se lee del código fuente y no de un comportamiento.
*/
test("the wiring never calls array methods on a live HTMLCollection", () => {
  const sospechosos = [...JS.matchAll(/\.children\s*\.\s*(\w+)/g)].map(([, metodo]) => metodo);
  const deArreglo = sospechosos.filter((metodo) =>
    ["map", "filter", "forEach", "slice", "reduce", "some", "every", "find", "findIndex", "flatMap", "includes", "indexOf", "sort", "reverse", "at", "join"].includes(metodo),
  );
  assert.deepEqual(deArreglo, [], "copia la colección con Array.from(...) antes de recorrerla");
});
