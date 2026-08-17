const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const {
  GENERADORES_SINTETICOS,
  analizarTablaPegada,
  construirSentenciasTabla,
  detectarDelimitador,
  escaparLiteralSql,
  generarDatosSinteticos,
  inferirTipoColumna,
  normalizarNombreIdentificador,
} = require(path.join(ROOT, "src/app/features/codigo/practica.datos.js"));

/*
  Este módulo escribe SQL a partir de texto que pega el alumno. Lo que se blinda
  acá es que ningún dato normal —un apellido con apóstrofo, una celda vacía, un
  encabezado con acento— produzca SQL que no corra.
*/

test("un encabezado real se vuelve un identificador usable", () => {
  assert.equal(normalizarNombreIdentificador("Monto Total ($)"), "monto_total");
  assert.equal(normalizarNombreIdentificador("Categoría"), "categoria");
  assert.equal(normalizarNombreIdentificador("  "), "columna");
  assert.equal(normalizarNombreIdentificador("", "columna_3"), "columna_3");
});

/*
  Un identificador que empieza con dígito es un error de sintaxis en Postgres, y
  una palabra reservada como nombre de columna rompe el select después aunque el
  create pase.
*/
test("los nombres que Postgres rechazaría se corrigen solos", () => {
  assert.equal(normalizarNombreIdentificador("2024"), "col_2024");
  assert.equal(normalizarNombreIdentificador("select"), "select_col");
  assert.equal(normalizarNombreIdentificador("Order"), "order_col");
});

test("dos columnas con el mismo nombre no chocan", () => {
  const { columnas } = analizarTablaPegada("Total,Total\n1,2");
  assert.deepEqual(columnas.map((columna) => columna.nombre), ["total", "total_2"]);
});

test("detecta el delimitador de Excel, del CSV y del formato en español", () => {
  assert.equal(detectarDelimitador("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectarDelimitador("a,b,c\n1,2,3"), ",");
  assert.equal(detectarDelimitador("a;b;c\n1;2;3"), ";");
});

test("infiere el tipo de cada columna", () => {
  assert.equal(inferirTipoColumna(["1", "2", "3"]), "integer");
  assert.equal(inferirTipoColumna(["1.5", "2"]), "numeric");
  assert.equal(inferirTipoColumna(["true", "false"]), "boolean");
  assert.equal(inferirTipoColumna(["2024-01-01"]), "date");
  assert.equal(inferirTipoColumna(["Ana", "Luis"]), "text");
});

/*
  Una celda vacía en una columna numérica es lo más normal del mundo. Si tumbara
  la inferencia a text, el alumno no podría hacer sum() sobre su propia tabla.
*/
test("una celda vacía no degrada el tipo de la columna", () => {
  assert.equal(inferirTipoColumna(["10", "", "20"]), "integer");
  assert.equal(inferirTipoColumna(["", "", ""]), "text");
});

test("un campo entrecomillado puede contener el delimitador", () => {
  const { columnas, filas } = analizarTablaPegada('producto,nota\n"Silla, roja",ok');
  assert.equal(columnas.length, 2);
  assert.deepEqual(filas, [["Silla, roja", "ok"]]);
});

test("una comilla escapada dentro del campo se conserva", () => {
  const { filas } = analizarTablaPegada('texto\n"dijo ""hola"""');
  assert.deepEqual(filas, [['dijo "hola"']]);
});

test("una fila con menos campos se rellena en vez de perderse", () => {
  const { filas } = analizarTablaPegada("a,b,c\n1,2");
  assert.deepEqual(filas, [["1", "2", ""]]);
});

test("pegar solo el encabezado explica qué falta", () => {
  const resultado = analizarTablaPegada("a,b,c");
  assert.match(resultado.error, /falta al menos una fila/);
  assert.deepEqual(resultado.filas, []);
});

test("pegar nada no revienta", () => {
  assert.match(analizarTablaPegada("").error, /No hay datos/);
  assert.match(analizarTablaPegada("   \n  ").error, /No hay datos/);
});

/*
  El caso que motivó escapar a mano: un apellido con apóstrofo cerraría la cadena
  del INSERT y dejaría SQL sintácticamente roto.
*/
test("un apóstrofo en los datos no rompe el INSERT", () => {
  assert.equal(escaparLiteralSql("O'Brien", "text"), "'O''Brien'");
  assert.equal(escaparLiteralSql("a'b'c", "text"), "'a''b''c'");
});

test("un vacío entra como NULL y no como cadena vacía", () => {
  assert.equal(escaparLiteralSql("", "text"), "null");
  assert.equal(escaparLiteralSql("   ", "integer"), "null");
  assert.equal(escaparLiteralSql(null, "text"), "null");
});

test("los números y booleanos entran sin comillas", () => {
  assert.equal(escaparLiteralSql("42", "integer"), "42");
  assert.equal(escaparLiteralSql("3.5", "numeric"), "3.5");
  assert.equal(escaparLiteralSql("true", "boolean"), "true");
  assert.equal(escaparLiteralSql("falso", "boolean"), "false");
});

/*
  El formato en español escribe 1234,56. Sin convertir la coma a punto, Postgres
  rechaza el literal numérico.
*/
test("la coma decimal del formato en español se convierte a punto", () => {
  assert.equal(escaparLiteralSql("1234,56", "numeric"), "1234.56");
});

/*
  Un valor que no corresponde al tipo inferido (texto en una columna numérica) se
  cita en vez de emitirse crudo: emitirlo crudo produciría SQL inválido.
*/
test("un valor que no encaja con el tipo se cita en vez de romper la sintaxis", () => {
  assert.equal(escaparLiteralSql("N/D", "integer"), "'N/D'");
});

test("el SQL generado crea la tabla y carga los datos", () => {
  const { columnas, filas } = analizarTablaPegada("producto,monto\nSilla,100\nMesa,250");
  const sql = construirSentenciasTabla({ nombre: "Mis Ventas", columnas, filas });

  assert.match(sql, /drop table if exists "mis_ventas";/);
  assert.match(sql, /create table "mis_ventas" \(/);
  assert.match(sql, /"monto" integer/);
  assert.match(sql, /\('Silla', 100\)/);
  assert.match(sql, /\('Mesa', 250\)/);
});

/*
  El DROP hace repetible reimportar la misma tabla; sin él, corregir un dato y
  volver a cargar choca con "ya existe".
*/
test("recargar la misma tabla es repetible", () => {
  const { columnas, filas } = analizarTablaPegada("a\n1");
  const sql = construirSentenciasTabla({ nombre: "t", columnas, filas });
  assert.ok(sql.indexOf("drop table") < sql.indexOf("create table"));
});

test("una carga grande se parte en varios INSERT", () => {
  const filas = Array.from({ length: 250 }, (_, indice) => [String(indice)]);
  const sql = construirSentenciasTabla(
    { nombre: "grande", columnas: [{ nombre: "n", tipo: "integer" }], filas },
    100,
  );
  assert.equal((sql.match(/insert into/g) || []).length, 3);
});

test("sin columnas no se genera SQL", () => {
  assert.equal(construirSentenciasTabla({ nombre: "x", columnas: [], filas: [] }), "");
});

/* --- Datos sintéticos --------------------------------------------- */

test("cada generador declara el tipo SQL que produce", () => {
  for (const generador of GENERADORES_SINTETICOS) {
    assert.ok(generador.id && generador.etiqueta, "cada generador necesita id y etiqueta");
    assert.match(generador.tipo, /^(integer|numeric|text|date|boolean)$/);
  }
});

test("generar datos produce la forma que espera el constructor de SQL", () => {
  const { columnas, filas } = generarDatosSinteticos({
    columnas: [
      { nombre: "Cliente", generador: "nombre" },
      { nombre: "Monto", generador: "decimal" },
    ],
    filas: 10,
    semilla: 7,
  });

  assert.deepEqual(columnas.map((columna) => columna.nombre), ["cliente", "monto"]);
  assert.deepEqual(columnas.map((columna) => columna.tipo), ["text", "numeric"]);
  assert.equal(filas.length, 10);
  assert.ok(filas.every((fila) => fila.length === 2));

  // Y el SQL resultante sale sin agujeros.
  const sql = construirSentenciasTabla({ nombre: "clientes", columnas, filas });
  assert.match(sql, /create table "clientes"/);
  assert.doesNotMatch(sql, /undefined/);
});

/*
  La semilla existe para que "generar 50 filas" sea reproducible: es lo que hace
  posible probar esto en Node y que el alumno vuelva al mismo conjunto de datos.
*/
test("la misma semilla produce exactamente los mismos datos", () => {
  const parametros = { columnas: [{ nombre: "n", generador: "entero" }], filas: 5, semilla: 42 };
  assert.deepEqual(generarDatosSinteticos(parametros).filas, generarDatosSinteticos(parametros).filas);

  const otra = generarDatosSinteticos({ ...parametros, semilla: 43 });
  assert.notDeepEqual(generarDatosSinteticos(parametros).filas, otra.filas);
});

test("las fechas generadas son válidas para una columna date", () => {
  const { filas } = generarDatosSinteticos({
    columnas: [{ nombre: "f", generador: "fecha" }],
    filas: 20,
    semilla: 3,
  });
  for (const [fecha] of filas) {
    assert.match(fecha, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Number.isNaN(new Date(fecha).getTime()), false);
  }
});

test("el número de filas se acota a un rango razonable", () => {
  const columnas = [{ nombre: "n", generador: "entero" }];
  assert.equal(generarDatosSinteticos({ columnas, filas: 0 }).filas.length, 1);
  assert.equal(generarDatosSinteticos({ columnas, filas: 999999 }).filas.length, 5000);
});
