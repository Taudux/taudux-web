const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const HOME_CSS = "src/app/features/home/home.css";

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function reglaDe(css, selector) {
  const inicio = css.indexOf(`${selector} {`);
  assert.notEqual(inicio, -1, `falta la regla ${selector}`);
  return css.slice(inicio, css.indexOf("}", inicio));
}

/*
  "Quiénes somos" sin caja (dirección "Bruma", elegida por Jorge el
  2026-09-16 sobre el lienzo de diseño). La tarjeta era la tapa del revelado:
  un borde de 1px y un radio de 20 alrededor del canvas de tsParticles. Ahora la
  tapa sigue ahí —el revelado y el hover no cambian— pero se extiende más allá
  del texto y sus bordes se funden con las estrellas por una máscara radial.

  Las clases `panel panel--spacious` siguen en el HTML porque
  ui-consolidation.test.js las exige; la pintura se anula desde home.css, que
  vive en @layer features y le gana a components sin especificidad, igual que
  hizo .contact__panel.
*/
test("the about card draws no box: the panel paint is cancelled", () => {
  const css = sinComentariosCss(read(HOME_CSS));
  const regla = reglaDe(css, ".about__content");

  const anulaciones = [
    [/(^|[^-])border\s*:\s*0/, "border: 0"],
    [/border-radius\s*:\s*0/, "border-radius: 0"],
    [/background\s*:\s*none/, "background: none"],
    [/box-shadow\s*:\s*none/, "box-shadow: none"],
    [/backdrop-filter\s*:\s*none/, "backdrop-filter: none"],
  ];
  for (const [patron, nombre] of anulaciones) {
    assert.match(regla, patron,
      `.about__content debe anular la pintura de .panel con ${nombre}`);
  }
});

test("the about reveal spills past the text and fades into the starfield", () => {
  const css = sinComentariosCss(read(HOME_CSS));
  const regla = reglaDe(css, ".about__particles");

  // La tapa crece más allá de la tarjeta: sin eso, el difuminado se comería
  // el revelado justo detrás del texto en vez de fundirse fuera de él.
  assert.match(regla, /inset\s*:\s*-[\d.]+rem\s+-[\d.]+rem/,
    "el canvas del revelado se extiende con un inset negativo en rem");
  assert.match(regla, /mask-image\s*:\s*radial-gradient\(/,
    "los bordes de la tapa se funden con una máscara radial");
  assert.match(regla, /-webkit-mask-image\s*:\s*radial-gradient\(/,
    "con prefijo -webkit-, que Safari todavía necesita");
  assert.doesNotMatch(regla, /border-radius\s*:\s*inherit/,
    "ya no hay radio que heredar: la forma la da la máscara");
});
