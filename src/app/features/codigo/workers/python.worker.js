/*
  Worker de Python (Pyodide). Corre en un worker propio y no por prolijidad: el
  intérprete ejecuta de forma síncrona, así que un `while True:` en el hilo
  principal congelaría la pestaña entera sin manera de recuperarla. Acá el hilo
  principal siempre puede hacer terminate() y matar la ejecución.

  Es un worker de tipo "module" para poder hacer import() dinámico de pyodide.mjs.
  La URL nunca está escrita acá: llega en el mensaje de carga desde el hilo
  principal, que la lee de practica.lenguajes.js. Una sola fuente de verdad.

  Protocolo de mensajes (idéntico al de sql.worker.js):
    recibe { tipo: "cargar", runtime: { url, indexURL } }
    recibe { tipo: "ejecutar", codigo }
    emite  { tipo: "progreso", etapa }
           { tipo: "listo" }
           { tipo: "salida", texto, flujo }
           { tipo: "resultado", ok, valor, imagenes, error }
*/

let pyodide = null;

function emitirSalida(texto, flujo) {
  self.postMessage({ tipo: "salida", texto, flujo });
}

/*
  Pyodide entrega stdout ya cortado por líneas y sin el salto final; la consola
  necesita el salto para no pegar todas las líneas en una sola.
*/
function conectarSalidaEstandar(opciones) {
  return {
    ...opciones,
    stdout: (linea) => emitirSalida(`${linea}\n`, "stdout"),
    stderr: (linea) => emitirSalida(`${linea}\n`, "stderr"),
  };
}

/*
  Recupera las figuras que el código del alumno dejó abiertas y las devuelve como
  PNG en base64.

  Se ejecuta después del código del usuario y solo si matplotlib llegó a
  importarse — preguntarle a sys.modules evita cargar matplotlib (varios MB) en el
  99% de los ejercicios que no dibujan nada.
*/
const CAPTURAR_FIGURAS = `
def _taudux_capturar_figuras():
    import sys

    if "matplotlib.pyplot" not in sys.modules:
        return []

    import base64
    import io

    plt = sys.modules["matplotlib.pyplot"]
    imagenes = []
    for numero in plt.get_fignums():
        figura = plt.figure(numero)
        memoria = io.BytesIO()
        figura.savefig(memoria, format="png", dpi=110, bbox_inches="tight")
        imagenes.append(
            "data:image/png;base64," + base64.b64encode(memoria.getvalue()).decode("ascii")
        )

    # Sin esto, la figura del ejercicio anterior reaparecería en el siguiente.
    plt.close("all")
    return imagenes

_taudux_capturar_figuras()
`;

async function cargar(runtime) {
  self.postMessage({ tipo: "progreso", etapa: "Descargando Python…" });
  const { loadPyodide } = await import(runtime.url);

  self.postMessage({ tipo: "progreso", etapa: "Iniciando intérprete…" });
  pyodide = await loadPyodide(conectarSalidaEstandar({ indexURL: runtime.indexURL }));

  /*
    matplotlib elige backend al importar pyplot, y el que trae Pyodide por defecto
    dibuja sobre el DOM — que en un worker no existe. Fijar MPLBACKEND antes de
    que el alumno importe nada obliga al backend AGG, que renderiza a un buffer en
    memoria y es el único que funciona sin documento.
  */
  await pyodide.runPythonAsync('import os; os.environ["MPLBACKEND"] = "AGG"');

  self.postMessage({ tipo: "listo" });
}

/*
  Un PyProxy sin destroy() filtra memoria del heap de WebAssembly en cada corrida.
  Como el valor solo se muestra como texto, se convierte y se libera de inmediato.
*/
function describirValor(valor) {
  if (valor === undefined || valor === null) return null;

  if (typeof valor === "object" && typeof valor.destroy === "function") {
    const texto = valor.toString();
    valor.destroy();
    return texto;
  }

  return String(valor);
}

async function ejecutar(codigo) {
  /*
    Detecta `import pandas` y baja el paquete solo. Si el import no existe en la
    distribución, no se aborta acá: conviene dejar que el código corra y que el
    alumno vea el ImportError real de Python, que explica mucho mejor qué pasó.
  */
  try {
    self.postMessage({ tipo: "progreso", etapa: "Preparando paquetes…" });
    await pyodide.loadPackagesFromImports(codigo);
  } catch {
    // Silencio deliberado: el error útil aparece al ejecutar.
  }

  try {
    const valor = await pyodide.runPythonAsync(codigo);
    let imagenes = [];
    try {
      const capturadas = await pyodide.runPythonAsync(CAPTURAR_FIGURAS);
      imagenes = capturadas ? capturadas.toJs() : [];
      if (capturadas && typeof capturadas.destroy === "function") capturadas.destroy();
    } catch {
      // Que falle la captura de gráficos no invalida la salida de texto.
    }

    self.postMessage({
      tipo: "resultado",
      ok: true,
      valor: describirValor(valor),
      imagenes,
      error: null,
    });
  } catch (error) {
    /*
      El message de un PythonError ya trae el traceback completo y formateado, que
      es exactamente lo que el alumno necesita leer.
    */
    self.postMessage({
      tipo: "resultado",
      ok: false,
      valor: null,
      imagenes: [],
      error: error?.message || String(error),
    });
  }
}

self.addEventListener("message", async (evento) => {
  const mensaje = evento.data || {};

  try {
    if (mensaje.tipo === "cargar") {
      await cargar(mensaje.runtime);
      return;
    }

    if (mensaje.tipo === "ejecutar") {
      await ejecutar(mensaje.codigo);
    }
  } catch (error) {
    self.postMessage({ tipo: "error", mensaje: error?.message || String(error) });
  }
});
