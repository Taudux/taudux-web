/*
  Núcleo puro del capturador de datos del sandbox de SQL: convertir datos pegados
  a mano (o generados) en las sentencias que crean la tabla. Sin DOM, así que Node
  lo prueba directo.

  POR QUÉ EXISTE. Para practicar SQL hace falta algo sobre qué consultar, y pedirle
  a un alumno que escriba a mano el CREATE TABLE y 40 INSERT antes de su primer
  SELECT es exactamente la fricción que hace que abandone. Acá pega la tabla desde
  Excel —o la genera— y el SQL de carga sale solo.

  Lo que se escribe acá es SQL a partir de texto del usuario. No es un problema de
  seguridad (la base vive en la pestaña del propio alumno, no hay nada ajeno que
  robar), pero sí de correctitud: un apóstrofo en "O'Brien" rompe el INSERT si no
  se escapa, y es un dato perfectamente normal.
*/

const FILAS_POR_INSERT = 500;
const DELIMITADORES_SOPORTADOS = ["\t", ",", ";", "|"];

/*
  Palabras que Postgres no acepta como nombre sin comillas. La lista corta a
  propósito: solo las que un alumno usaría de verdad como nombre de columna.
*/
const PALABRAS_RESERVADAS_SQL = new Set([
  "all", "and", "any", "as", "asc", "between", "by", "case", "check", "column",
  "constraint", "create", "default", "desc", "distinct", "drop", "else", "end",
  "except", "exists", "false", "from", "group", "having", "in", "index", "inner",
  "insert", "intersect", "into", "is", "join", "left", "like", "limit", "not",
  "null", "offset", "on", "or", "order", "outer", "primary", "references",
  "right", "select", "table", "then", "true", "union", "unique", "update",
  "user", "using", "values", "when", "where", "with",
]);

/*
  Un encabezado real trae acentos, espacios y mayúsculas ("Monto Total ($)").
  Postgres lo aceptaría entre comillas, pero entonces el alumno tendría que
  escribir `select "Monto Total ($)"` en cada consulta. Se normaliza a snake_case
  sin acentos para que las consultas se puedan escribir a mano sin pelear.
*/
function normalizarNombreIdentificador(nombre, respaldo = "columna") {
  const base = String(nombre ?? "")
    .normalize("NFD")
    // Marcas diacríticas sueltas que deja NFD: "categoría" queda "categoria".
    .replace(new RegExp("[\u0300-\u036f]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (base === "") return respaldo;
  // Un identificador no puede empezar con dígito: "2024" pasa a "col_2024".
  if (/^\d/.test(base)) return `col_${base}`;
  if (PALABRAS_RESERVADAS_SQL.has(base)) return `${base}_col`;
  return base;
}

/*
  Asegura que ningún nombre se repita: dos columnas "total" romperían el CREATE.
  El primero conserva su nombre, los siguientes reciben sufijo.
*/
function desduplicarNombres(nombres) {
  const vistos = new Map();
  return nombres.map((nombre) => {
    if (!vistos.has(nombre)) {
      vistos.set(nombre, 1);
      return nombre;
    }
    const repeticion = vistos.get(nombre) + 1;
    vistos.set(nombre, repeticion);
    return `${nombre}_${repeticion}`;
  });
}

/*
  Se decide por la primera línea y por conteo: Excel copia con tabuladores, un
  export típico usa comas y uno en español suele traer punto y coma. Gana el que
  más aparece, con la coma como desempate por ser el caso más común.
*/
function detectarDelimitador(texto) {
  const primeraLinea = String(texto ?? "").split(/\r?\n/, 1)[0] || "";

  let elegido = ",";
  let maximo = 0;
  for (const candidato of DELIMITADORES_SOPORTADOS) {
    const apariciones = primeraLinea.split(candidato).length - 1;
    if (apariciones > maximo) {
      maximo = apariciones;
      elegido = candidato;
    }
  }
  return elegido;
}

/*
  Parser delimitado con comillas al estilo RFC 4180: un campo entrecomillado puede
  contener el delimitador y saltos de línea, y "" es una comilla literal. Sin esto,
  una descripción con coma partiría la fila en dos columnas.
*/
function separarFilas(texto, delimitador) {
  const filas = [];
  let campos = [];
  let campo = "";
  let dentroDeComillas = false;

  const contenido = String(texto ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let indice = 0; indice < contenido.length; indice += 1) {
    const caracter = contenido[indice];

    if (dentroDeComillas) {
      if (caracter === '"') {
        if (contenido[indice + 1] === '"') {
          campo += '"';
          indice += 1;
        } else {
          dentroDeComillas = false;
        }
      } else {
        campo += caracter;
      }
      continue;
    }

    if (caracter === '"') {
      dentroDeComillas = true;
    } else if (caracter === delimitador) {
      campos.push(campo);
      campo = "";
    } else if (caracter === "\n") {
      campos.push(campo);
      filas.push(campos);
      campos = [];
      campo = "";
    } else {
      campo += caracter;
    }
  }

  if (campo !== "" || campos.length > 0) {
    campos.push(campo);
    filas.push(campos);
  }

  // Una línea en blanco al final del pegado no es una fila de datos.
  return filas.filter((fila) => fila.some((valor) => valor.trim() !== ""));
}

function pareceEntero(valor) {
  return /^-?\d+$/.test(valor) && Math.abs(Number(valor)) <= Number.MAX_SAFE_INTEGER;
}

function pareceDecimal(valor) {
  // Acepta la coma decimal del formato en español además del punto.
  return /^-?\d+([.,]\d+)?$/.test(valor);
}

function pareceBooleano(valor) {
  return /^(true|false|verdadero|falso)$/i.test(valor);
}

function pareceFecha(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

/*
  Los vacíos se ignoran al inferir: una columna de números con una celda en blanco
  sigue siendo numérica, y ese hueco entra como NULL. Si TODO está vacío no hay
  nada que deducir y queda text, el tipo que nunca falla al insertar.
*/
function inferirTipoColumna(valores) {
  const utiles = valores.map((valor) => String(valor ?? "").trim()).filter((valor) => valor !== "");
  if (utiles.length === 0) return "text";

  if (utiles.every(pareceEntero)) return "integer";
  if (utiles.every(pareceDecimal)) return "numeric";
  if (utiles.every(pareceBooleano)) return "boolean";
  if (utiles.every(pareceFecha)) return "date";
  return "text";
}

/*
  Convierte el texto pegado en columnas tipadas y filas. La primera fila se toma
  como encabezado: es lo que sale de Excel y de cualquier export.
*/
function analizarTablaPegada(texto, opciones = {}) {
  const delimitador = opciones.delimitador || detectarDelimitador(texto);
  const filasCrudas = separarFilas(texto, delimitador);

  if (filasCrudas.length === 0) {
    return { columnas: [], filas: [], delimitador, error: "No hay datos que leer." };
  }

  const encabezados = filasCrudas[0];
  const cuerpo = filasCrudas.slice(1);

  if (cuerpo.length === 0) {
    return {
      columnas: [],
      filas: [],
      delimitador,
      error: "Solo se encontró el encabezado: falta al menos una fila de datos.",
    };
  }

  const nombres = desduplicarNombres(
    encabezados.map((encabezado, indice) =>
      normalizarNombreIdentificador(encabezado, `columna_${indice + 1}`),
    ),
  );

  /*
    Una fila más corta que el encabezado se rellena con vacíos en vez de
    rechazarse: es lo que pasa cuando el último campo del renglón viene vacío, y
    perder toda la carga por eso sería absurdo.
  */
  const filas = cuerpo.map((fila) =>
    nombres.map((_, indice) => (fila[indice] === undefined ? "" : fila[indice].trim())),
  );

  const columnas = nombres.map((nombre, indice) => ({
    nombre,
    original: String(encabezados[indice] ?? "").trim(),
    tipo: inferirTipoColumna(filas.map((fila) => fila[indice])),
  }));

  return { columnas, filas, delimitador, error: null };
}

/*
  Escapa un valor para meterlo en un INSERT. Los apóstrofos se duplican, que es la
  forma que Postgres entiende; un vacío entra como NULL y no como cadena vacía,
  porque "sin dato" es justo lo que el alumno va a querer filtrar con `is null`.
*/
function escaparLiteralSql(valor, tipo) {
  const texto = String(valor ?? "").trim();
  if (texto === "") return "null";

  if (tipo === "integer" && pareceEntero(texto)) return texto;
  if (tipo === "numeric" && pareceDecimal(texto)) return texto.replace(",", ".");
  if (tipo === "boolean" && pareceBooleano(texto)) {
    return /^(true|verdadero)$/i.test(texto) ? "true" : "false";
  }

  return `'${texto.replace(/'/g, "''")}'`;
}

/*
  Arma el SQL completo de carga. El DROP va incluido para que reimportar la misma
  tabla sea repetible en vez de chocar con "ya existe".

  Los INSERT se parten en lotes: un solo INSERT con 50 000 filas es una cadena de
  varios MB que PGlite tarda muchísimo en parsear.
*/
function construirSentenciasTabla({ nombre, columnas, filas }, filasPorInsert = FILAS_POR_INSERT) {
  const tabla = normalizarNombreIdentificador(nombre, "datos");
  if (columnas.length === 0) return "";

  const definiciones = columnas.map((columna) => `  "${columna.nombre}" ${columna.tipo}`);
  const listaColumnas = columnas.map((columna) => `"${columna.nombre}"`).join(", ");

  const sentencias = [
    `drop table if exists "${tabla}";`,
    `create table "${tabla}" (\n${definiciones.join(",\n")}\n);`,
  ];

  for (let inicio = 0; inicio < filas.length; inicio += filasPorInsert) {
    const lote = filas.slice(inicio, inicio + filasPorInsert);
    const valores = lote
      .map(
        (fila) =>
          `  (${columnas.map((columna, indice) => escaparLiteralSql(fila[indice], columna.tipo)).join(", ")})`,
      )
      .join(",\n");
    sentencias.push(`insert into "${tabla}" (${listaColumnas}) values\n${valores};`);
  }

  return sentencias.join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Datos sintéticos                                                     */
/* ------------------------------------------------------------------ */

const NOMBRES_SINTETICOS = [
  "Ana", "Luis", "Sofia", "Carlos", "Maria", "Jorge", "Elena", "Pablo",
  "Lucia", "Diego", "Carmen", "Andres", "Paula", "Ricardo", "Valeria",
];
const APELLIDOS_SINTETICOS = [
  "Garcia", "Martinez", "Lopez", "Hernandez", "Torres", "Ramirez", "Flores",
  "Rivera", "Morales", "Ortiz",
];
const CATEGORIAS_SINTETICAS = ["Norte", "Sur", "Centro", "Occidente", "Oriente"];
const PRODUCTOS_SINTETICOS = ["Consultoria", "Capacitacion", "Soporte", "Licencia", "Analitica"];

/*
  PRNG propio y sembrable (mulberry32) en vez de Math.random: hace que "generar 50
  filas" sea reproducible, que es lo que permite probar esto en Node y que el
  alumno pueda volver al mismo conjunto de datos.
*/
function crearAleatorio(semilla) {
  let estado = semilla >>> 0;
  return function siguiente() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let valor = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    valor = (valor + Math.imul(valor ^ (valor >>> 7), 61 | valor)) ^ valor;
    return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296;
  };
}

function elegir(azar, lista) {
  return lista[Math.floor(azar() * lista.length)];
}

const GENERADORES_SINTETICOS = [
  {
    id: "entero",
    etiqueta: "Número entero",
    tipo: "integer",
    generar: (azar) => String(Math.floor(azar() * 1000)),
  },
  {
    id: "decimal",
    etiqueta: "Número decimal",
    tipo: "numeric",
    generar: (azar) => (azar() * 10000).toFixed(2),
  },
  {
    id: "nombre",
    etiqueta: "Nombre de persona",
    tipo: "text",
    generar: (azar) => `${elegir(azar, NOMBRES_SINTETICOS)} ${elegir(azar, APELLIDOS_SINTETICOS)}`,
  },
  {
    id: "correo",
    etiqueta: "Correo",
    tipo: "text",
    generar: (azar) =>
      `${elegir(azar, NOMBRES_SINTETICOS).toLowerCase()}.${elegir(azar, APELLIDOS_SINTETICOS).toLowerCase()}@ejemplo.com`,
  },
  {
    id: "categoria",
    etiqueta: "Región",
    tipo: "text",
    generar: (azar) => elegir(azar, CATEGORIAS_SINTETICAS),
  },
  {
    id: "producto",
    etiqueta: "Producto",
    tipo: "text",
    generar: (azar) => elegir(azar, PRODUCTOS_SINTETICOS),
  },
  {
    id: "fecha",
    etiqueta: "Fecha",
    tipo: "date",
    generar: (azar) => {
      const dia = Math.floor(azar() * 365);
      const fecha = new Date(Date.UTC(2024, 0, 1 + dia));
      return fecha.toISOString().slice(0, 10);
    },
  },
  {
    id: "booleano",
    etiqueta: "Sí / No",
    tipo: "boolean",
    generar: (azar) => (azar() < 0.5 ? "true" : "false"),
  },
];

function obtenerGeneradorSintetico(id) {
  return GENERADORES_SINTETICOS.find((generador) => generador.id === id) || GENERADORES_SINTETICOS[0];
}

/*
  `columnas` llega como [{ nombre, generador }]. Devuelve la misma forma que
  analizarTablaPegada para que la vista y construirSentenciasTabla no distingan
  entre datos pegados y datos generados.
*/
function generarDatosSinteticos({ columnas, filas, semilla = 1 }) {
  const azar = crearAleatorio(semilla);

  const definidas = desduplicarNombres(
    columnas.map((columna, indice) =>
      normalizarNombreIdentificador(columna.nombre, `columna_${indice + 1}`),
    ),
  ).map((nombre, indice) => {
    const generador = obtenerGeneradorSintetico(columnas[indice].generador);
    return { nombre, tipo: generador.tipo, generador };
  });

  const total = Math.max(1, Math.min(Number(filas) || 0, 5000));
  const datos = [];
  for (let fila = 0; fila < total; fila += 1) {
    datos.push(definidas.map((columna) => columna.generador.generar(azar)));
  }

  return {
    columnas: definidas.map(({ nombre, tipo }) => ({ nombre, original: nombre, tipo })),
    filas: datos,
    error: null,
  };
}

/* ------------------------------------------------------------------ */
/* Esquema: construir y modificar la base desde la vista de diseño       */
/* ------------------------------------------------------------------ */

/*
  Los tipos que ofrece el diseñador. Es un subconjunto corto de Postgres a
  propósito: son los que cubren el 95% de lo que un alumno modela, y una lista de
  cuarenta tipos convierte una decisión trivial en un obstáculo.
*/
const TIPOS_COLUMNA_SQL = [
  { id: "text", etiqueta: "Texto" },
  { id: "integer", etiqueta: "Número entero" },
  { id: "numeric", etiqueta: "Número decimal" },
  { id: "boolean", etiqueta: "Sí / No" },
  { id: "date", etiqueta: "Fecha" },
  { id: "timestamp", etiqueta: "Fecha y hora" },
];

function tipoSqlValido(tipo) {
  return TIPOS_COLUMNA_SQL.some((candidato) => candidato.id === tipo);
}

/*
  Un tipo inventado llegando al SQL sería inyección de DDL. Como el valor sale de
  un <select>, no debería pasar nunca — y justamente por eso conviene la guarda:
  lo que "no puede pasar" es lo que nadie revisa.
*/
function tipoSeguro(tipo) {
  return tipoSqlValido(tipo) ? tipo : "text";
}

function sentenciaCrearTablaVacia({ nombre, columnas }) {
  const tabla = normalizarNombreIdentificador(nombre, "tabla");
  if (!Array.isArray(columnas) || columnas.length === 0) return "";

  const nombres = desduplicarNombres(
    columnas.map((columna, indice) =>
      normalizarNombreIdentificador(columna.nombre, `columna_${indice + 1}`),
    ),
  );

  const definiciones = nombres.map(
    (nombreColumna, indice) => `  "${nombreColumna}" ${tipoSeguro(columnas[indice].tipo)}`,
  );

  return `create table "${tabla}" (\n${definiciones.join(",\n")}\n);`;
}

function sentenciaAgregarColumna(tabla, columna) {
  const nombreTabla = normalizarNombreIdentificador(tabla, "tabla");
  const nombreColumna = normalizarNombreIdentificador(columna?.nombre, "columna");
  return `alter table "${nombreTabla}" add column "${nombreColumna}" ${tipoSeguro(columna?.tipo)};`;
}

function sentenciaEliminarColumna(tabla, columna) {
  const nombreTabla = normalizarNombreIdentificador(tabla, "tabla");
  const nombreColumna = normalizarNombreIdentificador(columna, "columna");
  return `alter table "${nombreTabla}" drop column "${nombreColumna}";`;
}

function sentenciaEliminarTabla(tabla) {
  return `drop table if exists "${normalizarNombreIdentificador(tabla, "tabla")}" cascade;`;
}

/*
  Fila nueva con todas las columnas. Un valor vacío entra como NULL, que es lo
  correcto para "todavía no lo sé" y permite practicar `is null` después.
*/
function sentenciaInsertarFila(tabla, columnas, valores) {
  const nombreTabla = normalizarNombreIdentificador(tabla, "tabla");
  if (!Array.isArray(columnas) || columnas.length === 0) return "";

  const lista = columnas.map((columna) => `"${columna.nombre}"`).join(", ");
  const datos = columnas
    .map((columna, indice) => escaparLiteralSql(valores?.[indice], columna.tipo))
    .join(", ");

  return `insert into "${nombreTabla}" (${lista}) values (${datos});`;
}

/*
  IDENTIFICAR UNA FILA SIN CLAVE PRIMARIA. Las tablas del diseñador no llevan id
  —el alumno no debería estar obligado a modelar uno para poder practicar— así que
  para editar o borrar una fila concreta se usa ctid, el identificador físico que
  Postgres le da a cada tupla.

  Es válido solo dentro de la misma sesión y cambia si la fila se reescribe, que
  es exactamente el alcance que hace falta acá: leer la grilla, tocar una celda y
  volver a leer.
*/
const FORMA_CTID = /^\(\d+,\d+\)$/;

function ctidSeguro(ctid) {
  return typeof ctid === "string" && FORMA_CTID.test(ctid) ? ctid : null;
}

function sentenciaActualizarCelda(tabla, ctid, columna, valor, tipo) {
  const identificador = ctidSeguro(ctid);
  // Sin un ctid con forma válida no se emite nada: un update sin where borraría
  // el sentido de toda la tabla de un solo golpe.
  if (!identificador) return "";

  const nombreTabla = normalizarNombreIdentificador(tabla, "tabla");
  const nombreColumna = normalizarNombreIdentificador(columna, "columna");

  return (
    `update "${nombreTabla}" set "${nombreColumna}" = ${escaparLiteralSql(valor, tipo)} ` +
    `where ctid = '${identificador}';`
  );
}

function sentenciaEliminarFila(tabla, ctid) {
  const identificador = ctidSeguro(ctid);
  if (!identificador) return "";

  const nombreTabla = normalizarNombreIdentificador(tabla, "tabla");
  return `delete from "${nombreTabla}" where ctid = '${identificador}';`;
}

/*
  Decodifica el contenido crudo de un archivo importado.

  POR QUÉ NO ALCANZA CON UTF-8. Excel en Windows sigue exportando CSV en la
  codificación regional (windows-1252 en español), no en UTF-8. Leído como UTF-8,
  cada acento se convierte en el carácter de reemplazo U+FFFD y la tabla entra con
  "Regi<?>n" en vez de "Región". Como U+FFFD solo aparece cuando la decodificación
  falló, sirve de señal para reintentar con la codificación de Excel.

  También se quita el BOM: Excel lo antepone, y sin quitarlo el primer encabezado
  queda con un carácter invisible pegado que rompe el nombre de la columna.
*/
function decodificarTextoImportado(bytes) {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");

  try {
    return new TextDecoder("windows-1252").decode(bytes).replace(/^﻿/, "");
  } catch {
    // Navegador sin esa codificación: mejor el texto con reemplazos que nada.
    return utf8.replace(/^﻿/, "");
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    FILAS_POR_INSERT,
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
  });
}
