/*
  Núcleo puro de "Mi ficha": normalización y validación del formulario con el
  que cada colaborador edita su ficha pública. Sin DOM y sin fetch: este
  archivo se carga igual en la página y en los tests de Node.

  Las reglas son las de los CHECK de `fichas_colaborador` (migración 0039). Lo
  que este módulo deja pasar, la base lo acepta; lo que la base rechazaría, el
  formulario lo avisa campo por campo antes de enviarlo. Los límites, las
  expresiones de los enlaces y las disponibilidades se comparan contra el SQL
  en tests/mi-ficha.logica.test.js: una copia sin vigilancia se desfasa sola.

  El cableado (leer inputs, pintar errores, llamar al servicio) vive en
  mi-ficha.js. Los nombres globales llevan "MiFicha": la página carga otros
  scripts clásicos en el mismo ámbito y un `const` repetido la rompería.
*/

// Las columnas que el dueño escribe, en el orden de la tabla y de
// ficha.service.js (su COLUMNAS_MI_FICHA; un test compara las dos). Es también
// el orden del formulario: el primer error es el primer campo en pantalla.
const CAMPOS_MI_FICHA = Object.freeze([
  "rol",
  "especialidad",
  "ubicacion",
  "stack",
  "disponibilidad",
  "anio_inicio",
  "bio",
  "linkedin",
  "github",
  "correo",
]);

// Los mismos valores, en el mismo orden, que el CHECK
// `fichas_colaborador_disponibilidad_valida` y que DISPONIBILIDADES de
// colaboradores.datos.js. Copia a propósito: cargar la lógica del roster en
// esta página sólo para tres textos traería de paso todas sus globales.
const DISPONIBILIDADES_MI_FICHA = Object.freeze(["Disponible", "Parcial", "No disponible"]);

// Largos en caracteres (puntos de código, como `char_length`), cantidad de
// elementos del stack y rango de años que admite la base.
const LIMITES_MI_FICHA = Object.freeze({
  rol: Object.freeze({ min: 2, max: 60 }),
  especialidad: Object.freeze({ min: 2, max: 80 }),
  ubicacion: Object.freeze({ min: 2, max: 80 }),
  bio: Object.freeze({ min: 10, max: 600 }),
  stack: Object.freeze({ min: 1, max: 12 }),
  tecnologia: Object.freeze({ min: 1, max: 40 }),
  anio_inicio: Object.freeze({ min: 1950, max: 2100 }),
  linkedin: 200,
  github: 200,
  correo: 254,
});

/*
  Las expresiones de los CHECK de enlaces de la 0039 (allá `[^[:space:]]`, acá
  `[^\s]`), las mismas que usa enlacesDisponibles() en la página pública. Sin
  la bandera `i`, igual que el `~` de la base.
*/
const PATRONES_ENLACE_MI_FICHA = Object.freeze({
  linkedin: /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/[^\s]+$/,
  github: /^https:\/\/(www\.)?github\.com\/[^\s]+$/,
  correo: /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
});

/*
  "Sin caracteres de control" son dos reglas, como en la base: `[[:cntrl:]]`
  cubre la categoría Cc de Unicode, y los de formato bidireccional (Cf) van
  aparte, porque con un U+202E el texto se vería al revés en la página pública.
*/
const CONTROL_MI_FICHA = /\p{Cc}/u;
const BIDI_MI_FICHA = /[‎‏‪-‮⁦-⁩]/u;

// El formato de `perfiles_slug_formato` (0038).
const PATRON_SLUG_MI_FICHA = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MENSAJES_MI_FICHA = Object.freeze({
  rol: Object.freeze({
    vacio: "Escribe tu rol.",
    largo: "El rol debe tener entre 2 y 60 caracteres.",
    caracteres: "El rol tiene caracteres no permitidos.",
  }),
  especialidad: Object.freeze({
    vacio: "Escribe tu especialidad.",
    largo: "La especialidad debe tener entre 2 y 80 caracteres.",
    caracteres: "La especialidad tiene caracteres no permitidos.",
  }),
  ubicacion: Object.freeze({
    vacio: "Escribe tu ubicación.",
    largo: "La ubicación debe tener entre 2 y 80 caracteres.",
    caracteres: "La ubicación tiene caracteres no permitidos.",
  }),
  bio: Object.freeze({
    vacio: "Escribe tu bio.",
    largo: "La bio debe tener entre 10 y 600 caracteres.",
    caracteres: "La bio tiene caracteres no permitidos. Sólo se admiten saltos de línea.",
  }),
  stack: Object.freeze({
    vacio: "Escribe al menos una tecnología.",
    muchas: "Escribe como máximo 12 tecnologías.",
    largo: "Cada tecnología puede tener hasta 40 caracteres.",
    caracteres: "Alguna tecnología tiene caracteres no permitidos.",
  }),
  disponibilidad: "Elige tu disponibilidad.",
  anio_inicio: Object.freeze({
    vacio: "Escribe el año en que empezaste.",
    formato: "Escribe el año con números, por ejemplo 2018.",
  }),
  linkedin: Object.freeze({
    formato: "Usa un enlace https de linkedin.com, por ejemplo https://www.linkedin.com/in/tu-usuario.",
    largo: "El enlace de LinkedIn puede tener hasta 200 caracteres.",
  }),
  github: Object.freeze({
    formato: "Usa un enlace https de github.com, por ejemplo https://github.com/tu-usuario.",
    largo: "El enlace de GitHub puede tener hasta 200 caracteres.",
  }),
  correo: Object.freeze({
    formato: "Escribe un correo válido, por ejemplo nombre@dominio.com.",
    largo: "El correo puede tener hasta 254 caracteres.",
  }),
});

function textoMiFicha(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

// Iterar un string recorre puntos de código: un emoji cuenta 1, como en
// `char_length`, y no las 2 unidades UTF-16 que da .length.
function largoMiFicha(texto) {
  return [...texto].length;
}

function tieneCaracteresProhibidosMiFicha(texto) {
  return CONTROL_MI_FICHA.test(texto) || BIDI_MI_FICHA.test(texto);
}

// El stack se escribe en un solo campo, separado por comas.
function separarStack(texto) {
  if (typeof texto !== "string") return [];
  return texto.split(",").map((elemento) => elemento.trim()).filter((elemento) => elemento !== "");
}

// Sólo dígitos: "2018.5", "2e3", "-2018" o "0x7E2" no son un año, aunque
// Number() los convierta.
function anioMiFicha(valor) {
  if (Number.isInteger(valor)) return valor;
  const texto = textoMiFicha(valor);
  return /^\d+$/.test(texto) ? Number(texto) : null;
}

function enlaceMiFicha(valor) {
  const texto = textoMiFicha(valor);
  return texto === "" ? null : texto;
}

/*
  De los valores del formulario (todo texto) a la ficha que se guarda: textos
  recortados, stack separado, año numérico y enlaces vacíos en null. Siempre
  las diez llaves, válida o no; decidir si sirve es cosa de validarMiFicha().

  El recorte de la bio también quita los saltos de línea de los bordes: la
  base exige `bio = btrim(bio, E' \n')`, y un salto al final no es un error
  que valga la pena mostrar.
*/
function normalizarMiFicha(valores) {
  const origen = valores && typeof valores === "object" ? valores : {};
  return {
    rol: textoMiFicha(origen.rol),
    especialidad: textoMiFicha(origen.especialidad),
    ubicacion: textoMiFicha(origen.ubicacion),
    stack: separarStack(origen.stack),
    disponibilidad: textoMiFicha(origen.disponibilidad),
    anio_inicio: anioMiFicha(origen.anio_inicio),
    bio: textoMiFicha(origen.bio),
    linkedin: enlaceMiFicha(origen.linkedin),
    github: enlaceMiFicha(origen.github),
    correo: enlaceMiFicha(origen.correo),
  };
}

// Un texto obligatorio ya recortado. La bio admite `\n` en medio: es el único
// carácter de control que la base le deja.
function errorDeTextoMiFicha(campo, texto, { conSaltos = false } = {}) {
  const mensajes = MENSAJES_MI_FICHA[campo];
  const { min, max } = LIMITES_MI_FICHA[campo];
  if (texto === "") return mensajes.vacio;
  const revisable = conSaltos ? texto.replace(/\n/g, "") : texto;
  if (tieneCaracteresProhibidosMiFicha(revisable)) return mensajes.caracteres;
  const largo = largoMiFicha(texto);
  if (largo < min || largo > max) return mensajes.largo;
  return null;
}

/*
  El veredicto de UNA tecnología: los dos motivos que la 0039 revisa elemento
  por elemento con stack_colaborador_valido(). No mira el mínimo de un
  carácter porque quien arma el stack ya descarta lo vacío antes de llegar
  acá; el editor de etiquetas avisa ese caso por su cuenta.
*/
function errorDeElementoStackMiFicha(tecnologia) {
  const mensajes = MENSAJES_MI_FICHA.stack;
  if (tieneCaracteresProhibidosMiFicha(tecnologia)) return mensajes.caracteres;
  if (largoMiFicha(tecnologia) > LIMITES_MI_FICHA.tecnologia.max) return mensajes.largo;
  return null;
}

/*
  El veredicto del stack entero. Primero la cantidad, y después los motivos
  por elemento en su orden de siempre: si en el mismo stack una tecnología
  trae caracteres prohibidos y otra se pasa de largo, gana el de caracteres.
  Por eso se recorren los doce y no se corta en el primero que falle.
*/
function errorDeStackMiFicha(stack) {
  const mensajes = MENSAJES_MI_FICHA.stack;
  if (stack.length < LIMITES_MI_FICHA.stack.min) return mensajes.vacio;
  if (stack.length > LIMITES_MI_FICHA.stack.max) return mensajes.muchas;
  const errores = stack.map(errorDeElementoStackMiFicha);
  if (errores.includes(mensajes.caracteres)) return mensajes.caracteres;
  if (errores.includes(mensajes.largo)) return mensajes.largo;
  return null;
}

// El tope es el año en curso, que entra como argumento para que esto sea puro:
// la página le pasa el del reloj y los tests, uno fijo. Nunca pasa del máximo
// de la base, que es fijo para que un respaldo restaurado siga siendo válido.
function errorDeAnioMiFicha(textoOriginal, anio, anioActual) {
  const mensajes = MENSAJES_MI_FICHA.anio_inicio;
  if (textoMiFicha(textoOriginal) === "" && !Number.isInteger(textoOriginal)) return mensajes.vacio;
  if (anio === null) return mensajes.formato;
  const min = LIMITES_MI_FICHA.anio_inicio.min;
  const max = Math.min(anioActual, LIMITES_MI_FICHA.anio_inicio.max);
  if (anio < min || anio > max) return `El año debe estar entre ${min} y ${max}.`;
  return null;
}

// Un enlace opcional ya normalizado: null es válido.
function errorDeEnlaceMiFicha(campo, valor) {
  if (valor === null) return null;
  const mensajes = MENSAJES_MI_FICHA[campo];
  if (!PATRONES_ENLACE_MI_FICHA[campo].test(valor)) return mensajes.formato;
  if (largoMiFicha(valor) > LIMITES_MI_FICHA[campo]) return mensajes.largo;
  return null;
}

/*
  Valida TODO de una vez: un mensaje por campo inválido, en el orden de la
  ficha, para que la página los muestre juntos y enfoque el primero.
  Devuelve { ok: true, ficha } con la ficha normalizada lista para guardar, o
  { ok: false, errores: [{ campo, mensaje }] }.
*/
function validarMiFicha(valores, anioActual) {
  const origen = valores && typeof valores === "object" ? valores : {};
  const ficha = normalizarMiFicha(origen);

  const errores = {
    rol: errorDeTextoMiFicha("rol", ficha.rol),
    especialidad: errorDeTextoMiFicha("especialidad", ficha.especialidad),
    ubicacion: errorDeTextoMiFicha("ubicacion", ficha.ubicacion),
    stack: errorDeStackMiFicha(ficha.stack),
    disponibilidad: DISPONIBILIDADES_MI_FICHA.includes(ficha.disponibilidad) ? null : MENSAJES_MI_FICHA.disponibilidad,
    anio_inicio: errorDeAnioMiFicha(origen.anio_inicio, ficha.anio_inicio, anioActual),
    bio: errorDeTextoMiFicha("bio", ficha.bio, { conSaltos: true }),
    linkedin: errorDeEnlaceMiFicha("linkedin", ficha.linkedin),
    github: errorDeEnlaceMiFicha("github", ficha.github),
    correo: errorDeEnlaceMiFicha("correo", ficha.correo),
  };

  const lista = CAMPOS_MI_FICHA
    .filter((campo) => errores[campo] !== null)
    .map((campo) => ({ campo, mensaje: errores[campo] }));

  return lista.length === 0 ? { ok: true, ficha } : { ok: false, errores: lista };
}

/*
  De la ficha guardada (o null, si todavía no hay) a los valores del
  formulario: el stack unido con ", " para su único campo, el año como texto y
  los enlaces ausentes como campo vacío.
*/
function valoresFormularioMiFicha(ficha) {
  const origen = ficha && typeof ficha === "object" ? ficha : {};
  const texto = (valor) => (typeof valor === "string" ? valor : "");
  return {
    rol: texto(origen.rol),
    especialidad: texto(origen.especialidad),
    ubicacion: texto(origen.ubicacion),
    stack: Array.isArray(origen.stack) ? origen.stack.join(", ") : "",
    disponibilidad: DISPONIBILIDADES_MI_FICHA.includes(origen.disponibilidad) ? origen.disponibilidad : "",
    anio_inicio: Number.isInteger(origen.anio_inicio) ? String(origen.anio_inicio) : "",
    bio: texto(origen.bio),
    linkedin: texto(origen.linkedin),
    github: texto(origen.github),
    correo: texto(origen.correo),
  };
}

// El nombre no se edita acá (vive en Mi cuenta): sólo se muestra.
function nombreVisibleMiFicha(perfil) {
  return [perfil?.nombre, perfil?.apellidos].map(textoMiFicha).filter(Boolean).join(" ");
}

// El perfil público vive en el hash del roster (#/<slug>). Un slug fuera del
// formato de la base no arma enlace: mejor ninguno que uno roto.
function rutaPerfilPublicoMiFicha(slug) {
  if (typeof slug !== "string" || !PATRON_SLUG_MI_FICHA.test(slug)) return null;
  return `/app/features/colaboradores/#/${slug}`;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    CAMPOS_MI_FICHA,
    DISPONIBILIDADES_MI_FICHA,
    LIMITES_MI_FICHA,
    PATRONES_ENLACE_MI_FICHA,
    separarStack,
    errorDeElementoStackMiFicha,
    normalizarMiFicha,
    validarMiFicha,
    valoresFormularioMiFicha,
    nombreVisibleMiFicha,
    rutaPerfilPublicoMiFicha,
  });
}
