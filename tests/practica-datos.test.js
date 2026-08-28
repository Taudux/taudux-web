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
  TIPOS_COLUMNA_SQL,
  ctidSeguro,
  sentenciaActualizarCelda,
  sentenciaAgregarColumna,
  sentenciaCrearTablaVacia,
  sentenciaEliminarColumna,
  sentenciaEliminarFila,
  sentenciaEliminarTabla,
  sentenciaInsertarFila,
  tipoSqlValido,
  decodificarTextoImportado,
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

/* --- Esquema: construir y modificar la base ------------------------ */

/*
  Estas sentencias las arma la vista de diseño a partir de lo que el alumno
  teclea. Lo que se blinda acá es que ni un nombre raro ni un valor manipulado
  puedan producir SQL distinto del que la pantalla dice que va a ejecutar.
*/

test("crear una tabla vacía normaliza nombre y columnas", () => {
  const sql = sentenciaCrearTablaVacia({
    nombre: "Mis Ventas",
    columnas: [{ nombre: "Producto", tipo: "text" }, { nombre: "Monto Total", tipo: "numeric" }],
  });

  assert.match(sql, /create table "mis_ventas"/);
  assert.match(sql, /"producto" text/);
  assert.match(sql, /"monto_total" numeric/);
});

test("una tabla sin columnas no genera SQL", () => {
  assert.equal(sentenciaCrearTablaVacia({ nombre: "t", columnas: [] }), "");
  assert.equal(sentenciaCrearTablaVacia({ nombre: "t" }), "");
});

test("dos columnas con el mismo nombre no rompen el create", () => {
  const sql = sentenciaCrearTablaVacia({
    nombre: "t",
    columnas: [{ nombre: "total", tipo: "integer" }, { nombre: "Total", tipo: "integer" }],
  });

  assert.match(sql, /"total" integer/);
  assert.match(sql, /"total_2" integer/);
});

test("agregar y eliminar columnas produce el ALTER correcto", () => {
  assert.equal(
    sentenciaAgregarColumna("ventas", { nombre: "Región", tipo: "text" }),
    'alter table "ventas" add column "region" text;',
  );
  assert.equal(
    sentenciaEliminarColumna("ventas", "Región"),
    'alter table "ventas" drop column "region";',
  );
});

/*
  El tipo sale de un <select>, así que un valor fuera de la lista no debería
  llegar nunca. Justamente por eso hay guarda: lo que "no puede pasar" es lo que
  nadie revisa, y acá el tipo va crudo al DDL.
*/
test("un tipo fuera de la lista cae a text en vez de entrar al DDL", () => {
  const sql = sentenciaAgregarColumna("t", { nombre: "x", tipo: "; drop table t; --" });

  assert.equal(sql, 'alter table "t" add column "x" text;');
  assert.doesNotMatch(sql, /drop table/);
  assert.equal(tipoSqlValido("text"), true);
  assert.equal(tipoSqlValido("bytea"), false);
});

test("eliminar una tabla es repetible y arrastra lo que dependa de ella", () => {
  assert.equal(sentenciaEliminarTabla("Mis Datos"), 'drop table if exists "mis_datos" cascade;');
});

test("insertar una fila escapa los valores según el tipo de cada columna", () => {
  const sql = sentenciaInsertarFila(
    "ventas",
    [{ nombre: "producto", tipo: "text" }, { nombre: "monto", tipo: "integer" }],
    ["O'Brien", "150"],
  );

  assert.match(sql, /insert into "ventas" \("producto", "monto"\)/);
  assert.match(sql, /values \('O''Brien', 150\)/);
});

test("una celda vacía en la fila nueva entra como NULL", () => {
  const sql = sentenciaInsertarFila("t", [{ nombre: "a", tipo: "text" }], [""]);
  assert.match(sql, /values \(null\)/);
});

/*
  ctid es lo que permite editar una fila en una tabla sin clave primaria. Si la
  forma no es exactamente la de Postgres, no se emite NADA: un update o un delete
  sin where correcto arrasaría con toda la tabla.
*/
test("solo un ctid con la forma de Postgres produce sentencia", () => {
  assert.equal(ctidSeguro("(0,1)"), "(0,1)");
  assert.equal(ctidSeguro("(12,340)"), "(12,340)");
  assert.equal(ctidSeguro("1 or 1=1"), null);
  assert.equal(ctidSeguro("(0,1) or true"), null);
  assert.equal(ctidSeguro(""), null);
  assert.equal(ctidSeguro(null), null);
});

test("un ctid manipulado no emite update ni delete", () => {
  assert.equal(sentenciaActualizarCelda("t", "' or '1'='1", "a", "x", "text"), "");
  assert.equal(sentenciaEliminarFila("t", "'; drop table t; --"), "");
});

test("actualizar una celda apunta a una sola fila por su ctid", () => {
  assert.equal(
    sentenciaActualizarCelda("ventas", "(0,3)", "Monto", "99", "integer"),
    'update "ventas" set "monto" = 99 where ctid = \'(0,3)\';',
  );
});

test("eliminar una fila apunta a una sola fila por su ctid", () => {
  assert.equal(sentenciaEliminarFila("ventas", "(0,3)"), 'delete from "ventas" where ctid = \'(0,3)\';');
});

test("cada tipo de columna ofrecido declara id y etiqueta", () => {
  assert.ok(TIPOS_COLUMNA_SQL.length > 0);
  for (const tipo of TIPOS_COLUMNA_SQL) {
    assert.ok(tipo.id && tipo.etiqueta, "cada tipo necesita id y etiqueta");
  }
});

/* --- Importar archivos --------------------------------------------- */

/*
  Excel en Windows sigue exportando CSV en la codificación regional, no en UTF-8.
  Sin este arreglo, "Región" entra a la base como "Regi<?>n" y el alumno arrastra
  el dato roto por todo el ejercicio.
*/
test("un CSV en UTF-8 se lee tal cual", () => {
  const bytes = new TextEncoder().encode("producto,región\nSilla,Norte");
  assert.equal(decodificarTextoImportado(bytes).split("\n")[0], "producto,región");
});

test("un CSV exportado por Excel en español recupera sus acentos", () => {
  // "región" en windows-1252: la ó es un solo byte 0xF3, inválido como UTF-8.
  const bytes = new Uint8Array([0x72, 0x65, 0x67, 0x69, 0xf3, 0x6e]);
  assert.equal(decodificarTextoImportado(bytes), "región");
});

/*
  Excel antepone un BOM. Sin quitarlo, el primer encabezado arrastra un carácter
  invisible y su columna termina llamándose distinto de lo que se ve en pantalla.
*/
test("el BOM de Excel no contamina el primer encabezado", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]);
  assert.equal(decodificarTextoImportado(bytes), "a,b");

  const { columnas } = analizarTablaPegada(decodificarTextoImportado(bytes) + "\n1,2");
  assert.deepEqual(columnas.map((columna) => columna.nombre), ["a", "b"]);
});

test("un archivo vacío no revienta el decodificador", () => {
  assert.equal(decodificarTextoImportado(new Uint8Array([])), "");
});

/*
  Un CSV importado tiene que recorrer el mismo camino que uno pegado: decodificar
  no sirve de nada si después el análisis no lo entiende.
*/
test("lo decodificado se puede analizar y volcar a SQL", () => {
  const bytes = new TextEncoder().encode("producto;monto\nSilla;100\nMesa;250");
  const { columnas, filas, error } = analizarTablaPegada(decodificarTextoImportado(bytes));

  assert.equal(error, null);
  assert.deepEqual(columnas.map((columna) => columna.nombre), ["producto", "monto"]);
  assert.equal(filas.length, 2);
  assert.match(construirSentenciasTabla({ nombre: "t", columnas, filas }), /\('Silla', 100\)/);
});
