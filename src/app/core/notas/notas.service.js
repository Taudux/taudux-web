/*
  Acceso a los datos de las notas. Depende de notas.arbol.js y debe cargarse
  después de él; crearReporteroOperaciones es opcional y si no está, degrada.

  A diferencia del resto de servicios del sitio, este NO habla con Supabase: las
  notas viven como archivos estáticos en el repositorio y se sirven desde
  /content/notas. El área es pública, así que no hay sesión ni RLS de por medio.
  Lo que sí conserva es el contrato de resultados del proyecto —{ ok, mensaje }
  en vez de excepciones— para que las pantallas manejen el error igual que en
  cursos o en el portal.
*/

const reporteroNotas =
  typeof crearReporteroOperaciones === "function"
    ? crearReporteroOperaciones("notas")
    : { iniciarTiempo: () => 0, reportarFallo: () => {} };

/*
  Caché en memoria de la vida de la página. Vale para las dos vistas y para el
  ir y venir entre notas: el manifiesto se descarga una sola vez aunque el
  lector recorra veinte ramas, y una nota ya leída se reabre sin red.
*/
let arbolEnMemoria = null;
let cargaDeArbolEnCurso = null;
const cuerposEnMemoria = new Map();

/*
  Una respuesta 200 con HTML es el modo típico de fallar de un host estático:
  la ruta no existe y devuelve la página de error o el index. Sin esta
  comprobación, JSON.parse fallaría con un mensaje que no ayuda a nadie.
*/
function esRespuestaDeArchivoAusente(respuesta) {
  const tipo = respuesta.headers.get("content-type") || "";
  return tipo.includes("text/html");
}

/*
  Descarga y arma el árbol. Las llamadas concurrentes comparten la misma
  promesa: la vista de lista y la del grafo pueden pedirlo a la vez en el
  arranque y no tiene sentido bajar el manifiesto dos veces.

  Un manifiesto que llega roto se trata como error de carga y no se cachea, para
  que un "Reintentar" tenga sentido.
*/
async function cargarArbolDeNotas() {
  if (arbolEnMemoria) return { ok: true, arbol: arbolEnMemoria };
  if (cargaDeArbolEnCurso) return cargaDeArbolEnCurso;

  const inicio = reporteroNotas.iniciarTiempo();

  cargaDeArbolEnCurso = (async () => {
    try {
      const respuesta = await fetch(RUTA_MANIFIESTO_NOTAS, { cache: "no-cache" });
      if (!respuesta.ok || esRespuestaDeArchivoAusente(respuesta)) {
        reporteroNotas.reportarFallo(
          "cargar_manifiesto",
          null,
          inicio,
          `http_${respuesta.status}`
        );
        return { ok: false, mensaje: "No se pudo cargar el índice de notas." };
      }

      const manifiesto = await respuesta.json();
      const arbol = construirArbolDeNotas(manifiesto);
      if (arbol.raiz.hijos.length === 0) {
        reporteroNotas.reportarFallo("cargar_manifiesto", null, inicio, "manifiesto_vacio");
        return { ok: false, mensaje: "El índice de notas está vacío." };
      }

      arbolEnMemoria = arbol;
      return { ok: true, arbol };
    } catch (error) {
      reporteroNotas.reportarFallo("cargar_manifiesto", error, inicio, "excepcion");
      return { ok: false, mensaje: "No se pudo cargar el índice de notas." };
    } finally {
      /* Se libera pase lo que pase: si quedara colgada, un fallo de red dejaría
         el "Reintentar" devolviendo para siempre la promesa fallida. */
      cargaDeArbolEnCurso = null;
    }
  })();

  return cargaDeArbolEnCurso;
}

/* Descarga el cuerpo de una nota. Devuelve el markdown crudo: interpretarlo es
   trabajo del renderizador, que solo carga en la vista de lectura. */
async function cargarCuerpoDeNota(nota) {
  if (!nota || !nota.archivo) {
    return { ok: false, mensaje: "Esta nota no tiene contenido asociado." };
  }
  if (cuerposEnMemoria.has(nota.archivo)) {
    return { ok: true, markdown: cuerposEnMemoria.get(nota.archivo) };
  }

  const inicio = reporteroNotas.iniciarTiempo();

  try {
    /*
      El archivo se pide tal cual lo declara el manifiesto, sin construirlo a
      partir de la URL: así una ruta manipulada en el hash no puede convertirse
      en una petición a otra parte del sitio.
    */
    const respuesta = await fetch(`${RUTA_BASE_NOTAS}/${nota.archivo}`, { cache: "no-cache" });
    if (!respuesta.ok || esRespuestaDeArchivoAusente(respuesta)) {
      reporteroNotas.reportarFallo("cargar_nota", null, inicio, `http_${respuesta.status}`);
      return { ok: false, mensaje: "No se pudo cargar esta nota." };
    }

    const markdown = await respuesta.text();
    cuerposEnMemoria.set(nota.archivo, markdown);
    return { ok: true, markdown };
  } catch (error) {
    reporteroNotas.reportarFallo("cargar_nota", error, inicio, "excepcion");
    return { ok: false, mensaje: "No se pudo cargar esta nota." };
  }
}

/* Deja la caché en cero. Lo usa el botón de reintentar: si el manifiesto se
   arregló del lado del servidor, recargar la página no debería ser el remedio. */
function olvidarNotasEnMemoria() {
  arbolEnMemoria = null;
  cargaDeArbolEnCurso = null;
  cuerposEnMemoria.clear();
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    cargarArbolDeNotas,
    cargarCuerpoDeNota,
    olvidarNotasEnMemoria,
  });
}
