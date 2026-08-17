/*
  Vista de secciones: migas, tarjetas de un nivel y resultados de búsqueda.
  Depende de notas.arbol.js.

  Todo se arma con createElement y textContent, nunca con innerHTML: los
  títulos y resúmenes vienen del manifiesto y hoy son de confianza, pero un
  constructor de nodos que no puede inyectar HTML no deja de ser seguro cuando
  mañana esos textos lleguen de otro lado.
*/

function textoDeConteo(nodo) {
  if (nodo.tipo === "nota") return "Nota";
  const total = nodo.notasDescendientes.length;
  const temas = nodo.hijos.length;
  const notas = `${total} ${total === 1 ? "nota" : "notas"}`;
  if (temas === 0) return notas;
  return `${temas} ${temas === 1 ? "tema" : "temas"} · ${notas}`;
}

function crearEtiquetas(nodo) {
  if (!nodo.etiquetas.length) return null;
  const lista = document.createElement("ul");
  lista.className = "notas__etiquetas";
  nodo.etiquetas.forEach((etiqueta) => {
    const item = document.createElement("li");
    item.className = "notas__etiqueta";
    item.textContent = etiqueta;
    lista.appendChild(item);
  });
  return lista;
}

/*
  Toda la tarjeta es un enlace, no un div con un onclick: se puede abrir en otra
  pestaña, se ve el destino en la barra de estado y el teclado la alcanza sin
  que haya que agregar tabindex ni manejar Enter a mano.
*/
function crearTarjetaDeNodo(nodo, vista) {
  const tarjeta = document.createElement("a");
  tarjeta.className = `notas__tarjeta panel notas__tarjeta--${nodo.tipo}`;
  tarjeta.href = construirHashNotas({ vista, segmentos: nodo.segmentos });

  const encabezado = document.createElement("div");
  encabezado.className = "notas__tarjeta-encabezado";

  const titulo = document.createElement("h3");
  titulo.className = "notas__tarjeta-titulo";
  titulo.textContent = nodo.titulo;

  const conteo = document.createElement("span");
  conteo.className = "notas__tarjeta-conteo";
  conteo.textContent = textoDeConteo(nodo);

  encabezado.append(titulo, conteo);
  tarjeta.appendChild(encabezado);

  if (nodo.resumen) {
    const resumen = document.createElement("p");
    resumen.className = "notas__tarjeta-resumen";
    resumen.textContent = nodo.resumen;
    tarjeta.appendChild(resumen);
  }

  const etiquetas = crearEtiquetas(nodo);
  if (etiquetas) tarjeta.appendChild(etiquetas);

  return tarjeta;
}

/*
  Las migas son la única forma de subir de nivel en la vista de lista, así que
  el último elemento —el nodo actual— se marca con aria-current y no es enlace:
  un enlace a la página en la que ya estás confunde a quien navega con lector
  de pantalla.
*/
function renderizarMigasDeNotas(contenedor, migas, vista) {
  const lista = document.createElement("ol");
  lista.className = "notas__migas-lista";

  migas.forEach((miga, indice) => {
    const item = document.createElement("li");
    item.className = "notas__miga";
    const esUltima = indice === migas.length - 1;

    if (esUltima) {
      const actual = document.createElement("span");
      actual.className = "notas__miga-actual";
      actual.setAttribute("aria-current", "page");
      actual.textContent = miga.titulo;
      item.appendChild(actual);
    } else {
      const enlace = document.createElement("a");
      enlace.className = "notas__miga-enlace";
      enlace.href = construirHashNotas({ vista, segmentos: miga.segmentos });
      enlace.textContent = miga.titulo;
      item.appendChild(enlace);
    }

    lista.appendChild(item);
  });

  contenedor.replaceChildren(lista);
}

/*
  Un nivel del árbol. Temas y notas se separan en dos grupos con encabezado
  porque son dos cosas distintas: uno lleva más adentro y el otro es el destino.
  Mezclados en una sola grilla, la única pista sería el color del borde.
*/
function renderizarNivelDeNotas(contenedor, nodo, vista) {
  const fragmento = document.createDocumentFragment();

  const grupos = [
    { titulo: "Temas", nodos: nodo.hijos },
    { titulo: nodo.hijos.length ? "Notas de este nivel" : "Notas", nodos: nodo.notas },
  ];

  grupos.forEach((grupo) => {
    if (!grupo.nodos.length) return;

    const seccion = document.createElement("section");
    seccion.className = "notas__grupo";

    const titulo = document.createElement("h2");
    titulo.className = "notas__grupo-titulo";
    titulo.textContent = grupo.titulo;
    seccion.appendChild(titulo);

    const grilla = document.createElement("div");
    grilla.className = "notas__grilla";
    grupo.nodos.forEach((hijo) => grilla.appendChild(crearTarjetaDeNodo(hijo, vista)));
    seccion.appendChild(grilla);

    fragmento.appendChild(seccion);
  });

  if (!fragmento.childElementCount) {
    const vacio = document.createElement("p");
    vacio.className = "notas__vacio";
    vacio.textContent = "Todavía no hay contenido publicado en esta rama.";
    fragmento.appendChild(vacio);
  }

  contenedor.replaceChildren(fragmento);
}

/*
  Resultados de búsqueda. Cada uno muestra su ruta completa porque el mismo
  título puede existir en dos ramas y, sin el contexto, elegir es adivinar.
*/
function renderizarBusquedaDeNotas(contenedor, resultados, consulta, arbol, vista) {
  const fragmento = document.createDocumentFragment();

  const encabezado = document.createElement("p");
  encabezado.className = "notas__resultados-encabezado";
  encabezado.textContent = resultados.length
    ? `${resultados.length} ${resultados.length === 1 ? "resultado" : "resultados"} para “${consulta}”`
    : `Sin resultados para “${consulta}”`;
  fragmento.appendChild(encabezado);

  const grilla = document.createElement("div");
  grilla.className = "notas__grilla";

  resultados.forEach((nodo) => {
    const tarjeta = crearTarjetaDeNodo(nodo, vista);

    const ruta = document.createElement("p");
    ruta.className = "notas__tarjeta-ruta";
    ruta.textContent = migasDeNotas(arbol, nodo)
      .slice(1, -1)
      .map((miga) => miga.titulo)
      .join(" / ");
    if (ruta.textContent) tarjeta.appendChild(ruta);

    grilla.appendChild(tarjeta);
  });

  fragmento.appendChild(grilla);
  contenedor.replaceChildren(fragmento);
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    textoDeConteo,
  });
}
