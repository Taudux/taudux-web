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

  /* Campos de la tarjeta (todos opcionales: una carpeta sin ellos se sigue
     ofreciendo, con la tarjeta de respaldo). Son los mismos que devuelve
     catalogo_slides_subidas() (0048). */
  let categoria = "";
  if (objeto.categoria !== undefined) {
    if (typeof objeto.categoria !== "string") errores.push("la categoría debe ser texto");
    else if (objeto.categoria.trim().length > LIMITES_SUBIDA.categoria) {
      errores.push(`la categoría no puede pasar de ${LIMITES_SUBIDA.categoria} caracteres`);
    } else categoria = objeto.categoria.trim();
  }

  let actualizado = "";
  if (objeto.actualizado !== undefined) {
    if (typeof objeto.actualizado !== "string" || !fechaDeTexto(objeto.actualizado)) {
      errores.push('"actualizado" debe ser una fecha ISO (AAAA-MM-DD)');
    } else actualizado = objeto.actualizado.trim();
  }

  let totalLaminas = 0;
  if (objeto.total_laminas !== undefined) {
    if (!Number.isInteger(objeto.total_laminas) || objeto.total_laminas < 1) {
      errores.push('"total_laminas" debe ser un entero positivo');
    } else totalLaminas = objeto.total_laminas;
  }

  let autor = "";
  if (objeto.autor !== undefined) {
    if (typeof objeto.autor !== "string") errores.push("el autor debe ser texto");
    else autor = objeto.autor.trim();
  }

  let portada = "";
  if (objeto.portada !== undefined) {
    const ruta = textoNormalizado(objeto.portada);
    if (!ruta) {
      errores.push('"portada" no puede estar vacía si se declara');
    } else if (ruta.startsWith("/") || ruta.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(ruta)) {
      errores.push('"portada" debe ser una ruta relativa dentro de la carpeta de la presentación');
    } else if (!ruta.toLowerCase().endsWith(".webp")) {
      errores.push('"portada" debe terminar en .webp');
    } else portada = ruta;
  }

  return {
    ok: errores.length === 0,
    errores,
    presentacion: {
      slug: slugNormalizado,
      titulo,
      descripcion,
      archivo,
      categoria,
      actualizado,
      total_laminas: totalLaminas,
      autor,
      portada,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tarjetas: categoría, fecha, portada de respaldo y filtros           */
/* ------------------------------------------------------------------ */

const MESES_CORTOS = Object.freeze([
  "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic",
]);

/*
  Una fecha de texto ("2026-10-06" o un timestamp ISO de Postgres) a
  { anio, mes, dia }, o null si no es una fecha real. Los textos de sólo fecha
  NO pasan por `new Date`: ese los lee como UTC y en México (UTC-6) el día
  amanecería uno antes.
*/
function fechaDeTexto(valor) {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  let anio;
  let mes;
  let dia;
  if (soloFecha) {
    anio = Number(soloFecha[1]);
    mes = Number(soloFecha[2]);
    dia = Number(soloFecha[3]);
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) {
    const fecha = new Date(texto);
    if (Number.isNaN(fecha.getTime())) return null;
    anio = fecha.getFullYear();
    mes = fecha.getMonth() + 1;
    dia = fecha.getDate();
  } else {
    return null;
  }
  const real = new Date(anio, mes - 1, dia);
  if (real.getFullYear() !== anio || real.getMonth() !== mes - 1 || real.getDate() !== dia) return null;
  return { anio, mes, dia };
}

/* "6 oct 2026". Los meses van a mano y no con Intl: el abreviado de es-MX
   cambia entre motores (sep/sept) y la tarjeta tiene que verse igual. */
function fechaCorta(valor) {
  const fecha = fechaDeTexto(valor);
  if (!fecha) return "";
  return `${fecha.dia} ${MESES_CORTOS[fecha.mes - 1]} ${fecha.anio}`;
}

function textoLaminas(total) {
  if (!Number.isInteger(total) || total < 1) return "";
  return total === 1 ? "1 lámina" : `${total} láminas`;
}

/* Minúsculas, sin acentos, sin espacios de más: la clave con la que se
   comparan categorías escritas a mano ("Datos", "datos ", "DATÓS"). */
function claveDeCategoria(texto) {
  if (typeof texto !== "string") return "";
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Lo que se guarda para una categoría escrita: si ya existe una con la misma
  clave, SU grafía (la primera de la lista); si no, el texto con los espacios
  colapsados. Así «datos » termina siendo «Datos» y no una segunda categoría.
*/
function categoriaReconciliada(texto, existentes) {
  const limpia = typeof texto === "string" ? texto.replace(/\s+/g, " ").trim() : "";
  if (!limpia) return "";
  const clave = claveDeCategoria(limpia);
  const igual = (Array.isArray(existentes) ? existentes : []).find(
    (candidata) => typeof candidata === "string" && claveDeCategoria(candidata) === clave
  );
  return igual ? igual.replace(/\s+/g, " ").trim() : limpia;
}

/* Las categorías distintas del catálogo, por clave y en orden alfabético. */
function listarCategorias(catalogo) {
  const porClave = new Map();
  (Array.isArray(catalogo) ? catalogo : []).forEach((item) => {
    const clave = claveDeCategoria(item && item.categoria);
    if (clave && !porClave.has(clave)) porClave.set(clave, item.categoria.trim());
  });
  return [...porClave.values()].sort((a, b) => a.localeCompare(b, "es"));
}

/* `clave` vacía es «Todas». */
function filtrarPorCategoria(catalogo, clave) {
  const lista = Array.isArray(catalogo) ? catalogo : [];
  const buscada = claveDeCategoria(clave);
  if (!buscada) return lista;
  return lista.filter((item) => claveDeCategoria(item && item.categoria) === buscada);
}

/* Lo que va en la grilla principal (todo lo público, del repositorio o
   subido) y lo que va en el desplegable (admins y por revisar). Una entrada
   sin visibilidad es del repositorio, y por tanto pública. */
function repartirCatalogo(catalogo) {
  const publicas = [];
  const privadas = [];
  (Array.isArray(catalogo) ? catalogo : []).forEach((item) => {
    if (!item) return;
    if (item.visibilidad === "admins" || item.visibilidad === "por_revisar") privadas.push(item);
    else publicas.push(item);
  });
  return { publicas, privadas };
}

/* Hasta dos iniciales de la categoría: «Bases de datos» -> «BD»,
   «Humanidades» -> «HU». */
function inicialesDeCategoria(categoria) {
  const palabras = (typeof categoria === "string" ? categoria : "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (palabras.length === 0) return "";
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

/* Un tono FIJO por categoría (el mismo en cada visita y en cada máquina),
   dentro de la gama fría de la marca (del cian al violeta). */
function tonoDeCategoria(categoria) {
  const clave = claveDeCategoria(categoria);
  if (!clave) return 200;
  let hash = 0;
  for (let i = 0; i < clave.length; i += 1) hash = (hash * 31 + clave.charCodeAt(i)) >>> 0;
  return 170 + (hash % 130);
}

function degradadoDeCategoria(categoria) {
  const tono = tonoDeCategoria(categoria);
  return `linear-gradient(135deg, hsl(${tono} 78% 30%), hsl(${(tono + 40) % 360} 70% 16%))`;
}

/* ------------------------------------------------------------------ */
/* Subir una presentación                                              */
/* ------------------------------------------------------------------ */

const VISIBILIDADES = Object.freeze(["publico", "admins", "por_revisar"]);
const TIPOS_DE_PORTADA = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
const PORTADA_ANCHO = 1200;
const PORTADA_ALTO = 750;

/* Los mismos topes que la migración 0048 (columnas y bucket). */
const LIMITES_SUBIDA = Object.freeze({
  titulo: 160,
  descripcion: 600,
  categoria: 40,
  bytesHtml: 15 * 1024 * 1024,
  bytesPortada: 2 * 1024 * 1024,
});

/* "Curso SQL — De básico" -> "curso-sql-de-basico". Vacío si no queda nada
   utilizable. El tope es el de la columna. */
function slugDesdeTitulo(titulo) {
  if (typeof titulo !== "string") return "";
  return titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/*
  El recorte centrado de una imagen a una relación de aspecto: el rectángulo
  de origen que, estirado a 1200x750, llena el lienzo sin deformar nada.
*/
function rectanguloDeRecorte(ancho, alto, relacion = PORTADA_ANCHO / PORTADA_ALTO) {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) return null;
  const actual = ancho / alto;
  if (actual > relacion) {
    const sw = Math.round(alto * relacion);
    return { sx: Math.round((ancho - sw) / 2), sy: 0, sw, sh: alto };
  }
  const sh = Math.round(ancho / relacion);
  return { sx: 0, sy: Math.round((alto - sh) / 2), sw: ancho, sh };
}

/*
  Valida el formulario de subida. Recibe valores ya leídos (`archivo` y
  `portada` son objetos con `name`, `size` y `type`, como un File) y
  devuelve un mensaje por campo, para pintarlos junto a cada uno. La RLS y el
  bucket vuelven a exigir lo importante: esto es para explicarlo antes de
  subir 15 MB.

  `contexto.esAdmin` decide si el autor y la visibilidad se piden;
  `contexto.slugsOcupados` son los slugs del catálogo que la persona ve;
  `contexto.categorias` son las que ya existen, para no duplicar su grafía.

  `contexto.modo === "edicion"` valida el formulario de EDICIÓN de una
  presentación ya subida: el archivo y la portada son opcionales (sin archivo
  se conserva el actual) y el slug es `contexto.slugPropio`, que no cambia
  aunque el título sí, así que ningún slug cuenta como ocupado. En modo subida
  nada de esto aplica.
*/
function validarSubida(datos, contexto = {}) {
  const errores = {};
  const entrada = datos && typeof datos === "object" ? datos : {};
  const esAdmin = Boolean(contexto.esAdmin);
  const edicion = contexto.modo === "edicion";
  const ocupados = new Set(Array.isArray(contexto.slugsOcupados) ? contexto.slugsOcupados : []);

  const titulo = textoNormalizado(entrada.titulo);
  if (!titulo) errores.titulo = "Escribe el título.";
  else if (titulo.length > LIMITES_SUBIDA.titulo) {
    errores.titulo = `El título no puede pasar de ${LIMITES_SUBIDA.titulo} caracteres.`;
  } else if (!slugDesdeTitulo(titulo)) {
    errores.titulo = "El título necesita al menos una letra o un número.";
  } else if (!edicion && ocupados.has(slugDesdeTitulo(titulo))) {
    errores.titulo = "Ya existe una presentación con ese título. Cámbialo un poco.";
  }

  const descripcion = typeof entrada.descripcion === "string" ? entrada.descripcion.trim() : "";
  if (descripcion.length > LIMITES_SUBIDA.descripcion) {
    errores.descripcion = `La descripción no puede pasar de ${LIMITES_SUBIDA.descripcion} caracteres.`;
  }

  const categoria = categoriaReconciliada(entrada.categoria, contexto.categorias);
  if (!categoria) errores.categoria = "Escribe o elige una categoría.";
  else if (categoria.length > LIMITES_SUBIDA.categoria) {
    errores.categoria = `La categoría no puede pasar de ${LIMITES_SUBIDA.categoria} caracteres.`;
  }

  const archivo = entrada.archivo;
  if (!archivo || typeof archivo !== "object") {
    if (!edicion) errores.archivo = "Elige el archivo HTML de la presentación.";
  } else if (!/\.html?$/i.test(String(archivo.name || ""))) {
    errores.archivo = "El archivo tiene que ser un .html.";
  } else if (!(archivo.size > 0)) {
    errores.archivo = "El archivo está vacío.";
  } else if (archivo.size > LIMITES_SUBIDA.bytesHtml) {
    errores.archivo = "El archivo pesa más de 15 MB.";
  }

  const portada = entrada.portada;
  if (portada) {
    if (!TIPOS_DE_PORTADA.includes(portada.type)) {
      errores.portada = "La portada tiene que ser JPG, PNG o WebP.";
    } else if (portada.size > LIMITES_SUBIDA.bytesPortada) {
      errores.portada = "La portada pesa más de 2 MB.";
    }
  }

  let autorId = "";
  let visibilidad = "por_revisar";
  if (esAdmin) {
    autorId = textoNormalizado(entrada.autorId);
    if (!autorId) errores.autor = "Elige quién es el autor.";
    visibilidad = entrada.visibilidad;
    // Al editar, una presentación «por revisar» puede seguir así.
    const validas = edicion ? ["publico", "admins", "por_revisar"] : ["publico", "admins"];
    if (!validas.includes(visibilidad)) {
      errores.visibilidad = "Elige la visibilidad.";
    }
  }

  return {
    ok: Object.keys(errores).length === 0,
    errores,
    valores: {
      titulo,
      descripcion,
      categoria,
      autorId,
      visibilidad,
      slug: edicion ? textoNormalizado(contexto.slugPropio) : slugDesdeTitulo(titulo),
    },
  };
}

/* Cuántas láminas tiene un deck ya parseado (un Document o algo con el mismo
   querySelectorAll). Es el contrato de siempre: `section.slide`. */
function contarLaminas(documento) {
  if (!documento || typeof documento.querySelectorAll !== "function") return 0;
  return documento.querySelectorAll("section.slide").length;
}

/* ------------------------------------------------------------------ */
/* Decks que llenan el visor                                           */
/* ------------------------------------------------------------------ */

/*
  Un deck subido se ve como los del repositorio: marco 16:9 y los botones
  ‹ ⛶ › del visor abajo, aunque traiga los suyos. La excepción son los decks
  de esta lista (hoy sólo el QR de sesión): llenan todo el alto que deja la
  navbar y, si traen botones propios, los del visor se esconden. Decisión del
  2026-10-07; si la lista crece, conviene una columna en slides_subidas.
*/
const SLUGS_QUE_LLENAN_EL_VISOR = Object.freeze(["taudux-qr-de-sesion"]);

function llenaElVisor(presentacion) {
  return Boolean(
    presentacion &&
      presentacion.origen === "subida" &&
      SLUGS_QUE_LLENAN_EL_VISOR.includes(presentacion.slug)
  );
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    indiceAcotado,
    estaEscribiendoEnCampo,
    accionParaTecla,
    normalizarIndice,
    normalizarPresentacion,
    MAPA_DE_TECLAS,
    fechaDeTexto,
    fechaCorta,
    textoLaminas,
    claveDeCategoria,
    categoriaReconciliada,
    listarCategorias,
    filtrarPorCategoria,
    repartirCatalogo,
    inicialesDeCategoria,
    tonoDeCategoria,
    degradadoDeCategoria,
    VISIBILIDADES,
    TIPOS_DE_PORTADA,
    PORTADA_ANCHO,
    PORTADA_ALTO,
    LIMITES_SUBIDA,
    slugDesdeTitulo,
    rectanguloDeRecorte,
    validarSubida,
    contarLaminas,
    SLUGS_QUE_LLENAN_EL_VISOR,
    llenaElVisor,
  });
}
