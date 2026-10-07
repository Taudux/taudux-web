/*
  Acceso a los datos de las presentaciones de Slides.

  Hay DOS orígenes, y el catálogo los junta:

  1. Las del REPOSITORIO: archivos estáticos que se sirven desde
     /content/slides. Son públicas y no pasan por sesión ni RLS — mismo caso
     que notas.service.js. /content/slides/manifiesto.json es sólo el ÍNDICE
     (un arreglo de slugs, uno por carpeta) y cada carpeta trae su propio
     manifiesto con título, descripción, categoría, fecha, número de láminas,
     autor, portada y el archivo a abrir. Se bajan todos EN PARALELO
     (Promise.allSettled) y una carpeta rota —404, JSON inválido— se descarta
     con un aviso en consola en vez de tumbar el catálogo entero.

  2. Las SUBIDAS desde la propia página (0048): filas de `slides_subidas` con
     su HTML en el bucket privado `slides`. El catálogo sale de la función
     `catalogo_slides_subidas()`, que ya aplica la visibilidad de quien
     pregunta (anon sólo ve lo público; un administrador ve todo; un autor ve
     lo suyo). Si esa llamada falla —sin conexión, o la migración todavía no
     está aplicada— el catálogo del repositorio sigue en pie: un origen roto
     no tumba al otro.

  Conserva el contrato de resultados del proyecto —{ ok, mensaje } en vez de
  excepciones—. El catálogo del repositorio se cachea en memoria para no
  bajarlo dos veces en la misma visita; las subidas NO, porque dependen de la
  sesión y cambian cuando alguien sube o publica.

  Este servicio entrega el catálogo ya armado; normalizar y validar cada
  entrada a fondo (y el formulario de subida) es trabajo de slides.logica.js,
  que carga ANTES que este archivo y del que el servicio usa
  `validarSubida` y `slugDesdeTitulo`.
*/

const reporteroSlides =
  typeof crearReporteroOperaciones === "function"
    ? crearReporteroOperaciones("slides")
    : { iniciarTiempo: () => 0, reportarFallo: () => {} };

const RUTA_BASE_SLIDES = "/content/slides";
const RUTA_MANIFIESTO_SLIDES = `${RUTA_BASE_SLIDES}/manifiesto.json`;
/* La página que abre un deck subido. El slug viaja en el hash. */
const RUTA_PUENTE_SLIDES = `${RUTA_BASE_SLIDES}/_subida/`;
const BUCKET_SLIDES = "slides";
const SEGUNDOS_DE_URL_FIRMADA = 3600;

/* Caché en memoria de la vida de la página: el catálogo del repositorio se
   descarga una sola vez aunque el visor y la lista lo pidan a la vez. */
let catalogoEnMemoria = null;
let cargaDeCatalogoEnCurso = null;

/* El cliente de Supabase es un `const` global de supabase-client.js: si el CDN
   no cargó, ese script lanzó y el nombre queda sin inicializar para siempre,
   así que leerlo lanza. Acá eso se vuelve `null`. */
function clienteDeSlides() {
  try {
    return supabaseClient || null;
  } catch {
    return null;
  }
}

/*
  Una respuesta 200 con HTML es el modo típico de fallar de un host estático:
  la ruta no existe y devuelve la página de error o el index. Sin esta
  comprobación, JSON.parse fallaría con un mensaje que no ayuda a nadie.
*/
function esRespuestaDeArchivoAusente(respuesta) {
  const tipo = respuesta.headers.get("content-type") || "";
  return tipo.includes("text/html");
}

/*
  Descarga el manifiesto de UNA carpeta y arma la entrada de catálogo que le
  corresponde, o `null` si esa carpeta no se puede ofrecer (404, tipo de
  contenido raro, JSON que no parsea o que no es un objeto). Nunca lanza: el
  llamador la usa dentro de Promise.allSettled y un `null` alcanza para que
  esa carpeta se descarte sin tumbar a las demás.
*/
async function cargarManifiestoDeCarpeta(slug) {
  const respuesta = await fetch(`${RUTA_BASE_SLIDES}/${slug}/manifiesto.json`, { cache: "no-cache" });
  if (!respuesta.ok || esRespuestaDeArchivoAusente(respuesta)) return null;

  const manifiesto = await respuesta.json();
  if (!manifiesto || typeof manifiesto !== "object") return null;

  return {
    slug,
    titulo: manifiesto.titulo,
    descripcion: manifiesto.descripcion,
    archivo: manifiesto.archivo,
    categoria: manifiesto.categoria,
    actualizado: manifiesto.actualizado,
    total_laminas: manifiesto.total_laminas,
    autor: manifiesto.autor,
    portada: manifiesto.portada,
    origen: "repo",
    visibilidad: "publico",
    url: `${RUTA_BASE_SLIDES}/${slug}/${manifiesto.archivo}`,
    // La portada del repositorio es un archivo estático de la propia carpeta.
    portada_url: typeof manifiesto.portada === "string" && manifiesto.portada
      ? `${RUTA_BASE_SLIDES}/${slug}/${manifiesto.portada}`
      : "",
  };
}

/* Una fila de catalogo_slides_subidas() con la forma de una entrada del
   catálogo. `archivo` es siempre index.html: así la entrada pasa la misma
   validación que las del repositorio. */
function entradaDeSubida(fila) {
  return {
    id: fila.id,
    slug: fila.slug,
    titulo: fila.titulo,
    descripcion: fila.descripcion || undefined,
    archivo: "index.html",
    categoria: fila.categoria,
    actualizado: fila.actualizado_en,
    total_laminas: fila.total_laminas,
    autor: fila.autor || undefined,
    origen: "subida",
    visibilidad: fila.visibilidad,
    archivo_path: fila.archivo_path,
    portada_path: fila.portada_path || "",
    // Versión del HTML (0049): sube al reemplazarlo y va en la URL de descarga.
    version: fila.version_archivo || 1,
    // `es_mio` y `autor_id` (0049) sólo deciden qué botones mostrar y qué
    // preseleccionar en el formulario: la RLS es la que manda. `autor_id` llega
    // únicamente al administrador y al propio autor.
    es_mio: fila.es_mio === true,
    autor_id: fila.autor_id || null,
    portada_url: "",
    url: `${RUTA_PUENTE_SLIDES}#${fila.slug}`,
  };
}

/* Las subidas visibles para quien está mirando. Nunca lanza ni tumba al
   catálogo: sin cliente, sin red o sin la migración, es una lista vacía. */
async function cargarSubidasDeSlides() {
  const cliente = clienteDeSlides();
  if (!cliente) return [];

  try {
    const { data, error } = await cliente.rpc("catalogo_slides_subidas");
    if (error) {
      console.warn("slides: no se pudieron cargar las presentaciones subidas —", error.message || error);
      return [];
    }
    return (Array.isArray(data) ? data : []).map(entradaDeSubida);
  } catch (error) {
    console.warn("slides: no se pudieron cargar las presentaciones subidas —", error);
    return [];
  }
}

async function cargarCatalogoDelRepositorio(inicio) {
  if (catalogoEnMemoria) return { ok: true, catalogo: catalogoEnMemoria };

  const respuesta = await fetch(RUTA_MANIFIESTO_SLIDES, { cache: "no-cache" });
  if (!respuesta.ok || esRespuestaDeArchivoAusente(respuesta)) {
    reporteroSlides.reportarFallo("cargar_indice", null, inicio, `http_${respuesta.status}`);
    return { ok: false, mensaje: "No se pudo cargar el catálogo de presentaciones." };
  }

  const indice = await respuesta.json();
  if (!Array.isArray(indice)) {
    reporteroSlides.reportarFallo("cargar_indice", null, inicio, "indice_invalido");
    return { ok: false, mensaje: "El catálogo de presentaciones no es válido." };
  }

  const resultados = await Promise.allSettled(
    indice.map((slug) => cargarManifiestoDeCarpeta(slug))
  );

  const catalogo = [];
  resultados.forEach((resultado, posicion) => {
    if (resultado.status === "fulfilled" && resultado.value) {
      catalogo.push(resultado.value);
      return;
    }
    const slug = indice[posicion];
    const motivo = resultado.status === "rejected" ? resultado.reason : "manifiesto inválido";
    console.warn(`slides: se descarta la carpeta "${slug}" — ${motivo}`);
  });

  catalogoEnMemoria = catalogo;
  return { ok: true, catalogo };
}

/*
  Descarga el catálogo: el del repositorio (índice y luego cada manifiesto EN
  PARALELO) más las subidas que la sesión actual puede ver. Las llamadas
  concurrentes comparten la misma promesa, y un índice que llega roto se trata
  como error de carga y no se cachea, para que un "Reintentar" tenga sentido —
  una carpeta suelta rota, en cambio, sólo se descarta a sí misma (ver
  cargarManifiestoDeCarpeta).

  Si una subida repite el slug de una del repositorio, gana la del
  repositorio: es la que ya tiene enlaces compartidos.
*/
async function cargarCatalogoDeSlides() {
  if (cargaDeCatalogoEnCurso) return cargaDeCatalogoEnCurso;

  const inicio = reporteroSlides.iniciarTiempo();

  cargaDeCatalogoEnCurso = (async () => {
    try {
      const [repositorio, subidas] = await Promise.all([
        cargarCatalogoDelRepositorio(inicio),
        cargarSubidasDeSlides(),
      ]);
      if (!repositorio.ok) return repositorio;

      const slugsDelRepositorio = new Set(repositorio.catalogo.map((item) => item.slug));
      const nuevas = subidas.filter((item) => {
        if (!slugsDelRepositorio.has(item.slug)) return true;
        console.warn(`slides: la subida "${item.slug}" repite un slug del repositorio y se descarta`);
        return false;
      });

      return { ok: true, catalogo: [...repositorio.catalogo, ...nuevas] };
    } catch (error) {
      reporteroSlides.reportarFallo("cargar_indice", error, inicio, "excepcion");
      return { ok: false, mensaje: "No se pudo cargar el catálogo de presentaciones." };
    } finally {
      /* Se libera pase lo que pase: si quedara colgada, un fallo de red
         dejaría el "Reintentar" devolviendo para siempre la promesa fallida. */
      cargaDeCatalogoEnCurso = null;
    }
  })();

  return cargaDeCatalogoEnCurso;
}

/* Deja la caché en cero. Lo usa el botón de reintentar. */
function olvidarSlidesEnMemoria() {
  catalogoEnMemoria = null;
  cargaDeCatalogoEnCurso = null;
}

/* ------------------------------------------------------------------ */
/* Quién puede qué                                                     */
/* ------------------------------------------------------------------ */

/*
  Si la persona de la sesión puede subir presentaciones. SÓLO decide qué
  mostrar: la RLS (0048) es la que protege de verdad. Sin sesión, sin cliente
  o con cualquier fallo, no puede nada.
*/
async function cargarPermisosDeSlides() {
  const sinPermisos = { ok: true, admin: false, autor: false, usuarioId: null };
  const cliente = clienteDeSlides();
  if (!cliente) return sinPermisos;

  try {
    const { data } = await cliente.auth.getSession();
    const sesion = data && data.session;
    if (!sesion || !sesion.user) return sinPermisos;

    const admin = typeof esAdmin === "function" ? Boolean(await esAdmin(sesion)) : false;
    let autor = false;
    const respuesta = await cliente.rpc("es_autor_slides");
    if (!respuesta.error) autor = respuesta.data === true;

    return { ok: true, admin, autor, usuarioId: sesion.user.id };
  } catch {
    return sinPermisos;
  }
}

/* Los autores marcados, para el selector del administrador. */
async function cargarAutoresDeSlides() {
  const cliente = clienteDeSlides();
  if (!cliente) return { ok: false, mensaje: "No se pudo cargar la lista de autores.", autores: [] };

  try {
    const { data, error } = await cliente.rpc("listar_autores_slides");
    if (error) return { ok: false, mensaje: "No se pudo cargar la lista de autores.", autores: [] };
    const autores = (Array.isArray(data) ? data : []).map((fila) => ({
      id: fila.id,
      nombre: [fila.nombre, fila.apellidos].filter(Boolean).join(" ").trim() || "Sin nombre",
    }));
    return { ok: true, autores };
  } catch {
    return { ok: false, mensaje: "No se pudo cargar la lista de autores.", autores: [] };
  }
}

/* Las categorías ya usadas (en lo subido), para sugerirlas en el formulario. */
async function cargarCategoriasDeSlides() {
  const cliente = clienteDeSlides();
  if (!cliente) return { ok: false, categorias: [] };

  try {
    const { data, error } = await cliente.rpc("categorias_slides");
    if (error) return { ok: false, categorias: [] };
    return {
      ok: true,
      categorias: (Array.isArray(data) ? data : []).map((fila) => fila.categoria).filter(Boolean),
    };
  } catch {
    return { ok: false, categorias: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Subir y publicar                                                    */
/* ------------------------------------------------------------------ */

/* "Ya existe" en Storage llega como 409 o con ese texto, según la versión. */
function esErrorDeObjetoDuplicado(error) {
  if (!error) return false;
  const texto = String(error.message || "").toLowerCase();
  return String(error.statusCode) === "409" || texto.includes("already exists") || texto.includes("duplicate");
}

function mensajeDeErrorDeSubida(error) {
  if (!error) return "No se pudo subir la presentación.";
  if (error.code === "23505" || esErrorDeObjetoDuplicado(error)) {
    return "Ya existe una presentación con ese título. Cámbialo un poco e inténtalo de nuevo.";
  }
  if (error.code === "42501") return "No tienes permiso para subir presentaciones.";
  if (error.code === "P0001") return "Esa persona ya no está marcada como autora de Slides.";
  if (error.code === "23514") return "Alguno de los datos no es válido. Revisa el formulario.";
  return "No se pudo subir la presentación. Inténtalo de nuevo.";
}

/*
  Sube una presentación: el HTML (y la portada, si hay) al bucket y la fila a
  `slides_subidas`. Si algo falla a medias, deshace lo que ya había subido para
  no dejar archivos sin fila.

  `datos`: { titulo, descripcion, categoria, categoriasExistentes, archivo,
  portada, totalLaminas, autorId, visibilidad }. `autorId` y `visibilidad`
  sólo cuentan para un administrador: un autor sube SIEMPRE a su nombre y «por
  revisar», y la RLS lo exige igual aunque este código se saltara.
*/
async function subirSlide(datos) {
  const inicio = reporteroSlides.iniciarTiempo();
  const cliente = clienteDeSlides();
  if (!cliente) return { ok: false, mensaje: "No se pudo conectar. Inténtalo más tarde." };

  const permisos = await cargarPermisosDeSlides();
  if (!permisos.usuarioId) return { ok: false, mensaje: "Inicia sesión para subir una presentación." };
  if (!permisos.admin && !permisos.autor) {
    return { ok: false, mensaje: "No tienes permiso para subir presentaciones." };
  }

  const entrada = datos && typeof datos === "object" ? datos : {};
  const validacion = validarSubida(entrada, {
    esAdmin: permisos.admin,
    categorias: entrada.categoriasExistentes,
  });
  if (!validacion.ok) return { ok: false, mensaje: Object.values(validacion.errores)[0] };

  const totalLaminas = entrada.totalLaminas;
  if (!Number.isInteger(totalLaminas) || totalLaminas < 1) {
    return { ok: false, mensaje: "El archivo no trae láminas (section.slide)." };
  }

  const { slug, titulo, descripcion, categoria } = validacion.valores;
  const autorId = permisos.admin ? validacion.valores.autorId : permisos.usuarioId;
  const visibilidad = permisos.admin ? validacion.valores.visibilidad : "por_revisar";

  const rutaArchivo = `${autorId}/${slug}/index.html`;
  const rutaPortada = entrada.portada ? `${autorId}/${slug}/portada.webp` : null;
  const subidos = [];
  const almacen = cliente.storage.from(BUCKET_SLIDES);

  async function deshacer() {
    if (subidos.length === 0) return;
    try {
      await almacen.remove(subidos);
    } catch {
      // Lo que no se pudo retirar queda sin fila; un administrador lo ve en
      // Storage. No hay nada más que hacer desde acá.
    }
  }

  try {
    const archivo = await almacen.upload(rutaArchivo, entrada.archivo, {
      contentType: "text/html",
      upsert: false,
    });
    if (archivo.error) {
      reporteroSlides.reportarFallo("subir_archivo", archivo.error, inicio, "storage");
      return { ok: false, mensaje: mensajeDeErrorDeSubida(archivo.error) };
    }
    subidos.push(rutaArchivo);

    if (rutaPortada) {
      const portada = await almacen.upload(rutaPortada, entrada.portada, {
        contentType: "image/webp",
        upsert: false,
      });
      if (portada.error) {
        reporteroSlides.reportarFallo("subir_portada", portada.error, inicio, "storage");
        await deshacer();
        return { ok: false, mensaje: mensajeDeErrorDeSubida(portada.error) };
      }
      subidos.push(rutaPortada);
    }

    const insercion = await cliente.from("slides_subidas").insert({
      slug,
      titulo,
      descripcion,
      categoria,
      visibilidad,
      autor_id: autorId,
      archivo_path: rutaArchivo,
      portada_path: rutaPortada,
      total_laminas: totalLaminas,
    });
    if (insercion.error) {
      reporteroSlides.reportarFallo("insertar_fila", insercion.error, inicio, insercion.error.code || "insert");
      await deshacer();
      return { ok: false, mensaje: mensajeDeErrorDeSubida(insercion.error) };
    }

    // Las subidas no se cachean: la próxima carga del catálogo ya la incluye.
    return { ok: true, slug, visibilidad };
  } catch (error) {
    reporteroSlides.reportarFallo("subir_slide", error, inicio, "excepcion");
    await deshacer();
    return { ok: false, mensaje: "No se pudo subir la presentación. Inténtalo de nuevo." };
  }
}

/* Pasa una presentación a pública. Sólo un administrador: para cualquier otra
   cuenta la RLS no le deja ver la fila y el update no toca nada. */
async function publicarSlide(id) {
  const cliente = clienteDeSlides();
  if (!cliente) return { ok: false, mensaje: "No se pudo conectar. Inténtalo más tarde." };

  try {
    const { data, error } = await cliente
      .from("slides_subidas")
      .update({ visibilidad: "publico" })
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, mensaje: "No se pudo publicar la presentación." };
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, mensaje: "No se pudo publicar: ¿sigues siendo administrador?" };
    }
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No se pudo publicar la presentación." };
  }
}

/* ------------------------------------------------------------------ */
/* Editar y borrar (0049)                                              */
/* ------------------------------------------------------------------ */

const MENSAJE_SIN_PERMISO_DE_EDICION =
  "No se pudo guardar: no tienes permiso para editar esta presentación.";
const MENSAJE_SIN_PERMISO_DE_BORRADO =
  "No se pudo borrar: no tienes permiso para borrar esta presentación.";

function esErrorDePermiso(error) {
  if (!error) return false;
  const texto = String(error.message || "").toLowerCase();
  return error.code === "42501"
    || String(error.statusCode) === "403"
    || texto.includes("row-level security")
    || texto.includes("not authorized");
}

function mensajeDeErrorDeEdicion(error) {
  if (!error) return "No se pudieron guardar los cambios.";
  if (esErrorDePermiso(error)) return MENSAJE_SIN_PERMISO_DE_EDICION;
  if (error.code === "P0001") {
    return String(error.message || "").includes("cambiar el autor")
      ? "Sólo un administrador puede cambiar el autor de una presentación."
      : "Esa persona ya no está marcada como autora de Slides.";
  }
  if (error.code === "23514") return "Alguno de los datos no es válido. Revisa el formulario.";
  return "No se pudieron guardar los cambios. Inténtalo de nuevo.";
}

/*
  Guarda los cambios de una presentación subida. Sólo el administrador y el
  autor de la fila pueden (la RLS de 0049 lo exige igual que esto).

  `datos`: { id, slug, autorIdActual, archivoPathActual, portadaPathActual,
  visibilidadActual, versionActual, titulo, descripcion, categoria,
  categoriasExistentes, archivo?, totalLaminas?, portada?, quitarPortada?,
  autorId?, visibilidad? }. Sin `archivo` se conserva el HTML actual; sin
  `portada` y sin `quitarPortada`, la portada actual. `autorId` y
  `visibilidad` sólo cuentan para un administrador: un autor nunca los manda y
  la base deja su edición en «por revisar» pase lo que pase.

  El slug no cambia (es la dirección), así que las rutas del bucket tampoco,
  salvo cuando el administrador cambia de autor: ahí los archivos se MUEVEN a
  la carpeta del autor nuevo antes de actualizar la fila, y vuelven a su lugar
  si la fila no se pudo actualizar.

  Reemplazar un archivo es un `upsert`, así que si la fila falla después, el
  archivo viejo ya no se puede recuperar; por eso la fila se actualiza justo
  después de subir y no al final de nada más.
*/
async function editarSlide(datos) {
  const inicio = reporteroSlides.iniciarTiempo();
  const cliente = clienteDeSlides();
  if (!cliente) return { ok: false, mensaje: "No se pudo conectar. Inténtalo más tarde." };

  const permisos = await cargarPermisosDeSlides();
  if (!permisos.usuarioId) return { ok: false, mensaje: "Inicia sesión para editar una presentación." };
  if (!permisos.admin && !permisos.autor) return { ok: false, mensaje: MENSAJE_SIN_PERMISO_DE_EDICION };

  const entrada = datos && typeof datos === "object" ? datos : {};
  if (!entrada.id || !entrada.slug || !entrada.archivoPathActual) {
    return { ok: false, mensaje: "No se pudo identificar la presentación a editar." };
  }

  const validacion = validarSubida(entrada, {
    esAdmin: permisos.admin,
    categorias: entrada.categoriasExistentes,
    modo: "edicion",
    slugPropio: entrada.slug,
  });
  if (!validacion.ok) return { ok: false, mensaje: Object.values(validacion.errores)[0] };

  const reemplazaArchivo = Boolean(entrada.archivo);
  if (reemplazaArchivo && (!Number.isInteger(entrada.totalLaminas) || entrada.totalLaminas < 1)) {
    return { ok: false, mensaje: "El archivo no trae láminas (section.slide)." };
  }

  const { slug, titulo, descripcion, categoria } = validacion.valores;
  const autorActual = entrada.autorIdActual || (permisos.admin ? "" : permisos.usuarioId);
  if (!autorActual) return { ok: false, mensaje: "No se pudo identificar al autor de la presentación." };

  const autorFinal = permisos.admin ? validacion.valores.autorId : autorActual;
  const cambiaAutor = permisos.admin && autorFinal !== autorActual;

  const archivoActual = entrada.archivoPathActual;
  const portadaActual = entrada.portadaPathActual || null;
  const archivoNuevo = `${autorFinal}/${slug}/index.html`;
  const portadaNueva = `${autorFinal}/${slug}/portada.webp`;
  const quitaPortada = Boolean(entrada.quitarPortada) && !entrada.portada;
  const reemplazaPortada = Boolean(entrada.portada);
  const conservaPortada = Boolean(portadaActual) && !quitaPortada && !reemplazaPortada;

  let portadaFinal = null;
  if (reemplazaPortada) portadaFinal = portadaNueva;
  else if (conservaPortada) portadaFinal = cambiaAutor ? portadaNueva : portadaActual;

  const almacen = cliente.storage.from(BUCKET_SLIDES);
  const movidos = [];
  const creados = [];

  async function deshacer() {
    for (const [desde, hacia] of movidos.slice().reverse()) {
      try {
        await almacen.move(hacia, desde);
      } catch {
        // Queda en la carpeta nueva; un administrador lo ve en Storage.
      }
    }
    if (creados.length > 0) {
      try {
        await almacen.remove(creados);
      } catch {
        // Un objeto sin fila: no hay nada más que hacer desde acá.
      }
    }
  }

  async function actualizarFila(valores) {
    return cliente
      .from("slides_subidas")
      .update(valores)
      .eq("id", entrada.id)
      .select("id, visibilidad");
  }

  try {
    // La RLS de Storage no deja a un autor reemplazar el archivo de una
    // presentación PÚBLICA (sería saltarse la revisión): primero la fila pasa
    // a «por revisar». La base haría lo mismo en la edición de abajo.
    if (!permisos.admin && entrada.visibilidadActual === "publico" && (reemplazaArchivo || reemplazaPortada)) {
      const previo = await actualizarFila({ visibilidad: "por_revisar" });
      if (previo.error) {
        reporteroSlides.reportarFallo("editar_revision", previo.error, inicio, previo.error.code || "update");
        return { ok: false, mensaje: mensajeDeErrorDeEdicion(previo.error) };
      }
      if (!Array.isArray(previo.data) || previo.data.length === 0) {
        return { ok: false, mensaje: MENSAJE_SIN_PERMISO_DE_EDICION };
      }
    }

    if (cambiaAutor) {
      const archivo = await almacen.move(archivoActual, archivoNuevo);
      if (archivo.error) {
        reporteroSlides.reportarFallo("mover_archivo", archivo.error, inicio, "storage");
        return { ok: false, mensaje: mensajeDeErrorDeEdicion(archivo.error) };
      }
      movidos.push([archivoActual, archivoNuevo]);

      if (conservaPortada) {
        const portada = await almacen.move(portadaActual, portadaNueva);
        if (portada.error) {
          reporteroSlides.reportarFallo("mover_portada", portada.error, inicio, "storage");
          await deshacer();
          return { ok: false, mensaje: mensajeDeErrorDeEdicion(portada.error) };
        }
        movidos.push([portadaActual, portadaNueva]);
      }
    }

    if (reemplazaArchivo) {
      const archivo = await almacen.upload(archivoNuevo, entrada.archivo, {
        contentType: "text/html",
        upsert: true,
      });
      if (archivo.error) {
        reporteroSlides.reportarFallo("subir_archivo", archivo.error, inicio, "storage");
        await deshacer();
        return { ok: false, mensaje: mensajeDeErrorDeEdicion(archivo.error) };
      }
    }

    if (reemplazaPortada) {
      const portada = await almacen.upload(portadaNueva, entrada.portada, {
        contentType: "image/webp",
        upsert: true,
      });
      if (portada.error) {
        reporteroSlides.reportarFallo("subir_portada", portada.error, inicio, "storage");
        await deshacer();
        return { ok: false, mensaje: mensajeDeErrorDeEdicion(portada.error) };
      }
      // Si no había portada en esa carpeta, es un objeto nuevo y sin fila.
      if (!portadaActual || cambiaAutor) creados.push(portadaNueva);
    }

    const valores = { titulo, descripcion, categoria, portada_path: portadaFinal };
    if (reemplazaArchivo) {
      valores.total_laminas = entrada.totalLaminas;
      const version = Number.isInteger(entrada.versionActual) && entrada.versionActual > 0
        ? entrada.versionActual
        : 1;
      valores.version_archivo = version + 1;
    }
    if (permisos.admin) {
      valores.visibilidad = validacion.valores.visibilidad;
      if (cambiaAutor) {
        valores.autor_id = autorFinal;
        valores.archivo_path = archivoNuevo;
      }
    }

    const { data, error } = await actualizarFila(valores);
    if (error) {
      reporteroSlides.reportarFallo("editar_fila", error, inicio, error.code || "update");
      await deshacer();
      return { ok: false, mensaje: mensajeDeErrorDeEdicion(error) };
    }
    if (!Array.isArray(data) || data.length === 0) {
      await deshacer();
      return { ok: false, mensaje: MENSAJE_SIN_PERMISO_DE_EDICION };
    }

    // Con la fila ya actualizada, lo que quedó sin dueño se retira. Si no se
    // puede, sólo sobra un archivo: la edición ya se guardó.
    const sobrantes = [];
    if (portadaActual && (quitaPortada || (reemplazaPortada && cambiaAutor))) sobrantes.push(portadaActual);
    if (sobrantes.length > 0) {
      try {
        await almacen.remove(sobrantes);
      } catch {
        // Ver arriba.
      }
    }

    return { ok: true, slug, visibilidad: data[0].visibilidad };
  } catch (error) {
    reporteroSlides.reportarFallo("editar_slide", error, inicio, "excepcion");
    await deshacer();
    return { ok: false, mensaje: "No se pudieron guardar los cambios. Inténtalo de nuevo." };
  }
}

/*
  Borra una presentación para siempre: primero la fila y después sus archivos.
  Ese orden no es casual: la policy de Storage deja a un autor borrar un
  archivo sólo cuando ya no está registrado en la tabla. Si los archivos no se
  pueden retirar, la presentación ya no existe igual (sólo sobran objetos que
  un administrador ve en Storage), así que no se reporta como fallo.
*/
async function borrarSlide({ id, archivoPath, portadaPath } = {}) {
  const inicio = reporteroSlides.iniciarTiempo();
  const cliente = clienteDeSlides();
  if (!cliente) return { ok: false, mensaje: "No se pudo conectar. Inténtalo más tarde." };
  if (!id) return { ok: false, mensaje: "No se pudo identificar la presentación a borrar." };

  try {
    const { data, error } = await cliente
      .from("slides_subidas")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      reporteroSlides.reportarFallo("borrar_fila", error, inicio, error.code || "delete");
      return {
        ok: false,
        mensaje: esErrorDePermiso(error)
          ? MENSAJE_SIN_PERMISO_DE_BORRADO
          : "No se pudo borrar la presentación. Inténtalo de nuevo.",
      };
    }
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, mensaje: MENSAJE_SIN_PERMISO_DE_BORRADO };
    }

    const rutas = [archivoPath, portadaPath].filter(Boolean);
    if (rutas.length > 0) {
      try {
        await cliente.storage.from(BUCKET_SLIDES).remove(rutas);
      } catch (errorDeArchivos) {
        console.warn("slides: la fila se borró pero no sus archivos —", errorDeArchivos);
      }
    }
    return { ok: true };
  } catch (error) {
    reporteroSlides.reportarFallo("borrar_slide", error, inicio, "excepcion");
    return { ok: false, mensaje: "No se pudo borrar la presentación. Inténtalo de nuevo." };
  }
}

/*
  Las portadas subidas viven en un bucket privado: se leen con una URL firmada
  de una hora. Una sola llamada para todas. Devuelve un Map ruta -> URL; si
  algo falla, el Map queda vacío (o sin esa ruta) y la tarjeta usa su
  degradado.
*/
async function firmarPortadasDeSlides(catalogo) {
  const urls = new Map();
  const cliente = clienteDeSlides();
  const rutas = [...new Set(
    (Array.isArray(catalogo) ? catalogo : []).map((item) => item && item.portada_path).filter(Boolean)
  )];
  if (!cliente || rutas.length === 0) return urls;

  try {
    const { data, error } = await cliente.storage
      .from(BUCKET_SLIDES)
      .createSignedUrls(rutas, SEGUNDOS_DE_URL_FIRMADA);
    if (error || !Array.isArray(data)) return urls;
    data.forEach((fila) => {
      if (fila && fila.path && fila.signedUrl && !fila.error) urls.set(fila.path, fila.signedUrl);
    });
  } catch {
    // Sin URLs firmadas las tarjetas usan el degradado de respaldo.
  }
  return urls;
}

/*
  El HTML de un deck ya subido, como texto, para generarle la portada sin que
  quien edita tenga que volver a elegir el archivo. Mismo patrón que la página
  puente: `?v=` con la versión, porque Storage sirve con cache de una hora.
  Devuelve `null` si no se pudo; nunca lanza.
*/
async function descargarHtmlDeSlide(archivoPath, version) {
  const cliente = clienteDeSlides();
  if (!cliente || !archivoPath) return null;

  try {
    const descarga = await cliente.storage
      .from(BUCKET_SLIDES)
      .download(`${archivoPath}?v=${version || 1}`);
    if (descarga.error || !descarga.data) return null;
    return await descarga.data.text();
  } catch {
    return null;
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    RUTA_BASE_SLIDES,
    RUTA_MANIFIESTO_SLIDES,
    RUTA_PUENTE_SLIDES,
    cargarCatalogoDeSlides,
    olvidarSlidesEnMemoria,
    cargarPermisosDeSlides,
    cargarAutoresDeSlides,
    cargarCategoriasDeSlides,
    subirSlide,
    publicarSlide,
    editarSlide,
    borrarSlide,
    firmarPortadasDeSlides,
    descargarHtmlDeSlide,
  });
}
