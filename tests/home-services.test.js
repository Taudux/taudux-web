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

/*
  Luz en lugar de caja, como el contacto (decisión del 2026-09-08). Las
  tarjetas eran rectángulos #111318 con sombra sobre el campo de estrellas; ahora
  el contenido se apoya en un resplandor radial detrás de la sección y el hover
  enciende un halo propio, sin volver a dibujar la caja con una sombra.
*/
test("the services cards draw light, not boxes", () => {
  const css = sinComentariosCss(read(HOME_CSS));

  const tarjeta = reglaDe(css, ".services__card");
  assert.doesNotMatch(tarjeta, /background(-color)?\s*:\s*(#|rgb|var\()/,
    "la tarjeta no pinta un fondo sólido: las estrellas se ven a través");
  assert.doesNotMatch(tarjeta, /box-shadow\s*:\s*(?!none)/,
    "sin sombra de caja en reposo");

  const hover = reglaDe(css, ".services__card:hover");
  assert.match(hover, /translateY\(/, "la elevación del hover se conserva");
  assert.doesNotMatch(hover, /box-shadow\s*:/,
    "una sombra en hover redibuja el rectángulo que acabamos de quitar");

  // El halo del hover vive en un pseudo-elemento que sólo cambia de opacidad:
  // los degradados no interpolan, así que animar `background` saltaría.
  const halo = reglaDe(css, ".services__card::after");
  assert.match(halo, /radial-gradient/, "el halo es radial, como el resplandor de la sección");
  assert.match(halo, /opacity\s*:\s*0/, "apagado en reposo");
  assert.match(halo, /pointer-events\s*:\s*none/, "el halo no roba el hover a la tarjeta");
  assert.match(reglaDe(css, ".services__card:hover::after"), /opacity\s*:\s*1/,
    "encendido en hover");

  // Mismo contrato que .contact::before (home-contact-prefill.test.js).
  const bloom = reglaDe(css, ".services::before");
  assert.match(bloom, /radial-gradient/, "el resplandor de la sección es radial");
  assert.match(bloom, /z-index\s*:\s*var\(--z-behind\)/, "va detrás del contenido");
  assert.match(bloom, /pointer-events\s*:\s*none/, "no intercepta clics");
});
