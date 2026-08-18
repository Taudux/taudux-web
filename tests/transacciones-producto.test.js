/* El selector de producto: BBVA Débito o BBVA Crédito.
 *
 * Por qué existe este test. Los dos extractores leen los montos por posición,
 * contra umbrales distintos. Mandar un estado de débito al extractor de crédito
 * NO produce un error: devuelve la tabla completa, con las cifras en la columna
 * que no es. Es el modo de falla que este proyecto persigue en todos lados —
 * "nada falla visiblemente"— así que el contrato entre la vista y la API es
 * justo lo que hay que blindar.
 *
 * Se verifica sobre los archivos, no sobre un navegador: es la misma forma que
 * usa `navbar-jerarquia.test.js`, y alcanza porque lo que se afirma es el
 * contrato, no el pintado.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const VISTA = "src/app/features/transactions/index.html";
const SCRIPT = "src/app/features/transactions/transacciones.js";

test("the view offers both BBVA products as radios under one name", () => {
  const html = read(VISTA);

  ["credito", "debito"].forEach((valor) => {
    assert.match(
      html,
      new RegExp(`<input[^>]*type="radio"[^>]*value="${valor}"`),
      `falta el radio de ${valor}`
    );
  });

  // Un solo `name` los agrupa: sin eso el navegador los trata como casillas
  // sueltas y se pueden marcar los dos a la vez.
  const nombres = html.match(/<input[^>]*type="radio"[^>]*name="producto"/g) || [];
  assert.equal(nombres.length, 2, 'ambos radios deben compartir name="producto"');
});

test("exactly one product comes preselected", () => {
  const html = read(VISTA);
  const marcados = html.match(/<input[^>]*type="radio"[^>]*\schecked/g) || [];

  // Ninguno marcado deja al usuario mandar el formulario sin elegir, y la API
  // caería a su valor por defecto sin que él lo sepa. Dos marcados es HTML
  // inválido y el navegador resuelve el empate por su cuenta.
  assert.equal(marcados.length, 1, "debe venir exactamente uno preseleccionado");
});

test("the radio group is announced as a group, not as two loose options", () => {
  const html = read(VISTA);

  // Sin fieldset/legend, un lector de pantalla lee "crédito, botón de opción"
  // sin decir nunca de qué se trata la elección. Esta vista es la que mejor
  // accesibilidad tiene del repo (live region, aria-busy, foco al error) y el
  // control nuevo no puede bajar esa vara.
  assert.match(html, /<fieldset[^>]*>/, "los radios deben ir en un <fieldset>");
  assert.match(html, /<legend[^>]*>/, "el <fieldset> necesita su <legend>");
});

test("the chosen product travels with the file", () => {
  const js = read(SCRIPT);

  // El archivo sin el producto haría que la API resuelva por su cuenta: hoy
  // caería a crédito, que es exactamente la clasificación equivocada para
  // quien subió un estado de débito.
  assert.match(
    js,
    /cuerpo\.append\(\s*"producto"/,
    "el FormData debe llevar el campo producto"
  );
});

test("the product cannot be changed while a file is being processed", () => {
  const js = read(SCRIPT);

  // El mismo interruptor que apaga el input de archivo tiene que apagar los
  // radios: cambiar el producto a mitad de un envío deja la pantalla diciendo
  // una cosa y el servidor procesando otra.
  assert.match(
    js,
    /radiosProducto[\s\S]{0,200}disabled\s*=\s*ocupado/,
    "los radios deben deshabilitarse junto al input mientras procesa"
  );
});
