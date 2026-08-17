const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIRECTORIO_NOTAS = path.join(ROOT, "src/content/notas");

const {
  construirArbolDeNotas,
  extraerWikilinks,
  validarManifiestoDeNotas,
} = require(path.join(ROOT, "src/app/core/notas/notas.arbol.js"));

const manifiesto = JSON.parse(
  fs.readFileSync(path.join(DIRECTORIO_NOTAS, "manifiesto.json"), "utf8")
);
/* Los borradores también viajan al repo y también pueden estar rotos. */
const arbol = construirArbolDeNotas(manifiesto, { incluirBorradores: true });
const notas = [...arbol.notasPorSlug.values()];

const leerNota = (nota) => fs.readFileSync(path.join(DIRECTORIO_NOTAS, nota.archivo), "utf8");

/* Todos los .md del directorio de contenido, en rutas relativas con "/" para
   poder compararlas contra lo que declara el manifiesto en cualquier sistema. */
function archivosMarkdown(directorio = DIRECTORIO_NOTAS) {
  return fs.readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const completa = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) return archivosMarkdown(completa);
    if (!entrada.name.endsWith(".md")) return [];
    return [path.relative(DIRECTORIO_NOTAS, completa).split(path.sep).join("/")];
  });
}

/*
  El manifiesto y los archivos son dos mitades de la misma cosa y se editan por
  separado: se agrega una nota y se olvida declararla, o se renombra un archivo
  y el manifiesto queda apuntando al vacío. Nada de eso falla al guardar; falla
  en producción, como una tarjeta que lleva a un 404. Estas pruebas son el único
  punto donde las dos mitades se comparan.
*/

test("el manifiesto publicado cumple las reglas del modelo", () => {
  const { ok, errores } = validarManifiestoDeNotas(manifiesto);
  assert.deepEqual(errores, []);
  assert.equal(ok, true);
});

test("cada nota declarada tiene su archivo en el repositorio", () => {
  for (const nota of notas) {
    const completa = path.join(DIRECTORIO_NOTAS, nota.archivo);
    assert.equal(fs.existsSync(completa), true, `${nota.slug}: falta ${nota.archivo}`);
  }
});

test("no hay archivos de nota huérfanos, sin entrada en el manifiesto", () => {
  const declarados = new Set(notas.map((nota) => nota.archivo));
  const huerfanos = archivosMarkdown().filter((archivo) => !declarados.has(archivo));
  /* Un .md sin entrada es contenido escrito que nadie puede encontrar: no
     aparece en el listado, ni en el grafo, ni en la búsqueda. */
  assert.deepEqual(huerfanos, []);
});

test("dos notas no comparten el mismo archivo", () => {
  const vistos = new Map();
  for (const nota of notas) {
    const previo = vistos.get(nota.archivo);
    assert.equal(previo, undefined, `${nota.slug} y ${previo} comparten ${nota.archivo}`);
    vistos.set(nota.archivo, nota.slug);
  }
});

/*
  El corazón del modo Obsidian: las relaciones se escriben como [[wikilink]] en
  el cuerpo, pero el grafo las lee del manifiesto para no tener que descargar
  todas las notas del sitio solo para dibujar un nivel. Esa duplicación es
  deliberada y este test es lo que impide que se vuelva mentira.
*/
test("las relaciones del manifiesto son exactamente los [[wikilinks]] del cuerpo", () => {
  for (const nota of notas) {
    const enElCuerpo = extraerWikilinks(leerNota(nota)).sort();
    const enElManifiesto = [...nota.relacionadas].sort();
    assert.deepEqual(
      enElManifiesto,
      enElCuerpo,
      `${nota.slug}: el manifiesto declara [${enElManifiesto}] y el .md enlaza [${enElCuerpo}]`
    );
  }
});

test("ningún [[wikilink]] apunta a una nota inexistente", () => {
  for (const nota of notas) {
    for (const destino of extraerWikilinks(leerNota(nota))) {
      assert.equal(
        arbol.notasPorSlug.has(destino),
        true,
        `${nota.slug} enlaza a [[${destino}]], que no existe`
      );
    }
  }
});

/*
  El título sale del manifiesto y lo pinta la página, para que el listado, el
  grafo y la vista de lectura no puedan mostrar tres encabezados distintos de la
  misma nota. Un # al inicio del archivo lo duplicaría en pantalla.
*/
test("ningún archivo empieza con un encabezado de nivel 1", () => {
  for (const nota of notas) {
    const primeraLinea = leerNota(nota).trim().split("\n")[0];
    assert.equal(
      primeraLinea.startsWith("# "),
      false,
      `${nota.slug}: el título lo pone el manifiesto, el .md no lleva "# "`
    );
  }
});

test("ninguna nota está vacía", () => {
  for (const nota of notas) {
    assert.equal(leerNota(nota).trim().length > 0, true, `${nota.slug} está vacía`);
  }
});

/*
  La ruta del archivo no se deriva de los slugs a propósito —el manifiesto es
  quien manda—, pero cuando ambas coinciden el repositorio se navega en el
  editor igual que en el sitio. Vale la pena sostenerlo mientras no haya un
  motivo concreto para romperlo.
*/
test("la ruta de cada archivo refleja su lugar en el árbol", () => {
  for (const nota of notas) {
    assert.equal(
      nota.archivo,
      `${nota.segmentos.join("/")}.md`,
      `${nota.slug}: se esperaba ${nota.segmentos.join("/")}.md`
    );
  }
});
