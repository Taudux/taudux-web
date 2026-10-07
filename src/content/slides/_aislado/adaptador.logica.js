/*
  Lógica pura del adaptador del marco aislado (ver adaptador.js). Sin DOM
  real: recibe nodos o un documento y responde, para poder probarse en Node
  con nodos de mentira. Termina en un module.exports condicional, como
  subida.logica.js.

  Un deck subido con JavaScript trae su propia navegación y marca la lámina
  visible con una clase: `active` (los decks que se hicieron solos) o
  `is-active` (los de QR). El adaptador no impone la suya: lee la del deck.
*/

const CLASES_DE_ACTIVA = ["active", "is-active"];

/* Las láminas: `section.slide` si el deck las usa, si no cualquier `.slide`. */
function laminasDe(documento) {
  const secciones = Array.from(documento.querySelectorAll("section.slide"));
  if (secciones.length > 0) return secciones;
  return Array.from(documento.querySelectorAll(".slide"));
}

function estaActiva(lamina) {
  return CLASES_DE_ACTIVA.some((clase) => lamina.classList.contains(clase));
}

/* Índice de la lámina activa; 0 si ninguna lo está todavía. */
function indiceActivo(laminas) {
  const indice = laminas.findIndex(estaActiva);
  return indice < 0 ? 0 : indice;
}

/* Si el deck trae sus propias flechas (#prev y #next), el visor esconde las suyas. */
function tieneControlesPropios(documento) {
  return Boolean(documento.getElementById("prev") && documento.getElementById("next"));
}

/* Lo que se le informa al puente. */
function estadoDe(documento) {
  const laminas = laminasDe(documento);
  return {
    tipo: "slides:estado",
    indice: indiceActivo(laminas),
    total: laminas.length,
    controlesPropios: tieneControlesPropios(documento),
  };
}

/* Cuántos clics se toleran al ir a una lámina lejana: una lámina con pasos
   internos (un árbol) gasta varios antes de cambiar. */
const PASOS_POR_LAMINA = 40;

function limiteDePasos(total) {
  return Math.max(1, total) * PASOS_POR_LAMINA;
}

/* Qué botón pulsar para acercarse a `destino`: "siguiente", "anterior" o null. */
function pasoHacia(actual, destino) {
  if (!Number.isFinite(destino)) return null;
  if (destino > actual) return "siguiente";
  if (destino < actual) return "anterior";
  return null;
}

/* Último recurso, si el deck no trae #prev/#next: marcar la lámina a mano. */
function marcarActiva(laminas, destino) {
  laminas.forEach((lamina, i) => {
    CLASES_DE_ACTIVA.forEach((clase) => {
      if (lamina.classList.contains(clase) || i === destino) {
        lamina.classList.toggle(clase, i === destino);
      }
    });
  });
}

/* La orden { tipo, ... } que el puente le manda al marco, o null si no es válida. */
function ordenDelPuente(datos) {
  if (!datos || typeof datos.tipo !== "string") return null;
  if (datos.tipo === "slides:siguiente" || datos.tipo === "slides:anterior" || datos.tipo === "slides:consulta") {
    return { tipo: datos.tipo };
  }
  if (datos.tipo === "slides:ir" && Number.isFinite(datos.indice)) {
    return { tipo: "slides:ir", indice: Math.trunc(datos.indice) };
  }
  return null;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    laminasDe,
    estaActiva,
    indiceActivo,
    tieneControlesPropios,
    estadoDe,
    limiteDePasos,
    pasoHacia,
    marcarActiva,
    ordenDelPuente,
  });
}
