/*
  Vista de lectura de una nota. Depende de notas.arbol.js, notas.service.js y
  notas.markdown.js.

  Es la única vista que hace red después del arranque —el cuerpo de la nota es
  un archivo aparte— y por eso la única que tiene que resolver el caso de que el
  lector se vaya a otro lado mientras la descarga sigue en camino.
*/

/*
  Notas conectadas con esta, en cualquiera de los dos sentidos. Las relaciones se
  declaran en una sola de las dos notas para no duplicar información, así que
  preguntar solo por `nota.relacionadas` mostraría el pie "Sigue por aquí" a
  medias: la nota que fue citada no sabría que la citaron.
*/
function notasRelacionadasCon(arbol, nota) {
  return relacionesEntreNotas(arbol)
    .filter((par) => par.includes(nota.slug))
    .map((par) => arbol.notasPorSlug.get(par.find((slug) => slug !== nota.slug)))
    .filter(Boolean);
}

function crearCabeceraDeNota(nota) {
  const cabecera = document.createElement("header");
  cabecera.className = "notas__lectura-cabecera";

  const titulo = document.createElement("h2");
  titulo.className = "notas__lectura-titulo";
  titulo.textContent = nota.titulo;
  cabecera.appendChild(titulo);

  if (nota.resumen) {
    const resumen = document.createElement("p");
    resumen.className = "notas__lectura-resumen";
    resumen.textContent = nota.resumen;
    cabecera.appendChild(resumen);
  }

  const etiquetas = crearEtiquetas(nota);
  if (etiquetas) cabecera.appendChild(etiquetas);

  return cabecera;
}

/*
  Índice de la nota a partir de sus encabezados. Solo aparece si hay al menos
  tres: con uno o dos, ocupa más espacio del que ahorra.
*/
function crearIndiceDeNota(indice) {
  if (indice.length < 3) return null;

  const navegacion = document.createElement("nav");
  navegacion.className = "notas__indice";
  navegacion.setAttribute("aria-label", "Contenido de la nota");

  const titulo = document.createElement("p");
  titulo.className = "notas__indice-titulo";
  titulo.textContent = "En esta nota";
  navegacion.appendChild(titulo);

  const lista = document.createElement("ul");
  lista.className = "notas__indice-lista";
  indice.forEach((entrada) => {
    const item = document.createElement("li");
    item.className = `notas__indice-item notas__indice-item--nivel-${entrada.nivel}`;
    const enlace = document.createElement("a");
    /*
      El destino es un id dentro de la página, pero el hash ya lo ocupa el ruteo
      del área de notas: escribir "#seccion" cambiaría de nota. Se navega a mano
      con scrollIntoView y se deja el hash en paz.
    */
    enlace.href = `#${entrada.id}`;
    enlace.textContent = entrada.texto;
    enlace.addEventListener("click", (evento) => {
      evento.preventDefault();
      const destino = document.getElementById(entrada.id);
      if (destino) destino.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    item.appendChild(enlace);
    lista.appendChild(item);
  });

  navegacion.appendChild(lista);
  return navegacion;
}

function crearRelacionadasDeNota(arbol, nota, vista) {
  const relacionadas = notasRelacionadasCon(arbol, nota);
  if (!relacionadas.length) return null;

  const pie = document.createElement("footer");
  pie.className = "notas__relacionadas";

  const titulo = document.createElement("h3");
  titulo.className = "notas__relacionadas-titulo";
  titulo.textContent = "Sigue por aquí";
  pie.appendChild(titulo);

  const grilla = document.createElement("div");
  grilla.className = "notas__grilla";
  relacionadas.forEach((otra) => grilla.appendChild(crearTarjetaDeNodo(otra, vista)));
  pie.appendChild(grilla);

  return pie;
}

function crearAvisoDeLectura(mensaje, claseExtra = "") {
  const aviso = document.createElement("p");
  aviso.className = `notas__lectura-aviso ${claseExtra}`.trim();
  aviso.setAttribute("role", "status");
  aviso.textContent = mensaje;
  return aviso;
}

/*
  `sigueVigente` lo provee el controlador y responde si esta nota sigue siendo
  la que el lector quiere ver. Sin esa comprobación, abrir dos notas seguidas
  con la red lenta termina pintando la primera encima de la segunda, porque las
  respuestas no vuelven necesariamente en orden.
*/
async function renderizarLecturaDeNota({ contenedor, nota, arbol, vista, sigueVigente }) {
  const cabecera = crearCabeceraDeNota(nota);
  const cuerpo = document.createElement("div");
  cuerpo.className = "notas__prosa";
  cuerpo.appendChild(crearAvisoDeLectura("Cargando la nota…"));
  contenedor.replaceChildren(cabecera, cuerpo);

  const resultado = await cargarCuerpoDeNota(nota);
  if (!sigueVigente()) return;

  if (!resultado.ok) {
    cuerpo.replaceChildren(
      crearAvisoDeLectura(resultado.mensaje, "notas__lectura-aviso--error")
    );
    return;
  }

  let indice = [];
  try {
    indice = await renderizarNota({
      markdown: resultado.markdown,
      contenedor: cuerpo,
      arbol,
      vista,
    });
  } catch (error) {
    /*
      Acá solo se llega si falló el CDN del renderizador de markdown. Antes que
      dejar la nota en blanco, se muestra el texto crudo: es markdown, o sea
      perfectamente legible.
    */
    console.error("[notas.lectura] no se pudo renderizar el markdown", error);
    const crudo = document.createElement("pre");
    crudo.className = "notas__prosa-crudo";
    /* Sin el bloque de metadatos: incluso el respaldo tiene que verse como la
       nota, no como el archivo. */
    crudo.textContent = separarFrontmatter(resultado.markdown).cuerpo;
    cuerpo.replaceChildren(crudo);
  }

  if (!sigueVigente()) return;

  const piezas = [cabecera];
  const navegacionIndice = crearIndiceDeNota(indice);
  if (navegacionIndice) piezas.push(navegacionIndice);
  piezas.push(cuerpo);

  const relacionadas = crearRelacionadasDeNota(arbol, nota, vista);
  if (relacionadas) piezas.push(relacionadas);

  contenedor.replaceChildren(...piezas);
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    notasRelacionadasCon,
  });
}
