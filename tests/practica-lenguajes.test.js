const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const {
  LENGUAJES_PRACTICA,
  normalizarIdLenguaje,
  resolverLenguajeActivo,
} = require(path.join(ROOT, "src/app/features/practica/practica.lenguajes.js"));

/*
  El catálogo de lenguajes es la única fuente de verdad de qué runtime baja el
  navegador. Lo que se blinda acá no es la forma del objeto por gusto: son las dos
  cosas que rompen el playground en producción sin que nadie toque el repo — una
  URL flotante que cambia sola, y un hash de URL que deja la página sin editor.
*/

test("el playground ofrece exactamente Python, SQL y R", () => {
  assert.deepEqual(LENGUAJES_PRACTICA.map((lenguaje) => lenguaje.id), ["python", "sql", "r"]);
});

test("cada lenguaje trae lo que la página necesita para montarse", () => {
  for (const lenguaje of LENGUAJES_PRACTICA) {
    assert.ok(lenguaje.etiqueta, `${lenguaje.id} necesita etiqueta visible`);
    assert.match(lenguaje.modoEditor, /^ace\/mode\//, `${lenguaje.id} necesita un modo de Ace`);
    assert.ok(lenguaje.ejemplo.trim().length > 0, `${lenguaje.id} necesita código de ejemplo`);
    assert.ok(lenguaje.runtime && lenguaje.runtime.url, `${lenguaje.id} necesita URL de runtime`);
    assert.ok(lenguaje.archivo, `${lenguaje.id} necesita nombre de archivo para descargar`);
  }
});

/*
  La descarga es lo que reemplaza guardar el trabajo en el servidor, así que cada
  lenguaje baja en su extensión real. Python baja como script .py y nunca como
  notebook: la práctica apunta a lo fundacional, y un .ipynb es un JSON con celdas
  que este playground tampoco sabría volver a abrir.
*/
test("cada lenguaje se descarga como script plano en su extensión", () => {
  const archivos = Object.fromEntries(
    LENGUAJES_PRACTICA.map((lenguaje) => [lenguaje.id, lenguaje.archivo]),
  );

  assert.match(archivos.python, /\.py$/);
  assert.match(archivos.sql, /\.sql$/);
  assert.match(archivos.r, /\.R$/);

  for (const archivo of Object.values(archivos)) {
    assert.doesNotMatch(archivo, /\.ipynb$/, "un notebook no es el formato de este playground");
  }
});

/*
  Pyodide resuelve la biblioteca estándar y los paquetes relativos a indexURL. Si
  apuntara a otro release que el de pyodide.mjs, el intérprete carga y después
  falla al importar cualquier cosa — un fallo tardío y confuso. Deben ser el mismo
  release.
*/
test("el indexURL de Pyodide apunta al mismo release que su módulo", () => {
  const python = LENGUAJES_PRACTICA.find((lenguaje) => lenguaje.id === "python");
  const version = python.runtime.url.match(/pyodide\/(v[\d.]+)\//)[1];
  assert.ok(python.runtime.indexURL.includes(`/pyodide/${version}/`));
  assert.match(python.runtime.indexURL, /\/$/, "indexURL debe terminar en / o Pyodide concatena mal");
});

/*
  Estos runtimes pesan decenas de MB y publican cambios que rompen. Con `@latest`
  o `/latest/`, el CDN puede tumbar el playground en producción un día cualquiera
  sin un commit de por medio. Toda referencia externa va pineada, también la del
  editor que vive en el HTML.
*/
test("ninguna dependencia externa del playground queda en una versión flotante", () => {
  const urls = LENGUAJES_PRACTICA.map((lenguaje) => lenguaje.runtime.url);
  urls.push(...LENGUAJES_PRACTICA.map((lenguaje) => lenguaje.runtime.indexURL).filter(Boolean));

  for (const url of urls) {
    assert.doesNotMatch(url, /@latest|\/latest\//, `URL sin pinear: ${url}`);
  }

  const html = read("src/app/features/practica/index.html");
  const externos = html.match(/https:\/\/cdn\.jsdelivr\.net\/[^"']+/g) || [];
  assert.ok(externos.length > 0, "la página debe cargar el editor desde el CDN");
  for (const url of externos) {
    assert.doesNotMatch(url, /@latest|\/latest\//, `URL sin pinear en el HTML: ${url}`);
  }
});

test("normalizarIdLenguaje limpia el # y tolera basura", () => {
  assert.equal(normalizarIdLenguaje("#python"), "python");
  assert.equal(normalizarIdLenguaje("  #SQL  "), "sql");
  assert.equal(normalizarIdLenguaje(""), "");
  assert.equal(normalizarIdLenguaje(null), "");
  assert.equal(normalizarIdLenguaje(undefined), "");
  assert.equal(normalizarIdLenguaje(42), "");
});

test("un hash conocido abre su lenguaje", () => {
  assert.equal(resolverLenguajeActivo("#sql").id, "sql");
  assert.equal(resolverLenguajeActivo("#r").id, "r");
});

/*
  Misma regla que resolverSeccionActiva en el portal: nunca undefined. Un hash
  inventado cae al primer lenguaje en vez de dejar la página sin editor.
*/
test("un hash desconocido cae al primer lenguaje en vez de dejar la página vacía", () => {
  assert.equal(resolverLenguajeActivo("#<script>").id, "python");
  assert.equal(resolverLenguajeActivo("#cobol").id, "python");
  assert.equal(resolverLenguajeActivo("").id, "python");
  assert.equal(resolverLenguajeActivo(null).id, "python");
});

test("una lista de lenguajes vacía no rompe la resolución", () => {
  assert.equal(resolverLenguajeActivo("#sql", []).id, "sql");
  assert.equal(resolverLenguajeActivo("#sql", null).id, "sql");
});
