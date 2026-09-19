/*
  Fichas de MUESTRA de la página de colaboradores. Sólo para los tests: la
  página ya no las carga, pinta lo que devuelve listarColaboradores().

  Son personas inventadas que vienen del prototipo de diseño: nombres,
  ciudades, años de experiencia y proyectos no corresponden a nadie. Cada una
  lleva la ficha de perfil COMPLETA (tienePerfil() da true) para ejercitar la
  vista de perfil, y su `slug` explícito: la base es la única que genera
  slugs, así que acá no se derivan del nombre.

  Congeladas a propósito: un test que quiera retocar una ficha trabaja sobre
  structuredClone(COLABORADORES_MUESTRA). Un Object.assign directo lanza, en
  vez de ensuciar en silencio los datos del test siguiente.

  Carga doble, como colaboradores.datos.js: require() en Node y, corrido como
  script, deja COLABORADORES_MUESTRA como global.
*/
const COLABORADORES_MUESTRA = [
  { nombre: "Valeria Ortiz", corto: "Valeria", slug: "valeria", rol: "Arquitectura de datos", clase: "ESTRATEGA", bio: "Diseña pipelines y modelos de datos que aguantan crecimiento. Convierte tablas desordenadas en decisiones.", stats: [5, 3, 4, 4, 3], ciudad: "Querétaro, MX", anios: "8 años", esp: "Data warehousing", stack: "PostgreSQL · Python · GCP", disp: "Disponible", proyectos: 24 },
  { nombre: "Diego Ramírez", corto: "Diego", slug: "diego", rol: "Backend & APIs", clase: "TANQUE", bio: "Servicios estables bajo carga. Si el sistema no se cae, probablemente él lo construyó.", stats: [3, 5, 2, 5, 3], ciudad: "CDMX, MX", anios: "10 años", esp: "Sistemas distribuidos", stack: "Node.js · Docker · AWS", disp: "Disponible", proyectos: 31 },
  { nombre: "Mariana Cruz", corto: "Mariana", slug: "mariana", rol: "Frontend & UX", clase: "VELOCISTA", bio: "Interfaces rápidas que la gente entiende sin manual. Detalle obsesivo en animación y accesibilidad.", stats: [2, 4, 3, 2, 4], ciudad: "Guadalajara, MX", anios: "6 años", esp: "Design systems", stack: "HTML/CSS · JavaScript · Figma", disp: "Parcial", proyectos: 19 },
  { nombre: "Iván Torres", corto: "Iván", slug: "ivan", rol: "Modelos de IA", clase: "MAGO", bio: "Predicción de demanda, clasificación, LLMs aplicados. Traduce el negocio a features y las features a resultados.", stats: [4, 3, 5, 3, 4], ciudad: "Querétaro, MX", anios: "7 años", esp: "ML aplicado", stack: "Python · R · Vertex AI", disp: "Disponible", proyectos: 17 },
  { nombre: "Renata Solís", corto: "Renata", slug: "renata", rol: "Cloud & DevOps", clase: "INGENIERA", bio: "Infraestructura como código, despliegues sin sustos y facturas de nube que sí cierran.", stats: [3, 4, 2, 5, 2], ciudad: "Monterrey, MX", anios: "9 años", esp: "IaC y observabilidad", stack: "Docker · Git · AWS", disp: "Disponible", proyectos: 28 },
  { nombre: "Emilio Vega", corto: "Emilio", slug: "emilio", rol: "Capacitación técnica", clase: "MENTOR", bio: "Cursos y talleres para equipos que quieren dejar de depender de terceros. Explica lo difícil sin simplificarlo de más.", stats: [4, 3, 3, 2, 5], ciudad: "Querétaro, MX", anios: "12 años", esp: "Formación técnica", stack: "Python · SQL · Docencia", disp: "Parcial", proyectos: 40 },
  { nombre: "Camila Ruiz", corto: "Camila", slug: "camila", rol: "Analítica de negocio", clase: "ESTRATEGA", bio: "Tableros que responden preguntas, no que las generan. KPIs, forecasting y storytelling con datos.", stats: [5, 2, 3, 2, 4], ciudad: "Puebla, MX", anios: "6 años", esp: "BI y forecasting", stack: "Power BI · SQL · Python", disp: "Disponible", proyectos: 22 },
  { nombre: "Sebastián Lara", corto: "Sebastián", slug: "sebastian", rol: "Apps móviles", clase: "VELOCISTA", bio: "Del prototipo a la tienda. Apps que se sienten nativas y hablan con el backend sin fricción.", stats: [2, 4, 3, 3, 3], ciudad: "CDMX, MX", anios: "5 años", esp: "Apps nativas", stack: "Java · C++ · APIs", disp: "Disponible", proyectos: 14 },
  { nombre: "Lucía Herrera", corto: "Lucía", slug: "lucia", rol: "QA & Automatización", clase: "GUARDIANA", bio: "Pruebas que atrapan el bug antes que el cliente. Pipelines de CI que no dejan pasar nada roto.", stats: [3, 4, 2, 3, 3], ciudad: "León, MX", anios: "7 años", esp: "Testing automatizado", stack: "Cypress · Jest · CI/CD", disp: "Disponible", proyectos: 26 },
  { nombre: "Andrés Molina", corto: "Andrés", slug: "andres", rol: "Gestión de proyectos", clase: "CAPITÁN", bio: "Alcance claro, entregas a tiempo y cero sorpresas. Traduce entre negocio y equipo técnico.", stats: [3, 3, 2, 2, 4], ciudad: "Querétaro, MX", anios: "11 años", esp: "Delivery ágil", stack: "Scrum · Jira · Notion", disp: "Parcial", proyectos: 35 },
  { nombre: "Paola Núñez", corto: "Paola", slug: "paola", rol: "Ciencia de datos", clase: "MAGA", bio: "Estadística aplicada, experimentos A/B y modelos que explican por qué, no solo qué.", stats: [5, 2, 5, 2, 3], ciudad: "Mérida, MX", anios: "6 años", esp: "Estadística aplicada", stack: "Python · R · SQL", disp: "Disponible", proyectos: 15 },
  { nombre: "Jorge Castillo", corto: "Jorge", slug: "jorge", rol: "Seguridad", clase: "CENTINELA", bio: "Auditorías, hardening y respuesta a incidentes. Que lo tuyo siga siendo tuyo.", stats: [3, 4, 2, 5, 2], ciudad: "CDMX, MX", anios: "9 años", esp: "Ciberseguridad", stack: "Pentesting · SIEM · IAM", disp: "Disponible", proyectos: 21 },
];

COLABORADORES_MUESTRA.forEach((persona) => {
  Object.freeze(persona.stats);
  Object.freeze(persona);
});
Object.freeze(COLABORADORES_MUESTRA);

if (typeof module !== "undefined" && module.exports) {
  module.exports = { COLABORADORES_MUESTRA };
}
