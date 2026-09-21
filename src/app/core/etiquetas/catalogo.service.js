/*
  Carga los catálogos de etiquetas que los campos Herramientas, Habilidades e
  Idiomas de "Mi ficha" usan para sugerir mientras se escribe. Como las notas,
  y a diferencia del resto de los servicios del sitio, este NO habla con
  Supabase: cada catálogo es un archivo estático del repositorio
  (src/content/etiquetas/<nombre>.json) y se sirve desde /content/etiquetas.

  Un servicio parametrizado y no tres copias: lo único que cambia entre los
  catálogos es el nombre del archivo. La caché y la promesa en vuelo van por
  nombre —dos listas distintas no comparten ni lo uno ni lo otro— y el nombre
  se valida contra una lista fija antes de armar la ruta: nunca se concatena
  texto libre en una URL.

  Los catálogos NO son listas blancas. Sugieren, nunca restringen: quien
  escribe una etiqueta que no está en ellos la guarda igual. De ahí que este
  archivo no use crearReporteroOperaciones, que en este proyecto es consola
  más aviso en pantalla y no telemetría — un catálogo que no carga degrada en
  silencio a propósito, y un aviso sería ruido por algo que a quien edita su
  ficha no le toca resolver. Quien llama recibe { ok: false } y decide; el
  formulario sigue aceptando texto libre.
*/

const CATALOGOS_DE_ETIQUETAS = Object.freeze(["herramientas", "habilidades", "idiomas"]);

// Cachés de la vida de la página: los catálogos no cambian entre dos teclas.
const catalogosEnMemoria = new Map();
const cargasDeCatalogoEnCurso = new Map();

/* La ruta se arma SÓLO con un nombre ya validado contra la lista fija. */
function rutaDeCatalogoDeEtiquetas(nombre) {
  return `/content/etiquetas/${nombre}.json`;
}

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
function etiquetasDelCatalogo(datos) {
  if (!Array.isArray(datos?.etiquetas)) return [];
  return datos.etiquetas.filter((etiqueta) => typeof etiqueta === "string" && etiqueta !== "");
}

/*
  Las llamadas concurrentes al MISMO catálogo comparten la misma promesa; dos
  catálogos distintos, nunca. Un catálogo que llega roto no se cachea: así un
  segundo intento —otra visita a la página, o el mismo formulario reabierto—
  vuelve a pedirlo de verdad.
*/
async function cargarCatalogoDeEtiquetas(nombre) {
  if (!CATALOGOS_DE_ETIQUETAS.includes(nombre)) {
    return { ok: false, mensaje: "No se pudo cargar el catálogo de etiquetas." };
  }

  const mensajeDeCarga = `No se pudo cargar el catálogo de ${nombre}.`;

  if (catalogosEnMemoria.has(nombre)) {
    return { ok: true, etiquetas: catalogosEnMemoria.get(nombre) };
  }
  if (cargasDeCatalogoEnCurso.has(nombre)) return cargasDeCatalogoEnCurso.get(nombre);

  const carga = (async () => {
    try {
      const respuesta = await fetch(rutaDeCatalogoDeEtiquetas(nombre), { cache: "no-cache" });
      if (!respuesta.ok || esCatalogoAusente(respuesta)) {
        return { ok: false, mensaje: mensajeDeCarga };
      }

      const etiquetas = etiquetasDelCatalogo(await respuesta.json());
      if (etiquetas.length === 0) {
        return { ok: false, mensaje: `El catálogo de ${nombre} está vacío.` };
      }

      catalogosEnMemoria.set(nombre, Object.freeze(etiquetas));
      return { ok: true, etiquetas: catalogosEnMemoria.get(nombre) };
    } catch (error) {
      return { ok: false, mensaje: mensajeDeCarga };
    } finally {
      /* Se libera pase lo que pase: si quedara colgada, un fallo de red
         dejaría el próximo intento devolviendo para siempre la misma promesa
         fallida. */
      cargasDeCatalogoEnCurso.delete(nombre);
    }
  })();

  cargasDeCatalogoEnCurso.set(nombre, carga);
  return carga;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    CATALOGOS_DE_ETIQUETAS,
    rutaDeCatalogoDeEtiquetas,
    cargarCatalogoDeEtiquetas,
  });
}
