/*
  Fichas de MUESTRA de la página de colaboradores. Sólo para los tests: la
  página ya no las carga, pinta lo que devuelve listarColaboradores().

  Son personas inventadas que vienen del prototipo de diseño: nombres,
  ciudades y años de experiencia no corresponden a nadie. Cada una lleva la
  ficha de perfil COMPLETA (tienePerfil() da true) para ejercitar la vista de
  perfil, y su `slug` explícito: la base es la única que genera slugs, así
  que acá no se derivan del nombre.

  Sin clase, atributos ni proyectos: la página los retiró (2026-09-19) y una
  ficha que todavía los trajera escondería que tienePerfil() ya no los pide.

  Congeladas a propósito: un test que quiera retocar una ficha trabaja sobre
  structuredClone(COLABORADORES_MUESTRA). Un Object.assign directo lanza, en
  vez de ensuciar en silencio los datos del test siguiente.

  Carga doble, como colaboradores.datos.js: require() en Node y, corrido como
  script, deja COLABORADORES_MUESTRA como global.
*/
const COLABORADORES_MUESTRA = [
  { nombre: "Valeria Ortiz", corto: "Valeria", slug: "valeria", rol: "Arquitectura de datos", bio: "Diseña pipelines y modelos de datos que aguantan crecimiento. Convierte tablas desordenadas en decisiones.", ciudad: "Querétaro, MX", anios: "8 años", esp: "Data warehousing", stack: "PostgreSQL · Python · GCP", disp: "Disponible" },
  { nombre: "Diego Ramírez", corto: "Diego", slug: "diego", rol: "Backend & APIs", bio: "Servicios estables bajo carga. Si el sistema no se cae, probablemente él lo construyó.", ciudad: "CDMX, MX", anios: "10 años", esp: "Sistemas distribuidos", stack: "Node.js · Docker · AWS", disp: "Disponible" },
  { nombre: "Mariana Cruz", corto: "Mariana", slug: "mariana", rol: "Frontend & UX", bio: "Interfaces rápidas que la gente entiende sin manual. Detalle obsesivo en animación y accesibilidad.", ciudad: "Guadalajara, MX", anios: "6 años", esp: "Design systems", stack: "HTML/CSS · JavaScript · Figma", disp: "Parcial" },
  { nombre: "Iván Torres", corto: "Iván", slug: "ivan", rol: "Modelos de IA", bio: "Predicción de demanda, clasificación, LLMs aplicados. Traduce el negocio a features y las features a resultados.", ciudad: "Querétaro, MX", anios: "7 años", esp: "ML aplicado", stack: "Python · R · Vertex AI", disp: "Disponible" },
  { nombre: "Renata Solís", corto: "Renata", slug: "renata", rol: "Cloud & DevOps", bio: "Infraestructura como código, despliegues sin sustos y facturas de nube que sí cierran.", ciudad: "Monterrey, MX", anios: "9 años", esp: "IaC y observabilidad", stack: "Docker · Git · AWS", disp: "Disponible" },
  { nombre: "Emilio Vega", corto: "Emilio", slug: "emilio", rol: "Capacitación técnica", bio: "Cursos y talleres para equipos que quieren dejar de depender de terceros. Explica lo difícil sin simplificarlo de más.", ciudad: "Querétaro, MX", anios: "12 años", esp: "Formación técnica", stack: "Python · SQL · Docencia", disp: "Parcial" },
  { nombre: "Camila Ruiz", corto: "Camila", slug: "camila", rol: "Analítica de negocio", bio: "Tableros que responden preguntas, no que las generan. KPIs, forecasting y storytelling con datos.", ciudad: "Puebla, MX", anios: "6 años", esp: "BI y forecasting", stack: "Power BI · SQL · Python", disp: "Disponible" },
  { nombre: "Sebastián Lara", corto: "Sebastián", slug: "sebastian", rol: "Apps móviles", bio: "Del prototipo a la tienda. Apps que se sienten nativas y hablan con el backend sin fricción.", ciudad: "CDMX, MX", anios: "5 años", esp: "Apps nativas", stack: "Java · C++ · APIs", disp: "Disponible" },
  { nombre: "Lucía Herrera", corto: "Lucía", slug: "lucia", rol: "QA & Automatización", bio: "Pruebas que atrapan el bug antes que el cliente. Pipelines de CI que no dejan pasar nada roto.", ciudad: "León, MX", anios: "7 años", esp: "Testing automatizado", stack: "Cypress · Jest · CI/CD", disp: "Disponible" },
  { nombre: "Andrés Molina", corto: "Andrés", slug: "andres", rol: "Gestión de proyectos", bio: "Alcance claro, entregas a tiempo y cero sorpresas. Traduce entre negocio y equipo técnico.", ciudad: "Querétaro, MX", anios: "11 años", esp: "Delivery ágil", stack: "Scrum · Jira · Notion", disp: "Parcial" },
  { nombre: "Paola Núñez", corto: "Paola", slug: "paola", rol: "Ciencia de datos", bio: "Estadística aplicada, experimentos A/B y modelos que explican por qué, no solo qué.", ciudad: "Mérida, MX", anios: "6 años", esp: "Estadística aplicada", stack: "Python · R · SQL", disp: "Disponible" },
  { nombre: "Jorge Castillo", corto: "Jorge", slug: "jorge", rol: "Seguridad", bio: "Auditorías, hardening y respuesta a incidentes. Que lo tuyo siga siendo tuyo.", ciudad: "CDMX, MX", anios: "9 años", esp: "Ciberseguridad", stack: "Pentesting · SIEM · IAM", disp: "Disponible" },
];

COLABORADORES_MUESTRA.forEach((persona) => Object.freeze(persona));
Object.freeze(COLABORADORES_MUESTRA);

if (typeof module !== "undefined" && module.exports) {
  module.exports = { COLABORADORES_MUESTRA };
}
