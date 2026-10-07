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
  /* Sólo cuentan las carpetas con alguna página: una presentación siempre
     trae su HTML. Las que sólo guardan recursos compartidos entre
     presentaciones (los QR de una sesión, por ejemplo) no van al índice. */
  const subcarpetas = fs
    .readdirSync(DIRECTORIO_SLIDES, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    // `_subida` es la página puente de los decks SUBIDOS (ver subida.js), no
    // una presentación: el guion bajo marca lo que no va en el índice.
    .filter((nombre) => !nombre.startsWith("_"))
    .filter((nombre) => fs.readdirSync(path.join(DIRECTORIO_SLIDES, nombre)).some((archivo) => archivo.endsWith(".html")));

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

/*
  Los campos de la tarjeta (categoría, autor, fecha y número de láminas) que
  cada manifiesto del repositorio declara. Sin ellos la presentación no entra
  en los filtros por categoría ni muestra «N láminas» ni «autor · fecha».
  `portada` es opcional: sin ella la tarjeta usa el degradado de la categoría.
*/
function manifiestoDe(slug) {
  return JSON.parse(fs.readFileSync(path.join(DIRECTORIO_SLIDES, slug, "manifiesto.json"), "utf8"));
}

test("cada manifiesto del repositorio declara categoría, autor, fecha y láminas válidas", () => {
  resultadoIndice.indice.forEach((slug) => {
    const manifiesto = manifiestoDe(slug);
    const { presentacion } = normalizarPresentacion(slug, manifiesto);

    assert.ok(presentacion.categoria, `${slug}: falta "categoria"`);
    assert.ok(presentacion.autor, `${slug}: falta "autor"`);
    assert.match(presentacion.actualizado, /^\d{4}-\d{2}-\d{2}$/, `${slug}: "actualizado" no es AAAA-MM-DD`);
    assert.ok(presentacion.total_laminas > 0, `${slug}: falta "total_laminas"`);
  });
});

test("las categorías de los decks del repositorio son las acordadas", () => {
  const categorias = Object.fromEntries(
    resultadoIndice.indice.map((slug) => [slug, manifiestoDe(slug).categoria])
  );
  assert.deepEqual(categorias, {
    "curso-sql": "Bases de datos",
    "visualizacion-de-datos": "Análisis de datos",
    "curso-etl-elt": "Ingeniería de datos",
    "infocracia-y-epistemologia-digital": "Humanidades digitales",
  });
});

test("total_laminas de cada deck coincide con las láminas reales de su archivo", () => {
  resultadoIndice.indice.forEach((slug) => {
    const carpeta = path.join(DIRECTORIO_SLIDES, slug);
    const declarado = manifiestoDe(slug).total_laminas;

    // Los decks cuyas láminas están en el HTML se cuentan igual que lo hace
    // su deck.js: querySelectorAll('.slide'), es decir, elementos con esa clase.
    const html = fs.readFileSync(path.join(carpeta, "index.html"), "utf8");
    const enHtml = (html.match(/class="([^"]* )?slide( [^"]*)?"/g) || []).length;
    if (enHtml > 0) {
      assert.equal(declarado, enHtml, `${slug}: declara ${declarado} láminas y su HTML trae ${enHtml}`);
      return;
    }

    // Infocracia arma sus láminas desde un arreglo en deck.js: una entrada
    // por cada `id:` de primer nivel.
    const deck = fs.readFileSync(path.join(carpeta, "deck.js"), "utf8");
    const enDeck = (deck.match(/^ {2}\{ id: "/gm) || []).length;
    assert.ok(enDeck > 0, `${slug}: no se pudieron contar sus láminas`);
    assert.equal(declarado, enDeck, `${slug}: declara ${declarado} láminas y su deck.js trae ${enDeck}`);
  });
});

test("una portada declarada existe en la carpeta y es WebP", () => {
  resultadoIndice.indice.forEach((slug) => {
    const { portada } = manifiestoDe(slug);
    if (portada === undefined) return;

    const ruta = path.join(DIRECTORIO_SLIDES, slug, portada);
    assert.ok(fs.existsSync(ruta), `${slug}: falta la portada "${portada}"`);
    const cabecera = fs.readFileSync(ruta).subarray(0, 12);
    assert.equal(cabecera.subarray(0, 4).toString("latin1"), "RIFF", `${slug}: la portada no es RIFF/WebP`);
    assert.equal(cabecera.subarray(8, 12).toString("latin1"), "WEBP", `${slug}: la portada no es WebP`);
  });
});
