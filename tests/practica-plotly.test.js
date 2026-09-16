const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

/*
  Soporte de plotly en el entorno de Python. El worker es un módulo ES que Node
  no puede requerir como los módulos puros, así que estas pruebas leen la fuente:
  lo que se fija son invariantes de texto que, si se rompen, rompen producción sin
  que ningún otro test lo note.
*/

const WORKER = read("src/app/features/codigo/workers/python.worker.js");
const JS = read("src/app/features/codigo/practica.js");

function constante(nombre) {
  const encontrada = WORKER.match(new RegExp(`const ${nombre} = ([^;]+);`));
  assert.ok(encontrada, `no se encontró la constante ${nombre}`);
  return encontrada[1].trim();
}

/*
  micropip resuelve "lo último de PyPI". Sin pinear, un salto mayor de plotly.py
  cambia el plotly.js que necesita y puede romper el dibujo un día cualquiera sin
  un commit de por medio — el mismo motivo por el que las URLs de los runtimes
  van pineadas.
*/
test("la versión de plotly.py está pineada a una versión exacta", () => {
  const version = constante("VERSION_PLOTLY_PY").replace(/"/g, "");
  assert.match(version, /^\d+\.\d+\.\d+$/, `versión flotante: ${version}`);
  assert.match(WORKER, /micropip\.install\("plotly==\$\{VERSION_PLOTLY_PY\}"\)/);
});

/*
  Instalar plotly cuesta unos 15 MB. Solo un import real debe dispararlo: la
  palabra en un comentario o en un string no es motivo para pagar la descarga.
*/
test("solo un import real de plotly dispara su preparación", () => {
  const fuente = constante("IMPORTA_PLOTLY");
  const partes = fuente.match(/^\/(.*)\/([a-z]*)$/);
  assert.ok(partes, "IMPORTA_PLOTLY debe ser un literal de regex");
  const regex = new RegExp(partes[1], partes[2]);

  assert.equal(regex.test("import plotly.express as px"), true);
  assert.equal(regex.test("from plotly import graph_objects"), true);
  assert.equal(regex.test("x = 1\n  import plotly"), true);

  assert.equal(regex.test("# algún día usaré plotly"), false);
  assert.equal(regex.test("print('plotly')"), false);
  assert.equal(regex.test("import plotlyx"), false);
});

/*
  plotly.express exige pandas y numpy, pero `import plotly.express` no los
  menciona y loadPackagesFromImports no los trae. Sin cargarlos a mano, el import
  falla pidiendo `pip install "plotly[express]"` — que acá no existe.
*/
test("preparar plotly carga pandas y numpy antes", () => {
  assert.match(WORKER, /loadPackage\(\["micropip", "numpy", "pandas"\]/);
});

/*
  `fig.show()` fuera de un notebook intenta abrir un servidor local y en WASM
  revienta con OSError. El parche debe reemplazarlo y guardar la figura
  serializada, no dejarlo pasar.
*/
test("show() queda reemplazado por la captura de la figura", () => {
  assert.match(WORKER, /_taudux_bd\.BaseFigure\.show = _taudux_show/);
  assert.match(WORKER, /_taudux_figuras\.append\(self\.to_json\(\)\)/);
});

/*
  La versión de plotly.js que carga el navegador sale del propio paquete de
  Python, no de una constante: así plotly.py y plotly.js no pueden discrepar.
*/
test("la versión de plotly.js viaja con la figura y se valida antes de ir a la URL", () => {
  assert.match(WORKER, /get_plotlyjs_version\(\)/);
  assert.match(JS, /\/\^\\d\+\\\.\\d\+\\\.\\d\+\$\/\.test\(version/);
  assert.match(JS, /plotly\.js-dist-min@\$\{version\}\/plotly\.min\.js/);
});

test("plotly.js se carga bajo demanda y no en el arranque de la página", () => {
  for (const pagina of ["python", "r", "sql"]) {
    const html = read(`src/app/features/codigo/${pagina}/index.html`);
    assert.doesNotMatch(html, /plotly/, `${pagina} no debe cargar plotly.js de entrada`);
  }
});

/*
  El tema de marca usa las mismas familias tipográficas y el mismo acento que el
  resto del sitio. Si alguien cambia la paleta del sitio, este test recuerda que
  las gráficas tienen la suya escrita a mano.
*/
test("el tema de las gráficas comparte tipografía y acento con el sitio", () => {
  assert.match(WORKER, /Space Grotesk/);
  assert.match(WORKER, /Orbitron/);
  assert.match(WORKER, /"#00e1ff"/);
  assert.match(WORKER, /paper_bgcolor="rgba\(0,0,0,0\)"/);
});
