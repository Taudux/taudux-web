/* La barra de scroll de la página, con el degradado de la marca.
 *
 * Hasta el 2026-09-24 la página usaba la barra del sistema: en Windows, un
 * riel gris claro con flechas, pegado a un sitio entero en fondo oscuro. Se
 * eligió el diseño "Degradado" entre tres probados en el navegador: 8 px, del
 * azul del logo al cian, sobre un riel oscuro, con flechas cian.
 *
 * Los asertos miran la hoja, no el navegador: que el degradado se VEA lo
 * comprueba Chrome, no esta suite.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ESTILOS = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");

const regla = (selector) => {
  const inicio = ESTILOS.indexOf(`${selector} {`);
  assert.notEqual(inicio, -1, `falta la regla ${selector} en styles.css`);
  return ESTILOS.slice(inicio, ESTILOS.indexOf("}", inicio));
};

test("the page scrollbar is 8px wide on a dark track", () => {
  assert.match(regla("html::-webkit-scrollbar"), /width:\s*8px/);
  assert.match(regla("html::-webkit-scrollbar-track"), /background:\s*#0b0d10/);
});

test("the page scrollbar keeps its arrows, drawn as cyan triangles", () => {
  /*
    Se quitaron en la primera versión (2026-09-24) y Jorge las pidió de vuelta
    el mismo día: sin flechas la barra se leía incompleta. Son dos triángulos
    en SVG del color de acento, sobre el mismo riel oscuro.
  */
  assert.match(regla("html::-webkit-scrollbar-button:single-button:vertical"), /display:\s*block/);
  assert.match(regla("html::-webkit-scrollbar-button:single-button:vertical:decrement"), /background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(regla("html::-webkit-scrollbar-button:single-button:vertical:increment"), /background-image:\s*url\("data:image\/svg\+xml/);
  assert.doesNotMatch(ESTILOS, /html::-webkit-scrollbar-button\s*\{\s*display:\s*none/,
                      "una regla sin calificar que oculte los botones se llevaría las flechas");
});

test("the page scrollbar thumb runs from the logo blue to the cyan accent", () => {
  assert.match(
    regla("html::-webkit-scrollbar-thumb"),
    /linear-gradient\(to bottom,\s*var\(--color-accent-dark\),\s*var\(--color-accent\)\)/
  );
});

test("Firefox gets the same colours, fenced off from Chrome", () => {
  /*
    Firefox no entiende `::-webkit-scrollbar`, así que recibe `scrollbar-color`.
    Pero en Chrome un `scrollbar-color` ANULA los `::-webkit-scrollbar` del
    mismo elemento: sin el `@supports` el degradado desaparecería justo en el
    navegador que sí lo sabe pintar.
  */
  const inicio = ESTILOS.indexOf("@supports not selector(::-webkit-scrollbar)");
  assert.notEqual(inicio, -1, "el respaldo para Firefox tiene que ir dentro de @supports");
  const bloque = ESTILOS.slice(inicio, ESTILOS.indexOf("}\n", ESTILOS.indexOf("}", inicio) + 1) + 1);
  assert.match(bloque, /html\s*\{[^}]*scrollbar-color:\s*var\(--color-accent-dark\)\s+#0b0d10/);
});
