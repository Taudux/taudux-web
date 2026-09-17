/*
  Worker de Python (Pyodide). Corre en un worker propio y no por prolijidad: el
  intérprete ejecuta de forma síncrona, así que un `while True:` en el hilo
  principal congelaría la pestaña entera sin manera de recuperarla. Acá el hilo
  principal siempre puede hacer terminate() y matar la ejecución.

  Es un worker de tipo "module" para poder hacer import() dinámico de pyodide.mjs.
  La URL nunca está escrita acá: llega en el mensaje de carga desde el hilo
  principal, que la lee de practica.lenguajes.js. Una sola fuente de verdad.

  Protocolo de mensajes (el de sql.worker.js, más el campo `plotly`):
    recibe { tipo: "cargar", runtime: { url, indexURL } }
    recibe { tipo: "ejecutar", codigo }
    emite  { tipo: "progreso", etapa }
           { tipo: "listo" }
           { tipo: "salida", texto, flujo }
           { tipo: "resultado", ok, valor, imagenes, plotly: { version, figuras }, error }
  `imagenes` y `plotly.figuras` viajan también cuando ok es false: lo que el
  código dibujó antes de fallar se muestra junto con el traceback.
*/

let pyodide = null;

function emitirSalida(texto, flujo) {
  self.postMessage({ tipo: "salida", texto, flujo });
}

/*
  Pyodide entrega stdout ya cortado por líneas y sin el salto final; la consola
  necesita el salto para no pegar todas las líneas en una sola.
*/
const SALIDA_ESTANDAR = {
  stdout: (linea) => emitirSalida(`${linea}\n`, "stdout"),
  stderr: (linea) => emitirSalida(`${linea}\n`, "stderr"),
};

function conectarSalidaEstandar(opciones) {
  return { ...opciones, ...SALIDA_ESTANDAR };
}

/*
  Corre un snippet con stdout apagado. micropip imprime "Loading narwhals,
  packaging" al instalar dependencias y no ofrece cómo callarlo; en la consola
  del alumno eso es ruido, no resultado. stderr se deja: si algo falla de verdad,
  tiene que verse.
*/
async function correrEnSilencio(snippet) {
  pyodide.setStdout({ batched: () => {} });
  try {
    return await pyodide.runPythonAsync(snippet);
  } finally {
    pyodide.setStdout({ batched: SALIDA_ESTANDAR.stdout });
  }
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

/*
  PLOTLY EN EL NAVEGADOR. `fig.show()` fuera de un notebook usa el renderer
  "browser": levanta un servidor HTTP local y abre una pestaña. En WASM no hay
  sockets, así que revienta con OSError. Y los renderers de notebook necesitan
  IPython, que tampoco está.

  La salida es reemplazar `show` para que, en vez de buscar dónde dibujar, guarde
  la figura serializada. El hilo principal la recibe y la pinta con plotly.js:
  interactiva de verdad, no una captura.

  El parche se aplica ANTES de correr el código del alumno y solo si el código
  importa plotly, para no pagar la instalación (unos 15 MB) en cada ejecución de
  Python. Por eso no hace falta un hook de importación: el worker garantiza que
  plotly ya está cargado y parchado cuando el alumno llama a show().

  La versión va pineada por lo mismo que las URLs de los runtimes: micropip
  resuelve "lo último de PyPI", y un salto mayor de plotly.py arrastra un
  plotly.js distinto sin que nadie haya tocado el repo. La versión de plotly.js
  se lee del propio paquete y viaja con las figuras, así que las dos nunca
  pueden discrepar.
*/
const VERSION_PLOTLY_PY = "7.1.0";

const PREPARAR_PLOTLY = `
import importlib.util

if importlib.util.find_spec("plotly") is None:
    import micropip
    await micropip.install("plotly==${VERSION_PLOTLY_PY}")

import plotly.basedatatypes as _taudux_bd
import plotly.io as _taudux_pio
import plotly.graph_objects as _taudux_go
import plotly.offline as _taudux_po

if not hasattr(_taudux_bd.BaseFigure, "_taudux_figuras"):
    _taudux_bd.BaseFigure._taudux_figuras = []

    def _taudux_show(self, *args, **kwargs):
        # to_json incluye layout.template, así que el tema viaja con la figura.
        _taudux_bd.BaseFigure._taudux_figuras.append(self.to_json())

    _taudux_bd.BaseFigure.show = _taudux_show

    # Tema de marca: parte del oscuro de plotly. El papel es transparente para
    # apoyarse en la pizarra del contenedor (ver .practica__plotly en el CSS);
    # el área de trazado es la misma pizarra un tono más clara.
    #
    # LA PALETA NO SE ELIGIÓ A OJO. Son los matices del sitio (cian, naranja,
    # violeta, verde, ámbar, magenta, púrpura, rojo) escalonados para fondo
    # oscuro y validados con scripts/validate_palette.js del skill de dataviz
    # contra la superficie #172130: luminosidad dentro de la banda oscura,
    # contraste >= 3:1, y separación entre vecinos bajo daltonismo con un peor
    # par de dE 12.5 (objetivo >= 8). La versión anterior, más brillante,
    # deslumbraba sobre negro y confundía ámbar con verde para un daltónico.
    # El orden alterna claro/oscuro a propósito: el daltonismo confunde matiz,
    # no luminosidad. Cambiar un color exige volver a correr el validador.
    _taudux_tema = _taudux_go.layout.Template(
        _taudux_pio.templates["plotly_dark"].to_plotly_json()
    )
    # UNA SOLA SUPERFICIE. El área de trazado es del mismo color que el papel:
    # sin el rectángulo interior, la grilla flota sobre una lámina uniforme y la
    # gráfica llena el marco en vez de quedar encajonada en su centro. Los
    # márgenes son los mínimos para los rótulos de eje; la leyenda ya no reserva
    # una columna a la derecha porque flota dentro del área como una tarjeta.
    _taudux_tema.layout.update(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="#111925",
        font=dict(family="Space Grotesk, sans-serif", color="#d4dbe4", size=13),
        title=dict(
            font=dict(family="Orbitron, sans-serif", size=16, color="#ffffff"),
            x=0.02, xanchor="left",
        ),
        colorway=[
            "#1ba0b6", "#c95f1c", "#8272e8", "#177a4a",
            "#b98e1a", "#d84f88", "#a26ddc", "#c4423c",
        ],
        xaxis=dict(
            gridcolor="rgba(170,195,220,0.09)",
            zerolinecolor="rgba(170,195,220,0.22)",
            showline=False,
            ticks="",
            title=dict(standoff=10),
        ),
        yaxis=dict(
            gridcolor="rgba(170,195,220,0.09)",
            zerolinecolor="rgba(170,195,220,0.22)",
            showline=False,
            ticks="",
            title=dict(standoff=10),
        ),
        # Tarjeta flotante arriba a la derecha, dentro del área de datos. El
        # fondo semiopaco la separa de las series que pasen por debajo.
        legend=dict(
            x=0.99, y=0.98, xanchor="right", yanchor="top",
            bgcolor="rgba(17,25,37,0.86)",
            bordercolor="rgba(170,195,220,0.18)", borderwidth=1,
            font=dict(size=12),
        ),
        hoverlabel=dict(
            bgcolor="#1e2836", bordercolor="#00e1ff", font=dict(color="#ffffff")
        ),
        margin=dict(l=54, r=18, t=36, b=46),
        height=440,
    )
    _taudux_pio.templates["taudux"] = _taudux_tema
    _taudux_pio.templates.default = "taudux"

_taudux_po.get_plotlyjs_version()
`;

const CAPTURAR_PLOTLY = `
def _taudux_capturar_plotly():
    import sys

    bd = sys.modules.get("plotly.basedatatypes")
    figuras = getattr(getattr(bd, "BaseFigure", None), "_taudux_figuras", None)
    if not figuras:
        return []

    salida = list(figuras)
    # Sin esto, la figura del ejercicio anterior reaparecería en el siguiente.
    figuras.clear()
    return salida

_taudux_capturar_plotly()
`;

// Solo un import real, no la palabra en un comentario: instalar plotly cuesta
// unos 15 MB y varios segundos, y no se paga por una mención de pasada.
const IMPORTA_PLOTLY = /^\s*(?:import|from)\s+plotly\b/m;

/*
  Pyodide imprime en stdout cada paquete que baja ("Loading numpy, pandas…",
  "numpy already loaded from default channel"). Es telemetría del intérprete, no
  salida del programa, y en la consola del alumno se mezcla con sus prints. El
  estado de la barra ya avisa "Preparando paquetes…"; con eso alcanza.
*/
const CARGA_SILENCIOSA = { messageCallback: () => {} };

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
    await pyodide.loadPackagesFromImports(codigo, CARGA_SILENCIOSA);
  } catch {
    // Silencio deliberado: el error útil aparece al ejecutar.
  }

  /*
    plotly.express exige pandas y numpy, pero `import plotly.express` no los
    menciona, así que loadPackagesFromImports no los trae. Se cargan a mano
    antes de preparar plotly, o el import falla pidiendo instalar "plotly[express]"
    con pip — que acá no existe.
  */
  let versionPlotlyJs = null;
  if (IMPORTA_PLOTLY.test(codigo)) {
    try {
      self.postMessage({ tipo: "progreso", etapa: "Preparando plotly… la primera vez tarda un poco." });
      await pyodide.loadPackage(["micropip", "numpy", "pandas"], CARGA_SILENCIOSA);
      versionPlotlyJs = String(await correrEnSilencio(PREPARAR_PLOTLY));
    } catch {
      // Igual que arriba: si plotly no se pudo preparar, el import del alumno
      // fallará con un mensaje de Python mucho más claro que cualquiera de acá.
    }
  }

  try {
    const valor = await pyodide.runPythonAsync(codigo);
    const { imagenes, figurasPlotly } = await capturarSalidaGrafica();

    self.postMessage({
      tipo: "resultado",
      ok: true,
      valor: describirValor(valor),
      imagenes,
      plotly: { version: versionPlotlyJs, figuras: figurasPlotly },
      error: null,
    });
  } catch (error) {
    /*
      Las figuras se capturan también acá, por dos razones. La visible: lo que el
      código dibujó antes de reventar se muestra encima del traceback, como en
      Jupyter. La invisible: la captura es la que vacía las listas del intérprete;
      sin ella la figura sobrevivía a la corrida fallida, se acumulaba con cada
      error y aparecía bajo la siguiente corrida exitosa aunque no graficara nada.

      El message de un PythonError ya trae el traceback completo y formateado, que
      es exactamente lo que el alumno necesita leer.
    */
    const { imagenes, figurasPlotly } = await capturarSalidaGrafica();

    self.postMessage({
      tipo: "resultado",
      ok: false,
      valor: null,
      imagenes,
      plotly: { version: versionPlotlyJs, figuras: figurasPlotly },
      error: error?.message || String(error),
    });
  }
}

/*
  Recoge lo que la corrida dejó dibujado, en matplotlib y en plotly, y de paso
  deja limpias las dos listas para la corrida siguiente. Un solo camino para el
  éxito y para el error: si divergen, el bug del zombi vuelve por uno de los dos.
*/
async function capturarSalidaGrafica() {
  const imagenes = await capturarLista(CAPTURAR_FIGURAS);
  const figurasPlotly = await capturarLista(CAPTURAR_PLOTLY);
  return { imagenes, figurasPlotly };
}

/*
  Corre un snippet de captura y devuelve su lista como arreglo de JS. Que falle
  la captura de gráficos nunca invalida la salida de texto: ante cualquier error
  devuelve vacío y el resto del resultado sigue su camino.
*/
async function capturarLista(snippet) {
  try {
    const capturadas = await pyodide.runPythonAsync(snippet);
    const lista = capturadas ? capturadas.toJs() : [];
    if (capturadas && typeof capturadas.destroy === "function") capturadas.destroy();
    return Array.from(lista);
  } catch {
    return [];
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
