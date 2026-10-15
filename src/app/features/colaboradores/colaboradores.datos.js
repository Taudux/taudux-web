/*
  Lógica pura del roster de colaboradores. Sin DOM: este archivo se carga igual
  en la página y en los tests de Node.

  Acá NO hay personas. La lista sale de la base con listarColaboradores()
  (core/colaboradores/colaboradores.service.js), que entrega de cada una
  nombre, corto y slug, más los campos de su ficha (migraciones 0039, 0040 y
  0041) con los nombres de la base: puesto, sector, ubicacion, herramientas,
  habilidades e idiomas (arreglos de textos), modalidad_trabajo, anio_inicio
  (un año entero), bio, linkedin, github y correo. Las fichas de muestra del prototipo viven en
  tests/fixtures/colaboradores.muestra.js y sólo las usan los tests.

  Quien todavía no llenó su ficha trae esos campos en null: está en el roster
  pero no tiene perfil que abrir. tienePerfil() es quien lo decide.

  Campos opcionales de contacto: `linkedin`, `github` (URL https a ese sitio)
  y `correo`. Los que falten no se pintan; ver enlacesDisponibles().

  `habilidades` e `idiomas` también son opcionales, y por eso NO entran en
  tienePerfil(): si contaran, quien no las llenó se quedaría sin perfil
  abrible. Vienen siempre como arreglo (la 0041 las declara not null default
  '{}'), y vacías esconden su celda entera en la vista de perfil.

  `empresa` y `empresa_enlace` corren la misma suerte y por el mismo motivo;
  ver empresaDelPerfil(). Son nullable, así que la ausencia llega como null.
*/

// Los mismos valores, en el mismo orden, que el CHECK
// `fichas_colaborador_modalidad_trabajo_valida` de la 0040. Un test compara
// las dos listas.
const MODALIDADES_TRABAJO = Object.freeze(["Presencial", "Híbrido", "Remoto"]);

// La grilla del roster tiene cuatro columnas en todos los anchos; en
// moverSeleccion, arriba/abajo saltan de a una fila, o sea de a
// COLUMNAS_ROSTER fichas.
const COLUMNAS_ROSTER = 4;

// Todo lo que la vista de perfil escribe tal cual como texto y NO sabe
// ocultar: si falta uno, quedaría un hueco en blanco en la ficha técnica.
//
// `sector` salió de esta lista con la 0042, que lo volvió opcional: su celda
// se oculta sola, así que no dejaría hueco. Si siguiera acá, una ficha sin
// sector no abriría perfil —que es bastante más grave que el hueco que esto
// evita—. Lo mismo vale para empresa, habilidades e idiomas, que nunca
// estuvieron.
const CAMPOS_DE_TEXTO_DEL_PERFIL = ["nombre", "corto", "puesto", "ubicacion", "bio"];

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
  const herramientasCompletas = Array.isArray(persona.herramientas)
    && persona.herramientas.length > 0
    && persona.herramientas.every(esTextoConContenido);

  return textosCompletos
    && herramientasCompletas
    && MODALIDADES_TRABAJO.includes(persona.modalidad_trabajo)
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
  La expresión del CHECK `fichas_colaborador_empresa_enlace_valido` (0041),
  con la misma traducción que las de arriba (allá `[^[:space:]]`, acá `[^\s]`)
  y sin bandera `i`. A diferencia de linkedin y github NO fija el host —la
  empresa vive donde vive— pero sí el esquema: sólo https, porque este texto
  sale de datos y termina en un href.
*/
const PATRON_ENLACE_EMPRESA = /^https:\/\/[^\s\/?#]+\.[^\s\/?#]+([\/?#][^\s]*)?$/;

/*
  La empresa que el perfil pinta, o null si no hay nombre que mostrar (sin
  nombre la fila entera no aparece). Con un enlace válido el nombre es
  clicable; con uno inválido —o sin enlace— queda como texto plano.

  Se valida ACÁ, en la capa pura, y no al pintar: el href sale de datos, así
  que pasa por lista blanca antes de tocar el DOM. Es la misma postura de
  enlacesDisponibles(). Degradar a texto plano y no omitir la fila es
  deliberado: el nombre de la empresa sigue siendo un dato bueno aunque su
  enlace no lo sea.
*/
function empresaDelPerfil(ficha) {
  const nombre = String(ficha?.empresa || "").trim();
  if (nombre === "") return null;

  const enlace = String(ficha?.empresa_enlace || "").trim();
  return { nombre, href: PATRON_ENLACE_EMPRESA.test(enlace) ? enlace : null };
}

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

/*
  La escala de un círculo según su distancia al centro del área: 1 en el centro
  y hasta 0.45 en lo más lejano posible, con una caída que se acelera hacia
  afuera (exponente 1.6). (dx, dy) es el desplazamiento respecto del centro del
  área, no del círculo: por eso sirve igual con el panal en reposo que movido
  por el arrastre o el zoom, donde la escala se recalcula a cada cuadro.
*/
function escalaEnPanal(dx, dy, ancho, alto) {
  const distanciaMaxima = Math.hypot((Number(ancho) || 0) / 2, (Number(alto) || 0) / 2) || 1;
  const proporcion = Math.min(1, Math.hypot(dx, dy) / distanciaMaxima);
  return Math.max(0.45, 1 - proporcion ** 1.6 * 0.75);
}

/*
  Resistencia elástica de un eje, como el rebote del scroll en iOS. Dentro de
  [min, max] el valor pasa tal cual; fuera, el exceso rinde cada vez menos: la
  curva sube con pendiente `elasticidad` junto al borde y se aplana hacia un
  tope (TOPE_ELASTICO px), así que jalar más fuerte siempre mueve algo más pero
  nunca se escapa. Siempre rinde menos que el exceso crudo (elasticidad ≤ 1).
  Si el rango llega invertido (racimo más chico que la vista) se colapsa a su
  punto medio en vez de empujar hacia un lado.
*/
const TOPE_ELASTICO = 160;

function limitarDesplazamiento(valor, min, max, elasticidad = 0.35) {
  const invertido = min > max;
  const bajo = invertido ? (min + max) / 2 : min;
  const alto = invertido ? (min + max) / 2 : max;
  const k = Math.max(0, Number(elasticidad) || 0);
  const resistido = (exceso) => (exceso * k) / (1 + (exceso * k) / TOPE_ELASTICO);
  if (valor < bajo) return bajo - resistido(bajo - valor);
  if (valor > alto) return alto + resistido(valor - alto);
  return valor;
}

/*
  Un paso de la inercia tras soltar el arrastre: la velocidad (px/ms) decae
  exponencial con `friccion` (1/ms) durante `dt` ms. Siempre termina: bajo
  UMBRAL_FRENADO se declara frenada, y una fricción nula o inválida frena de
  golpe en vez de dejar al llamador en un bucle sin fin.
*/
const UMBRAL_FRENADO = 0.02;

function pasoDeInercia(velocidad, dt, friccion = 0.005) {
  const v = Number(velocidad) || 0;
  const t = Math.max(0, Number(dt) || 0);
  if (!(friccion > 0)) return { velocidad: 0, frenado: true };
  const siguiente = v * Math.exp(-friccion * t);
  if (Math.abs(siguiente) < UMBRAL_FRENADO) return { velocidad: 0, frenado: true };
  return { velocidad: siguiente, frenado: false };
}

/*
  El PANAL del roster: círculos en anillos hexagonales alrededor de uno central,
  como la pantalla de apps del Apple Watch. Pura: recibe cuántos círculos y el
  área disponible, y devuelve el diámetro común y, por círculo, su CENTRO
  (x, y, en px desde la esquina del área) y su escala. Quien la aplica al DOM es
  acomodarPanal(), en colaboradores.js.

  Los huecos se llenan en orden estable: el 0 al centro y luego cada anillo
  (6, 12, 18…) empezando por el este y girando en sentido horario, así que con
  pocos círculos queda un racimo compacto y centrado.

  La separación horizontal entre centros es 1.08 diámetros (un respiro entre
  círculos) y la vertical entre filas, 0.87 de eso: la proporción de un
  empaquetado hexagonal.

  El diámetro es el mayor que deja TODO el racimo dentro del área, con el radio
  incluido. El racimo se mide simétrico respecto del centro del área (el hueco
  0 está en el centro), y `limite` lo topa para que con tres personas no
  salgan círculos gigantes.

  La escala baja con la distancia al centro: 1 en el centro y hasta 0.45 en lo
  más lejano posible del área, con una caída que se acelera hacia afuera
  (exponente 1.6). Como sólo encoge, un círculo escalado siempre cabe en su
  hueco sin salirse del área.
*/
function posicionesDelPanal(cantidad, ancho, alto, limite = 118) {
  const total = Math.max(0, Math.floor(Number(cantidad)) || 0);
  const ESPACIADO = 1.08;
  const FILA = 0.87;
  // Hexágono "pointy": cada paso axial (q, r) mueve ESPACIADO·(q + r/2) a lo
  // ancho y ESPACIADO·FILA·r a lo alto, medidos en diámetros.
  const DIRECCIONES = [[-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0], [0, 1]];

  const huecos = [[0, 0]];
  for (let anillo = 1; huecos.length < total; anillo += 1) {
    const delAnillo = [];
    let q = anillo;
    let r = 0;
    for (const [dq, dr] of DIRECCIONES) {
      for (let paso = 0; paso < anillo; paso += 1) {
        delAnillo.push([q, r]);
        q += dq;
        r += dr;
      }
    }
    // El último anillo, si queda a medias, se reparte parejo alrededor del
    // centro: llenarlo en orden cargaba el racimo hacia un lado (con 4
    // personas quedaban tres juntas abajo a la derecha).
    const faltan = total - huecos.length;
    if (faltan < delAnillo.length) {
      for (let i = 0; i < faltan; i += 1) {
        huecos.push(delAnillo[Math.floor((i * delAnillo.length) / faltan)]);
      }
    } else {
      huecos.push(...delAnillo);
    }
  }
  huecos.length = total;

  const unidades = huecos.map(([q, r]) => ({
    x: ESPACIADO * (q + r / 2),
    y: ESPACIADO * FILA * r,
  }));

  const semiAncho = Math.max(0, ...unidades.map((u) => Math.abs(u.x))) + 0.5;
  const semiAlto = Math.max(0, ...unidades.map((u) => Math.abs(u.y))) + 0.5;
  const ancha = Math.max(0, Number(ancho) || 0);
  const alta = Math.max(0, Number(alto) || 0);

  const diametro = total === 0 ? 0 : Math.max(0, Math.min(limite, ancha / 2 / semiAncho, alta / 2 / semiAlto));

  const posiciones = unidades.map((u) => {
    const dx = u.x * diametro;
    const dy = u.y * diametro;
    return {
      x: ancha / 2 + dx,
      y: alta / 2 + dy,
      escala: escalaEnPanal(dx, dy, ancha, alta),
    };
  });

  return {
    diametro,
    posiciones,
    // Alto mínimo que necesita el racimo: sirve cuando el alto no lo dicta la
    // ventana (móvil) y hay que dárselo al panal.
    altoNecesario: 2 * semiAlto * diametro,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COLUMNAS_ROSTER,
    MODALIDADES_TRABAJO,
    tienePerfil,
    experienciaDesde,
    indicePorSlug,
    moverSeleccion,
    numeroDeFicha,
    empresaDelPerfil,
    enlacesDisponibles,
    posicionesDelPanal,
    escalaEnPanal,
    limitarDesplazamiento,
    pasoDeInercia,
  };
}
