/*
  Controlador del área de notas. Se carga al final: depende de notas.arbol.js,
  notas.service.js, notas.lista.js, notas.lectura.js, notas.grafo.js y
  notas.markdown.js.

  Todo lo que se ve sale del hash. Ni la vista elegida ni el nivel en el que
  está parado el lector viven en una variable aparte, porque entonces habría dos
  fuentes de verdad y el botón "atrás" del navegador desincronizaría una de
  ellas. La única excepción es la búsqueda, que es transitoria a propósito:
  compartir un enlace con un texto de búsqueda a medio escribir no le sirve a
  nadie.
*/

const RETRASO_BUSQUEDA_NOTAS = 180;

const elementosNotas = {};
let arbolDeNotas = null;
let grafoMontado = null;
/* Se incrementa en cada navegación; la vista de lectura lo usa para descartar
   una descarga que llegó tarde. Ver renderizarLecturaDeNota. */
let generacionDeNavegacion = 0;
let temporizadorDeBusqueda = null;
let introPredeterminada = "";

function cacharElementosDeNotas() {
  [
    "notasTitulo",
    "notasIntro",
    "notasMigas",
    "notasBuscar",
    "notasEstado",
    "notasEstadoMensaje",
    "notasReintentar",
    "notasResultados",
    "notasLista",
    "notasGrafo",
    "notasGrafoLienzo",
    "notasGrafoLista",
    "notasLectura",
    "notasVistaLista",
    "notasVistaGrafo",
  ].forEach((id) => {
    elementosNotas[id] = document.getElementById(id);
  });
  introPredeterminada = elementosNotas.notasIntro.textContent.trim();
}

function mostrarEstadoDeNotas(mensaje) {
  elementosNotas.notasEstadoMensaje.textContent = mensaje;
  elementosNotas.notasEstado.hidden = false;
  elementosNotas.notasEstado.focus();
}

function ocultarEstadoDeNotas() {
  elementosNotas.notasEstado.hidden = true;
}

/* El grafo deja un bucle de animación y listeners de ventana: sin desmontarlo,
   navegar diez niveles deja diez simulaciones corriendo a la vez. */
function desmontarGrafo() {
  if (!grafoMontado) return;
  grafoMontado.destruir();
  grafoMontado = null;
}

function mostrarSecciones({ lista = false, grafo = false, lectura = false, resultados = false }) {
  if (!grafo) desmontarGrafo();
  elementosNotas.notasLista.hidden = !lista;
  elementosNotas.notasGrafo.hidden = !grafo;
  elementosNotas.notasLectura.hidden = !lectura;
  elementosNotas.notasResultados.hidden = !resultados;
}

function actualizarSelectorDeVista(vista, visible) {
  [elementosNotas.notasVistaLista, elementosNotas.notasVistaGrafo].forEach((boton) => {
    const activo = boton.dataset.vista === vista;
    boton.classList.toggle("notas__vista--activa", activo);
    boton.setAttribute("aria-selected", String(activo));
    boton.hidden = !visible;
  });
}

function actualizarEncabezado(nodo) {
  const esRaiz = nodo.tipo === "raiz";
  elementosNotas.notasTitulo.textContent = esRaiz ? "Notas" : nodo.titulo;
  elementosNotas.notasIntro.textContent = esRaiz
    ? introPredeterminada
    : nodo.resumen || introPredeterminada;
  document.title = esRaiz ? "Notas | Taudux" : `${nodo.titulo} | Notas | Taudux`;
}

function irA(segmentos, vista, { reemplazar = false } = {}) {
  const destino = construirHashNotas({ vista, segmentos });
  if (reemplazar) {
    /*
      replaceState y no location.hash: la ruta rota no debería quedar en el
      historial, o el botón "atrás" devolvería al lector justo al enlace que no
      existe.
    */
    window.history.replaceState(null, "", destino);
    renderizarDesdeElHash();
    return;
  }
  window.location.hash = destino;
}

function renderizarVistaDeLista(nodo, vista) {
  mostrarSecciones({ lista: true });
  renderizarNivelDeNotas(elementosNotas.notasLista, nodo, vista);
}

function renderizarVistaDeGrafo(nodo, vista) {
  mostrarSecciones({ grafo: true });
  desmontarGrafo();
  grafoMontado = montarGrafoDeNotas({
    contenedor: elementosNotas.notasGrafoLienzo,
    listaAccesible: elementosNotas.notasGrafoLista,
    arbol: arbolDeNotas,
    nodo,
    vista,
    alNavegar: (segmentos) => irA(segmentos, vista),
  });
}

function renderizarVistaDeLectura(nota, vista) {
  mostrarSecciones({ lectura: true });
  const generacion = generacionDeNavegacion;
  renderizarLecturaDeNota({
    contenedor: elementosNotas.notasLectura,
    nota,
    arbol: arbolDeNotas,
    vista,
    sigueVigente: () => generacion === generacionDeNavegacion,
  });
}

function renderizarDesdeElHash() {
  if (!arbolDeNotas) return;

  generacionDeNavegacion += 1;
  const { vista, segmentos } = parsearHashNotas(window.location.hash);
  const { nodo, encontrado } = resolverRutaDeNotas(arbolDeNotas, segmentos);

  if (!encontrado) {
    if (typeof mostrarToast === "function") {
      mostrarToast("Esa nota ya no está donde apuntaba el enlace.", "error");
    }
    /* Se corrige la URL al lugar real en vez de dejarla mintiendo. */
    irA(nodo.segmentos, vista, { reemplazar: true });
    return;
  }

  /* Cambiar de nivel con una búsqueda escrita dejaría los resultados encima del
     nivel nuevo; el campo se limpia al navegar. */
  elementosNotas.notasBuscar.value = "";

  actualizarEncabezado(nodo);
  renderizarMigasDeNotas(elementosNotas.notasMigas, migasDeNotas(arbolDeNotas, nodo), vista);
  actualizarSelectorDeVista(vista, nodo.tipo !== "nota");

  if (nodo.tipo === "nota") {
    renderizarVistaDeLectura(nodo, vista);
    return;
  }

  if (vista === "grafo") {
    renderizarVistaDeGrafo(nodo, vista);
    return;
  }

  renderizarVistaDeLista(nodo, vista);
  /* El scroll queda donde estaba al bajar un nivel y la grilla nueva arranca
     fuera de cuadro; enfocarla la trae y además anuncia el cambio. */
  elementosNotas.notasLista.focus({ preventScroll: true });
}

function ejecutarBusqueda() {
  const consulta = elementosNotas.notasBuscar.value.trim();
  const { vista } = parsearHashNotas(window.location.hash);

  if (!consulta) {
    /* Volver a lo que dicte el hash: la búsqueda no cambia dónde está el lector. */
    renderizarDesdeElHash();
    return;
  }

  mostrarSecciones({ resultados: true });
  renderizarBusquedaDeNotas(
    elementosNotas.notasResultados,
    buscarEnNotas(arbolDeNotas, consulta),
    consulta,
    arbolDeNotas,
    vista
  );
}

function conectarEventosDeNotas() {
  window.addEventListener("hashchange", renderizarDesdeElHash);

  [elementosNotas.notasVistaLista, elementosNotas.notasVistaGrafo].forEach((boton) => {
    boton.addEventListener("click", () => {
      const { segmentos } = parsearHashNotas(window.location.hash);
      irA(segmentos, boton.dataset.vista);
    });
  });

  elementosNotas.notasBuscar.addEventListener("input", () => {
    /* Sin el retraso, cada tecla recorre el árbol entero y repinta la grilla. */
    window.clearTimeout(temporizadorDeBusqueda);
    temporizadorDeBusqueda = window.setTimeout(ejecutarBusqueda, RETRASO_BUSQUEDA_NOTAS);
  });

  elementosNotas.notasBuscar.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") return;
    elementosNotas.notasBuscar.value = "";
    ejecutarBusqueda();
  });

  elementosNotas.notasReintentar.addEventListener("click", () => {
    olvidarNotasEnMemoria();
    iniciarNotas();
  });
}

async function iniciarNotas() {
  ocultarEstadoDeNotas();
  const resultado = await cargarArbolDeNotas();

  if (!resultado.ok) {
    arbolDeNotas = null;
    mostrarSecciones({});
    mostrarEstadoDeNotas(resultado.mensaje);
    return;
  }

  arbolDeNotas = resultado.arbol;
  renderizarDesdeElHash();
}

document.addEventListener("DOMContentLoaded", () => {
  cacharElementosDeNotas();
  conectarEventosDeNotas();
  iniciarNotas();
});
