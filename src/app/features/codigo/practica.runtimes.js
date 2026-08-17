/*
  Adaptadores de ejecución del playground. Expone crearRuntime(lenguaje), que
  devuelve siempre el mismo contrato sin importar el lenguaje:

    cargar(alProgreso)         descarga e inicializa; reporta etapas
    ejecutar(codigo, alSalir)  corre el código; alSalir(texto, flujo) va en vivo
    detener()                  corta la ejecución en curso
    estaCargado()              si hay runtime vivo listo para ejecutar
    liberar()                  suelta el runtime

  Todos garantizan lo mismo —nunca bloquear el hilo principal— pero por caminos
  distintos, porque las tres librerías tienen modelos de hilos distintos:

    Python y SQL  worker propio nuestro. Ejecutan síncrono, así que sin worker un
                  ciclo infinito congelaría la pestaña. terminate() es el botón de
                  pánico que funciona siempre, incluso con el intérprete colgado.
    R             webR ya crea su propio worker internamente. Anidar un worker
                  dentro de otro agrega una capa históricamente frágil en Safari
                  sin ganar nada, así que se maneja desde el hilo principal.

  Depende de practica.salida.js (formatearTablaSql) y practica.lenguajes.js.
*/

const RUTAS_WORKER_PRACTICA = {
  python: "/app/features/codigo/workers/python.worker.js",
  sql: "/app/features/codigo/workers/sql.worker.js",
};

function crearResultadoPractica(parcial = {}) {
  return {
    ok: true,
    detenida: false,
    error: null,
    valor: null,
    imagenes: [],
    tablas: [],
    mensajes: [],
    ...parcial,
  };
}

/*
  Los gráficos de R y de matplotlib se diseñan para papel blanco: ejes y texto en
  negro. Sobre el fondo oscuro del sitio, un PNG con transparencia se vería como
  una mancha negra sobre negro, así que el lienzo se pinta de blanco antes.
*/
function convertirBitmapADataUrl(bitmap) {
  const lienzo = document.createElement("canvas");
  lienzo.width = bitmap.width;
  lienzo.height = bitmap.height;

  const contexto = lienzo.getContext("2d");
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, lienzo.width, lienzo.height);
  contexto.drawImage(bitmap, 0, 0);

  return lienzo.toDataURL("image/png");
}

/* ------------------------------------------------------------------ */
/* Adaptador genérico sobre un worker (Python y SQL)                    */
/* ------------------------------------------------------------------ */

function crearRuntimeWorker(lenguaje, interpretarResultado) {
  const ruta = RUTAS_WORKER_PRACTICA[lenguaje.id];
  let worker = null;
  let cargado = false;
  let pendiente = null;
  let alSalir = null;
  let alProgreso = null;

  function cerrarPendiente(accion, valor) {
    if (!pendiente) return;
    const tarea = pendiente;
    pendiente = null;
    tarea[accion](valor);
  }

  function manejarMensaje(evento) {
    const mensaje = evento.data || {};

    if (mensaje.tipo === "progreso") {
      if (alProgreso) alProgreso(mensaje.etapa);
      return;
    }
    if (mensaje.tipo === "salida") {
      if (alSalir) alSalir(mensaje.texto, mensaje.flujo);
      return;
    }
    if (mensaje.tipo === "listo") {
      cargado = true;
      cerrarPendiente("resolver");
      return;
    }
    if (mensaje.tipo === "resultado") {
      cerrarPendiente("resolver", interpretarResultado(mensaje));
      return;
    }
    if (mensaje.tipo === "error") {
      cerrarPendiente("rechazar", new Error(mensaje.mensaje));
    }
  }

  function descartarWorker() {
    if (!worker) return;
    worker.terminate();
    worker = null;
    cargado = false;
  }

  async function cargar(reportarProgreso) {
    if (cargado) return;
    alProgreso = reportarProgreso;

    try {
      worker = new Worker(ruta, { type: "module" });
      worker.addEventListener("message", manejarMensaje);
      worker.addEventListener("error", (evento) => {
        cerrarPendiente("rechazar", new Error(evento.message || "El worker falló al iniciar."));
      });

      await new Promise((resolver, rechazar) => {
        pendiente = { resolver, rechazar };
        worker.postMessage({ tipo: "cargar", runtime: lenguaje.runtime });
      });
    } catch (error) {
      // Sin esto, un fallo de red dejaría un worker muerto que impide reintentar.
      descartarWorker();
      throw error;
    }
  }

  function ejecutar(codigo, reportarSalida) {
    alSalir = reportarSalida;
    return new Promise((resolver, rechazar) => {
      pendiente = { resolver, rechazar };
      worker.postMessage({ tipo: "ejecutar", codigo });
    });
  }

  /*
    terminate() es un corte duro: mata el intérprete con todo su estado, no solo
    la corrida. Es el precio de poder cortar un ciclo infinito sin
    SharedArrayBuffer, y funciona en todos los navegadores. La próxima ejecución
    vuelve a cargar el runtime (rápido, porque los .wasm ya están en caché).
  */
  function detener() {
    if (!worker) return;
    descartarWorker();
    cerrarPendiente(
      "resolver",
      crearResultadoPractica({ ok: false, detenida: true, error: "Ejecución detenida." }),
    );
  }

  return {
    id: lenguaje.id,
    cargar,
    ejecutar,
    detener,
    estaCargado: () => cargado,
    liberar: descartarWorker,
  };
}

function interpretarResultadoPython(mensaje) {
  return crearResultadoPractica({
    ok: mensaje.ok,
    error: mensaje.error,
    valor: mensaje.valor,
    imagenes: mensaje.imagenes || [],
  });
}

/*
  PGlite devuelve un resultado por sentencia. Las que traen columnas se vuelven
  tabla; las que no (create table, insert) solo dejan una nota, para que el alumno
  vea que algo pasó en vez de una consola muda.
*/
function interpretarResultadoSql(mensaje) {
  if (!mensaje.ok) {
    return crearResultadoPractica({ ok: false, error: mensaje.error });
  }

  const tablas = [];
  const mensajes = [];

  for (const resultado of mensaje.resultados || []) {
    const tabla = formatearTablaSql(resultado);
    if (tabla) {
      tablas.push(tabla);
      continue;
    }
    if (resultado.affectedRows > 0) {
      const plural = resultado.affectedRows === 1 ? "fila afectada" : "filas afectadas";
      mensajes.push(`${resultado.affectedRows} ${plural}.`);
    }
  }

  if (tablas.length === 0 && mensajes.length === 0) {
    mensajes.push("Sentencia ejecutada correctamente.");
  }

  return crearResultadoPractica({ ok: true, tablas, mensajes });
}

/* ------------------------------------------------------------------ */
/* Adaptador de R (webR maneja su propio worker)                        */
/* ------------------------------------------------------------------ */

function crearRuntimeR(lenguaje) {
  let webR = null;
  let cargado = false;

  async function cargar(reportarProgreso) {
    if (cargado) return;

    reportarProgreso("Descargando R…");
    const { WebR } = await import(lenguaje.runtime.url);

    reportarProgreso("Iniciando R…");
    webR = new WebR();
    await webR.init();
    cargado = true;
  }

  /*
    A diferencia de Python, la salida de R no llega en vivo: captureR entrega todo
    junto al terminar. Es una limitación de la API, no una decisión — por eso el
    alumno ve la salida de golpe al final en vez de línea por línea.

    captureConditions queda en false a propósito: con true, los errores y warnings
    vuelven como RObject (proxies de R que habría que convertir y liberar a mano),
    mientras que con false el error sube como excepción de JS con su texto ya
    legible.
  */
  async function ejecutar(codigo, reportarSalida) {
    const refugio = await new webR.Shelter();

    try {
      const captura = await refugio.captureR(codigo, {
        withAutoprint: true,
        captureStreams: true,
        captureConditions: false,
        captureGraphics: true,
      });

      /*
        webR NO rechaza la promesa cuando el código de R falla: con
        captureConditions en false, el error viaja como una línea más de stderr y
        la llamada resuelve normal. Sin revisar el texto, un stop() se reportaría
        como "Listo." con el error impreso al lado — verificado contra webR 0.6.0.

        Se detecta por el prefijo porque R siempre abre sus errores con "Error"
        al inicio de línea ("Error:", "Error in foo():"), mientras que warning() y
        message() usan otros prefijos. Un message() del alumno que empiece con esa
        palabra daría un falso positivo: el costo es una línea de estado
        equivocada, nunca salida perdida ni mal pintada.
      */
      let huboError = false;

      for (const salida of captura.output || []) {
        if (typeof salida.data !== "string") continue;
        const esError = salida.type === "stderr";
        if (esError && /^Error\b/m.test(salida.data)) huboError = true;
        reportarSalida(`${salida.data}\n`, esError ? "stderr" : "stdout");
      }

      const imagenes = (captura.images || []).map(convertirBitmapADataUrl);
      // El mensaje ya se imprimió en la consola; repetirlo en `error` lo duplicaría.
      return crearResultadoPractica({ ok: !huboError, imagenes });
    } catch (error) {
      return crearResultadoPractica({ ok: false, error: error?.message || String(error) });
    } finally {
      // Sin purge, cada corrida deja objetos de R vivos en memoria.
      await refugio.purge();
    }
  }

  function liberar() {
    if (!webR) return;
    webR.close();
    webR = null;
    cargado = false;
  }

  /*
    webR.close() mata su worker interno, que es el equivalente exacto del
    terminate() de los otros dos: sin aislamiento de origen cruzado no hay forma
    de interrumpir R sin matarlo.
  */
  return {
    id: lenguaje.id,
    cargar,
    ejecutar,
    detener: liberar,
    estaCargado: () => cargado,
    liberar,
  };
}

function crearRuntime(lenguaje) {
  if (lenguaje.id === "python") return crearRuntimeWorker(lenguaje, interpretarResultadoPython);
  if (lenguaje.id === "sql") return crearRuntimeWorker(lenguaje, interpretarResultadoSql);
  if (lenguaje.id === "r") return crearRuntimeR(lenguaje);
  throw new Error(`Lenguaje sin runtime: ${lenguaje.id}`);
}
