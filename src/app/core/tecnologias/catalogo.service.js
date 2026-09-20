/*
  Carga el catálogo de tecnologías que el campo Stack de "Mi ficha" usa para
  sugerir mientras se escribe. Como las notas, y a diferencia del resto de los
  servicios del sitio, este NO habla con Supabase: el catálogo es un archivo
  estático del repositorio (src/content/tecnologias/catalogo.json) y se sirve
  desde /content/tecnologias.

  El catálogo NO es una lista blanca. Sugiere, nunca restringe: quien escribe
  una tecnología que no está en él la guarda igual. De ahí que este archivo no
  use crearReporteroOperaciones, que en este proyecto es consola más aviso en
  pantalla y no telemetría — un catálogo que no carga degrada en silencio a
  propósito, y un aviso sería ruido por algo que a quien edita su ficha no le
  toca resolver. Quien llama recibe { ok: false } y decide; el formulario sigue
  aceptando texto libre.
*/

const RUTA_CATALOGO_TECNOLOGIAS = "/content/tecnologias/catalogo.json";

// Caché de la vida de la página: el catálogo no cambia entre dos teclas.
let catalogoEnMemoria = null;
let cargaDeCatalogoEnCurso = null;

/*
  Una respuesta 200 con HTML es el modo típico de fallar de un host estático:
  la ruta no existe y devuelve el index. Sin esto, JSON.parse fallaría con un
  mensaje que no ayuda a nadie. Igual que en notas.service.js.
*/
function esCatalogoAusente(respuesta) {
  const tipo = respuesta.headers.get("content-type") || "";
  return tipo.includes("text/html");
}

/*
  Se queda sólo con los textos. Un catálogo a medio editar —con un número
  colado entre las comillas, o sin el arreglo— no tiene por qué tumbar el
  campo: se usa lo que sirve y, si no queda nada, es un fallo de carga.
*/
function tecnologiasDelCatalogo(datos) {
  if (!Array.isArray(datos?.tecnologias)) return [];
  return datos.tecnologias.filter((tecnologia) => typeof tecnologia === "string" && tecnologia !== "");
}

/*
  Las llamadas concurrentes comparten la misma promesa. Un catálogo que llega
  roto no se cachea: así un segundo intento —otra visita a la página, o el
  mismo formulario reabierto— vuelve a pedirlo de verdad.
*/
async function cargarCatalogoDeTecnologias() {
  if (catalogoEnMemoria) return { ok: true, tecnologias: catalogoEnMemoria };
  if (cargaDeCatalogoEnCurso) return cargaDeCatalogoEnCurso;

  cargaDeCatalogoEnCurso = (async () => {
    try {
      const respuesta = await fetch(RUTA_CATALOGO_TECNOLOGIAS, { cache: "no-cache" });
      if (!respuesta.ok || esCatalogoAusente(respuesta)) {
        return { ok: false, mensaje: "No se pudo cargar el catálogo de tecnologías." };
      }

      const tecnologias = tecnologiasDelCatalogo(await respuesta.json());
      if (tecnologias.length === 0) {
        return { ok: false, mensaje: "El catálogo de tecnologías está vacío." };
      }

      catalogoEnMemoria = Object.freeze(tecnologias);
      return { ok: true, tecnologias: catalogoEnMemoria };
    } catch (error) {
      return { ok: false, mensaje: "No se pudo cargar el catálogo de tecnologías." };
    } finally {
      /* Se libera pase lo que pase: si quedara colgada, un fallo de red
         dejaría el próximo intento devolviendo para siempre la misma promesa
         fallida. */
      cargaDeCatalogoEnCurso = null;
    }
  })();

  return cargaDeCatalogoEnCurso;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    RUTA_CATALOGO_TECNOLOGIAS,
    cargarCatalogoDeTecnologias,
  });
}
