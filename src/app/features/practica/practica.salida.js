/*
  Núcleo puro de la consola del playground: acumular la salida de un programa sin
  que la pestaña muera, y darle forma de tabla al resultado de una consulta SQL.
  Sin DOM, así que Node lo requiere directo en los tests.

  POR QUÉ EXISTE EL TRUNCADO. El primer accidente de todo alumno es imprimir
  dentro de un ciclo grande (`for i in range(10**7): print(i)`). El intérprete
  aguanta eso perfectamente — lo que mata la pestaña es el DOM al intentar pintar
  cientos de MB de texto. Por eso el límite vive acá, del lado del consumidor de
  la salida, y no en el worker: el worker puede seguir produciendo, la consola
  simplemente deja de crecer y lo dice en pantalla.
*/

const LIMITE_LINEAS_SALIDA = 2000;
const LIMITE_CARACTERES_SALIDA = 200000;
const LIMITE_FILAS_TABLA = 500;

const AVISO_SALIDA_TRUNCADA =
  "\n[Salida truncada: el programa imprimió más de lo que la consola puede mostrar.]\n";

/*
  Recorta el texto para que aporte como mucho `lineasDisponibles` saltos de línea,
  cortando en la frontera de línea y no a media línea. Devuelve el texto completo
  si cabe entero.
*/
function recortarPorLineas(texto, lineasDisponibles) {
  if (lineasDisponibles <= 0) return "";

  let restantes = lineasDisponibles;
  let posicion = -1;
  while (restantes > 0) {
    const siguiente = texto.indexOf("\n", posicion + 1);
    if (siguiente === -1) return texto;
    posicion = siguiente;
    restantes -= 1;
  }
  return texto.slice(0, posicion + 1);
}

function contarLineas(texto) {
  let total = 0;
  let posicion = texto.indexOf("\n");
  while (posicion !== -1) {
    total += 1;
    posicion = texto.indexOf("\n", posicion + 1);
  }
  return total;
}

/*
  Acumulador con tope. `agregar` devuelve los fragmentos que la consola debe
  pintar: normalmente uno, ninguno si ya se truncó, o dos cuando este fragmento
  es justo el que cruza el límite (lo que alcanzó a entrar + el aviso).

  El orden de llegada se respeta tal cual: stdout y stderr comparten un solo hilo
  de fragmentos porque intercalarlos es lo que hace legible un traceback que cae
  en medio de unos prints.
*/
function crearAcumuladorSalida(limites = {}) {
  const maxLineas = Number.isFinite(limites.maxLineas) ? limites.maxLineas : LIMITE_LINEAS_SALIDA;
  const maxCaracteres = Number.isFinite(limites.maxCaracteres)
    ? limites.maxCaracteres
    : LIMITE_CARACTERES_SALIDA;

  let lineas = 0;
  let caracteres = 0;
  let truncada = false;

  function agregar(texto, flujo = "stdout") {
    if (truncada) return [];

    const contenido = typeof texto === "string" ? texto : String(texto ?? "");
    if (contenido === "") return [];

    let aceptado = contenido;

    if (caracteres + aceptado.length > maxCaracteres) {
      aceptado = aceptado.slice(0, Math.max(0, maxCaracteres - caracteres));
      truncada = true;
    }

    const lineasDelFragmento = contarLineas(aceptado);
    if (lineas + lineasDelFragmento > maxLineas) {
      aceptado = recortarPorLineas(aceptado, maxLineas - lineas);
      truncada = true;
    }

    caracteres += aceptado.length;
    lineas += contarLineas(aceptado);

    const fragmentos = [];
    if (aceptado !== "") fragmentos.push({ texto: aceptado, flujo });
    if (truncada) fragmentos.push({ texto: AVISO_SALIDA_TRUNCADA, flujo: "aviso" });
    return fragmentos;
  }

  return {
    agregar,
    estaTruncada: () => truncada,
    totalCaracteres: () => caracteres,
    totalLineas: () => lineas,
  };
}

/*
  Un valor de Postgres puede llegar como null, fecha, arreglo o json. `String(v)`
  convertiría un objeto en "[object Object]", que en una tabla de resultados es
  peor que no mostrar nada, así que cada caso tiene su representación.
*/
function formatearCeldaSql(valor) {
  if (valor === null || valor === undefined) return "NULL";
  if (typeof valor === "boolean") return valor ? "true" : "false";
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "object") {
    try {
      return JSON.stringify(valor);
    } catch {
      return String(valor);
    }
  }
  return String(valor);
}

/*
  Traduce el resultado de PGlite ({ rows, fields }) a algo que la vista pinta sin
  pensar. Devuelve null cuando la sentencia no produce filas (create table,
  insert sin returning): ahí no hay tabla que mostrar y quien llama reporta texto.

  Las filas se topean igual que la consola y por la misma razón: un `select` sobre
  una tabla grande no debe congelar la pestaña al construir el <table>.
*/
function formatearTablaSql(resultado, limiteFilas = LIMITE_FILAS_TABLA) {
  const campos = Array.isArray(resultado?.fields) ? resultado.fields : [];
  if (campos.length === 0) return null;

  const columnas = campos.map((campo, indice) => campo?.name ?? `columna_${indice + 1}`);
  const filasCrudas = Array.isArray(resultado?.rows) ? resultado.rows : [];
  const visibles = filasCrudas.slice(0, limiteFilas);

  return {
    columnas,
    filas: visibles.map((fila) => columnas.map((columna) => formatearCeldaSql(fila?.[columna]))),
    totalFilas: filasCrudas.length,
    truncada: filasCrudas.length > visibles.length,
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    LIMITE_LINEAS_SALIDA,
    LIMITE_CARACTERES_SALIDA,
    LIMITE_FILAS_TABLA,
    AVISO_SALIDA_TRUNCADA,
    crearAcumuladorSalida,
    formatearCeldaSql,
    formatearTablaSql,
  });
}
