const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const {
  AVISO_SALIDA_TRUNCADA,
  crearAcumuladorSalida,
  formatearCeldaSql,
  formatearTablaSql,
} = require(path.join(ROOT, "src/app/features/practica/practica.salida.js"));

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
