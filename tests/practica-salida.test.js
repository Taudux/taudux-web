const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const {
  AVISO_SALIDA_TRUNCADA,
  crearAcumuladorSalida,
  formatearCeldaSql,
  formatearTablaSql,
  sugerenciaDePaquetePython,
  lineaDelErrorPython,
  lineaDelErrorSql,
} = require(path.join(ROOT, "src/app/features/codigo/practica.salida.js"));

/*
  El caso central a blindar es el accidente que todo alumno comete el primer día:
  imprimir dentro de un ciclo enorme. El intérprete lo aguanta; lo que mata la
  pestaña es el DOM al pintar cientos de MB. Estas pruebas fijan que el acumulador
  corta, avisa una sola vez, y no vuelve a crecer nunca más.
*/

test("la salida normal pasa intacta y en orden", () => {
  const acumulador = crearAcumuladorSalida();

  assert.deepEqual(acumulador.agregar("hola\n"), [{ texto: "hola\n", flujo: "stdout" }]);
  assert.deepEqual(acumulador.agregar("error\n", "stderr"), [{ texto: "error\n", flujo: "stderr" }]);
  assert.equal(acumulador.estaTruncada(), false);
});

/*
  stdout y stderr comparten un solo hilo de fragmentos a propósito: un traceback
  que cae en medio de unos prints solo se entiende si se lee intercalado, en el
  orden real en que el programa lo produjo.
*/
test("stdout y stderr conservan el orden real de llegada", () => {
  const acumulador = crearAcumuladorSalida();
  const pintados = [];

  for (const [texto, flujo] of [["a", "stdout"], ["b", "stderr"], ["c", "stdout"]]) {
    pintados.push(...acumulador.agregar(texto, flujo));
  }

  assert.deepEqual(pintados, [
    { texto: "a", flujo: "stdout" },
    { texto: "b", flujo: "stderr" },
    { texto: "c", flujo: "stdout" },
  ]);
});

test("un texto vacío no genera fragmentos que pintar", () => {
  const acumulador = crearAcumuladorSalida();
  assert.deepEqual(acumulador.agregar(""), []);
  assert.deepEqual(acumulador.agregar(null), []);
});

test("al pasar el tope de líneas corta y avisa", () => {
  const acumulador = crearAcumuladorSalida({ maxLineas: 3 });

  assert.deepEqual(acumulador.agregar("1\n2\n"), [{ texto: "1\n2\n", flujo: "stdout" }]);

  const fragmentos = acumulador.agregar("3\n4\n5\n");
  assert.equal(acumulador.estaTruncada(), true);
  assert.deepEqual(fragmentos, [
    { texto: "3\n", flujo: "stdout" },
    { texto: AVISO_SALIDA_TRUNCADA, flujo: "aviso" },
  ]);
});

test("al pasar el tope de caracteres corta a la mitad del fragmento", () => {
  const acumulador = crearAcumuladorSalida({ maxCaracteres: 5 });

  const fragmentos = acumulador.agregar("abcdefghij");
  assert.deepEqual(fragmentos, [
    { texto: "abcde", flujo: "stdout" },
    { texto: AVISO_SALIDA_TRUNCADA, flujo: "aviso" },
  ]);
  assert.equal(acumulador.totalCaracteres(), 5);
});

/*
  Un solo print gigante (un DataFrame enorme, un JSON de un MB) llega como un
  único fragmento. Descartarlo entero dejaría la consola en blanco haciendo creer
  que el programa no imprimió nada: hay que mostrar lo que quepa.
*/
test("un fragmento gigante se recorta, no se descarta entero", () => {
  const acumulador = crearAcumuladorSalida({ maxCaracteres: 10 });
  const fragmentos = acumulador.agregar("x".repeat(5000));

  assert.equal(fragmentos[0].texto, "x".repeat(10));
  assert.equal(fragmentos[1].flujo, "aviso");
});

/*
  Esta es la prueba que justifica el módulo: después de truncar, el worker sigue
  produciendo salida durante un buen rato. Si el acumulador siguiera devolviendo
  fragmentos, el tope no serviría de nada.
*/
test("una vez truncada, la consola deja de crecer y no repite el aviso", () => {
  const acumulador = crearAcumuladorSalida({ maxLineas: 1 });
  acumulador.agregar("1\n2\n");

  const caracteresAlTruncar = acumulador.totalCaracteres();
  for (let i = 0; i < 1000; i += 1) {
    assert.deepEqual(acumulador.agregar(`linea ${i}\n`), []);
  }

  assert.equal(acumulador.totalCaracteres(), caracteresAlTruncar);
});

test("formatearCeldaSql da forma legible a los tipos de Postgres", () => {
  assert.equal(formatearCeldaSql(null), "NULL");
  assert.equal(formatearCeldaSql(undefined), "NULL");
  assert.equal(formatearCeldaSql(true), "true");
  assert.equal(formatearCeldaSql(false), "false");
  assert.equal(formatearCeldaSql(0), "0");
  assert.equal(formatearCeldaSql("texto"), "texto");
  assert.equal(formatearCeldaSql(new Date("2026-08-14T00:00:00Z")), "2026-08-14T00:00:00.000Z");
});

/*
  Sin este caso, un json o un array de Postgres se pintaría como
  "[object Object]", que en una tabla de resultados es peor que no mostrar nada.
*/
test("un valor json o array se serializa en vez de caer en [object Object]", () => {
  assert.equal(formatearCeldaSql({ a: 1 }), '{"a":1}');
  assert.equal(formatearCeldaSql([1, 2]), "[1,2]");
});

test("un select se convierte en columnas y filas", () => {
  const tabla = formatearTablaSql({
    fields: [{ name: "region" }, { name: "ingresos" }],
    rows: [
      { region: "Norte", ingresos: 23500.5 },
      { region: "Sur", ingresos: 13000 },
    ],
  });

  assert.deepEqual(tabla.columnas, ["region", "ingresos"]);
  assert.deepEqual(tabla.filas, [["Norte", "23500.5"], ["Sur", "13000"]]);
  assert.equal(tabla.totalFilas, 2);
  assert.equal(tabla.truncada, false);
});

/*
  `create table` e `insert` sin returning no producen columnas. Devolver una tabla
  vacía pintaría un recuadro fantasma; quien llama reporta texto en su lugar.
*/
test("una sentencia sin columnas no produce tabla", () => {
  assert.equal(formatearTablaSql({ fields: [], rows: [] }), null);
  assert.equal(formatearTablaSql({}), null);
  assert.equal(formatearTablaSql(null), null);
});

test("un select enorme se topea y lo declara", () => {
  const rows = Array.from({ length: 20 }, (_, indice) => ({ n: indice }));
  const tabla = formatearTablaSql({ fields: [{ name: "n" }], rows }, 5);

  assert.equal(tabla.filas.length, 5);
  assert.equal(tabla.totalFilas, 20);
  assert.equal(tabla.truncada, true);
});

/*
  Pistas de paquetes. El entorno corre Python real pero sin terminal, así que los
  dos reflejos que trae el alumno —`pip install` y confiar en que su import
  existe— fallan de formas que no explican nada. Estas pruebas fijan que la ayuda
  aparezca en esos dos casos y SOLO en ellos: una pista inventada desorienta más
  que el error crudo.
*/

test("pip install se traduce al micropip que sí funciona acá", () => {
  const pista = sugerenciaDePaquetePython("SyntaxError: invalid syntax", "pip install seaborn");

  assert.match(pista, /Acá no existe pip/);
  assert.match(pista, /await micropip\.install\("seaborn"\)/);
});

test("reconoce las formas de pip que se copian de un notebook", () => {
  for (const linea of ["!pip install rich", "%pip install rich", "  pip install rich"]) {
    const pista = sugerenciaDePaquetePython("", linea);
    assert.match(pista, /await micropip\.install\("rich"\)/, `no reconoció: ${linea}`);
  }
});

/*
  Decirle que instale pandas cuando ya viene incluido lo manda a resolver un
  problema que no tiene.
*/
test("la pista de pip aclara que el stack de datos ya viene incluido", () => {
  assert.match(sugerenciaDePaquetePython("", "pip install pandas"), /ya vienen incluidos/);
});

test("un módulo ausente sugiere instalarlo con micropip", () => {
  const pista = sugerenciaDePaquetePython(
    "ModuleNotFoundError: No module named 'humanize'",
    "import humanize",
  );

  assert.match(pista, /"humanize" no está cargado/);
  assert.match(pista, /await micropip\.install\("humanize"\)/);
});

/*
  micropip instala paquetes, no submódulos: de `sklearn.linear_model` hay que
  pedir `sklearn`, o la instalación falla con un error todavía más confuso.
*/
test("de un submódulo se sugiere el paquete raíz, no la ruta completa", () => {
  const pista = sugerenciaDePaquetePython(
    "ModuleNotFoundError: No module named 'sklearn.linear_model'",
    "from sklearn.linear_model import LinearRegression",
  );

  assert.match(pista, /await micropip\.install\("sklearn"\)/);
  assert.doesNotMatch(pista, /linear_model/);
});

test("advierte que un paquete con extensiones en C puede no existir acá", () => {
  const pista = sugerenciaDePaquetePython("ModuleNotFoundError: No module named 'psycopg2'", "");
  assert.match(pista, /extensiones en C/);
});

test("un error cualquiera no inventa pistas", () => {
  assert.equal(sugerenciaDePaquetePython("ZeroDivisionError: division by zero", "1/0"), null);
  assert.equal(sugerenciaDePaquetePython("", ""), null);
  assert.equal(sugerenciaDePaquetePython(null, null), null);
});

/*
  "pip" dentro de un comentario o de un nombre de variable no es una invocación:
  el patrón exige que la línea empiece por pip para no disparar de más.
*/
test("mencionar pip de pasada no dispara la pista", () => {
  assert.equal(sugerenciaDePaquetePython("", "# antes hacías pip install algo"), null);
  assert.equal(sugerenciaDePaquetePython("", "equipo = 'pip install'"), null);
});

/*
  Línea del error. Sirve para marcarla en el editor, así que equivocarse es peor
  que no marcar nada: señalaría una línea inocente y mandaría al alumno a buscar
  el problema donde no está.
*/

test("del traceback de Python sale la línea del código del alumno", () => {
  const traceback = [
    "Traceback (most recent call last):",
    '  File "/lib/python314.zip/_pyodide/_base.py", line 411, in run_async',
    '  File "<exec>", line 8, in <module>',
    "NameError: name 'no_existe' is not defined",
  ].join("\n");

  assert.equal(lineaDelErrorPython(traceback), 8);
});

/*
  Los marcos de _pyodide son ruido del andamiaje: si se tomara el primero que
  aparece, se marcaría una línea de la librería en el código del alumno.
*/
test("los marcos internos de Pyodide no se confunden con el código del alumno", () => {
  const traceback = [
    '  File "/lib/python314.zip/_pyodide/_base.py", line 597, in eval_code_async',
    '  File "<exec>", line 3, in <module>',
  ].join("\n");

  assert.equal(lineaDelErrorPython(traceback), 3);
});

/*
  Con funciones anidadas el traceback trae varios marcos de <exec>: el último es
  donde realmente reventó, los anteriores son quién lo llamó.
*/
test("con varios marcos propios se toma el último, que es donde falló", () => {
  const traceback = [
    '  File "<exec>", line 10, in <module>',
    '  File "<exec>", line 4, in calcular',
    "ZeroDivisionError: division by zero",
  ].join("\n");

  assert.equal(lineaDelErrorPython(traceback), 4);
});

test("un error sin traceback no señala ninguna línea", () => {
  assert.equal(lineaDelErrorPython("ZeroDivisionError: division by zero"), null);
  assert.equal(lineaDelErrorPython(""), null);
  assert.equal(lineaDelErrorPython(null), null);
});

/*
  Postgres reporta un desplazamiento en caracteres, no una línea. Sin traducirlo,
  el número no significa nada para el editor.
*/
test("la posición de Postgres se traduce a número de línea", () => {
  const consulta = "select 1\nfrom no_existe\nwhere x = 1";

  // La posición 25 cae dentro de la tercera línea.
  assert.equal(lineaDelErrorSql("Posición: 25", consulta), 3);
  // Y una posición del primer renglón sigue siendo la línea 1.
  assert.equal(lineaDelErrorSql("Posición: 3", consulta), 1);
});

test("un error de SQL sin posición no señala línea", () => {
  assert.equal(lineaDelErrorSql("syntax error", "select 1"), null);
  assert.equal(lineaDelErrorSql(null, "select 1"), null);
  assert.equal(lineaDelErrorSql("Posición: 5", null), null);
});

/*
  Una posición más allá del final del texto (consulta reescrita entre el envío y
  el error) no puede devolver una línea que no existe.
*/
test("una posición fuera de rango se acota al final del código", () => {
  assert.equal(lineaDelErrorSql("Posición: 9999", "select 1\nfrom t"), 2);
});
