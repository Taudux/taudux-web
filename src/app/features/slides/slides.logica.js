/*
  Lógica pura del visor de Slides. No toca el DOM, no hace red y no depende de
  Supabase: recibe datos ya cargados (el catálogo, una tecla, un índice) y
  responde preguntas sobre ellos. Por eso vive separada de slides.js, que es
  quien pinta, y de slides.service.js (core), que es quien habla con la red.

  También la requieren los tests de Node, de ahí el module.exports del final.
*/

function esTextoUtil(valor) {
  return typeof valor === "string" && valor.trim().length > 0;
}

function textoNormalizado(valor) {
  return esTextoUtil(valor) ? valor.trim() : "";
}

/* ------------------------------------------------------------------ */
/* Índice de la diapositiva actual                                    */
/* ------------------------------------------------------------------ */

/*
  Acota un índice al rango [0, total - 1]. Un catálogo sin diapositivas no
  tiene índice válido y se resuelve a 0 en vez de a -1: el visor siempre tiene
  algo que intentar mostrar, aunque sea un mensaje de "no hay diapositivas".
*/
function indiceAcotado(indice, total) {
  if (!Number.isFinite(indice) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.trunc(indice)));
}

/* ------------------------------------------------------------------ */
/* Teclado                                                             */
/* ------------------------------------------------------------------ */

/*
  Escribir en un campo nunca debe cambiar de diapositiva ni disparar pantalla
  completa: buscar "F" en un campo de texto del visor (si algún día lo hay) no
  puede activar el atajo. Los tres elementos de formulario y cualquier nodo
  contenteditable cuentan como "está escribiendo".
*/
const ELEMENTOS_DE_ESCRITURA = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function estaEscribiendoEnCampo(elemento) {
  if (!elemento || typeof elemento !== "object") return false;
  if (ELEMENTOS_DE_ESCRITURA.has(elemento.tagName)) return true;
  return Boolean(elemento.isContentEditable);
}

/*
  Mismo repertorio que llevaba deck.js (flechas, PageUp/Down, Home/End y
  espacio) más F/f para pantalla completa, que el mazo original no tenía
  porque vivía suelto, sin marco que maximizar.
*/
const MAPA_DE_TECLAS = Object.freeze({
  ArrowRight: "siguiente",
  PageDown: "siguiente",
  " ": "siguiente",
  ArrowLeft: "anterior",
  PageUp: "anterior",
  Home: "primera",
  End: "ultima",
  f: "pantalla-completa",
  F: "pantalla-completa",
});

/*
  La acción que corresponde a una tecla, o null si no hay ninguna o si el
  foco está en un campo de escritura. `elementoObjetivo` es el `target` (o
  `activeElement`) del evento; se pasa aparte para no acoplar esta función a
  KeyboardEvent y poder probarla con objetos simples.
*/
function accionParaTecla(key, elementoObjetivo) {
  if (estaEscribiendoEnCampo(elementoObjetivo)) return null;
  return MAPA_DE_TECLAS[key] || null;
}

/* ------------------------------------------------------------------ */
/* Manifiestos                                                         */
/* ------------------------------------------------------------------ */

/* El slug viaja en el hash (#/<slug>) y es el nombre de una carpeta bajo
   /content/slides: kebab-case estricto (minúsculas, dígitos y guiones
   simples, sin guion al principio, al final o duplicado) evita depender de
   encodeURIComponent para que exista y descarta nombres de carpeta raros. */
const PATRON_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/*
  Normaliza y valida el ÍNDICE (manifiesto.json de la raíz): un arreglo de
  slugs, uno por carpeta de presentación, sin repetidos. Es lo primero que se
  descarga y lo único que le hace falta al catálogo para saber qué carpetas
  visitar — el contenido de cada una lo valida normalizarPresentacion.

  Igual que normalizarPresentacion, junta todos los problemas en vez de
  cortar en el primero y dice cuáles slugs están duplicados, no sólo que hay
  un duplicado.
*/
function normalizarIndice(valor) {
  const errores = [];

  if (!Array.isArray(valor)) {
    errores.push("el índice debe ser un arreglo");
    return { ok: false, errores, indice: [] };
  }

  const vistos = new Set();
  const duplicados = new Set();
  const indice = [];

  valor.forEach((item, posicion) => {
    if (typeof item !== "string" || !esTextoUtil(item)) {
      errores.push(`la entrada #${posicion + 1} del índice no es un texto`);
      return;
    }

    const slug = item.trim();
    if (!PATRON_SLUG.test(slug)) {
      errores.push(`"${slug}" no es un slug kebab-case válido`);
      return;
    }

    if (vistos.has(slug)) duplicados.add(slug);
    else {
      vistos.add(slug);
      indice.push(slug);
    }
  });

  duplicados.forEach((slug) => errores.push(`"${slug}" está duplicado en el índice`));

  return { ok: errores.length === 0, errores, indice };
}

/*
  Normaliza y valida el manifiesto de UNA carpeta de presentación. A
  diferencia del formato anterior (una presentación por diapositiva HTML),
  cada carpeta es un solo deck autocontenido: `archivo` es la página que el
  visor carga en el <iframe>, así que tiene que quedarse adentro de su propia
  carpeta — nada de rutas absolutas, "..", ni otro protocolo.

  `slug` llega aparte porque es el nombre de la carpeta (lo sabe el índice),
  no un campo que el manifiesto declare sobre sí mismo.

  Devuelve la lista completa de problemas en vez de cortar en el primero,
  mismo criterio que validarManifiestoDeNotas: quien edite el manifiesto y
  rompa varias cosas a la vez las ve todas juntas. `presentacion` sale
  siempre con la forma esperada, aunque `ok` sea falso.
*/
function normalizarPresentacion(slug, manifiesto) {
  const errores = [];
  const objeto = manifiesto && typeof manifiesto === "object" ? manifiesto : {};

  const slugNormalizado = textoNormalizado(slug);
  if (!slugNormalizado) {
    errores.push("falta slug");
  } else if (!PATRON_SLUG.test(slugNormalizado)) {
    errores.push(`el slug "${slugNormalizado}" solo admite minúsculas, dígitos y guiones simples`);
  }

  const titulo = textoNormalizado(objeto.titulo);
  if (!titulo) errores.push("falta título");

  let descripcion = "";
  if (objeto.descripcion !== undefined) {
    if (typeof objeto.descripcion !== "string") errores.push("la descripción debe ser texto");
    else descripcion = objeto.descripcion.trim();
  }

  const archivo = textoNormalizado(objeto.archivo);
  if (!archivo) {
    errores.push("falta archivo");
  } else {
    if (archivo.startsWith("/")) {
      errores.push('"archivo" no puede empezar con "/": debe ser relativo a la carpeta de la presentación');
    }
    if (archivo.includes("..")) {
      errores.push('"archivo" no puede contener "..": debe quedarse dentro de su propia carpeta');
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(archivo)) {
      errores.push('"archivo" no puede llevar protocolo: debe ser una ruta relativa');
    }
    if (!archivo.toLowerCase().endsWith(".html")) {
      errores.push('"archivo" debe terminar en .html');
    }
  }

  return {
    ok: errores.length === 0,
    errores,
    presentacion: { slug: slugNormalizado, titulo, descripcion, archivo },
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    indiceAcotado,
    estaEscribiendoEnCampo,
    accionParaTecla,
    normalizarIndice,
    normalizarPresentacion,
    MAPA_DE_TECLAS,
  });
}
