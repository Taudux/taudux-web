/*
  Lógica pura del árbol de notas. No toca el DOM, no hace red y no depende de
  Supabase: recibe el manifiesto ya cargado y responde preguntas sobre él.

  Existe separado de notas.service.js porque las dos vistas del área de notas
  —el listado por secciones y el grafo— tienen que estar de acuerdo en qué
  cuelga de qué. Si cada vista dedujera la jerarquía por su cuenta, la primera
  nota que se moviera de rama dejaría una de las dos mostrando algo distinto.
  Acá el árbol se construye una vez y ambas lo consumen.

  También lo requieren los tests de Node, de ahí el module.exports del final.
*/

/* El manifiesto y los .md se sirven como estáticos desde src/. */
const RUTA_BASE_NOTAS = "/content/notas";
const RUTA_MANIFIESTO_NOTAS = `${RUTA_BASE_NOTAS}/manifiesto.json`;

/*
  El nodo raíz no vive en el manifiesto: el manifiesto arranca en un arreglo de
  áreas. Se sintetiza acá para que "estoy en la portada" sea el mismo caso que
  "estoy en un tema" y las dos vistas no necesiten una rama especial para el
  nivel superior.
*/
const TITULO_RAIZ_NOTAS = "Notas";

const VISTAS_NOTAS = Object.freeze(["lista", "grafo"]);
/*
  El mapa es la vista de entrada. Un listado de tarjetas lo tiene cualquier
  sitio; lo que esta sección aporta es ver el conocimiento como una red, y
  esconderlo detrás de un segundo clic lo convierte en un extra que casi nadie
  descubre. El listado sigue a un clic para quien prefiera leer en columna.
*/
const VISTA_NOTAS_PREDETERMINADA = "grafo";

function esTextoUtil(valor) {
  return typeof valor === "string" && valor.trim().length > 0;
}

function textoNormalizado(valor) {
  return esTextoUtil(valor) ? valor.trim() : "";
}

function arregloDe(valor) {
  return Array.isArray(valor) ? valor : [];
}

/*
  Un nodo del árbol ya normalizado. `segmentos` es la ruta completa desde la
  raíz y hace las veces de identidad: se usa como clave del índice, como ruta
  del hash y para calcular el padre (segmentos.slice(0, -1)).

  Deliberadamente NO se guarda una referencia al padre. Sería cómodo, pero
  volvería el árbol cíclico y cualquier JSON.stringify —en un log, en un test,
  en el estado de una vista— explotaría.
*/
function crearNodo({ tipo, origen, segmentos }) {
  return {
    tipo,
    slug: textoNormalizado(origen.slug),
    /*
      El título cae al slug cuando falta, para que la página degrade en vez de
      mostrar una tarjeta en blanco. Eso mismo enmascararía el olvido ante la
      validación, así que `declarado` conserva lo que el manifiesto dijo de
      verdad y es contra eso que se revisan los campos obligatorios.
    */
    declarado: {
      titulo: textoNormalizado(origen.titulo),
      resumen: textoNormalizado(origen.resumen),
    },
    titulo: textoNormalizado(origen.titulo) || textoNormalizado(origen.slug),
    resumen: textoNormalizado(origen.resumen),
    /*
      Texto largo de contexto, solo en las áreas: de dónde salió la disciplina,
      quién la empujó y para qué se usa. Es distinto del resumen —que es la línea
      de la tarjeta— y se muestra encima del mapa mientras se navega el área
      entera, como ancla de en qué disciplina está parado el lector.
    */
    descripcion: textoNormalizado(origen.descripcion),
    segmentos,
    ruta: segmentos.join("/"),
    etiquetas: arregloDe(origen.etiquetas).filter(esTextoUtil).map(textoNormalizado),
    hijos: [],
    notas: [],
    /* Solo en notas: ruta del .md relativa a RUTA_BASE_NOTAS. */
    archivo: tipo === "nota" ? textoNormalizado(origen.archivo) : "",
    /*
      Habilitar/deshabilitar una nota sin borrarla ni sacarla del repo. Si el
      campo no está, la nota se considera publicada: exigir "publicada": true en
      cada entrada sería ruido en el 95% de los casos y, cuando se olvidara,
      una nota invisible sin ningún error que lo explique.
    */
    publicada: tipo === "nota" ? origen.publicada !== false : true,
    /*
      Espejo de los [[wikilinks]] que la nota tiene en su cuerpo. Se declara acá
      —y no se deduce leyendo los .md— porque el grafo tiene que poder dibujar
      relaciones sin descargar todas las notas del sitio. La sincronía entre
      ambos la vigila tests/notas-manifiesto.test.js.
    */
    relacionadas: tipo === "nota"
      ? arregloDe(origen.relacionadas).filter(esTextoUtil).map(textoNormalizado)
      : [],
    /*
      Notas que cuelgan de este nodo a cualquier profundidad. La lista lo usa
      para el contador ("12 notas") y el grafo para decidir el tamaño del nodo
      y para agregar las relaciones laterales de toda una rama en una sola
      arista. Una nota se contiene a sí misma para que ambos usos traten igual
      a un tema y a una nota suelta.
    */
    notasDescendientes: [],
  };
}

function construirNota(origen, segmentosPadre) {
  const nodo = crearNodo({
    tipo: "nota",
    origen,
    segmentos: [...segmentosPadre, textoNormalizado(origen.slug)],
  });
  nodo.notasDescendientes = [nodo.slug];
  return nodo;
}

function construirRama(origen, segmentosPadre, tipo, opciones) {
  const segmentos = [...segmentosPadre, textoNormalizado(origen.slug)];
  const nodo = crearNodo({ tipo, origen, segmentos });

  nodo.notas = arregloDe(origen.notas)
    .map((nota) => construirNota(nota, segmentos))
    .filter((nota) => opciones.incluirBorradores || nota.publicada);
  nodo.hijos = arregloDe(origen.hijos)
    .map((hijo) => construirRama(hijo, segmentos, "tema", opciones))
    /*
      Un tema al que solo le quedaban borradores queda vacío tras el filtro. Se
      poda en vez de mostrarse: en el grafo sería un nodo en el que se hace clic
      y no lleva a ningún lado.
    */
    .filter((hijo) => opciones.incluirBorradores || hijo.notasDescendientes.length > 0);

  const descendientes = [];
  nodo.notas.forEach((nota) => descendientes.push(...nota.notasDescendientes));
  nodo.hijos.forEach((hijo) => descendientes.push(...hijo.notasDescendientes));
  nodo.notasDescendientes = descendientes;

  return nodo;
}

/*
  Recorre el árbol ya construido en profundidad. Se usa para armar los índices
  y para la búsqueda; ninguna vista debería recorrer a mano.
*/
function recorrerNodos(nodo, visitar) {
  visitar(nodo);
  nodo.hijos.forEach((hijo) => recorrerNodos(hijo, visitar));
  nodo.notas.forEach((nota) => visitar(nota));
}

/*
  Punto de entrada: manifiesto crudo -> árbol navegable con sus índices.

  `porRuta` resuelve una ruta del hash en un solo paso y `notasPorSlug` resuelve
  las `relacionadas`, que se declaran por slug global y no por ruta justamente
  para que mover una nota de rama no obligue a editar las notas que la citan.

  `incluirBorradores` lo activan el panel de administración y la validación, que
  necesitan ver el árbol completo. La página pública nunca lo pasa.
*/
function construirArbolDeNotas(manifiesto, { incluirBorradores = false } = {}) {
  const opciones = { incluirBorradores };
  const raiz = crearNodo({
    tipo: "raiz",
    origen: { slug: "", titulo: TITULO_RAIZ_NOTAS, resumen: "" },
    segmentos: [],
  });

  raiz.hijos = arregloDe(manifiesto && manifiesto.areas)
    .map((area) => construirRama(area, [], "area", opciones))
    .filter((area) => incluirBorradores || area.notasDescendientes.length > 0);
  raiz.notasDescendientes = raiz.hijos.flatMap((hijo) => hijo.notasDescendientes);

  const porRuta = new Map();
  const notasPorSlug = new Map();
  recorrerNodos(raiz, (nodo) => {
    porRuta.set(nodo.ruta, nodo);
    if (nodo.tipo === "nota" && !notasPorSlug.has(nodo.slug)) {
      notasPorSlug.set(nodo.slug, nodo);
    }
  });

  return { raiz, porRuta, notasPorSlug };
}

/* ------------------------------------------------------------------ */
/* Ruteo por hash                                                      */
/* ------------------------------------------------------------------ */

/*
  Formato: #/<vista>/<segmento>/<segmento>...  — por ejemplo
  #/grafo/machine-learning/aprendizaje-supervisado/regresion

  La vista va DENTRO del hash y no en la query string para que compartir un
  enlace conserve exactamente lo que la otra persona vería, y para que cambiar
  de lista a grafo sea un cambio de hash más: no recarga la página ni pierde la
  posición en el árbol.

  Nunca lanza ni devuelve undefined. Un hash basura cae en la portada en modo
  lista, misma regla que resolverLenguajeActivo en el playground: es preferible
  una portada válida a una pantalla en blanco sin explicación.
*/
function parsearHashNotas(hash) {
  const crudo = typeof hash === "string" ? hash.trim().replace(/^#/, "") : "";
  const partes = crudo
    .split("/")
    .map((parte) => {
      /* Un hash escrito a mano puede traer %20 o acentos percent-encoded. */
      try {
        return decodeURIComponent(parte);
      } catch (error) {
        return parte;
      }
    })
    .map((parte) => parte.trim().toLowerCase())
    .filter((parte) => parte.length > 0);

  if (partes.length === 0) {
    return { vista: VISTA_NOTAS_PREDETERMINADA, segmentos: [] };
  }

  const vista = VISTAS_NOTAS.includes(partes[0]) ? partes[0] : VISTA_NOTAS_PREDETERMINADA;
  /*
    Si el primer segmento no es una vista conocida se conserva como parte de la
    ruta en vez de descartarlo: así un enlace viejo o acortado del tipo
    #/machine-learning sigue llevando al área correcta.
  */
  const segmentos = VISTAS_NOTAS.includes(partes[0]) ? partes.slice(1) : partes;

  return { vista, segmentos };
}

function construirHashNotas({ vista, segmentos } = {}) {
  const vistaValida = VISTAS_NOTAS.includes(vista) ? vista : VISTA_NOTAS_PREDETERMINADA;
  const ruta = arregloDe(segmentos)
    .filter(esTextoUtil)
    .map((segmento) => encodeURIComponent(textoNormalizado(segmento)));
  return `#/${[vistaValida, ...ruta].join("/")}`;
}

/*
  Baja por el árbol hasta donde los segmentos existan de verdad. Devuelve
  siempre un nodo utilizable: si la ruta apunta a algo que ya no está —una nota
  borrada, un enlace viejo—, entrega el ancestro más profundo que sí existe y
  marca `encontrado: false` para que la vista pueda avisar en vez de fingir que
  el destino era ese.
*/
function resolverRutaDeNotas(arbol, segmentos) {
  let nodo = arbol.raiz;
  const solicitados = arregloDe(segmentos).filter(esTextoUtil);

  for (const segmento of solicitados) {
    if (nodo.tipo === "nota") break;
    const siguiente =
      nodo.hijos.find((hijo) => hijo.slug === segmento) ||
      nodo.notas.find((nota) => nota.slug === segmento);
    if (!siguiente) {
      return { nodo, encontrado: false, segmentosSolicitados: solicitados };
    }
    nodo = siguiente;
  }

  return { nodo, encontrado: true, segmentosSolicitados: solicitados };
}

/*
  Migas desde la portada hasta el nodo, incluido. Se arma con el índice y no
  guardando padres en cada nodo, por lo dicho en crearNodo sobre los ciclos.
*/
/*
  El área a la que pertenece un nodo, a cualquier profundidad. La descripción que
  se muestra arriba del mapa es siempre la del área y no la del nivel actual: al
  bajar a Clustering o a DBSCAN, lo que el lector necesita recordar es que sigue
  dentro de Machine Learning.
*/
function areaDeNodo(arbol, nodo) {
  if (!nodo || !nodo.segmentos.length) return null;
  return arbol.porRuta.get(nodo.segmentos[0]) || null;
}

function migasDeNotas(arbol, nodo) {
  if (!nodo) return [];
  const migas = [];
  for (let corte = 0; corte <= nodo.segmentos.length; corte += 1) {
    const ancestro = arbol.porRuta.get(nodo.segmentos.slice(0, corte).join("/"));
    if (ancestro) migas.push({ titulo: ancestro.titulo, segmentos: ancestro.segmentos });
  }
  return migas;
}

/* Hijos navegables de un nodo, temas primero y notas después. */
function hijosNavegables(nodo) {
  if (!nodo || nodo.tipo === "nota") return [];
  return [...nodo.hijos, ...nodo.notas];
}

/* ------------------------------------------------------------------ */
/* Datos para el grafo                                                 */
/* ------------------------------------------------------------------ */

/*
  Pares de notas relacionadas, sin dirección y sin repetir. `relacionadas` se
  declara en una sola de las dos notas —obligar a declararlo en ambas sería una
  fuente garantizada de desincronización— y acá se normaliza a un par simétrico.
  Las referencias a notas inexistentes se descartan en silencio: el test del
  manifiesto es el que las convierte en error, no la página del lector.
*/
function relacionesEntreNotas(arbol) {
  const pares = new Map();
  arbol.notasPorSlug.forEach((nota) => {
    nota.relacionadas.forEach((otroSlug) => {
      if (otroSlug === nota.slug) return;
      if (!arbol.notasPorSlug.has(otroSlug)) return;
      const clave = [nota.slug, otroSlug].sort().join("::");
      if (!pares.has(clave)) pares.set(clave, [nota.slug, otroSlug].sort());
    });
  });
  return [...pares.values()];
}

/*
  Lo que el grafo dibuja cuando el lector está parado en `nodo`: el nodo actual
  al centro y sus hijos alrededor.

  Las aristas de jerarquía son el esqueleto. Las laterales son lo que hace que
  esto se lea como un mapa de conocimiento y no como un organigrama: si alguna
  nota de la rama A está relacionada con alguna de la rama B, se dibuja una
  arista entre A y B aunque las notas concretas estén tres niveles más abajo.
  Así la conexión entre PCA y regresión lineal ya se insinúa desde el nivel de
  las áreas, en vez de aparecer solo al llegar a las hojas.
*/
function vistaDeGrafo(arbol, nodo) {
  const actual = nodo || arbol.raiz;
  const hijos = hijosNavegables(actual);

  /*
    En la portada NO hay centro. La raíz es un contenedor que inventamos para
    tener dónde colgar las áreas, no un concepto: dibujarla convertiría a
    "Notas" en el nodo más general del mapa, por encima de Machine Learning o
    Ciberseguridad, que es exactamente al revés de como se ordena el
    conocimiento. Las áreas flotan sueltas, y si un día se agrega un concepto
    más general —Inteligencia artificial sobre Machine Learning—, ese concepto
    pasa a ser un área y queda arriba por derecho propio, no por andamiaje.
  */
  const centro = actual.tipo === "raiz" ? null : actual;

  const aristas = centro
    ? hijos.map((hijo) => ({
        origen: centro.ruta,
        destino: hijo.ruta,
        tipo: "jerarquia",
      }))
    : [];

  /* slug de nota -> ruta del hijo visible bajo el que cuelga. */
  const ramaDeNota = new Map();
  hijos.forEach((hijo) => {
    hijo.notasDescendientes.forEach((slug) => ramaDeNota.set(slug, hijo.ruta));
  });

  const lateralesVistas = new Set();
  relacionesEntreNotas(arbol).forEach(([slugA, slugB]) => {
    const ramaA = ramaDeNota.get(slugA);
    const ramaB = ramaDeNota.get(slugB);
    /*
      Solo interesan las relaciones que cruzan de una rama visible a otra. Si
      ambas notas cuelgan del mismo hijo, esa conexión se verá al entrar en él;
      dibujarla acá sería un bucle sobre sí mismo.
    */
    if (!ramaA || !ramaB || ramaA === ramaB) return;
    const clave = [ramaA, ramaB].sort().join("::");
    if (lateralesVistas.has(clave)) return;
    lateralesVistas.add(clave);
    aristas.push({ origen: ramaA, destino: ramaB, tipo: "relacion" });
  });

  return { centro, nodos: hijos, aristas };
}

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */

/*
  Comparación tolerante a acentos y mayúsculas: quien busca "regresion logistica"
  espera encontrar "Regresión logística". NFD + quitar diacríticos es suficiente
  acá y no necesita tabla de reemplazos.
*/
function normalizarParaBusqueda(texto) {
  return textoNormalizado(texto)
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/*
  Busca en títulos, resúmenes y etiquetas de TODO el árbol, no solo del nodo
  actual: el lector que escribe "pca" casi nunca sabe en qué rama vive.
*/
function buscarEnNotas(arbol, consulta) {
  const terminos = normalizarParaBusqueda(consulta).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return [];

  const resultados = [];
  recorrerNodos(arbol.raiz, (nodo) => {
    if (nodo.tipo === "raiz") return;
    const texto = normalizarParaBusqueda(
      [nodo.titulo, nodo.resumen, ...nodo.etiquetas].join(" ")
    );
    if (terminos.every((termino) => texto.includes(termino))) resultados.push(nodo);
  });

  /*
    Las notas primero: son el destino final de la navegación. Entre iguales, el
    orden del manifiesto, que es el orden de lectura que eligió quien escribe.
  */
  return resultados.sort((a, b) => {
    if (a.tipo === b.tipo) return 0;
    return a.tipo === "nota" ? -1 : 1;
  });
}

/* ------------------------------------------------------------------ */
/* Wikilinks                                                           */
/* ------------------------------------------------------------------ */

/*
  Las relaciones se escriben dentro del markdown como en un vault de Obsidian:
  [[slug-de-la-nota]] o [[slug-de-la-nota|texto que se lee]].
*/
const PATRON_WIKILINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*))?\]\]/g;

/*
  Un [[enlace]] dentro de código NO es un enlace. Esto no es teórico: en notas
  de ciencia de datos `df[["col_a","col_b"]]` es la forma normal de seleccionar
  columnas en pandas, y sin quitar el código antes de buscar, ese fragmento se
  convertiría en una relación fantasma hacia una nota inexistente.

  Se reemplaza por espacios en vez de borrar para no correr los offsets si algún
  día alguien quiere reportar la posición del enlace.
*/
function sinCodigo(markdown) {
  return textoNormalizado(markdown)
    .replace(/```[\s\S]*?```/g, (bloque) => " ".repeat(bloque.length))
    .replace(/~~~[\s\S]*?~~~/g, (bloque) => " ".repeat(bloque.length))
    .replace(/`[^`\n]*`/g, (bloque) => " ".repeat(bloque.length));
}

/* Slugs citados por el cuerpo de una nota, en orden y sin repetir. */
function extraerWikilinks(markdown) {
  const encontrados = [];
  const cuerpo = sinCodigo(markdown);
  let coincidencia = PATRON_WIKILINK.exec(cuerpo);
  while (coincidencia !== null) {
    const destino = textoNormalizado(coincidencia[1]).toLocaleLowerCase("es-MX");
    if (destino && !encontrados.includes(destino)) encontrados.push(destino);
    coincidencia = PATRON_WIKILINK.exec(cuerpo);
  }
  /* El regex es global y con estado: sin esto, la segunda llamada empieza a
     mitad del texto anterior y devuelve de menos. */
  PATRON_WIKILINK.lastIndex = 0;
  return encontrados;
}

/*
  Convierte los [[wikilinks]] en enlaces markdown normales antes de que el
  renderizador toque el texto.

  El patrón alterna "esto es código" contra "esto es un wikilink" en una sola
  pasada, en vez de limpiar el código primero como hace extraerWikilinks: acá
  hay que conservar el código intacto en la salida, no solo ignorarlo.

  `resolver` recibe el slug y devuelve { href, titulo } si la nota existe, o algo
  falsy si no. Un enlace roto se degrada a texto marcado en vez de a un enlace
  que lleva a ningún lado; el test del manifiesto es el que impide que llegue a
  publicarse.
*/
const PATRON_CODIGO_O_WIKILINK =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*))?\]\]/g;

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reemplazarWikilinks(markdown, resolver) {
  return textoNormalizado(markdown).replace(
    PATRON_CODIGO_O_WIKILINK,
    (coincidencia, codigo, destino, alias) => {
      if (codigo) return codigo;

      const slug = textoNormalizado(destino).toLocaleLowerCase("es-MX");
      const nota = typeof resolver === "function" ? resolver(slug) : null;
      const texto = textoNormalizado(alias) || (nota && nota.titulo) || slug;

      if (!nota) return `<span class="notas__enlace-roto">${escaparHtml(texto)}</span>`;
      /* Markdown y no HTML: así el renderizador le aplica el mismo tratamiento
         que a cualquier otro enlace de la nota. */
      return `[${texto.replace(/[[\]]/g, "")}](${nota.href})`;
    }
  );
}

/* ------------------------------------------------------------------ */
/* Frontmatter                                                         */
/* ------------------------------------------------------------------ */

/*
  Los metadatos de cada nota —título, resumen, etiquetas— viven en un bloque
  delimitado por --- al inicio del archivo, igual que en Obsidian. De ahí los
  lee tools/notas.js para generar el manifiesto, y de ahí los tiene que quitar
  el sitio antes de renderizar el cuerpo.

  Esas dos necesidades usan ESTA función y no dos copias, porque un parser de
  frontmatter duplicado que se desincroniza deja el bloque impreso como texto en
  medio de la nota publicada.

  Es un subconjunto de YAML deliberadamente chico, no YAML:
    clave: valor              (con o sin comillas; true/false y números se convierten)
    clave: [uno, dos]         (lista en línea)
    clave:                    (lista en bloque)
      - uno
      - dos
  Cualquier otra sintaxis se reporta como error en vez de ignorarse: un
  "resumen:" mal escrito que se descarta en silencio es una tarjeta sin resumen
  que nadie entiende por qué salió vacía.
*/
const DELIMITADOR_FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function convertirEscalarDeFrontmatter(texto) {
  const valor = texto.trim();
  if (valor === "true") return true;
  if (valor === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(valor)) return Number(valor);
  const entrecomillado = valor.match(/^"([\s\S]*)"$/) || valor.match(/^'([\s\S]*)'$/);
  return entrecomillado ? entrecomillado[1] : valor;
}

function convertirListaEnLinea(texto) {
  const interior = texto.trim().slice(1, -1).trim();
  if (!interior) return [];
  return interior.split(",").map((parte) => convertirEscalarDeFrontmatter(parte));
}

function analizarFrontmatter(bloque) {
  const datos = {};
  const errores = [];
  const lineas = bloque.split(/\r?\n/);

  for (let indice = 0; indice < lineas.length; indice += 1) {
    const linea = lineas[indice];
    if (!linea.trim() || linea.trim().startsWith("#")) continue;

    const coincidencia = linea.match(/^([A-Za-zÁÉÍÓÚÑáéíóúñ_][\w-]*)[ \t]*:[ \t]*(.*)$/);
    if (!coincidencia) {
      errores.push(`línea ${indice + 1}: no se entiende «${linea.trim()}»`);
      continue;
    }

    const [, clave, resto] = coincidencia;

    if (resto.trim().startsWith("[") && resto.trim().endsWith("]")) {
      datos[clave] = convertirListaEnLinea(resto);
      continue;
    }

    if (resto.trim()) {
      datos[clave] = convertirEscalarDeFrontmatter(resto);
      continue;
    }

    /* Sin valor en la misma línea: o es una lista en bloque, o está vacío. */
    const elementos = [];
    while (indice + 1 < lineas.length && /^[ \t]*-[ \t]+/.test(lineas[indice + 1])) {
      indice += 1;
      elementos.push(convertirEscalarDeFrontmatter(lineas[indice].replace(/^[ \t]*-[ \t]+/, "")));
    }
    datos[clave] = elementos;
  }

  return { datos, errores };
}

/*
  Separa metadatos de contenido. Un archivo sin frontmatter no es un error:
  devuelve datos vacíos y el texto entero como cuerpo, y es la herramienta de
  generación la que decide si esa nota puede publicarse así.
*/
function separarFrontmatter(texto) {
  const contenido = typeof texto === "string" ? texto.replace(/^﻿/, "") : "";
  const coincidencia = contenido.match(DELIMITADOR_FRONTMATTER);
  if (!coincidencia) return { datos: {}, cuerpo: contenido, errores: [], tieneFrontmatter: false };

  const { datos, errores } = analizarFrontmatter(coincidencia[1]);
  return {
    datos,
    cuerpo: contenido.slice(coincidencia[0].length),
    errores,
    tieneFrontmatter: true,
  };
}

/* ------------------------------------------------------------------ */
/* Validación del manifiesto (la usan los tests)                       */
/* ------------------------------------------------------------------ */

/*
  Vive acá y no en el test porque son las reglas del modelo, no del test: el
  día que el manifiesto se edite desde otro lado, estas siguen siendo las
  condiciones para que las vistas no se rompan.

  Devuelve la lista completa de problemas en vez de cortar en el primero, para
  que quien agrega diez notas de golpe los vea todos juntos.
*/
function validarManifiestoDeNotas(manifiesto) {
  const errores = [];
  /* Los borradores también se validan: un borrador roto se publica roto. */
  const arbol = construirArbolDeNotas(manifiesto, { incluirBorradores: true });
  const slugsDeNota = new Map();

  const revisarNodo = (nodo) => {
    const donde = nodo.ruta || "(raíz)";

    if (nodo.tipo !== "raiz") {
      if (!nodo.slug) errores.push(`${donde}: falta slug`);
      /*
        El slug viaja en la URL. Restringirlo a minúsculas, dígitos y guiones
        evita rutas que dependan de encodeURIComponent para existir.
      */
      if (nodo.slug && !/^[a-z0-9-]+$/.test(nodo.slug)) {
        errores.push(`${donde}: el slug "${nodo.slug}" solo admite minúsculas, dígitos y guiones`);
      }
      if (!nodo.declarado.titulo) errores.push(`${donde}: falta título`);
      if (!nodo.declarado.resumen) {
        /* El resumen es lo que se lee en la tarjeta y en el tooltip del grafo. */
        errores.push(`${donde}: falta resumen`);
      }
    }

    if (nodo.tipo === "nota") {
      if (!nodo.archivo) errores.push(`${donde}: falta archivo`);
      if (nodo.archivo && !nodo.archivo.endsWith(".md")) {
        errores.push(`${donde}: el archivo debe ser .md`);
      }
      if (nodo.hijos.length || nodo.notas.length) {
        errores.push(`${donde}: una nota no puede tener hijos`);
      }
      const previo = slugsDeNota.get(nodo.slug);
      if (previo) {
        errores.push(`${donde}: el slug de nota "${nodo.slug}" ya lo usa ${previo}`);
      } else {
        slugsDeNota.set(nodo.slug, donde);
      }
      nodo.relacionadas.forEach((otro) => {
        if (otro === nodo.slug) errores.push(`${donde}: se relaciona consigo misma`);
      });
    } else if (nodo.tipo !== "raiz" && nodo.hijos.length === 0 && nodo.notas.length === 0) {
      /*
        Un tema vacío se ve como un nodo del grafo que no lleva a ningún lado:
        el lector hace clic y no pasa nada.
      */
      errores.push(`${donde}: un tema debe tener notas o subtemas`);
    }

    /* Los hermanos comparten espacio de nombres porque comparten URL. */
    const hermanos = hijosNavegables(nodo).map((hijo) => hijo.slug);
    hermanos.forEach((slug, indice) => {
      if (hermanos.indexOf(slug) !== indice) {
        errores.push(`${donde}: el slug "${slug}" está repetido entre hermanos`);
      }
    });
  };

  recorrerNodos(arbol.raiz, revisarNodo);

  /* Las relacionadas se validan al final: pueden apuntar a cualquier rama. */
  arbol.notasPorSlug.forEach((nota) => {
    nota.relacionadas.forEach((otro) => {
      if (!arbol.notasPorSlug.has(otro)) {
        errores.push(`${nota.ruta}: relacionada con "${otro}", que no existe`);
      }
    });
  });

  if (arbol.raiz.hijos.length === 0) errores.push("(raíz): el manifiesto no tiene áreas");

  return { ok: errores.length === 0, errores };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    RUTA_BASE_NOTAS,
    RUTA_MANIFIESTO_NOTAS,
    TITULO_RAIZ_NOTAS,
    VISTAS_NOTAS,
    VISTA_NOTAS_PREDETERMINADA,
    construirArbolDeNotas,
    parsearHashNotas,
    construirHashNotas,
    resolverRutaDeNotas,
    migasDeNotas,
    areaDeNodo,
    hijosNavegables,
    relacionesEntreNotas,
    vistaDeGrafo,
    buscarEnNotas,
    normalizarParaBusqueda,
    extraerWikilinks,
    reemplazarWikilinks,
    separarFrontmatter,
    analizarFrontmatter,
    escaparHtml,
    sinCodigo,
    validarManifiestoDeNotas,
  });
}
