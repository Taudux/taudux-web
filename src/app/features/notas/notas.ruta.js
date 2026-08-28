/*
  La ruta actual dibujada como un grafo dirigido vertical, pegado a la izquierda.
  Depende de notas.arbol.js.

  Es la columna vertebral de la pantalla: Notas → Machine Learning → Aprendizaje
  no supervisado → Clustering → DBSCAN. El primer nodo es la base, el último es
  donde está parado el lector, y las flechas dicen en qué dirección se bajó.

  Responde tres cosas a la vez: dónde estoy, cómo llegué y cómo vuelvo — porque
  cada paso es un enlace real. Por eso se construye con elementos del DOM y no en
  un canvas como el mapa: un canvas se vería igual pero no se podría tabular, ni
  abrir en otra pestaña, ni leer con un lector de pantalla.

  En pantallas anchas sustituye a las migas horizontales, que quedan solo para
  cuando no hay ancho para una columna lateral. Las dos salen del mismo
  migasDeNotas, así que no pueden contradecirse.
*/

/*
  Los pasos de la ruta, de la raíz al nodo actual. Es exactamente la cadena de
  ancestros: acá no hay historial de por dónde anduvo el lector, sino de qué
  cuelga lo que está viendo.
*/
function pasosDeLaRuta(arbol, nodo) {
  return migasDeNotas(arbol, nodo).map((miga, indice, todas) => ({
    titulo: miga.titulo,
    segmentos: miga.segmentos,
    ruta: miga.segmentos.join("/"),
    /* La raíz es el nodo base y el último es dónde estás: los dos se marcan
       distinto porque son los dos extremos que el lector busca de un vistazo. */
    esBase: indice === 0,
    esActual: indice === todas.length - 1,
  }));
}

function tipoDelPaso(arbol, paso) {
  const nodo = arbol.porRuta.get(paso.ruta);
  return nodo ? nodo.tipo : "tema";
}

function crearPasoDeRuta(paso, { arbol, vista }) {
  const item = document.createElement("li");
  item.className = `notas__ruta-paso notas__ruta-paso--${tipoDelPaso(arbol, paso)}`;
  if (paso.esActual) item.classList.add("notas__ruta-paso--actual");
  if (paso.esBase) item.classList.add("notas__ruta-paso--base");

  /*
    El nodo del grafo es un elemento propio y no un pseudo-elemento del <li>
    porque de él cuelgan la flecha y la línea hacia el siguiente paso, y un
    elemento solo tiene dos pseudo-elementos.
  */
  const punto = document.createElement("span");
  punto.className = "notas__ruta-nodo";
  punto.setAttribute("aria-hidden", "true");

  const enlace = document.createElement("a");
  enlace.className = "notas__ruta-enlace";
  enlace.href = construirHashNotas({ vista, segmentos: paso.segmentos });
  enlace.textContent = paso.titulo;
  if (paso.esActual) enlace.setAttribute("aria-current", "page");

  item.append(punto, enlace);
  return item;
}

/*
  Pinta la ruta. El panel se oculta mientras el lector esté en la portada: un
  grafo de un solo nodo no informa nada y solo le quita ancho al contenido.
*/
function montarRutaDeNotas({ panel, lista, arbol, nodo, vista }) {
  const pasos = pasosDeLaRuta(arbol, nodo);

  panel.hidden = pasos.length < 2;
  if (panel.hidden) {
    lista.replaceChildren();
    return;
  }

  lista.replaceChildren(...pasos.map((paso) => crearPasoDeRuta(paso, { arbol, vista })));
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    pasosDeLaRuta,
  });
}
