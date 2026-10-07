/*
  Lógica de la página puente de los decks SUBIDOS (ver subida.js). Sin red y
  sin Supabase: recibe un documento ya parseado o los nodos de la página y
  responde. Vive aparte para poder probarse en Node con nodos de mentira, y
  por eso termina en un module.exports condicional, igual que slides.logica.js.

  EL PROBLEMA QUE RESUELVE. Un deck subido es un HTML ajeno al repositorio, y
  esta página corre bajo la CSP de /content/slides (sin 'unsafe-inline' en
  script-src) en el MISMO origen que el sitio y su sesión de Supabase. Dejarlo
  correr tal cual sería darle esa sesión a quien lo escribió. Por eso el deck
  NUNCA se sirve como página: se descarga como texto, se parsea con
  DOMParser (que no ejecuta nada), se le quita todo lo que pueda ejecutar
  código y sólo entonces se pasa a la página puente. Lo que sobrevive es lo
  que un deck de diseño necesita: sus <style>, su HTML y sus imágenes.

  Es una defensa EN PROFUNDIDAD, no la única: la CSP ya bloquea los scripts
  inline y los handlers on*, y la RLS ya decide quién sube y quién lee. Esto
  quita además lo que la CSP deja pasar (scripts de jsdelivr, iframes del
  mismo origen, <base>, <meta http-equiv>).
*/

/* Lo que se quita entero. `noscript` va porque DOMParser lo parsea como
   elementos reales (sin scripting) y, ya en esta página, se mostraría. */
const SELECTOR_DE_NODOS_PELIGROSOS =
  "script, noscript, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv]";

/* Las hojas de estilo externas que se conservan: las de Google Fonts, que la
   CSP ya permite y que los decks usan para sus tipografías. */
const PREFIJO_DE_HOJAS_PERMITIDAS = "https://fonts.googleapis.com/";

const EVENTO_DE_CAMBIO = "slides:cambio";

function esUrlDeScript(valor) {
  if (typeof valor !== "string") return false;
  // Los navegadores ignoran espacios y caracteres de control dentro del
  // esquema ("java\tscript:"), así que se comparan sin ellos.
  // eslint-disable-next-line no-control-regex
  return valor.replace(/[\u0000- ]/g, "").toLowerCase().startsWith("javascript:");
}

/*
  Quita de `documento` todo lo que pueda ejecutar código y devuelve cuántos
  nodos y atributos retiró (para los tests y para la consola). Recibe un
  Document, o algo con el mismo querySelectorAll/remove/attributes.
*/
function sanearDocumento(documento) {
  let retirados = 0;
  if (!documento || typeof documento.querySelectorAll !== "function") return retirados;

  documento.querySelectorAll(SELECTOR_DE_NODOS_PELIGROSOS).forEach((nodo) => {
    nodo.remove();
    retirados += 1;
  });

  // <link>: sólo las hojas de estilo de Google Fonts. El resto (preload,
  // import, icon, prefetch...) no hace falta para pintar el deck.
  documento.querySelectorAll("link").forEach((nodo) => {
    const rel = String(nodo.getAttribute("rel") || "").toLowerCase();
    const href = String(nodo.getAttribute("href") || "");
    const permitido = rel === "stylesheet" && href.startsWith(PREFIJO_DE_HOJAS_PERMITIDAS);
    if (permitido) return;
    nodo.remove();
    retirados += 1;
  });

  documento.querySelectorAll("*").forEach((nodo) => {
    Array.from(nodo.attributes || []).forEach((atributo) => {
      const nombre = String(atributo.name || "").toLowerCase();
      const peligroso = nombre.startsWith("on")
        || nombre === "srcdoc"
        || esUrlDeScript(atributo.value);
      if (!peligroso) return;
      nodo.removeAttribute(atributo.name);
      retirados += 1;
    });

    // Un enlace que abre otra pestaña no debe poder tocar ésta.
    if (nodo.getAttribute && nodo.getAttribute("target") === "_blank") {
      nodo.setAttribute("rel", "noopener noreferrer");
    }
  });

  return retirados;
}

/*
  Parsea el HTML de un deck con el `parser` dado (un DOMParser), lo sanea y lo
  separa en lo que la página puente necesita: los <style> y <link> de Google
  Fonts del <head>, los hijos del <body> y las clases del <body>.
*/
function prepararDeck(texto, parser) {
  const documento = parser.parseFromString(String(texto), "text/html");
  const retirados = sanearDocumento(documento);
  const cabeza = documento.head ? Array.from(documento.head.querySelectorAll("style, link")) : [];
  const cuerpo = documento.body ? Array.from(documento.body.childNodes) : [];
  return {
    titulo: String(documento.title || "").trim(),
    estilos: cabeza,
    // <style> sueltos dentro del <body> también cuentan: se ven igual.
    cuerpo,
    clasesDelCuerpo: documento.body ? String(documento.body.className || "") : "",
    laminas: documento.querySelectorAll("section.slide").length,
    retirados,
  };
}

/*
  ¿El deck trae programa propio? Sí si tiene algún <script> o algún atributo
  on* (onclick, onload...). `documento` es el Document ya parseado y SIN sanear
  (DOMParser no ejecuta nada). Si lo trae, el puente no lo monta en su propia
  página: lo corre en el marco aislado (ver _aislado/); si no, sigue el camino
  de siempre, saneado y montado aquí.
*/
function deckTraePrograma(documento) {
  if (!documento || typeof documento.querySelectorAll !== "function") return false;
  if (documento.querySelectorAll("script").length > 0) return true;
  return Array.from(documento.querySelectorAll("*")).some((nodo) =>
    Array.from(nodo.attributes || []).some((atributo) => String(atributo.name || "").toLowerCase().startsWith("on")));
}

/*
  Valida un mensaje "slides:estado" del marco aislado y lo devuelve ya limpio,
  o null si no tiene la forma esperada. El marco es de origen opaco y su
  código es ajeno: nada de lo que mande se usa sin comprobar el tipo.
*/
function leerEstadoAislado(datos) {
  if (!datos || datos.tipo !== "slides:estado") return null;
  const { indice, total } = datos;
  if (!Number.isInteger(indice) || !Number.isInteger(total)) return null;
  if (total < 0 || total > 10000 || indice < 0 || (total > 0 && indice >= total)) return null;
  return { indice, total, controlesPropios: datos.controlesPropios === true };
}

/* El slug del hash (#<slug>), o "" si no tiene la forma de un slug. */
function slugDelHash(hash) {
  const crudo = typeof hash === "string" ? hash.trim().replace(/^#/, "").toLowerCase() : "";
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(crudo) ? crudo : "";
}

/* ------------------------------------------------------------------ */
/* Navegación                                                          */
/* ------------------------------------------------------------------ */

function acotar(indice, total) {
  if (!Number.isFinite(indice) || total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.trunc(indice)));
}

/*
  El controlador de láminas: lo que antes hacía el deck.js de cada deck. Marca
  cada `section.slide` con is-active / is-before / is-after (es lo que el CSS
  de los decks como el de QR espera para animar la entrada y la salida), y
  avisa cada cambio a `alCambiar(indice, total)`.

  `laminas` son los nodos; sólo se les pide classList, setAttribute y
  removeAttribute, así que se prueba con nodos de mentira.
*/
function crearNavegacion(laminas, alCambiar) {
  const lista = Array.from(laminas || []);
  const total = lista.length;
  let actual = 0;

  function mostrar(propuesto) {
    if (total === 0) return;
    const n = acotar(propuesto, total);
    actual = n;
    lista.forEach((lamina, i) => {
      lamina.classList.toggle("is-active", i === n);
      lamina.classList.toggle("is-before", i < n);
      lamina.classList.toggle("is-after", i > n);
      lamina.setAttribute("aria-hidden", i === n ? "false" : "true");
      // `inert` saca de la tabulación y del lector de pantalla lo que no se ve.
      if (i === n) lamina.removeAttribute("inert");
      else lamina.setAttribute("inert", "");
    });
    if (typeof alCambiar === "function") alCambiar(n, total);
  }

  return {
    total,
    indice: () => actual,
    ir: mostrar,
  };
}

/*
  Cuánto achicar una lámina para que entre entera en el marco, sin barra de
  scroll. Un deck subido se diseña para la ventana completa; en el visor (o en
  una ventana angosta, donde el deck apila su contenido) puede no caber. Se
  aplica como `zoom` sobre la lámina, que reacomoda el layout y no sólo lo
  pinta más chico como haría un transform.

  `visible` y `contenido` son el clientHeight y el scrollHeight medidos SIN
  zoom. Devuelve 1 si ya cabe (con un píxel de tolerancia para las fracciones)
  y nunca menos de ESCALA_MINIMA: más chico ya no se lee, y ahí es mejor que
  la lámina scrollee.

  Al achicar se apunta HOLGURA_DE_AJUSTE píxeles por debajo del alto visible:
  el zoom redondea el layout, y con la escala exacta a veces sobraba un píxel
  y aparecía la barra de scroll.
*/
const ESCALA_MINIMA = 0.5;
const HOLGURA_DE_AJUSTE = 2;

function escalaParaCaber(visible, contenido) {
  if (!(visible > 0) || !(contenido > 0) || contenido <= visible + 1) return 1;
  const objetivo = Math.max(visible - HOLGURA_DE_AJUSTE, 1);
  return Math.max(ESCALA_MINIMA, Math.floor((objetivo / contenido) * 1000) / 1000);
}

/* Si con la escala ya aplicada todavía sobra contenido, el siguiente intento:
   un punto porcentual menos, sin bajar del mínimo. null si ya no se puede. */
function siguienteEscala(escala) {
  const menor = Math.round((escala - 0.01) * 1000) / 1000;
  return menor >= ESCALA_MINIMA ? menor : null;
}

/* Qué hace una tecla sobre el deck. Las mismas de los decks originales (las
   flechas arriba/abajo también) menos F: pantalla completa es del visor. */
const TECLAS_DE_DECK = Object.freeze({
  ArrowRight: "siguiente",
  ArrowDown: "siguiente",
  PageDown: "siguiente",
  " ": "siguiente",
  ArrowLeft: "anterior",
  ArrowUp: "anterior",
  PageUp: "anterior",
  Home: "primera",
  End: "ultima",
});

function accionDeTeclaDeDeck(evento) {
  if (!evento || evento.altKey || evento.ctrlKey || evento.metaKey) return null;
  return TECLAS_DE_DECK[evento.key] || null;
}

/*
  Conecta los botones que el propio deck trae, con los mismos ids y atributos
  que el de QR de sesión: #prev, #next, #fs y cualquier [data-go="n"] (los
  puntos Inicio/Cierre). Devuelve `controlesPropios`: true si el deck trae sus
  flechas (#prev y #next), y entonces el visor esconde las suyas.

  `raiz` es el documento de la página puente. `alPantallaCompleta` es lo que
  hace #fs: pedirle el marco al visor.
*/
function conectarControlesDelDeck(raiz, navegacion, alPantallaCompleta) {
  const anterior = raiz.getElementById("prev");
  const siguiente = raiz.getElementById("next");
  const pantalla = raiz.getElementById("fs");
  const destinos = Array.from(raiz.querySelectorAll("[data-go]"));

  if (anterior) anterior.addEventListener("click", () => navegacion.ir(navegacion.indice() - 1));
  if (siguiente) siguiente.addEventListener("click", () => navegacion.ir(navegacion.indice() + 1));
  destinos.forEach((destino) => {
    destino.addEventListener("click", () => navegacion.ir(Number(destino.getAttribute("data-go"))));
  });
  if (pantalla && typeof alPantallaCompleta === "function") {
    pantalla.addEventListener("click", alPantallaCompleta);
  }

  return {
    controlesPropios: Boolean(anterior && siguiente),
    // Refleja el índice en los botones: flechas deshabilitadas en los
    // extremos y aria-current en el punto de la lámina actual.
    reflejar(indice, total) {
      if (anterior) anterior.disabled = indice <= 0;
      if (siguiente) siguiente.disabled = indice >= total - 1;
      destinos.forEach((destino) => {
        const esActual = Number(destino.getAttribute("data-go")) === indice;
        destino.setAttribute("aria-current", esActual ? "true" : "false");
      });
    },
  };
}

/*
  Los controles se esconden solos tras unos segundos sin movimiento
  (`body.is-idle`, que el CSS del deck sabe aprovechar) y reaparecen con
  cualquier señal de vida. `programar` y `cancelar` se inyectan (setTimeout y
  clearTimeout) para probarlo sin esperar.
*/
function crearInactividad(cuerpo, { espera = 3000, programar, cancelar } = {}) {
  let temporizador = null;

  function despertar() {
    cuerpo.classList.remove("is-idle");
    if (temporizador !== null) cancelar(temporizador);
    temporizador = programar(() => cuerpo.classList.add("is-idle"), espera);
  }

  return { despertar };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    SELECTOR_DE_NODOS_PELIGROSOS,
    EVENTO_DE_CAMBIO,
    sanearDocumento,
    prepararDeck,
    deckTraePrograma,
    leerEstadoAislado,
    slugDelHash,
    crearNavegacion,
    ESCALA_MINIMA,
    HOLGURA_DE_AJUSTE,
    escalaParaCaber,
    siguienteEscala,
    accionDeTeclaDeDeck,
    conectarControlesDelDeck,
    crearInactividad,
  });
}
