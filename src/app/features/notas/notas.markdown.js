/*
  Renderizado del cuerpo de una nota. Depende de notas.arbol.js.

  Las tres bibliotecas que hacen falta —markdown, resaltado de código y
  fórmulas— se descargan bajo demanda, la primera vez que alguien abre una nota.
  El índice y el grafo no las necesitan y son la primera pantalla que ve
  cualquiera: cargarlas ahí sería hacer pagar a todo el mundo por algo que solo
  usa quien entra a leer. KaTeX además arrastra sus fuentes, así que su hoja de
  estilos también va diferida.

  Las versiones van fijas a propósito. En este repositorio ya hay precedente de
  un CDN que se mueve solo y rompe producción sin que nadie toque el código
  (ver el test del runtime en practica); un rango de versión abierto es
  exactamente esa clase de trampa.
*/

const CDN_MARKED = "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js";
const CDN_HLJS = "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js";
const CDN_HLJS_ESTILO =
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github-dark.min.css";
const CDN_KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
const CDN_KATEX_ESTILO = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
const CDN_KATEX_AUTO =
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js";

/* Una promesa por URL: dos notas abiertas seguidas no vuelven a pedir nada. */
const recursosExternos = new Map();

function cargarRecursoExterno(url, crearEtiqueta) {
  if (recursosExternos.has(url)) return recursosExternos.get(url);

  const promesa = new Promise((resolver, rechazar) => {
    const etiqueta = crearEtiqueta();
    etiqueta.addEventListener("load", () => resolver(true));
    etiqueta.addEventListener("error", () => {
      /* Se olvida para que un segundo intento sea posible: la caída puede ser
         un corte momentáneo de red y no el CDN entero. */
      recursosExternos.delete(url);
      rechazar(new Error(`No se pudo cargar ${url}`));
    });
    document.head.appendChild(etiqueta);
  });

  recursosExternos.set(url, promesa);
  return promesa;
}

function cargarScriptExterno(url) {
  return cargarRecursoExterno(url, () => {
    const etiqueta = document.createElement("script");
    etiqueta.src = url;
    etiqueta.async = true;
    return etiqueta;
  });
}

function cargarEstiloExterno(url) {
  return cargarRecursoExterno(url, () => {
    const etiqueta = document.createElement("link");
    etiqueta.rel = "stylesheet";
    etiqueta.href = url;
    return etiqueta;
  });
}

/*
  Solo se baja KaTeX si la nota trae fórmulas, que es lo más pesado del conjunto.
  La comprobación es sobre el markdown ya sin código: un `$` dentro de un bloque
  de shell o de una cadena de Python no es una fórmula.
*/
function tieneFormulas(markdown) {
  const cuerpo = sinCodigo(markdown);
  return /\$\$[\s\S]+?\$\$/.test(cuerpo) || /(^|[^\\$])\$[^$\n]+\$/.test(cuerpo);
}

function tieneCodigo(html) {
  return html.includes("<code");
}

/*
  Los [[wikilinks]] se resuelven contra el árbol y conservan la vista actual: si
  alguien está explorando en modo grafo, saltar a una nota relacionada no debería
  expulsarlo de vuelta al listado.
*/
function resolverWikilink(arbol, vista) {
  return (slug) => {
    const nota = arbol.notasPorSlug.get(slug);
    if (!nota) return null;
    return {
      titulo: nota.titulo,
      href: construirHashNotas({ vista, segmentos: nota.segmentos }),
    };
  };
}

/*
  El markdown viene de archivos del repositorio, revisados en un commit antes de
  publicarse: es contenido de confianza y por eso se permite HTML en línea, que
  a veces hace falta para una tabla o una figura. Esa confianza deja de valer el
  día que el cuerpo de una nota llegue de una fuente externa; si eso pasa, acá
  va la sanitización.
*/
function convertirMarkdownAHtml(markdown, arbol, vista) {
  const conEnlaces = reemplazarWikilinks(markdown, resolverWikilink(arbol, vista));
  return marked.parse(conEnlaces, { gfm: true, breaks: false });
}

/* Los encabezados necesitan id para que el índice lateral pueda apuntarles. */
function idDeEncabezado(texto, usados) {
  const base =
    normalizarParaBusqueda(texto)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "seccion";

  let candidato = base;
  let sufijo = 2;
  while (usados.has(candidato)) {
    candidato = `${base}-${sufijo}`;
    sufijo += 1;
  }
  usados.add(candidato);
  return candidato;
}

function prepararEncabezados(contenedor) {
  const usados = new Set();
  const indice = [];

  contenedor.querySelectorAll("h2, h3").forEach((encabezado) => {
    encabezado.id = idDeEncabezado(encabezado.textContent, usados);
    indice.push({
      id: encabezado.id,
      texto: encabezado.textContent.trim(),
      nivel: encabezado.tagName === "H2" ? 2 : 3,
    });
  });

  return indice;
}

/*
  Un enlace a otro sitio se abre aparte para no sacar al lector de la nota a
  media lectura. rel="noopener" es obligatorio con target="_blank": sin él, la
  página destino puede manipular window.opener.
*/
function prepararEnlaces(contenedor) {
  contenedor.querySelectorAll("a[href]").forEach((enlace) => {
    const href = enlace.getAttribute("href");
    if (!/^https?:\/\//i.test(href)) return;
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
  });
}

/*
  Una tabla ancha no puede ensanchar la página: se envuelve para que scrollee
  sola. tabindex la vuelve alcanzable por teclado, que es la parte que casi
  siempre se olvida en un contenedor con scroll.
*/
function prepararTablas(contenedor) {
  contenedor.querySelectorAll("table").forEach((tabla) => {
    if (tabla.parentElement && tabla.parentElement.classList.contains("notas__tabla-scroll")) {
      return;
    }
    const envoltorio = document.createElement("div");
    envoltorio.className = "notas__tabla-scroll";
    envoltorio.tabIndex = 0;
    envoltorio.setAttribute("role", "region");
    envoltorio.setAttribute("aria-label", "Tabla con desplazamiento horizontal");
    tabla.replaceWith(envoltorio);
    envoltorio.appendChild(tabla);
  });
}

async function resaltarCodigo(contenedor) {
  await Promise.all([cargarScriptExterno(CDN_HLJS), cargarEstiloExterno(CDN_HLJS_ESTILO)]);
  contenedor.querySelectorAll("pre code").forEach((bloque) => {
    hljs.highlightElement(bloque);
  });
}

async function renderizarFormulas(contenedor) {
  await Promise.all([
    cargarEstiloExterno(CDN_KATEX_ESTILO),
    cargarScriptExterno(CDN_KATEX).then(() => cargarScriptExterno(CDN_KATEX_AUTO)),
  ]);

  renderMathInElement(contenedor, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      /*
        El delimitador de un solo $ es cómodo para escribir y tiene un costo: un
        precio como $5 y otro $9 en el mismo párrafo se interpretaría como
        fórmula. En las notas se escriben los montos sin el símbolo, o con \$.
      */
      { left: "$", right: "$", display: false },
    ],
    /* Un error de sintaxis en una fórmula no puede tumbar el resto de la nota. */
    throwOnError: false,
    errorColor: "#e5484d",
  });
}

/*
  Punto de entrada. Pinta el markdown y devuelve el índice de encabezados para
  que la vista de lectura arme su navegación lateral.

  El resaltado y las fórmulas se aplican DESPUÉS de que el texto ya está en
  pantalla y no bloquean: si el CDN tarda o falla, la nota se lee igual, con el
  código sin colores y las fórmulas en su forma cruda. Que una nota sea
  ilegible porque un CDN de terceros no respondió sería un mal negocio.
*/
async function renderizarNota({ markdown, contenedor, arbol, vista }) {
  await cargarScriptExterno(CDN_MARKED);

  contenedor.innerHTML = convertirMarkdownAHtml(markdown, arbol, vista);
  const indice = prepararEncabezados(contenedor);
  prepararEnlaces(contenedor);
  prepararTablas(contenedor);

  const pendientes = [];
  if (tieneCodigo(contenedor.innerHTML)) pendientes.push(resaltarCodigo(contenedor));
  if (tieneFormulas(markdown)) pendientes.push(renderizarFormulas(contenedor));

  await Promise.allSettled(pendientes);
  return indice;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    tieneFormulas,
    idDeEncabezado,
    CDN_MARKED,
    CDN_HLJS,
    CDN_KATEX,
  });
}
