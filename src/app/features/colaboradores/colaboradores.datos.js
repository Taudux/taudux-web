/*
  Lógica pura del roster de colaboradores. Sin DOM: este archivo se carga igual
  en la página y en los tests de Node.

  Acá NO hay personas. La lista sale de la base con listarColaboradores()
  (core/colaboradores/colaboradores.service.js), que entrega nombre, corto y
  slug de cada una. Las fichas de muestra del prototipo viven en
  tests/fixtures/colaboradores.muestra.js y sólo las usan los tests.

  La ficha de perfil (rol, clase, bio, atributos…) todavía no existe: llega
  con "Mi ficha". Hasta entonces una persona puede estar en el roster sin
  tener perfil que abrir; tienePerfil() es quien lo decide.

  Campos opcionales de contacto: `linkedin`, `github` (URL https) y `correo`.
  Los que falten no se pintan; ver enlacesDisponibles().
*/

const ETIQUETAS_ATRIBUTOS = ["DATOS", "SOFTWARE", "IA", "NUBE", "DOCENCIA"];
const DISPONIBILIDADES = ["Disponible", "Parcial"];

// La grilla del roster tiene cuatro columnas en todos los anchos; las flechas
// arriba/abajo saltan de a una fila, o sea de a COLUMNAS_ROSTER fichas.
const COLUMNAS_ROSTER = 4;

// Todo lo que la vista de perfil escribe como texto: si falta uno, quedaría un
// hueco en blanco en la ficha técnica.
const CAMPOS_DE_TEXTO_DEL_PERFIL = ["nombre", "corto", "rol", "clase", "bio", "ciudad", "anios", "esp", "stack", "disp"];

/*
  ¿Tiene esta persona la ficha de perfil COMPLETA? Todo o nada: la vista de
  perfil pinta cada campo, así que una ficha a medias no se abre. Cada barra
  tiene tantos segmentos como atributos hay, y el valor va de 1 a ese total.
*/
function tienePerfil(persona) {
  if (!persona || typeof persona !== "object") return false;

  const textosCompletos = CAMPOS_DE_TEXTO_DEL_PERFIL.every(
    (campo) => typeof persona[campo] === "string" && persona[campo].trim() !== "",
  );
  const { stats } = persona;
  const atributosCompletos = Array.isArray(stats)
    && stats.length === ETIQUETAS_ATRIBUTOS.length
    && stats.every((valor) => Number.isInteger(valor) && valor >= 1 && valor <= ETIQUETAS_ATRIBUTOS.length);

  return textosCompletos
    && atributosCompletos
    && DISPONIBILIDADES.includes(persona.disp)
    && Number.isInteger(persona.proyectos)
    && persona.proyectos >= 0;
}

/*
  El perfil vive en el hash (#/valeria) para que el botón atrás del navegador
  vuelva al roster. El slug es el de la base, tal cual: el front no lo deriva
  del nombre, así un cambio de nombre no rompe los enlaces compartidos.
*/
function indicePorSlug(lista, slug) {
  const buscado = String(slug || "").trim().toLowerCase();
  if (!buscado || !Array.isArray(lista)) return -1;
  return lista.findIndex((persona) => persona?.slug === buscado);
}

/*
  Flechas sobre la grilla. No da la vuelta: en el borde se queda donde está, que
  es lo que espera quien navega una grilla con el teclado. Con la última fila
  incompleta, bajar desde una columna sin ficha debajo tampoco se mueve.
*/
function moverSeleccion(indice, tecla, total, columnas = COLUMNAS_ROSTER) {
  const desplazamientos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columnas, ArrowDown: columnas };
  if (!(tecla in desplazamientos)) return indice;

  // Cualquier índice que no apunte a una ficha cuenta como "sin selección", no
  // sólo null. indicePorSlug() devuelve -1 para un hash desconocido, y ese -1
  // pasado tal cual se quedaba clavado con ↑/← y saltaba a la ficha 3 con ↓.
  const apuntaAUnaFicha = Number.isInteger(indice) && indice >= 0 && indice < total;
  if (!apuntaAUnaFicha) return total > 0 ? 0 : indice;

  const destino = indice + desplazamientos[tecla];
  if (destino < 0 || destino >= total) return indice;

  // Izquierda/derecha no cruzan de fila: del final de una no se pasa al
  // principio de la siguiente, igual que arriba/abajo no cambian de columna.
  const mismaFila = Math.floor(destino / columnas) === Math.floor(indice / columnas);
  if ((tecla === "ArrowLeft" || tecla === "ArrowRight") && !mismaFila) return indice;

  return destino;
}

// "Suele trabajar con": la ficha siguiente, dando la vuelta al final.
function colegaSugerido(indice, total) {
  if (total < 2) return null;
  return (indice + 1) % total;
}

function numeroDeFicha(indice) {
  return String(indice + 1).padStart(2, "0");
}

function etiquetaDeAtributo(valor) {
  return `${valor}/${ETIQUETAS_ATRIBUTOS.length}`;
}

/*
  En el prototipo todos los enlaces eran "#". Un enlace muerto es peor que
  ninguno, así que sólo se ofrecen los que tienen destino real, en orden fijo.
  Sólo https y direcciones de correo: lo que venga en los datos termina en un
  href, y un `javascript:` ahí sería una puerta abierta.
*/
function enlacesDisponibles(ficha) {
  const enlaces = [];
  const urlSegura = (valor) => {
    const texto = String(valor || "").trim();
    return /^https:\/\/[^\s]+$/i.test(texto) ? texto : null;
  };

  const linkedin = urlSegura(ficha?.linkedin);
  if (linkedin) enlaces.push({ tipo: "linkedin", texto: "LinkedIn", href: linkedin });

  const github = urlSegura(ficha?.github);
  if (github) enlaces.push({ tipo: "github", texto: "GitHub", href: github });

  // Lista blanca de caracteres de una dirección, no "cualquier cosa con una
  // arroba": un mailto acepta cabeceras tras el `?`, y `a@b.com?bcc=otro%40x.com`
  // pondría a un tercero en copia oculta cuando el visitante haga clic.
  const correo = String(ficha?.correo || "").trim();
  if (/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(correo)) {
    enlaces.push({ tipo: "correo", texto: "Correo", href: `mailto:${correo}` });
  }

  return enlaces;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ETIQUETAS_ATRIBUTOS,
    COLUMNAS_ROSTER,
    DISPONIBILIDADES,
    tienePerfil,
    indicePorSlug,
    moverSeleccion,
    colegaSugerido,
    numeroDeFicha,
    etiquetaDeAtributo,
    enlacesDisponibles,
  };
}
