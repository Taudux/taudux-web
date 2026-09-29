/* La puerta de los Términos y el aviso de que nada se guarda.
 *
 * Por qué existe este test. El extractor procesa estados de cuenta, y la ley
 * exige consentimiento EXPRESO para tratar información financiera; los propios
 * Términos (cláusulas IV, XIII y XV) dicen que aceptarlos no lo sustituye. La
 * puerta de entrada es lo que recaba ese consentimiento, así que lo que aquí se
 * blinda no es estética: si la puerta se puede saltar, si enlaza a una página
 * que no existe, o si dice una versión distinta a la publicada, el
 * consentimiento que registra no vale lo que aparenta.
 *
 * También blinda el otro lado: la API se despliega aparte de esta página, y la
 * página NO puede encerrar a nadie detrás de un cuadro que no se cierra
 * mientras esa API no conozca los términos (404 en /api/terminos/aceptar).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const SCRIPT = "src/app/features/transactions/extractor.js";
const PAGINA = "src/app/features/transactions/index.html";
const ESTILOS = "src/app/features/transactions/extractor.css";
const TERMINOS = "src/app/features/legal/terminos.html";

const sinComentariosJs = (js) => js
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

/** Extrae una función de nivel superior del script y la evalúa aislada. */
function funcion(nombre) {
  const js = read(SCRIPT);
  const inicio = js.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `debe existir la función ${nombre}()`);
  let profundidad = 0;
  for (let i = js.indexOf("{", inicio); i < js.length; i += 1) {
    if (js[i] === "{") profundidad += 1;
    if (js[i] === "}") profundidad -= 1;
    if (profundidad === 0) {
      return vm.runInNewContext(`(${js.slice(inicio, i + 1)})`);
    }
  }
  throw new Error(`no se pudo aislar ${nombre}()`);
}

test("both doors exist, start hidden, and live outside <main> so the page can go inert", () => {
  const html = read(PAGINA);
  for (const id of ["puertaTerminos", "puertaAviso"]) {
    assert.match(html, new RegExp(`id="${id}" hidden role="dialog" aria-modal="true"`),
                 `${id} debe ser un diálogo modal que arranca oculto`);
  }
  assert.ok(html.indexOf("</main>") < html.indexOf('id="puertaTerminos"'),
            "las puertas van fuera de <main>: el resto del body se marca inert");
  assert.match(html, /id="btnAceptarTerminos" disabled/,
               "Continuar arranca deshabilitado hasta que la frase esté completa");
  assert.match(html, /id="btnAvisoEntendido"/);
  assert.match(html, /id="btnAvisoNoMostrar"/);
});

test("the terms door carries the express consent and the simplified privacy notice", () => {
  const html = read(PAGINA);
  const puerta = html.slice(html.indexOf('id="puertaTerminos"'), html.indexOf('id="puertaAviso"'));
  assert.match(puerta, /consentimiento expreso/, "la declaración debe nombrar el consentimiento expreso");
  assert.match(puerta, /acepto términos y condiciones/, "debe mostrar la frase a escribir");
  // Aviso simplificado: responsable, finalidad y dónde leer el integral.
  assert.match(puerta, /Responsable: René Samael Flores Ortega/);
  assert.match(puerta, /Finalidad:/);
  assert.match(puerta, /Aviso de Privacidad Integral/);
});

test("the terms door opens with the 'not stored' seal, before anything formal", () => {
  // El cuadro es formal a propósito, y quien desconfía abandona ahí, antes de
  // llegar al aviso que dice que nada se guarda. El sello lo adelanta: tiene
  // que ser lo PRIMERO de la caja, y remitir al paso donde está el detalle.
  const html = read(PAGINA);
  const caja = html.slice(html.indexOf('id="puertaTerminos"'));
  const primero = caja.slice(caja.indexOf('<div class="puerta__caja">') + '<div class="puerta__caja">'.length)
    .trimStart();
  assert.ok(primero.startsWith('<p class="puerta__sello">'),
            "el sello va antes que el título y el extracto");
  const sello = primero.slice(0, primero.indexOf("</p>"));
  assert.match(sello, /no se guarda/, "el sello dice que el estado de cuenta no se guarda");
  assert.match(sello, /siguiente paso/, "y remite al aviso que lo detalla");
});

test("the door links to legal pages that exist", () => {
  const html = read(PAGINA);
  const puerta = html.slice(html.indexOf('id="puertaTerminos"'), html.indexOf('id="puertaAviso"'));
  for (const destino of ["/app/features/legal/terminos.html", "/app/features/legal/privacidad.html"]) {
    assert.ok(puerta.includes(`href="${destino}"`), `la puerta debe enlazar ${destino}`);
    assert.ok(fs.existsSync(path.join(ROOT, "src", destino)), `${destino} debe existir`);
  }
});

test("the version shown, the version accepted and the version published are the same", () => {
  const js = read(SCRIPT);
  const enScript = js.match(/const TERMINOS_VERSION_LOCAL = "([^"]+)"/);
  assert.ok(enScript, "el script debe declarar la versión que acepta");
  const enPuerta = read(PAGINA).match(/<span data-terminos-version>([^<]+)<\/span>/);
  assert.ok(enPuerta, "la puerta debe mostrar la versión");
  const publicada = read(TERMINOS).match(/Versión ([0-9.]+)/);
  assert.ok(publicada, "la página de Términos debe declarar su versión");
  assert.equal(enPuerta[1], enScript[1], "la puerta y el script dicen versiones distintas");
  assert.equal(publicada[1], enScript[1], "se aceptaría una versión que no es la publicada");
});

test("the published terms keep every clause of the document", () => {
  const html = read(TERMINOS);
  const clausulas = html.match(/<h2 class="legal__section-title">[IVXL]+\. /g) || [];
  assert.equal(clausulas.length, 64, "los Términos tienen 64 cláusulas numeradas");
  assert.match(html, /id="transitorio"/, "y el transitorio único");
});

test("the phrase is compared without accents, capitals or final punctuation — and nothing else passes", () => {
  const normalizarFrase = funcion("normalizarFrase");
  const FRASE = read(SCRIPT).match(/const FRASE_ACEPTACION = "([^"]+)"/)[1];
  for (const buena of ["acepto terminos y condiciones", "ACEPTO TÉRMINOS Y CONDICIONES",
                       "Acepto términos y condiciones.", "  acepto   términos y condiciones! "]) {
    assert.equal(normalizarFrase(buena), FRASE, `"${buena}" debe valer`);
  }
  for (const mala of ["acepto", "acepto los términos", "sí", "", "acepto términos y condiciones de uso"]) {
    assert.notEqual(normalizarFrase(mala), FRASE, `"${mala}" no debe valer`);
  }
});

test("every server answer can reopen the door, and a missing endpoint never locks anyone out", () => {
  const js = sinComentariosJs(read(SCRIPT));
  const cuota = js.slice(js.indexOf("function actualizarCuota("));
  assert.match(cuota.slice(0, 8000), /revisarPuertas\(cuota\.terminos \|\| terminosLocales\(\)\)/,
               "cada cuota decide la puerta; sin `terminos` decide el registro local");
  assert.match(js, /json\.error === "terminos_no_aceptados"\) revisarPuertas\(json\.terminos\)/,
               "un 403 de la API reabre la puerta");
  const aceptar = js.slice(js.indexOf('apiFetch("/api/terminos/aceptar"'));
  assert.match(aceptar.slice(0, 1500), /respuesta\.status === 404/,
               "si la API aún no tiene el endpoint, se registra aquí y se sigue");
  assert.match(aceptar, /apiFetch\(/, "la aceptación va por apiFetch: lleva la identidad");
});

test("storage is always guarded: a blocked localStorage must not take the page down", () => {
  const js = sinComentariosJs(read(SCRIPT));
  const lecturas = js.match(/localStorage\.(getItem|setItem)/g) || [];
  const protegidas = js.match(/try \{ (return )?localStorage\.(getItem|setItem)/g) || [];
  assert.equal(protegidas.length, lecturas.length,
               "cada acceso a localStorage del extractor va dentro de try");
});

test("the doors sit above every other layer of the page", () => {
  const css = read(ESTILOS);
  assert.match(css, /\.puerta \{[^}]*z-index: 1500/, "las puertas van en 1500");
  const numeros = (css.match(/z-index:\s*(\d+)/g) || []).map((z) => Number(z.match(/\d+/)[0]));
  assert.equal(Math.max(...numeros), 1500, "nada de la página puede quedar por encima");
});
