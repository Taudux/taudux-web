/*
  Roster de colaboradores y la lógica pura que lo recorre. Sin DOM: este archivo
  se carga igual en la página y en los tests de Node.

  LAS DOCE FICHAS SON DE MUESTRA. Vienen del prototipo de diseño y son personas
  inventadas: nombres, ciudades, años de experiencia y proyectos no corresponden
  a nadie. Tienen que reemplazarse por el equipo real, con el visto bueno de
  cada persona, antes de que esta página llegue a producción.

  Una ficha lleva TODOS sus campos. El prototipo los traía en dos arreglos
  paralelos emparejados por índice; borrar o reordenar a alguien en uno solo
  desfasaba a los demás sin que nada fallara.

  Campos opcionales de contacto: `linkedin`, `github` (URL https) y `correo`.
  Los que falten no se pintan; ver enlacesDisponibles().
*/

const ETIQUETAS_ATRIBUTOS = ["DATOS", "SOFTWARE", "IA", "NUBE", "DOCENCIA"];
const DISPONIBILIDADES = ["Disponible", "Parcial"];

// La grilla del roster tiene cuatro columnas en todos los anchos; las flechas
// arriba/abajo saltan de a una fila, o sea de a COLUMNAS_ROSTER fichas.
const COLUMNAS_ROSTER = 4;

const COLABORADORES = [
  { nombre: "Valeria Ortiz", corto: "Valeria", rol: "Arquitectura de datos", clase: "ESTRATEGA", bio: "Diseña pipelines y modelos de datos que aguantan crecimiento. Convierte tablas desordenadas en decisiones.", stats: [5, 3, 4, 4, 3], ciudad: "Querétaro, MX", anios: "8 años", esp: "Data warehousing", stack: "PostgreSQL · Python · GCP", disp: "Disponible", proyectos: 24 },
  { nombre: "Diego Ramírez", corto: "Diego", rol: "Backend & APIs", clase: "TANQUE", bio: "Servicios estables bajo carga. Si el sistema no se cae, probablemente él lo construyó.", stats: [3, 5, 2, 5, 3], ciudad: "CDMX, MX", anios: "10 años", esp: "Sistemas distribuidos", stack: "Node.js · Docker · AWS", disp: "Disponible", proyectos: 31 },
  { nombre: "Mariana Cruz", corto: "Mariana", rol: "Frontend & UX", clase: "VELOCISTA", bio: "Interfaces rápidas que la gente entiende sin manual. Detalle obsesivo en animación y accesibilidad.", stats: [2, 4, 3, 2, 4], ciudad: "Guadalajara, MX", anios: "6 años", esp: "Design systems", stack: "HTML/CSS · JavaScript · Figma", disp: "Parcial", proyectos: 19 },
  { nombre: "Iván Torres", corto: "Iván", rol: "Modelos de IA", clase: "MAGO", bio: "Predicción de demanda, clasificación, LLMs aplicados. Traduce el negocio a features y las features a resultados.", stats: [4, 3, 5, 3, 4], ciudad: "Querétaro, MX", anios: "7 años", esp: "ML aplicado", stack: "Python · R · Vertex AI", disp: "Disponible", proyectos: 17 },
  { nombre: "Renata Solís", corto: "Renata", rol: "Cloud & DevOps", clase: "INGENIERA", bio: "Infraestructura como código, despliegues sin sustos y facturas de nube que sí cierran.", stats: [3, 4, 2, 5, 2], ciudad: "Monterrey, MX", anios: "9 años", esp: "IaC y observabilidad", stack: "Docker · Git · AWS", disp: "Disponible", proyectos: 28 },
  { nombre: "Emilio Vega", corto: "Emilio", rol: "Capacitación técnica", clase: "MENTOR", bio: "Cursos y talleres para equipos que quieren dejar de depender de terceros. Explica lo difícil sin simplificarlo de más.", stats: [4, 3, 3, 2, 5], ciudad: "Querétaro, MX", anios: "12 años", esp: "Formación técnica", stack: "Python · SQL · Docencia", disp: "Parcial", proyectos: 40 },
  { nombre: "Camila Ruiz", corto: "Camila", rol: "Analítica de negocio", clase: "ESTRATEGA", bio: "Tableros que responden preguntas, no que las generan. KPIs, forecasting y storytelling con datos.", stats: [5, 2, 3, 2, 4], ciudad: "Puebla, MX", anios: "6 años", esp: "BI y forecasting", stack: "Power BI · SQL · Python", disp: "Disponible", proyectos: 22 },
  { nombre: "Sebastián Lara", corto: "Sebastián", rol: "Apps móviles", clase: "VELOCISTA", bio: "Del prototipo a la tienda. Apps que se sienten nativas y hablan con el backend sin fricción.", stats: [2, 4, 3, 3, 3], ciudad: "CDMX, MX", anios: "5 años", esp: "Apps nativas", stack: "Java · C++ · APIs", disp: "Disponible", proyectos: 14 },
  { nombre: "Lucía Herrera", corto: "Lucía", rol: "QA & Automatización", clase: "GUARDIANA", bio: "Pruebas que atrapan el bug antes que el cliente. Pipelines de CI que no dejan pasar nada roto.", stats: [3, 4, 2, 3, 3], ciudad: "León, MX", anios: "7 años", esp: "Testing automatizado", stack: "Cypress · Jest · CI/CD", disp: "Disponible", proyectos: 26 },
  { nombre: "Andrés Molina", corto: "Andrés", rol: "Gestión de proyectos", clase: "CAPITÁN", bio: "Alcance claro, entregas a tiempo y cero sorpresas. Traduce entre negocio y equipo técnico.", stats: [3, 3, 2, 2, 4], ciudad: "Querétaro, MX", anios: "11 años", esp: "Delivery ágil", stack: "Scrum · Jira · Notion", disp: "Parcial", proyectos: 35 },
  { nombre: "Paola Núñez", corto: "Paola", rol: "Ciencia de datos", clase: "MAGA", bio: "Estadística aplicada, experimentos A/B y modelos que explican por qué, no solo qué.", stats: [5, 2, 5, 2, 3], ciudad: "Mérida, MX", anios: "6 años", esp: "Estadística aplicada", stack: "Python · R · SQL", disp: "Disponible", proyectos: 15 },
  { nombre: "Jorge Castillo", corto: "Jorge", rol: "Seguridad", clase: "CENTINELA", bio: "Auditorías, hardening y respuesta a incidentes. Que lo tuyo siga siendo tuyo.", stats: [3, 4, 2, 5, 2], ciudad: "CDMX, MX", anios: "9 años", esp: "Ciberseguridad", stack: "Pentesting · SIEM · IAM", disp: "Disponible", proyectos: 21 },
];

/*
  El perfil vive en el hash (#/valeria) para que el botón atrás del navegador
  vuelva al roster. NFD separa la letra de su acento y el rango U+0300–U+036F
  son justamente esos acentos sueltos: "Sebastián" → "sebastian".
*/
function slugDeColaborador(ficha) {
  return String(ficha?.corto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function indicePorSlug(slug) {
  const buscado = String(slug || "").trim().toLowerCase();
  if (!buscado) return -1;
  return COLABORADORES.findIndex((ficha) => slugDeColaborador(ficha) === buscado);
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
    COLABORADORES,
    ETIQUETAS_ATRIBUTOS,
    COLUMNAS_ROSTER,
    DISPONIBILIDADES,
    slugDeColaborador,
    indicePorSlug,
    moverSeleccion,
    colegaSugerido,
    numeroDeFicha,
    etiquetaDeAtributo,
    enlacesDisponibles,
  };
}
