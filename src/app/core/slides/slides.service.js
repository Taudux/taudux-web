/*
  Acceso a los datos de las presentaciones de Slides.

  A diferencia del resto de los servicios del sitio, este NO habla con
  Supabase: el catálogo y cada presentación viven como archivos estáticos en
  el repositorio y se sirven desde /content/slides. El área es pública, así
  que no hay sesión ni RLS de por medio — mismo caso que notas.service.js.

  Conserva el contrato de resultados del proyecto —{ ok, mensaje } en vez de
  excepciones— y cachea el catálogo en memoria para no bajarlo dos veces en la
  misma visita.

  Cada presentación es hoy un deck autocontenido (un solo HTML con sus
  gráficas), no una carpeta de diapositivas sueltas: /content/slides/
  manifiesto.json es sólo el ÍNDICE (un arreglo de slugs, uno por carpeta) y
  cada carpeta trae su propio manifiesto con título, descripción y el archivo
  a abrir. Se bajan todos los manifiestos de carpeta EN PARALELO
  (Promise.allSettled) y una carpeta rota —404, JSON inválido— se descarta
  con un aviso en consola en vez de tumbar el catálogo entero.

  Este servicio entrega el catálogo ya armado (slug, título, descripción y la
  URL completa del archivo); normalizar y validar cada entrada a fondo sigue
  siendo trabajo de slides.logica.js (features/slides), que carga después y
  es lo único que necesita esa lógica pura.
*/

const reporteroSlides =
  typeof crearReporteroOperaciones === "function"
    ? crearReporteroOperaciones("slides")
    : { iniciarTiempo: () => 0, reportarFallo: () => {} };

const RUTA_BASE_SLIDES = "/content/slides";
const RUTA_MANIFIESTO_SLIDES = `${RUTA_BASE_SLIDES}/manifiesto.json`;

/* Caché en memoria de la vida de la página: el catálogo se descarga una sola
   vez aunque el visor y la lista lo pidan a la vez en el arranque. */
let catalogoEnMemoria = null;
let cargaDeCatalogoEnCurso = null;

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
  Descarga el manifiesto de UNA carpeta y arma la entrada de catálogo que le
  corresponde, o `null` si esa carpeta no se puede ofrecer (404, tipo de
  contenido raro, JSON que no parsea o que no es un objeto). Nunca lanza: el
  llamador la usa dentro de Promise.allSettled y un `null` alcanza para que
  esa carpeta se descarte sin tumbar a las demás.
*/
async function cargarManifiestoDeCarpeta(slug) {
  const respuesta = await fetch(`${RUTA_BASE_SLIDES}/${slug}/manifiesto.json`, { cache: "no-cache" });
  if (!respuesta.ok || esRespuestaDeArchivoAusente(respuesta)) return null;

  const manifiesto = await respuesta.json();
  if (!manifiesto || typeof manifiesto !== "object") return null;

  return {
    slug,
    titulo: manifiesto.titulo,
    descripcion: manifiesto.descripcion,
    archivo: manifiesto.archivo,
    url: `${RUTA_BASE_SLIDES}/${slug}/${manifiesto.archivo}`,
  };
}

/*
  Descarga el catálogo de presentaciones: primero el índice (el arreglo de
  slugs), después el manifiesto de cada carpeta EN PARALELO. Las llamadas
  concurrentes a esta función comparten la misma promesa, y un índice que
  llega roto se trata como error de carga y no se cachea, para que un
  "Reintentar" tenga sentido — una carpeta suelta rota, en cambio, sólo se
  descarta a sí misma (ver cargarManifiestoDeCarpeta).
*/
async function cargarCatalogoDeSlides() {
  if (catalogoEnMemoria) return { ok: true, catalogo: catalogoEnMemoria };
  if (cargaDeCatalogoEnCurso) return cargaDeCatalogoEnCurso;

  const inicio = reporteroSlides.iniciarTiempo();

  cargaDeCatalogoEnCurso = (async () => {
    try {
      const respuesta = await fetch(RUTA_MANIFIESTO_SLIDES, { cache: "no-cache" });
      if (!respuesta.ok || esRespuestaDeArchivoAusente(respuesta)) {
        reporteroSlides.reportarFallo("cargar_indice", null, inicio, `http_${respuesta.status}`);
        return { ok: false, mensaje: "No se pudo cargar el catálogo de presentaciones." };
      }

      const indice = await respuesta.json();
      if (!Array.isArray(indice)) {
        reporteroSlides.reportarFallo("cargar_indice", null, inicio, "indice_invalido");
        return { ok: false, mensaje: "El catálogo de presentaciones no es válido." };
      }

      const resultados = await Promise.allSettled(
        indice.map((slug) => cargarManifiestoDeCarpeta(slug))
      );

      const catalogo = [];
      resultados.forEach((resultado, posicion) => {
        if (resultado.status === "fulfilled" && resultado.value) {
          catalogo.push(resultado.value);
          return;
        }
        const slug = indice[posicion];
        const motivo = resultado.status === "rejected" ? resultado.reason : "manifiesto inválido";
        console.warn(`slides: se descarta la carpeta "${slug}" — ${motivo}`);
      });

      catalogoEnMemoria = catalogo;
      return { ok: true, catalogo };
    } catch (error) {
      reporteroSlides.reportarFallo("cargar_indice", error, inicio, "excepcion");
      return { ok: false, mensaje: "No se pudo cargar el catálogo de presentaciones." };
    } finally {
      /* Se libera pase lo que pase: si quedara colgada, un fallo de red
         dejaría el "Reintentar" devolviendo para siempre la promesa fallida. */
      cargaDeCatalogoEnCurso = null;
    }
  })();

  return cargaDeCatalogoEnCurso;
}

/* Deja la caché en cero. Lo usa el botón de reintentar. */
function olvidarSlidesEnMemoria() {
  catalogoEnMemoria = null;
  cargaDeCatalogoEnCurso = null;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    RUTA_BASE_SLIDES,
    RUTA_MANIFIESTO_SLIDES,
    cargarCatalogoDeSlides,
    olvidarSlidesEnMemoria,
  });
}
