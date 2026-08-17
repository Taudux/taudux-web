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
    lenguajes: document.getElementById("practicaLenguajes"),
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

async function ejecutarCodigo() {
  if (ejecutando) return;

  const runtime = obtenerRuntime(lenguajeActivo);
  const codigo = editor.getValue();

  alternarControles(true);
  limpiarSalida();

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
    const resultado = await runtime.ejecutar(codigo, recibirSalida);

    pintarResultado(resultado);

    if (resultado.detenida) {
      anunciarEstado("Ejecución detenida.", "aviso");
    } else if (resultado.ok) {
      anunciarEstado("Listo.", "exito");
    } else {
      anunciarEstado("La ejecución terminó con errores.", "error");
    }
  } catch (error) {
    /*
      Acá caen los fallos de infraestructura (no llegó el runtime, el worker murió),
      no los errores del código del alumno: esos vuelven dentro del resultado.
    */
    console.error("[practica]", { lenguaje: lenguajeActivo.id, error: { type: error?.name || null } });
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
  descargar.title = sesionActiva
    ? "Descarga tu código como archivo"
    : "Crea tu cuenta gratis para descargar tu código";
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
    // Vuelve al lenguaje en el que estaba, no al playground genérico.
    window.location.href = urlLoginConDestino(
      `/app/features/practica/#${lenguajeActivo.id}`,
    );
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

function marcarLenguajeActivo(idLenguaje) {
  const { lenguajes } = obtenerElementos();

  for (const boton of lenguajes.querySelectorAll("[data-lenguaje]")) {
    const activo = boton.dataset.lenguaje === idLenguaje;
    boton.classList.toggle("practica__lenguaje--activo", activo);
    boton.setAttribute("aria-selected", activo ? "true" : "false");
    boton.tabIndex = activo ? 0 : -1;
  }
}

function aplicarLenguaje(lenguaje) {
  lenguajeActivo = lenguaje;

  editor.session.setMode(lenguaje.modoEditor);
  editor.setValue(leerCodigoGuardado(lenguaje.id) ?? lenguaje.ejemplo, -1);

  marcarLenguajeActivo(lenguaje.id);
  limpiarSalida();
  anunciarEstado("");

  const { restaurar, descargar } = obtenerElementos();
  restaurar.textContent = `Restaurar ejemplo de ${lenguaje.etiqueta}`;
  descargar.textContent = `Descargar ${lenguaje.archivo}`;
  // El botón se reetiqueta en cada cambio de lenguaje; el candado tiene que
  // volver a aplicarse sobre la etiqueta nueva.
  actualizarAccesoDescarga();

  // El panel de captura de datos solo tiene sentido con una base detrás.
  if (panelDatos) panelDatos.mostrar(lenguaje.id === "sql");
}

function cambiarLenguaje(idLenguaje) {
  if (ejecutando || idLenguaje === lenguajeActivo.id) return;

  const lenguaje = resolverLenguajeActivo(idLenguaje);
  // Deja el lenguaje en la URL para poder compartir el enlace ya posicionado.
  window.history.replaceState(null, "", `#${lenguaje.id}`);
  aplicarLenguaje(lenguaje);
}

function construirSelectorDeLenguajes() {
  const { lenguajes } = obtenerElementos();

  for (const lenguaje of LENGUAJES_PRACTICA) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "practica__lenguaje";
    boton.dataset.lenguaje = lenguaje.id;
    boton.setAttribute("role", "tab");
    boton.title = lenguaje.descripcion;

    const nombre = document.createElement("span");
    nombre.className = "practica__lenguaje-nombre";
    nombre.textContent = lenguaje.etiqueta;

    const version = document.createElement("span");
    version.className = "practica__lenguaje-version";
    version.textContent = lenguaje.version;

    boton.append(nombre, version);
    boton.addEventListener("click", () => cambiarLenguaje(lenguaje.id));
    lenguajes.appendChild(boton);
  }
}

function montarEditor() {
  ace.config.set("basePath", "https://cdn.jsdelivr.net/npm/ace-builds@1.44.0/src-min-noconflict");

  editor = ace.edit("practicaEditor");
  editor.setTheme(TEMA_EDITOR_PRACTICA);
  editor.setOptions({
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
  });
}

function iniciarPlayground() {
  const { ejecutar, detener, restaurar, descargar } = obtenerElementos();

  construirSelectorDeLenguajes();
  montarEditor();

  /*
    El panel se configura ANTES del primer aplicarLenguaje: ese ya decide si
    mostrarlo, y con panelDatos todavía en null la pantalla arrancaría con el
    panel visible en Python.
  */
  panelDatos = configurarPanelDeDatos({
    ejecutarSql: ejecutarSqlDeDatos,
    escribirEnEditor: (sql) => {
      editor.setValue(sql, -1);
      editor.focus();
    },
  });

  aplicarLenguaje(resolverLenguajeActivo(window.location.hash));

  ejecutar.addEventListener("click", ejecutarCodigo);
  detener.addEventListener("click", detenerEjecucion);
  descargar.addEventListener("click", descargarCodigo);
  restaurar.addEventListener("click", () => {
    olvidarCodigo(lenguajeActivo.id);
    editor.setValue(lenguajeActivo.ejemplo, -1);
    editor.focus();
  });

  window.addEventListener("hashchange", () => cambiarLenguaje(window.location.hash));

  // No se espera: el playground es usable sin sesión y solo la descarga depende
  // de ella, así que resolverla no debe retrasar el montaje del editor.
  return resolverSesion();
}

window.tauduxPractica = {
  iniciar: iniciarPlayground,
};
window.tauduxPractica.ready = window.tauduxPractica.iniciar();
Object.freeze(window.tauduxPractica);
