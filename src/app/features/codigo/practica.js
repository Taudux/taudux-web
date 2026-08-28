/*
  Playground de práctica: editor, ejecución y consola. Depende de
  practica.lenguajes.js, practica.salida.js y practica.runtimes.js, y debe
  cargarse después de los tres.

  El código del alumno se guarda en localStorage por lenguaje, no en Supabase: el
  playground es público y no exige cuenta. Guardar en el servidor llega cuando
  haya sesión y progreso que guardar.
*/

const CLAVE_CODIGO_PRACTICA = "taudux:practica:codigo";
const TEMA_EDITOR_PRACTICA = "ace/theme/tomorrow_night";

const runtimesPorLenguaje = new Map();
let editor = null;
let lenguajeActivo = null;
let ejecutando = false;
let panelDatos = null;
// Arranca bloqueado a propósito: la sesión se resuelve en una llamada asíncrona y
// hasta que conteste no hay que dar por buena una descarga.
let sesionActiva = false;
let fondoAmbiental = null;
let marcadorDeError = null;

/* ------------------------------------------------------------------ */
/* Persistencia local                                                   */
/* ------------------------------------------------------------------ */

// Storage puede estar bloqueado (modo privado, cookies de terceros): nunca debe
// tumbar el playground, solo se pierde el guardado.
function leerCodigoGuardado(idLenguaje) {
  try {
    return localStorage.getItem(`${CLAVE_CODIGO_PRACTICA}:${idLenguaje}`);
  } catch {
    return null;
  }
}

function guardarCodigo(idLenguaje, codigo) {
  try {
    localStorage.setItem(`${CLAVE_CODIGO_PRACTICA}:${idLenguaje}`, codigo);
  } catch {
    // Sin persistencia el editor sigue funcionando; no hay nada que reportar.
  }
}

function olvidarCodigo(idLenguaje) {
  try {
    localStorage.removeItem(`${CLAVE_CODIGO_PRACTICA}:${idLenguaje}`);
  } catch {
    // Igual que arriba.
  }
}

/* ------------------------------------------------------------------ */
/* Consola y resultados                                                 */
/* ------------------------------------------------------------------ */

function obtenerElementos() {
  return {
    consola: document.getElementById("practicaConsola"),
    resultados: document.getElementById("practicaResultados"),
    estado: document.getElementById("practicaEstado"),
    ejecutar: document.getElementById("practicaEjecutar"),
    detener: document.getElementById("practicaDetener"),
    restaurar: document.getElementById("practicaRestaurar"),
    descargar: document.getElementById("practicaDescargar"),
    notaDescarga: document.getElementById("practicaNotaDescarga"),
    fondo: document.getElementById("practicaFondo"),
    nomenclatura: document.getElementById("practicaNomenclatura"),
    nomenclaturaPanel: document.getElementById("practicaNomenclaturaPanel"),
    // Solo existe en la página de SQL; en las demás vale null a propósito.
    datos: document.getElementById("practicaBase"),
  };
}

function limpiarSalida() {
  const { consola, resultados } = obtenerElementos();
  consola.textContent = "";
  resultados.replaceChildren();
}

function pintarFragmento({ texto, flujo }) {
  const { consola } = obtenerElementos();

  const trozo = document.createElement("span");
  trozo.className = `practica__salida practica__salida--${flujo}`;
  trozo.textContent = texto;
  consola.appendChild(trozo);
  consola.scrollTop = consola.scrollHeight;
}

function anunciarEstado(texto, tono = "info") {
  const { estado } = obtenerElementos();
  estado.textContent = texto;
  estado.className = `practica__estado practica__estado--${tono}`;
  estado.hidden = !texto;
}

function pintarTabla(tabla) {
  const { resultados } = obtenerElementos();

  const contenedor = document.createElement("div");
  contenedor.className = "practica__tabla-scroll";

  const elemento = document.createElement("table");
  elemento.className = "practica__tabla";

  const encabezado = document.createElement("thead");
  const filaEncabezado = document.createElement("tr");
  for (const columna of tabla.columnas) {
    const celda = document.createElement("th");
    celda.scope = "col";
    celda.textContent = columna;
    filaEncabezado.appendChild(celda);
  }
  encabezado.appendChild(filaEncabezado);

  const cuerpo = document.createElement("tbody");
  for (const fila of tabla.filas) {
    const elementoFila = document.createElement("tr");
    for (const valor of fila) {
      const celda = document.createElement("td");
      celda.textContent = valor;
      elementoFila.appendChild(celda);
    }
    cuerpo.appendChild(elementoFila);
  }

  elemento.append(encabezado, cuerpo);
  contenedor.appendChild(elemento);
  resultados.appendChild(contenedor);

  const pie = document.createElement("p");
  pie.className = "practica__tabla-pie";
  pie.textContent = tabla.truncada
    ? `Mostrando ${tabla.filas.length} de ${tabla.totalFilas} filas.`
    : `${tabla.totalFilas} ${tabla.totalFilas === 1 ? "fila" : "filas"}.`;
  resultados.appendChild(pie);
}

function pintarImagen(fuente) {
  const { resultados } = obtenerElementos();

  const imagen = document.createElement("img");
  imagen.className = "practica__grafico";
  imagen.src = fuente;
  imagen.alt = "Gráfico generado por tu código";
  resultados.appendChild(imagen);
}

function pintarResultado(resultado) {
  for (const tabla of resultado.tablas) pintarTabla(tabla);
  for (const imagen of resultado.imagenes) pintarImagen(imagen);
  for (const mensaje of resultado.mensajes) pintarFragmento({ texto: `${mensaje}\n`, flujo: "aviso" });

  if (resultado.valor) pintarFragmento({ texto: `${resultado.valor}\n`, flujo: "valor" });
  if (resultado.error) pintarFragmento({ texto: `${resultado.error}\n`, flujo: "stderr" });
}

/* ------------------------------------------------------------------ */
/* Ejecución                                                            */
/* ------------------------------------------------------------------ */

function obtenerRuntime(lenguaje) {
  if (!runtimesPorLenguaje.has(lenguaje.id)) {
    runtimesPorLenguaje.set(lenguaje.id, crearRuntime(lenguaje));
  }
  return runtimesPorLenguaje.get(lenguaje.id);
}

function alternarControles(corriendo) {
  const { ejecutar, detener } = obtenerElementos();
  ejecutar.disabled = corriendo;
  detener.disabled = !corriendo;
  ejecutando = corriendo;
}

/*
  Marca en el editor la línea que reventó. Sin esto, un traceback obliga al alumno
  a contar renglones a mano para encontrar dónde mirar — que es justo la parte del
  error que un principiante no sabe leer todavía.

  Se pinta de dos formas porque cumplen funciones distintas: la anotación pone el
  ícono y el mensaje al pasar el mouse por el margen, y el marcador tiñe la fila
  entera para que se encuentre de un vistazo sin leer nada.
*/
function limpiarMarcaDeError() {
  if (!editor) return;

  editor.session.clearAnnotations();
  if (marcadorDeError !== null) {
    editor.session.removeMarker(marcadorDeError);
    marcadorDeError = null;
  }
}

function marcarLineaDeError(linea, mensaje) {
  if (!editor || !linea) return;

  // Ace cuenta filas desde 0; los intérpretes reportan líneas desde 1.
  const fila = linea - 1;
  const totalFilas = editor.session.getLength();
  // Un error en la última línea puede reportar una fila que ya no existe.
  if (fila < 0 || fila >= totalFilas) return;

  editor.session.setAnnotations([{ row: fila, column: 0, text: mensaje, type: "error" }]);

  const Rango = ace.require("ace/range").Range;
  marcadorDeError = editor.session.addMarker(
    new Rango(fila, 0, fila, 1),
    "practica__linea-error",
    "fullLine",
  );
}

/*
  Deduce la línea del error según el lenguaje. R queda fuera a propósito: sus
  mensajes no traen número de línea de forma fiable, y marcar la línea equivocada
  es peor que no marcar ninguna.
*/
function lineaDelError(resultado, codigo) {
  if (lenguajeActivo.id === "python") return lineaDelErrorPython(resultado.error || "");
  if (lenguajeActivo.id === "sql") return lineaDelErrorSql(resultado.error || "", codigo);
  return null;
}

/* Un tiempo con más de un decimal en milisegundos es ruido, no información. */
function formatearDuracion(milisegundos) {
  if (milisegundos < 1000) return `${Math.round(milisegundos)} ms`;
  return `${(milisegundos / 1000).toFixed(2)} s`;
}

async function ejecutarCodigo() {
  if (ejecutando) return;

  const runtime = obtenerRuntime(lenguajeActivo);
  const codigo = editor.getValue();

  alternarControles(true);
  limpiarSalida();
  limpiarMarcaDeError();
  // El fondo late mientras corre: es la única señal ambiental de que algo pasa.
  if (fondoAmbiental) fondoAmbiental.ejecutando();

  /*
    Un acumulador nuevo por corrida: el tope de salida es por ejecución, no por
    sesión, o el segundo `print` del día quedaría truncado sin motivo.
  */
  const acumulador = crearAcumuladorSalida();
  const recibirSalida = (texto, flujo) => {
    for (const fragmento of acumulador.agregar(texto, flujo)) pintarFragmento(fragmento);
  };

  try {
    if (!runtime.estaCargado()) {
      anunciarEstado(`Preparando ${lenguajeActivo.etiqueta}… la primera vez tarda unos segundos.`);
      await runtime.cargar((etapa) => anunciarEstado(etapa));
    }

    anunciarEstado("Ejecutando…");
    /*
      Se cronometra solo la ejecución, no la descarga del intérprete: mezclarlas
      daría "12 s" en la primera corrida y engañaría sobre lo que tarda el código.
    */
    const inicio = performance.now();
    const resultado = await runtime.ejecutar(codigo, recibirSalida);
    const duracion = formatearDuracion(performance.now() - inicio);

    pintarResultado(resultado);

    /*
      El intérprete es real pero no hay terminal, así que `pip install` y los
      imports ausentes fallan de formas que no le dicen al alumno qué hacer. La
      pista aparece pegada al error, que es donde va a estar mirando.
    */
    if (!resultado.ok && lenguajeActivo.id === "python") {
      const pista = sugerenciaDePaquetePython(resultado.error || "", codigo);
      if (pista) pintarFragmento({ texto: `\n${pista}\n`, flujo: "aviso" });
    }

    /*
      Detenida no es un fracaso del código: el alumno cortó a propósito. Se tiñe
      como error igual porque el pulso solo distingue "salió bien" de "no salió".
    */
    if (fondoAmbiental) fondoAmbiental.terminado(resultado.ok);

    if (resultado.detenida) {
      // Cortada a mano: el tiempo transcurrido no mide nada que valga reportar.
      anunciarEstado("Ejecución detenida.", "aviso");
    } else if (resultado.ok) {
      anunciarEstado(`Listo en ${duracion}.`, "exito");
    } else {
      const linea = lineaDelError(resultado, codigo);
      marcarLineaDeError(linea, resultado.error || "Error");
      anunciarEstado(
        linea ? `Error en la línea ${linea}.` : "La ejecución terminó con errores.",
        "error",
      );
    }
  } catch (error) {
    /*
      Acá caen los fallos de infraestructura (no llegó el runtime, el worker murió),
      no los errores del código del alumno: esos vuelven dentro del resultado.
    */
    console.error("[practica]", { lenguaje: lenguajeActivo.id, error: { type: error?.name || null } });
    if (fondoAmbiental) fondoAmbiental.terminado(false);
    pintarFragmento({ texto: `No se pudo ejecutar: ${error?.message || error}\n`, flujo: "stderr" });
    anunciarEstado("No se pudo preparar el intérprete. Revisa tu conexión e intenta de nuevo.", "error");
  } finally {
    alternarControles(false);
  }
}

function detenerEjecucion() {
  if (!ejecutando) return;
  obtenerRuntime(lenguajeActivo).detener();
  anunciarEstado("Deteniendo…", "aviso");
}

/*
  Ejecuta SQL de infraestructura del panel de datos (crear tabla, listar, vaciar)
  sin volcarlo a la consola: el alumno no pidió ver 500 INSERT, pidió su tabla.
  Devuelve null si no se pudo preparar el motor, para que quien llama no confunda
  "falló la carga" con "la sentencia dio error".
*/
async function ejecutarSqlDeDatos(sql) {
  if (ejecutando) return null;

  const runtime = obtenerRuntime(resolverLenguajeActivo("sql"));
  alternarControles(true);

  try {
    if (!runtime.estaCargado()) {
      anunciarEstado("Preparando Postgres… la primera vez tarda unos segundos.");
      await runtime.cargar((etapa) => anunciarEstado(etapa));
    }
    const resultado = await runtime.ejecutar(sql, () => {});
    anunciarEstado("");
    return resultado;
  } catch (error) {
    console.error("[practica]", { contexto: "sql_datos", error: { type: error?.name || null } });
    anunciarEstado("No se pudo preparar Postgres. Revisa tu conexión e intenta de nuevo.", "error");
    return null;
  } finally {
    alternarControles(false);
  }
}

/*
  La descarga es el beneficio reservado a quien tiene cuenta. El botón se muestra
  igual sin sesión —bloquearlo escondiéndolo no convertiría a nadie: hay que ver
  lo que se está perdiendo— pero al hacer clic lleva al login con `next` de vuelta
  acá. El código no se pierde en el viaje: vive en localStorage, que sobrevive la
  navegación.
*/
function actualizarAccesoDescarga() {
  const { descargar, notaDescarga } = obtenerElementos();

  descargar.classList.toggle("practica__descargar--bloqueado", !sesionActiva);

  /*
    El botón es un icono sin texto, así que su etiqueta accesible es lo único que
    nombra el archivo. Tiene que decir QUÉ baja y, cuando está bloqueado, POR QUÉ
    no baja — si no, el clic que lleva al login parece un fallo.
  */
  const archivo = lenguajeActivo?.archivo || "tu código";
  const etiqueta = sesionActiva
    ? `Descargar ${archivo}`
    : `Descargar ${archivo} — necesitas una cuenta`;

  descargar.title = etiqueta;
  descargar.setAttribute("aria-label", etiqueta);
  notaDescarga.hidden = sesionActiva;
}

async function resolverSesion() {
  try {
    sesionActiva = Boolean(await obtenerSesion());
  } catch (error) {
    // Ante la duda queda bloqueado: el botón lleva al login, que es recuperable.
    console.error("[practica]", { contexto: "sesion", error: { type: error?.name || null } });
    sesionActiva = false;
  }
  actualizarAccesoDescarga();
}

function descargarCodigo() {
  if (!sesionActiva) {
    /*
      Vuelve a la página del lenguaje, no al hub: ahora cada entorno tiene su
      propia URL, y un hash sobre el hub no lo abriría. El código sobrevive el
      viaje porque vive en localStorage.
    */
    window.location.href = urlLoginConDestino(lenguajeActivo.ruta);
    return;
  }

  const contenido = new Blob([editor.getValue()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(contenido);

  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = lenguajeActivo.archivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();

  // Revocar en el mismo tick cancela la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ------------------------------------------------------------------ */
/* Editor y cambio de lenguaje                                          */
/* ------------------------------------------------------------------ */

/*
  El lenguaje ya no se elige dentro de la pantalla: lo declara la propia página en
  <body data-lenguaje="python">. Cada entorno vive en su URL, así que compartir el
  enlace lleva directo al lenguaje correcto, "atrás" del navegador significa lo que
  el alumno espera, y cada página puede crecer con las herramientas —o el diseño—
  que solo le sirven a ella.

  Sigue pasando por resolverLenguajeActivo para heredar su garantía: un data-atributo
  mal escrito cae al primer lenguaje en vez de dejar la página sin editor.
*/
function resolverLenguajeDeLaPagina() {
  return resolverLenguajeActivo(document.body.dataset.lenguaje || "");
}

function aplicarLenguaje(lenguaje) {
  lenguajeActivo = lenguaje;

  editor.session.setMode(lenguaje.modoEditor);
  editor.setValue(leerCodigoGuardado(lenguaje.id) ?? lenguaje.ejemplo, -1);

  limpiarSalida();
  anunciarEstado("");

  // Los controles son iconos sin texto: el nombre del archivo solo puede vivir en
  // la etiqueta accesible, que es también el tooltip.
  actualizarAccesoDescarga();
}

/* ------------------------------------------------------------------ */
/* Vistas: SQL y base de datos                                          */
/* ------------------------------------------------------------------ */

/*
  Solo la página de SQL tiene dos vistas. Consultar y modelar son modos de trabajo
  distintos: juntos en una pantalla, ninguno de los dos entra cómodo.
*/
function cambiarVista(vista) {
  const panelSql = document.getElementById("practicaPanelSql");
  const panelBase = document.getElementById("practicaPanelBase");
  if (!panelSql || !panelBase) return;

  const enSql = vista !== "base";
  panelSql.hidden = !enSql;
  panelBase.hidden = enSql;

  for (const boton of document.querySelectorAll("[data-vista]")) {
    const activa = boton.dataset.vista === (enSql ? "sql" : "base");
    boton.classList.toggle("practica__vista--activa", activa);
    boton.setAttribute("aria-selected", activa ? "true" : "false");
  }

  /*
    Ace calcula su tamaño al montarse y no se entera de los cambios mientras
    estuvo oculto: sin este resize vuelve con el alto viejo y el cursor cae
    desalineado del texto.
  */
  if (enSql && editor) editor.resize();

  /*
    Al entrar a la vista de base se relee el esquema real: el alumno pudo crear o
    borrar tablas desde el editor, y la pantalla no puede mostrar lo que había
    cuando se abrió.
  */
  if (!enSql && panelDatos) panelDatos.refrescar();
}

function configurarVistas() {
  for (const boton of document.querySelectorAll("[data-vista]")) {
    boton.addEventListener("click", () => cambiarVista(boton.dataset.vista));
  }
}

/*
  La nomenclatura reemplaza a los botones con texto: los iconos quedan limpios
  arriba y el significado de cada uno se consulta bajo demanda, en la esquina
  opuesta, sin ocupar espacio permanente del entorno.
*/
function configurarNomenclatura() {
  const { nomenclatura, nomenclaturaPanel } = obtenerElementos();
  if (!nomenclatura || !nomenclaturaPanel) return;

  function cerrar() {
    nomenclatura.setAttribute("aria-expanded", "false");
    nomenclaturaPanel.hidden = true;
  }

  nomenclatura.addEventListener("click", () => {
    const abierto = nomenclatura.getAttribute("aria-expanded") === "true";
    if (abierto) {
      cerrar();
      return;
    }
    nomenclatura.setAttribute("aria-expanded", "true");
    nomenclaturaPanel.hidden = false;
  });

  // El panel flota sobre la salida: Escape tiene que devolver la vista sin que el
  // alumno tenga que apuntarle otra vez al botón.
  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape" || nomenclaturaPanel.hidden) return;
    cerrar();
    nomenclatura.focus();
  });
}

function montarEditor() {
  ace.config.set("basePath", "https://cdn.jsdelivr.net/npm/ace-builds@1.44.0/src-min-noconflict");

  editor = ace.edit("practicaEditor");
  editor.setTheme(TEMA_EDITOR_PRACTICA);
  editor.setOptions({
    fontFamily: "var(--font-mono)",
    fontSize: "14px",
    showPrintMargin: false,
    // El editor ocupa una caja fija; sin esto Ace no reflowea al cambiar de tamaño.
    autoScrollEditorIntoView: true,
    tabSize: 4,
    useSoftTabs: true,
  });

  editor.commands.addCommand({
    name: "ejecutarCodigo",
    bindKey: { win: "Ctrl-Enter", mac: "Command-Enter" },
    exec: ejecutarCodigo,
  });

  editor.session.on("change", () => {
    if (lenguajeActivo) guardarCodigo(lenguajeActivo.id, editor.getValue());
    /*
      Al primer tecleo la marca deja de ser cierta: las líneas se corrieron y
      seguiría señalando una fila que ya no es la que falló.
    */
    limpiarMarcaDeError();
  });
}

function iniciarPlayground() {
  const { ejecutar, detener, restaurar, descargar, datos, fondo } = obtenerElementos();

  montarEditor();

  /*
    El fondo es decoración: si por lo que sea no se pudiera montar, el entorno
    tiene que seguir funcionando igual. De ahí la guarda en vez de asumirlo.
  */
  if (fondo && typeof montarFondoDeCodigo === "function") {
    fondoAmbiental = montarFondoDeCodigo(fondo);
  }

  /*
    La vista de base de datos solo existe en la página de SQL. Montarla a ciegas
    reventaría en Python y R, donde ninguno de sus elementos está en el DOM.
  */
  if (datos) {
    panelDatos = montarVistaBaseDeDatos({
      ejecutarSql: ejecutarSqlDeDatos,
      escribirEnEditor: (sql) => {
        editor.setValue(sql, -1);
        // Escribir en el editor solo sirve si el editor está a la vista.
        cambiarVista("sql");
        editor.focus();
      },
    });
    configurarVistas();
  }

  aplicarLenguaje(resolverLenguajeDeLaPagina());
  configurarNomenclatura();

  ejecutar.addEventListener("click", ejecutarCodigo);
  detener.addEventListener("click", detenerEjecucion);
  descargar.addEventListener("click", descargarCodigo);
  restaurar.addEventListener("click", () => {
    olvidarCodigo(lenguajeActivo.id);
    editor.setValue(lenguajeActivo.ejemplo, -1);
    editor.focus();
  });

  // No se espera: el entorno es usable sin sesión y solo la descarga depende de
  // ella, así que resolverla no debe retrasar el montaje del editor.
  return resolverSesion();
}

window.tauduxPractica = {
  iniciar: iniciarPlayground,
};
window.tauduxPractica.ready = window.tauduxPractica.iniciar();
Object.freeze(window.tauduxPractica);
