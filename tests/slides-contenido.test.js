const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIRECTORIO_SLIDES = path.join(ROOT, "src/content/slides");

const { normalizarIndice, normalizarPresentacion } = require(
  path.join(ROOT, "src/app/features/slides/slides.logica.js")
);

const indiceCrudo = JSON.parse(
  fs.readFileSync(path.join(DIRECTORIO_SLIDES, "manifiesto.json"), "utf8")
);
const resultadoIndice = normalizarIndice(indiceCrudo);

/*
  El contenido publicado de Slides. Cada presentación vive en su propia
  carpeta bajo /content/slides/<slug>/, con su propio manifiesto (título,
  descripción, archivo) y un deck HTML autocontenido. El manifiesto de la
  raíz es sólo el ÍNDICE: un arreglo de esos slugs.

  Como el resto de las pruebas de contenido del repo (ver
  notas-manifiesto.test.js), lo que se fija acá es que lo que el índice
  promete exista de verdad en disco, que ninguna carpeta quede huérfana sin
  listar, y que cada deck respete el script-src estricto del sitio (ver
  cabeceras-seguridad.test.js).
*/

test("el índice de la raíz es un arreglo válido de slugs únicos", () => {
  assert.deepEqual(resultadoIndice.errores, [], resultadoIndice.errores.join("; "));
  assert.ok(resultadoIndice.indice.length > 0, "el índice no puede estar vacío");
});

test("cada carpeta listada en el índice existe y trae un manifiesto válido", () => {
  resultadoIndice.indice.forEach((slug) => {
    const carpeta = path.join(DIRECTORIO_SLIDES, slug);
    assert.ok(
      fs.existsSync(carpeta) && fs.statSync(carpeta).isDirectory(),
      `falta la carpeta de "${slug}"`
    );

    const rutaManifiesto = path.join(carpeta, "manifiesto.json");
    assert.ok(fs.existsSync(rutaManifiesto), `"${slug}" no tiene manifiesto.json`);

    const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, "utf8"));
    const resultado = normalizarPresentacion(slug, manifiesto);
    assert.deepEqual(resultado.errores, [], `${slug}: ${resultado.errores.join("; ")}`);

    const rutaArchivo = path.join(carpeta, resultado.presentacion.archivo);
    assert.ok(fs.existsSync(rutaArchivo), `${slug}: falta "${resultado.presentacion.archivo}"`);
  });
});

test("ninguna subcarpeta de /content/slides queda huérfana, sin listar en el índice", () => {
  const subcarpetas = fs
    .readdirSync(DIRECTORIO_SLIDES, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name);

  subcarpetas.forEach((nombre) => {
    assert.ok(
      resultadoIndice.indice.includes(nombre),
      `"${nombre}" existe en disco pero no está en el índice de manifiesto.json`
    );
  });
});

/* Ayuda a las dos pruebas de abajo: la ruta absoluta del deck de una carpeta
   ya validada (asume que las pruebas de arriba pasaron). */
function rutaDelDeck(slug) {
  const carpeta = path.join(DIRECTORIO_SLIDES, slug);
  const manifiesto = JSON.parse(fs.readFileSync(path.join(carpeta, "manifiesto.json"), "utf8"));
  return path.join(carpeta, manifiesto.archivo);
}

/*
  Cada deck corre dentro de un <iframe> del visor bajo la regla propia de
  `/content/slides` en vercel.json (frame-ancestors 'self', X-Robots-Tag), y
  el CSP del sitio no lleva 'unsafe-inline' en script-src (ver
  cabeceras-seguridad.test.js): ningún deck puede traer un <script> sin src
  ni un handler inline.
*/
test("ningún deck trae script inline ni handlers on*: rompería el script-src estricto", () => {
  resultadoIndice.indice.forEach((slug) => {
    const ruta = rutaDelDeck(slug);
    const html = fs.readFileSync(ruta, "utf8");
    const relativo = path.relative(ROOT, ruta);

    assert.doesNotMatch(
      html,
      /<\w+[^>]*\son(?:click|load|error|change|submit|input|focus|blur|mouseover|keyup|keydown)\s*=/i,
      `${relativo}: trae un handler inline`
    );
    assert.doesNotMatch(
      html,
      /<script(?![^>]*\ssrc=)[^>]*>/i,
      `${relativo}: trae un <script> inline`
    );
  });
});

test("cada <script src> de un deck es del propio sitio o de cdn.jsdelivr.net, y el que es propio existe", () => {
  resultadoIndice.indice.forEach((slug) => {
    const ruta = rutaDelDeck(slug);
    const html = fs.readFileSync(ruta, "utf8");
    const relativo = path.relative(ROOT, ruta);

    const fuentes = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
    assert.ok(fuentes.length > 0, `${relativo}: no carga ningún <script src>`);

    fuentes.forEach((src) => {
      if (src.startsWith("https://cdn.jsdelivr.net/")) return;

      assert.ok(
        src.startsWith("/"),
        `${relativo}: "${src}" no es una ruta absoluta del sitio ni de cdn.jsdelivr.net`
      );
      const rutaLocal = path.join(ROOT, "src", src.replace(/^\//, ""));
      assert.ok(fs.existsSync(rutaLocal), `${relativo}: el script local "${src}" no existe`);
    });
  });
});
