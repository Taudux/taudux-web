const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const HOME_CSS = "src/app/features/home/home.css";

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Recorta el cuerpo de la primera regla cuyo selector empieza exactamente así
// (".services__card {" con llave, para no confundirse con ":hover" o
// "--visible").
function reglaDe(css, selector) {
  const inicio = css.indexOf(`${selector} {`);
  assert.notEqual(inicio, -1, `falta la regla ${selector}`);
  return css.slice(inicio, css.indexOf("}", inicio));
}

/*
  Las tarjetas de servicios medían 1160px dentro de un contenedor que podía
  medir 1200: cuatro tarjetas de 260 más tres huecos de 40. No era el relleno
  de la sección. El contenedor es un ítem de grid (.home__section) con
  margin-inline: auto, y los márgenes auto lo sacan del stretch: se dimensiona
  a fit-content, o sea al ancho de sus tarjetas. A 1536px arrancaba en x=180
  con el logo del navbar en x=160.
*/
test("the services container fills the site width instead of shrinking to its cards", () => {
  const css = sinComentariosCss(read(HOME_CSS));
  const contenedor = reglaDe(css, ".services__container");
  assert.match(contenedor, /inline-size\s*:\s*100%/,
    "un ítem de grid con márgenes auto se encoge a su contenido; el 100% lo devuelve al ancho del track (topado por .u-contenedor)");
  assert.doesNotMatch(contenedor, /max-(inline-size|width)\s*:\s*\d/,
    "el tope del ancho lo pone .u-contenedor, no un número acá");
});

test("the services cards grow to share the row instead of pinning at 260px", () => {
  const css = sinComentariosCss(read(HOME_CSS));
  const tarjeta = reglaDe(css, ".services__card");
  assert.match(tarjeta, /flex\s*:\s*1\s+1\s+260px/,
    "flex-grow 1: con cuatro en fila reparten los 1200 (270 cada una) y llegan al eje del logo");
  assert.doesNotMatch(tarjeta, /max-width\s*:\s*260px/,
    "el tope de 260 era lo que dejaba el hueco de 20px por lado");
  assert.match(tarjeta, /max-width\s*:\s*320px/,
    "con tope de 320 una tarjeta sola en la última fila no se estira a todo el ancho");
});
