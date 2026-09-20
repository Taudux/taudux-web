/*
  Fichas de MUESTRA de la página de colaboradores. Sólo para los tests: la
  página ya no las carga, pinta lo que devuelve listarColaboradores().

  Son personas inventadas que vienen del prototipo de diseño: nombres,
  ubicaciones, años y enlaces no corresponden a nadie (los correos son de
  example.com y los enlaces llevan "ejemplo" en la ruta). Cada una tiene la
  misma forma que el registro que arma el servicio con la 0039/0040 —los
  campos de la ficha con los nombres de la base— y la ficha COMPLETA
  (tienePerfil() da true) para ejercitar la vista de perfil. Su `slug` es
  explícito: la base es la única que genera slugs, así que acá no se derivan
  del nombre.

  Hay al menos una persona por cada modalidad de trabajo y algunas con enlaces
  de contacto válidos; las demás los tienen en null, como los entrega la base.

  Sin clase, atributos ni proyectos: la página los retiró (2026-09-19) y una
  ficha que todavía los trajera escondería que tienePerfil() ya no los pide.

  Congeladas a fondo, stack incluido: un test que quiera retocar una ficha
  trabaja sobre structuredClone(COLABORADORES_MUESTRA). Un Object.assign o un
  push directo lanza, en vez de ensuciar en silencio los datos del test
  siguiente.

  Carga doble, como colaboradores.datos.js: require() en Node y, corrido como
  script, deja COLABORADORES_MUESTRA como global.
*/
const COLABORADORES_MUESTRA = [
  {
    nombre: "Valeria Ortiz", corto: "Valeria", slug: "valeria",
    puesto: "Arquitectura de datos", sector: "Data warehousing", ubicacion: "Querétaro, MX",
    stack: ["PostgreSQL", "Python", "GCP"], modalidad_trabajo: "Remoto", anio_inicio: 2018,
    bio: "Diseña pipelines y modelos de datos que aguantan crecimiento. Convierte tablas desordenadas en decisiones.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Diego Ramírez", corto: "Diego", slug: "diego",
    puesto: "Backend & APIs", sector: "Sistemas distribuidos", ubicacion: "CDMX, MX",
    stack: ["Node.js", "Docker", "AWS"], modalidad_trabajo: "Presencial", anio_inicio: 2016,
    bio: "Servicios estables bajo carga. Si el sistema no se cae, probablemente él lo construyó.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Mariana Cruz", corto: "Mariana", slug: "mariana",
    puesto: "Frontend & UX", sector: "Design systems", ubicacion: "Guadalajara, MX",
    stack: ["HTML/CSS", "JavaScript", "Figma"], modalidad_trabajo: "Híbrido", anio_inicio: 2020,
    bio: "Interfaces rápidas que la gente entiende sin manual. Detalle obsesivo en animación y accesibilidad.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Iván Torres", corto: "Iván", slug: "ivan",
    puesto: "Modelos de IA", sector: "ML aplicado", ubicacion: "Querétaro, MX",
    stack: ["Python", "R", "Vertex AI"], modalidad_trabajo: "Remoto", anio_inicio: 2019,
    bio: "Predicción de demanda, clasificación, LLMs aplicados. Traduce el negocio a features y las features a resultados.",
    linkedin: null, github: "https://github.com/ejemplo-ivan-torres", correo: null,
  },
  {
    nombre: "Renata Solís", corto: "Renata", slug: "renata",
    puesto: "Cloud & DevOps", sector: "IaC y observabilidad", ubicacion: "Monterrey, MX",
    stack: ["Docker", "Git", "AWS"], modalidad_trabajo: "Presencial", anio_inicio: 2017,
    bio: "Infraestructura como código, despliegues sin sustos y facturas de nube que sí cierran.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Emilio Vega", corto: "Emilio", slug: "emilio",
    puesto: "Capacitación técnica", sector: "Formación técnica", ubicacion: "Querétaro, MX",
    stack: ["Python", "SQL", "Docencia"], modalidad_trabajo: "Híbrido", anio_inicio: 2014,
    bio: "Cursos y talleres para equipos que quieren dejar de depender de terceros. Explica lo difícil sin simplificarlo de más.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Camila Ruiz", corto: "Camila", slug: "camila",
    puesto: "Analítica de negocio", sector: "BI y forecasting", ubicacion: "Puebla, MX",
    stack: ["Power BI", "SQL", "Python"], modalidad_trabajo: "Remoto", anio_inicio: 2020,
    bio: "Tableros que responden preguntas, no que las generan. KPIs, forecasting y storytelling con datos.",
    linkedin: "https://www.linkedin.com/in/ejemplo-camila-ruiz", github: null, correo: "camila@example.com",
  },
  {
    nombre: "Sebastián Lara", corto: "Sebastián", slug: "sebastian",
    puesto: "Apps móviles", sector: "Apps nativas", ubicacion: "CDMX, MX",
    stack: ["Java", "C++", "APIs"], modalidad_trabajo: "Presencial", anio_inicio: 2021,
    bio: "Del prototipo a la tienda. Apps que se sienten nativas y hablan con el backend sin fricción.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Lucía Herrera", corto: "Lucía", slug: "lucia",
    puesto: "QA & Automatización", sector: "Testing automatizado", ubicacion: "León, MX",
    stack: ["Cypress", "Jest", "CI/CD"], modalidad_trabajo: "Híbrido", anio_inicio: 2019,
    bio: "Pruebas que atrapan el bug antes que el cliente. Pipelines de CI que no dejan pasar nada roto.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Andrés Molina", corto: "Andrés", slug: "andres",
    puesto: "Gestión de proyectos", sector: "Delivery ágil", ubicacion: "Querétaro, MX",
    stack: ["Scrum", "Jira", "Notion"], modalidad_trabajo: "Remoto", anio_inicio: 2015,
    bio: "Alcance claro, entregas a tiempo y cero sorpresas. Traduce entre negocio y equipo técnico.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Paola Núñez", corto: "Paola", slug: "paola",
    puesto: "Ciencia de datos", sector: "Estadística aplicada", ubicacion: "Mérida, MX",
    stack: ["Python", "R", "SQL"], modalidad_trabajo: "Presencial", anio_inicio: 2020,
    bio: "Estadística aplicada, experimentos A/B y modelos que explican por qué, no solo qué.",
    linkedin: null, github: null, correo: null,
  },
  {
    nombre: "Jorge Castillo", corto: "Jorge", slug: "jorge",
    puesto: "Seguridad", sector: "Ciberseguridad", ubicacion: "CDMX, MX",
    stack: ["Pentesting", "SIEM", "IAM"], modalidad_trabajo: "Híbrido", anio_inicio: 2017,
    bio: "Auditorías, hardening y respuesta a incidentes. Que lo tuyo siga siendo tuyo.",
    linkedin: "https://mx.linkedin.com/in/ejemplo-jorge-castillo",
    github: "https://github.com/ejemplo-jorge-castillo",
    correo: "jorge@example.com",
  },
];

COLABORADORES_MUESTRA.forEach((persona) => {
  Object.freeze(persona.stack);
  Object.freeze(persona);
});
Object.freeze(COLABORADORES_MUESTRA);

if (typeof module !== "undefined" && module.exports) {
  module.exports = { COLABORADORES_MUESTRA };
}
