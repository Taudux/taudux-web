const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const leer = (ruta) => fs.readFileSync(path.join(ROOT, ruta), "utf8");

const HTML = leer("src/app/features/slides/index.html");
const JS = leer("src/app/features/slides/slides.js");
const CSS = leer("src/app/features/slides/slides.css");

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const sinComentariosJs = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/*
  La página de Slides: catálogo con tarjetas nuevas, filtros por categoría,
  desplegable de privadas y formulario de subida. No hay DOM en Node, así que
  esto fija la estructura y las reglas que la prueba de navegador comprueba
  después: lo que va escrito en el HTML, el JS y el CSS.
*/

const marcado = sinComentariosHtml(HTML);

function posicion(fragmento) {
  const indice = marcado.indexOf(fragmento);
  assert.notEqual(indice, -1, `falta ${fragmento} en index.html`);
  return indice;
}

/* ---------- HTML ---------- */

test("el botón «Subir presentación» está a la derecha del título y arranca oculto", () => {
  assert.match(marcado, /<button[^>]*id="slidesSubir"[^>]*\shidden[^>]*>/);
  assert.match(marcado, /Subir presentación\s*<\/button>/);
  assert.ok(posicion('id="slidesTitulo"') < posicion('id="slidesSubir"'), "el botón va después del título");
  assert.match(marcado, /slides__titulo-fila/);
});

test("el orden del catálogo es: aviso, desplegable de privadas, filtros, grilla", () => {
  const orden = ['id="slidesAviso"', 'id="slidesPrivadas"', 'id="slidesFiltros"', 'id="slidesGrilla"'].map(posicion);
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b));
});

test("el desplegable de privadas es un <details> cerrado y oculto hasta que haya algo", () => {
  const etiqueta = /<details[^>]*id="slidesPrivadas"[^>]*>/.exec(marcado)[0];
  assert.match(etiqueta, /class="slides__privadas"/);
  assert.match(etiqueta, /\shidden/);
  assert.doesNotMatch(etiqueta, /\sopen[\s>]/, "arranca cerrado");
  assert.match(marcado, /<summary[^>]*id="slidesPrivadasTitulo"/);
});

test("la fila de filtros es un grupo con nombre accesible y arranca oculta", () => {
  const etiqueta = /<div[^>]*id="slidesFiltros"[^>]*>/.exec(marcado)[0];
  assert.match(etiqueta, /role="group"/);
  assert.match(etiqueta, /aria-label="[^"]+"/);
  assert.match(etiqueta, /\shidden/);
});

test("el formulario es un <dialog> con todos sus campos", () => {
  assert.match(marcado, /<dialog[^>]*id="slidesDialogo"[^>]*aria-labelledby="slidesDialogoTitulo"/);
  for (const id of [
    "slidesFormTitulo", "slidesFormDescripcion", "slidesFormCategoria", "slidesFormPortada",
    "slidesFormArchivo", "slidesFormAutor",
  ]) {
    assert.match(marcado, new RegExp(`id="${id}"`), `falta el campo ${id}`);
    assert.match(marcado, new RegExp(`for="${id}"`), `${id} no tiene <label>`);
  }
});

test("la categoría es un <input list> con su <datalist>", () => {
  const entrada = /<input[^>]*id="slidesFormCategoria"[^>]*>/.exec(marcado)[0];
  const lista = /list="([^"]+)"/.exec(entrada);
  assert.ok(lista, "el input no apunta a un datalist");
  assert.match(marcado, new RegExp(`<datalist id="${lista[1]}"`));
});

test("la portada acepta sólo JPG, PNG y WebP, y el archivo sólo HTML", () => {
  assert.match(marcado, /id="slidesFormPortada"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(marcado, /id="slidesFormArchivo"[^>]*accept="\.html,\.htm,text\/html"/);
});

test("el autor y la visibilidad son sólo del administrador: arrancan ocultos", () => {
  assert.match(marcado, /id="slidesFormAutorCampo"[^>]*\shidden/);
  assert.match(marcado, /id="slidesFormVisibilidadCampo"[^>]*\shidden/);
  assert.match(marcado, /<select[^>]*id="slidesFormAutor"[^>]*\srequired/);
});

test("la visibilidad ofrece «Solo administradores» (por defecto) y «Público», y nada más", () => {
  const radios = [...marcado.matchAll(/<input type="radio" name="visibilidad" value="([a-z_]+)"([^>]*)>/g)];
  assert.deepEqual(radios.map((r) => r[1]), ["admins", "publico"]);
  assert.match(radios[0][2], /checked/);
  assert.match(marcado, /🔒 Solo administradores/);
  assert.match(marcado, /<span>Público<\/span>/);
});

test("el autor ve que lo suyo se publica tras la revisión de un administrador", () => {
  assert.match(marcado, /id="slidesFormNotaAutor"[^>]*\shidden[^>]*>Se publicará cuando un administrador la revise\./);
});

test("cada error del formulario se anuncia (role=alert) y se enlaza con su campo", () => {
  const errores = [...marcado.matchAll(/id="(slidesForm\w+Error)"[^>]*role="alert"/g)].map((m) => m[1]);
  assert.ok(errores.length >= 6, "hay un error por campo");
  for (const id of ["slidesFormTituloError", "slidesFormCategoriaError", "slidesFormArchivoError"]) {
    assert.ok(errores.includes(id), `falta ${id}`);
    assert.match(marcado, new RegExp(`aria-describedby="[^"]*${id}`), `${id} no está enlazado`);
  }
});

test("los scripts cargan en orden: la lógica antes del servicio, y ambos antes de la página", () => {
  const orden = [
    "/app/core/supabase/supabase-client.js",
    "/app/core/auth/auth.service.js",
    "/app/features/slides/slides.logica.js",
    "/app/core/slides/slides.service.js",
    "/app/shared/toast/toast.js",
    "/app/features/slides/slides.js",
  ].map((src) => posicion(`<script src="${src}"></script>`));
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b));
});

/* ---------- JS ---------- */

const js = sinComentariosJs(JS);

test("el desplegable recuerda su estado en localStorage, siempre dentro de try/catch", () => {
  assert.match(js, /taudux_slides_privadas_abiertas/);
  assert.match(js, /try \{\s*return window\.localStorage\.getItem\(llave\);\s*\} catch/);
  assert.match(js, /try \{\s*window\.localStorage\.setItem\(llave, valor\);\s*\} catch/);
  assert.equal((js.match(/localStorage/g) || []).length, 2, "localStorage sólo se toca en los dos helpers con try/catch");
});

test("los títulos del desplegable son los acordados para administrador y autor", () => {
  assert.match(JS, /🔒 Solo administradores · \$\{delDesplegable\.length\}/);
  assert.match(JS, /"Mis presentaciones por revisar"/);
});

test("la fila de filtros se oculta con una sola categoría y marca el botón activo con aria-pressed", () => {
  assert.match(js, /el\.filtros\.hidden = categorias\.length <= 1/);
  assert.match(js, /\{ texto: "Todas", clave: "" \}\]\.concat\(/);
  assert.match(js, /setAttribute\("aria-pressed", String\(clave === categoriaActiva\)\)/);
});

test("cada tarjeta lleva la descripción como title y aria-describedby, no como texto visible", () => {
  assert.match(js, /boton\.title = presentacion\.descripcion/);
  assert.match(js, /setAttribute\("aria-describedby", descripcion\.id\)/);
  assert.match(js, /descripcion\.className = "u-visually-hidden"/);
  assert.doesNotMatch(js, /slides__tarjeta-descripcion/);
});

test("la portada es lazy, cae al degradado si no carga y lleva «N láminas»", () => {
  assert.match(js, /imagen\.loading = "lazy"/);
  assert.match(js, /imagen\.addEventListener\("error", \(\) => imagen\.remove\(\)\)/);
  assert.match(js, /degradadoDeCategoria\(presentacion\.categoria\)/);
  assert.match(js, /textoLaminas\(presentacion\.total_laminas\)/);
  assert.match(js, /fechaCorta\(presentacion\.actualizado\)/);
});

test("el botón de subir sólo se muestra a administradores y autores", () => {
  assert.match(js, /el\.subir\.hidden = !\(hayFormulario && \(permisos\.admin \|\| permisos\.autor\)\)/);
});

test("«Publicar» sólo se ofrece al administrador y sólo en lo «por revisar»", () => {
  assert.match(js, /permisos\.admin && presentacion\.visibilidad === "por_revisar"/);
  assert.match(js, /publicar\.textContent = "Publicar"/);
});

test("un autor sólo ve en el desplegable lo suyo por revisar", () => {
  assert.match(js, /privadas\.filter\(\(item\) => item\.visibilidad === "por_revisar"\)/);
});

test("la portada del formulario se recorta y se reduce a 1200x750 en un canvas, y sale WebP", () => {
  assert.match(js, /createImageBitmap\(archivo\)/);
  assert.match(js, /rectanguloDeRecorte\(imagen\.width, imagen\.height\)/);
  assert.match(js, /lienzo\.width = PORTADA_ANCHO/);
  assert.match(js, /toBlob\(resolver, "image\/webp"/);
  const logica = require(path.join(ROOT, "src/app/features/slides/slides.logica.js"));
  assert.equal(logica.PORTADA_ANCHO, 1200);
  assert.equal(logica.PORTADA_ALTO, 750);
});

test("las láminas del archivo se cuentan en el navegador, parseando sin ejecutar", () => {
  assert.match(js, /new DOMParser\(\)\.parseFromString\(texto, "text\/html"\)/);
  assert.match(js, /contarLaminas\(documento\)/);
});

test("el visor le da el marco transparente a los decks subidos y esconde sus botones si el deck trae los suyos", () => {
  assert.match(js, /classList\.toggle\("slides__marco--subida", presentacion\.origen === "subida"\)/);
  assert.match(js, /el\.controles\.hidden = deck\.controlesPropios === true/);
  assert.match(js, /detalle\.controlesPropios/);
});

test("no se arma HTML con texto de la base: todo entra por textContent", () => {
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.doesNotMatch(js, /insertAdjacentHTML/);
});

/* ---------- CSS ---------- */

const css = sinComentariosCss(CSS);

test("la tarjeta tiene portada 16:10 con esquinas redondeadas y título de dos líneas", () => {
  assert.match(css, /\.slides__portada \{[^}]*aspect-ratio: 16 \/ 10;[^}]*border-radius: 14px/);
  assert.match(css, /\.slides__tarjeta-titulo \{[^}]*-webkit-line-clamp: 2;[^}]*line-clamp: 2/);
  assert.match(css, /\.slides__categoria \{[^}]*text-transform: uppercase;[^}]*color: var\(--color-accent\)/);
});

test("al pasar el mouse la portada sube y se ilumina; sin movimiento no sube", () => {
  assert.match(css, /\.slides__tarjeta:hover \.slides__portada,\s*\.slides__tarjeta:focus-visible \.slides__portada \{[^}]*translateY\(-4px\)[^}]*box-shadow/);
  const reducido = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*\}\s*$/.exec(css)[1];
  assert.match(reducido, /\.slides__portada,/);
  assert.match(reducido, /transition: none/);
  assert.match(reducido, /\.slides__tarjeta:hover \.slides__portada[\s\S]*transform: none/);
});

test("el botón de subir es una píldora con el degradado #00d7ff a #4f8cff, texto oscuro y resplandor cian", () => {
  const regla = /\.slides__subir \{([^}]*)\}/.exec(css)[1];
  assert.match(regla, /border-radius: var\(--radius-pill\)/);
  assert.match(regla, /linear-gradient\(135deg, #00d7ff, #4f8cff\)/);
  assert.match(regla, /color: #04121a/);
  assert.match(regla, /box-shadow: 0 0 22px/);
});

test("el marco de un deck subido es transparente y en pantalla completa llena la ventana", () => {
  assert.match(css, /\.slides__marco--subida \{\s*background: transparent;/);
  assert.match(css, /\.slides__marco--subida:fullscreen \.slides__iframe,[\s\S]*?\{\s*inline-size: 100vw;\s*block-size: 100vh;/);
  // El marco negro de los decks del repositorio no cambia.
  assert.match(css, /\.slides__marco \{[^}]*background: #000;/);
});

test("los campos que ocultan con el atributo hidden no los pisa un display de la hoja", () => {
  assert.match(css, /\.slides-page \[hidden\] \{\s*display: none;/);
});

test("la hoja no declara color-scheme: el puente tiene que igualar a su contenedor", () => {
  assert.doesNotMatch(css, /color-scheme/);
});
