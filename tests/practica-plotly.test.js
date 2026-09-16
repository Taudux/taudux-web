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

/*
  La paleta de las series se validó con scripts/validate_palette.js del skill de
  dataviz contra la superficie #172130: banda de luminosidad oscura, contraste
  >= 3:1 y separación bajo daltonismo (peor par adyacente dE 12.5, objetivo >= 8).
  Este test es el recordatorio de que cambiar un color exige volver a correrlo:
  la paleta anterior, elegida a ojo, deslumbraba y confundía ámbar con verde.
*/
test("la paleta de las gráficas es exactamente la validada contra la pizarra", () => {
  const validada = [
    "#1ba0b6", "#c95f1c", "#8272e8", "#177a4a",
    "#b98e1a", "#d84f88", "#a26ddc", "#c4423c",
  ];
  const bloque = WORKER.match(/colorway=\[([\s\S]*?)\]/);
  assert.ok(bloque, "el tema debe declarar colorway");
  const declarada = bloque[1].match(/#[0-9a-f]{6}/g);
  assert.deepEqual(declarada, validada);

  // Y la superficie contra la que se validó es la que usa el área de trazado.
  assert.match(WORKER, /plot_bgcolor="#172130"/);
});

test("la gráfica se apoya en la pizarra con el isotipo como marca de agua", () => {
  const css = read("src/app/features/codigo/practica.css");
  const bloque = css.match(/\.practica__plotly\s*\{([\s\S]*?)\n  \}/);
  assert.ok(bloque, ".practica__plotly debe existir");
  assert.match(bloque[1], /background-color: #111925/);
  assert.doesNotMatch(bloque[1], /backdrop-filter/, "opaca: el mosaico no compite con las series");

  const marca = css.match(/\.practica__plotly::after\s*\{([\s\S]*?)\n  \}/);
  assert.ok(marca, "la marca de agua debe existir");
  assert.match(marca[1], /isotipo\.png/);
  assert.match(marca[1], /opacity: 0\.1;/, "90% de transparencia");
  assert.match(marca[1], /z-index: -1/, "bajo los datos, sobre la pizarra");
  assert.match(marca[1], /pointer-events: none/);
});

/*
  Un programa que solo dibuja no debe dejar un recuadro de consola vacío encima
  de la gráfica: obliga a hacer scroll para verla. La consola arranca oculta y
  aparece con el primer fragmento que llega.
*/
test("la consola arranca oculta y solo aparece cuando hay texto", () => {
  for (const pagina of ["python", "r", "sql"]) {
    const html = read(`src/app/features/codigo/${pagina}/index.html`);
    assert.match(html, /id="practicaConsola"[^>]*\shidden>/, `${pagina}: la consola debe arrancar oculta`);
  }

  const limpiar = JS.match(/function limpiarSalida\(\) \{([\s\S]*?)\n\}/);
  assert.match(limpiar[1], /consola\.hidden = true/);

  const pintar = JS.match(/function pintarFragmento\(\{ texto, flujo \}\) \{([\s\S]*?)\n\}/);
  assert.match(pintar[1], /consola\.hidden = false/);

  const css = read("src/app/features/codigo/practica.css");
  assert.match(css, /\.practica__consola\[hidden\]\s*\{\s*display: none;/);
});
