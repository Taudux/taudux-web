/*
  Lógica pura del roster de colaboradores. Sin DOM: este archivo se carga igual
  en la página y en los tests de Node.

  Acá NO hay personas. La lista sale de la base con listarColaboradores()
  (core/colaboradores/colaboradores.service.js), que entrega de cada una
  nombre, corto y slug, más los campos de su ficha (migración 0039) con los
  nombres de la base: rol, especialidad, ubicacion, stack (arreglo de textos),
  disponibilidad, anio_inicio (un año entero), bio, linkedin, github y correo.
  Las fichas de muestra del prototipo viven en
  tests/fixtures/colaboradores.muestra.js y sólo las usan los tests.

  Quien todavía no llenó su ficha trae esos campos en null: está en el roster
  pero no tiene perfil que abrir. tienePerfil() es quien lo decide.

  Campos opcionales de contacto: `linkedin`, `github` (URL https a ese sitio)
  y `correo`. Los que falten no se pintan; ver enlacesDisponibles().
*/

// Los mismos valores, en el mismo orden, que el CHECK
// `fichas_colaborador_disponibilidad_valida` de la 0039. Un test compara las
// dos listas.
const DISPONIBILIDADES = Object.freeze(["Disponible", "Parcial", "No disponible"]);

// La grilla del roster tiene cuatro columnas en todos los anchos; en
// moverSeleccion, arriba/abajo saltan de a una fila, o sea de a
// COLUMNAS_ROSTER fichas.
const COLUMNAS_ROSTER = 4;

// Todo lo que la vista de perfil escribe tal cual como texto: si falta uno,
// quedaría un hueco en blanco en la ficha técnica.
const CAMPOS_DE_TEXTO_DEL_PERFIL = ["nombre", "corto", "rol", "especialidad", "ubicacion", "bio"];

function esTextoConContenido(valor) {
  return typeof valor === "string" && valor.trim() !== "";
}

/*
  ¿Tiene esta persona la ficha de perfil COMPLETA? Todo o nada: la vista de
  perfil pinta cada campo, así que una ficha a medias no se abre.

  La base ya garantiza que una ficha guardada está completa (todo `not null`
  en la 0039), pero acá no se da por hecho: si mañana una columna se vuelve
  opcional, esa persona se queda sin perfil en vez de romper el pintado.
*/
function tienePerfil(persona) {
  if (!persona || typeof persona !== "object") return false;

  const textosCompletos = CAMPOS_DE_TEXTO_DEL_PERFIL.every((campo) => esTextoConContenido(persona[campo]));
  const stackCompleto = Array.isArray(persona.stack)
    && persona.stack.length > 0
    && persona.stack.every(esTextoConContenido);

  return textosCompletos
    && stackCompleto
    && DISPONIBILIDADES.includes(persona.disponibilidad)
    && Number.isInteger(persona.anio_inicio);
}

/*
  La base guarda el año de inicio y no un texto como "8 años", que envejecería
  solo. El año en curso entra como argumento para que esto sea puro: la página
  le pasa el del reloj y los tests, uno fijo. Un año de inicio en el futuro no
  da una experiencia negativa.
*/
function experienciaDesde(anioInicio, anioActual) {
  const anios = anioActual - anioInicio;
  if (anios <= 0) return "Menos de un año";
  if (anios === 1) return "1 año";
  return `${anios} años`;
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
  OJO: es lógica pura, todavía SIN conectar. colaboradores.js no escucha
  keydown; la navegación con flechas quedó para después.
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

function numeroDeFicha(indice) {
  return String(indice + 1).padStart(2, "0");
}

/*
  Las mismas expresiones que los CHECK `fichas_colaborador_linkedin_valido` y
  `fichas_colaborador_github_valido` de la 0039 (allá `[^[:space:]]`, acá
  `[^\s]`). La píldora dice "LinkedIn" o "GitHub": el destino tiene que ser ese
  sitio, y no `linkedin.com.otro-sitio.com` ni `otro-sitio.com/linkedin.com`.
  Sin la bandera `i`, igual que el `~` de la base: una ficha guardada siempre
  pasa, y lo que la base rechazaría el front tampoco lo pinta.
*/
const PATRONES_DE_ENLACE = Object.freeze({
  linkedin: /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/[^\s]+$/,
  github: /^https:\/\/(www\.)?github\.com\/[^\s]+$/,
});

/*
  En el prototipo todos los enlaces eran "#". Un enlace muerto es peor que
  ninguno, así que sólo se ofrecen los que tienen destino real, en orden fijo.
  Sólo https al sitio que nombra la píldora y direcciones de correo: lo que
  venga en los datos termina en un href, y un `javascript:` ahí sería una
  puerta abierta.
*/
function enlacesDisponibles(ficha) {
  const enlaces = [];
  const urlDe = (tipo) => {
    const texto = String(ficha?.[tipo] || "").trim();
    return PATRONES_DE_ENLACE[tipo].test(texto) ? texto : null;
  };

  const linkedin = urlDe("linkedin");
  if (linkedin) enlaces.push({ tipo: "linkedin", texto: "LinkedIn", href: linkedin });

  const github = urlDe("github");
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
    COLUMNAS_ROSTER,
    DISPONIBILIDADES,
    tienePerfil,
    experienciaDesde,
    indicePorSlug,
    moverSeleccion,
    numeroDeFicha,
    enlacesDisponibles,
  };
}
