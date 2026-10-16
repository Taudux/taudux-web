/*
  Servicio de "Mi ficha": lee y guarda la ficha pública del colaborador con
  sesión, en la tabla `fichas_colaborador` (migración 0039). Depende de
  supabaseClient y debe cargarse después de él.

  La RLS deja leer, crear y editar SÓLO la fila propia y sólo mientras la
  cuenta esté marcada como colaboradora. Una cuenta sin marcar lee "sin ficha"
  (0 filas, sin error) y, al guardar, su INSERT choca con la RLS (42501).

  Guardar es UPDATE y, si no había fila, INSERT; nunca upsert. El grant de
  UPDATE no incluye `id`, y el `on conflict do update` de un upsert la
  reescribe: fallaría siempre con 42501.

  Todo lo que la ficha guarda sale en la página pública /colaboradores.

  La foto (`foto_path`, migración 0050) tiene su propio camino: se sube al
  bucket público `colaboradores-fotos` y se publica EN EL MOMENTO, sin pasar
  por «Guardar ficha». Por eso `foto_path` se LEE junto con la ficha pero no
  está en COLUMNAS_MI_FICHA: guardar la ficha nunca la reescribe.
*/

// Columnas que el dueño escribe y que se le devuelven. Lista explícita, nunca
// `*`: una columna que la tabla gane después no se lee ni se escribe por
// accidente.
//
// EL ORDEN ES EL DE LA PANTALLA, NO EL DE LA TABLA. Espejaba el orden físico
// de las columnas hasta que habilidades subió encima de herramientas en el
// formulario y en el perfil. A Postgres el orden le da igual —esto es una
// lista de `select` y el payload de un `insert`—, pero CAMPOS_MI_FICHA lo
// copia, y ÉSE decide a qué campo se manda el foco al primer error: tiene que
// ser el primero de la pantalla, no el primero de la tabla. Un test compara
// las dos listas, así que no pueden separarse en silencio.
const COLUMNAS_MI_FICHA = Object.freeze([
  "puesto",
  "sector",
  "ubicacion",
  "habilidades",
  "herramientas",
  "idiomas",
  "empresa",
  "empresa_enlace",
  "modalidad_trabajo",
  "anio_inicio",
  "bio",
  "linkedin",
  "github",
  "correo",
]);
// Lo que se lee y se devuelve: las columnas editables más la foto, de sólo
// lectura para «Guardar ficha» (la escriben subirFotoDeMiFicha y
// quitarFotoDeMiFicha, que tocan esa única columna).
const SELECT_MI_FICHA = [...COLUMNAS_MI_FICHA, "foto_path"].join(", ");

const BUCKET_FOTOS_MI_FICHA = "colaboradores-fotos";
// Misma forma que el CHECK de la 0050 (ampliado en la 0051): <uuid>/<uuid>.webp
// o <uuid>/<uuid>.jpg. Safari no codifica WebP y el editor cae a JPEG.
const PATRON_RUTA_FOTO_MI_FICHA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|jpg)$/;
// Tipos de blob que admite el bucket (0051) y la extensión de cada uno.
const FORMATOS_DE_FOTO_MI_FICHA = Object.freeze({
  "image/webp": Object.freeze({ extension: "webp", contentType: "image/webp" }),
  "image/jpeg": Object.freeze({ extension: "jpg", contentType: "image/jpeg" }),
});

const MENSAJE_CARGAR_MI_FICHA = "No se pudo cargar tu ficha. Intenta de nuevo.";
const MENSAJE_GUARDAR_MI_FICHA = "No se pudo guardar tu ficha. Intenta de nuevo.";
const MENSAJE_SUBIR_FOTO_MI_FICHA = "No se pudo guardar tu foto. Intenta de nuevo.";
const MENSAJE_QUITAR_FOTO_MI_FICHA = "No se pudo quitar tu foto. Intenta de nuevo.";
const MENSAJE_FOTO_SIN_FICHA = "Guarda tu ficha primero; después podrás subir tu foto.";

function registrarErrorMiFicha(contexto, error) {
  console.error("[ficha.service]", { contexto, error });
}

/*
  Si el CDN de Supabase no cargó, supabase-client.js lanza al inicializar su
  `const supabaseClient` y el binding global queda en TDZ para siempre: ahí
  incluso `typeof supabaseClient` lanza ReferenceError. Por eso la consulta va
  dentro de un try y no basta con comparar contra "undefined".
*/
function clienteSupabaseMiFicha() {
  try {
    return typeof supabaseClient === "object" && supabaseClient !== null ? supabaseClient : null;
  } catch {
    return null;
  }
}

function esUsuarioDeMiFicha(userId) {
  return typeof userId === "string" && userId.trim() !== "";
}

function esObjetoDeMiFicha(ficha) {
  return typeof ficha === "object" && ficha !== null && !Array.isArray(ficha);
}

/*
  Payload armado desde la lista blanca: cualquier otra llave que traiga el
  llamador (id, fechas, nombre…) se ignora. Una fila guardada es una ficha
  completa, así que las diez columnas van siempre; la que no viene se manda
  como null (un enlace ausente se borra; un obligatorio ausente lo rechaza la
  base con 23502).
*/
function camposDeMiFicha(ficha) {
  const campos = {};
  for (const columna of COLUMNAS_MI_FICHA) {
    campos[columna] = ficha[columna] ?? null;
  }
  return campos;
}

function mensajeErrorMiFicha(error) {
  switch (error?.code) {
    case "42501":
      return "Sólo los colaboradores pueden editar su ficha.";
    case "23514":
      return "Revisa tu ficha: algún dato no tiene el formato esperado.";
    case "23502":
      return "Faltan datos obligatorios en tu ficha.";
    default:
      return MENSAJE_GUARDAR_MI_FICHA;
  }
}

function falloAlGuardarMiFicha(contexto, error) {
  registrarErrorMiFicha(contexto, error);
  return { ok: false, mensaje: mensajeErrorMiFicha(error) };
}

// Sin `id` en el payload: el grant de UPDATE no la incluye. Si no hay fila
// propia (o la RLS la oculta), responde data null sin error.
function actualizarMiFicha(cliente, userId, campos) {
  return cliente
    .from("fichas_colaborador")
    .update(campos)
    .eq("id", userId)
    .select(SELECT_MI_FICHA)
    .maybeSingle();
}

function insertarMiFicha(cliente, userId, campos) {
  return cliente
    .from("fichas_colaborador")
    .insert({ id: userId, ...campos })
    .select(SELECT_MI_FICHA)
    .single();
}

// Devuelve la ficha propia, o data null si todavía no existe.
async function obtenerMiFicha(userId) {
  if (!esUsuarioDeMiFicha(userId)) {
    registrarErrorMiFicha("obtener-sin-usuario", null);
    return { ok: false, mensaje: MENSAJE_CARGAR_MI_FICHA };
  }

  const cliente = clienteSupabaseMiFicha();
  if (!cliente) {
    registrarErrorMiFicha("obtener-sin-cliente", null);
    return { ok: false, mensaje: MENSAJE_CARGAR_MI_FICHA };
  }

  try {
    const { data, error } = await cliente
      .from("fichas_colaborador")
      .select(SELECT_MI_FICHA)
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      registrarErrorMiFicha("obtener", error);
      return { ok: false, mensaje: MENSAJE_CARGAR_MI_FICHA };
    }
    return { ok: true, data: data ?? null };
  } catch (error) {
    // Fallo de red o respuesta inesperada: la página muestra el error, no se rompe.
    registrarErrorMiFicha("obtener-excepcion", error);
    return { ok: false, mensaje: MENSAJE_CARGAR_MI_FICHA };
  }
}

/*
  Crea o edita la ficha propia: UPDATE primero; si no encontró fila, INSERT.
  Si el INSERT choca con la PK (23505) es que otra pestaña la creó entre los
  dos pasos, y un único UPDATE más ya la encuentra. Ese 23505 no se registra:
  es una carrera esperada, no un error.
*/
async function guardarMiFicha(userId, ficha) {
  if (!esUsuarioDeMiFicha(userId)) {
    registrarErrorMiFicha("guardar-sin-usuario", null);
    return { ok: false, mensaje: MENSAJE_GUARDAR_MI_FICHA };
  }
  if (!esObjetoDeMiFicha(ficha)) {
    registrarErrorMiFicha("guardar-ficha-invalida", null);
    return { ok: false, mensaje: MENSAJE_GUARDAR_MI_FICHA };
  }

  const cliente = clienteSupabaseMiFicha();
  if (!cliente) {
    registrarErrorMiFicha("guardar-sin-cliente", null);
    return { ok: false, mensaje: MENSAJE_GUARDAR_MI_FICHA };
  }

  const campos = camposDeMiFicha(ficha);
  try {
    const editada = await actualizarMiFicha(cliente, userId, campos);
    if (editada.error) return falloAlGuardarMiFicha("actualizar", editada.error);
    if (editada.data) return { ok: true, data: editada.data };

    const creada = await insertarMiFicha(cliente, userId, campos);
    if (!creada.error && creada.data) return { ok: true, data: creada.data };
    if (creada.error?.code !== "23505") return falloAlGuardarMiFicha("insertar", creada.error);

    const reintento = await actualizarMiFicha(cliente, userId, campos);
    if (reintento.error) return falloAlGuardarMiFicha("reintentar", reintento.error);
    if (reintento.data) return { ok: true, data: reintento.data };

    // La fila existe (la PK lo dijo) pero el UPDATE no la ve: la marca se
    // retiró a mitad de camino, o la RLS cambió. No se insiste.
    registrarErrorMiFicha("reintentar-sin-fila", null);
    return { ok: false, mensaje: MENSAJE_GUARDAR_MI_FICHA };
  } catch (error) {
    registrarErrorMiFicha("guardar-excepcion", error);
    return { ok: false, mensaje: MENSAJE_GUARDAR_MI_FICHA };
  }
}

/*
  URL pública de una foto del bucket, o null si la ruta no tiene la forma
  esperada o no hay cliente. Es la misma cuenta que `urlDeFotoDeColaborador`
  (colaboradores.service.js), repetida a propósito: esta página no carga aquel
  servicio y atarlos por orden de scripts sería más frágil que tres líneas.
*/
function urlDeFotoDeMiFicha(ruta) {
  if (typeof ruta !== "string" || !PATRON_RUTA_FOTO_MI_FICHA.test(ruta)) return null;
  const cliente = clienteSupabaseMiFicha();
  if (!cliente) return null;
  try {
    return cliente.storage.from(BUCKET_FOTOS_MI_FICHA).getPublicUrl(ruta).data?.publicUrl ?? null;
  } catch (error) {
    registrarErrorMiFicha("url-foto", error);
    return null;
  }
}

// Borrar un archivo del bucket nunca hace fallar la operación que lo pidió: lo
// peor que pasa es un archivo huérfano, y la foto ya quedó como el dueño la
// quiso. Se registra y se sigue.
async function retirarFotoDelBucket(cliente, ruta, contexto) {
  if (typeof ruta !== "string" || ruta === "") return;
  await retirarFotosDelBucket(cliente, [ruta], contexto);
}

async function retirarFotosDelBucket(cliente, rutas, contexto) {
  if (rutas.length === 0) return;
  try {
    const { error } = await cliente.storage.from(BUCKET_FOTOS_MI_FICHA).remove(rutas);
    if (error) registrarErrorMiFicha(contexto, error);
  } catch (error) {
    registrarErrorMiFicha(contexto, error);
  }
}

/*
  Una sola foto por cuenta en el bucket (2026-10-13): tras subir o quitar, se
  lista la carpeta propia y se retira todo lo que no sea `conservar` (null al
  quitar, y la carpeta queda vacía). Así un retiro que falló antes —la red,
  otra pestaña— lo limpia el siguiente guardado, en vez de dejar para siempre
  un archivo viejo público por URL.

  Listar la carpeta propia es posible por la policy de SELECT de la 0050, que
  sólo deja ver la de uno. Sólo se tocan nombres con la forma de una foto
  (<uuid>.webp o <uuid>.jpg): el marcador de carpeta vacía de Supabase u otra cosa rara se
  deja en paz. Si listar falla, se cae al retiro puntual de `respaldo` —la ruta
  que se sabía vieja—, que es lo que se hacía antes de esta limpieza.

  Límite conocido: dos pestañas que suben a la vez pueden retirarse la foto
  una a la otra; la ficha queda apuntando a la última y, si su archivo ya no
  está, la página muestra la silueta hasta el próximo guardado.
*/
async function limpiarCarpetaDeFoto(cliente, userId, conservar, respaldo, contexto) {
  let listado = null;
  try {
    const { data, error } = await cliente.storage.from(BUCKET_FOTOS_MI_FICHA).list(userId, { limit: 100 });
    if (error) registrarErrorMiFicha(`${contexto}-listar`, error);
    else listado = Array.isArray(data) ? data : [];
  } catch (error) {
    registrarErrorMiFicha(`${contexto}-listar`, error);
  }

  if (listado === null) {
    if (respaldo && respaldo !== conservar) await retirarFotoDelBucket(cliente, respaldo, contexto);
    return;
  }

  const sobrantes = listado
    .map((objeto) => `${userId}/${objeto?.name}`)
    .filter((ruta) => ruta !== conservar && PATRON_RUTA_FOTO_MI_FICHA.test(ruta));
  await retirarFotosDelBucket(cliente, sobrantes, contexto);
}

/*
  Sube la foto (un Blob WebP o JPEG; JPEG en Safari, que no codifica WebP) y la cuelga de la ficha propia en el acto.

  Orden: 1) lee el `foto_path` actual —así se sabe qué archivo retirar sin
  fiarse de lo que la pestaña recuerde, y si la ficha todavía no existe se
  avisa ANTES de subir nada—; 2) sube el archivo con un nombre nuevo (`upsert`
  en falso: cada foto es un objeto distinto, ver 0050); 3) UPDATE de
  `foto_path`; 4) deja en la carpeta sólo la nueva (limpiarCarpetaDeFoto). Si el UPDATE falla o no encuentra
  fila, el archivo recién subido se retira y la ficha queda como estaba.
*/
async function subirFotoDeMiFicha(userId, blob) {
  if (!esUsuarioDeMiFicha(userId) || !blob) {
    registrarErrorMiFicha("subir-foto-sin-datos", null);
    return { ok: false, mensaje: MENSAJE_SUBIR_FOTO_MI_FICHA };
  }

  // La extensión y el contentType salen del tipo REAL del blob, no de lo que se
  // pidió al exportar: el bucket sólo admite WebP y JPEG (0051).
  const formato = FORMATOS_DE_FOTO_MI_FICHA[blob.type];
  if (!formato) {
    registrarErrorMiFicha("subir-foto-formato", { tipo: blob.type ?? null });
    return { ok: false, mensaje: MENSAJE_SUBIR_FOTO_MI_FICHA };
  }

  const cliente = clienteSupabaseMiFicha();
  if (!cliente) {
    registrarErrorMiFicha("subir-foto-sin-cliente", null);
    return { ok: false, mensaje: MENSAJE_SUBIR_FOTO_MI_FICHA };
  }

  try {
    const actual = await cliente
      .from("fichas_colaborador")
      .select("foto_path")
      .eq("id", userId)
      .maybeSingle();
    if (actual.error) {
      registrarErrorMiFicha("subir-foto-leer", actual.error);
      return { ok: false, mensaje: MENSAJE_SUBIR_FOTO_MI_FICHA };
    }
    if (!actual.data) return { ok: false, mensaje: MENSAJE_FOTO_SIN_FICHA };
    const anterior = actual.data.foto_path ?? null;

    const ruta = `${userId}/${crypto.randomUUID()}.${formato.extension}`;
    const subida = await cliente.storage
      .from(BUCKET_FOTOS_MI_FICHA)
      .upload(ruta, blob, { contentType: formato.contentType, upsert: false });
    if (subida.error) {
      registrarErrorMiFicha("subir-foto-archivo", subida.error);
      return { ok: false, mensaje: MENSAJE_SUBIR_FOTO_MI_FICHA };
    }

    const colgada = await cliente
      .from("fichas_colaborador")
      .update({ foto_path: ruta })
      .eq("id", userId)
      .select("foto_path")
      .maybeSingle();
    if (colgada.error) {
      registrarErrorMiFicha("subir-foto-colgar", colgada.error);
      await retirarFotoDelBucket(cliente, ruta, "subir-foto-deshacer");
      return { ok: false, mensaje: MENSAJE_SUBIR_FOTO_MI_FICHA };
    }
    if (!colgada.data) {
      // La fila desapareció entre la lectura y el UPDATE, o la RLS la oculta
      // (la marca de colaborador se retiró).
      await retirarFotoDelBucket(cliente, ruta, "subir-foto-deshacer");
      return { ok: false, mensaje: MENSAJE_FOTO_SIN_FICHA };
    }

    await limpiarCarpetaDeFoto(cliente, userId, ruta, anterior, "subir-foto-retirar-anterior");
    return { ok: true, data: { foto_path: ruta, url: urlDeFotoDeMiFicha(ruta) } };
  } catch (error) {
    registrarErrorMiFicha("subir-foto-excepcion", error);
    return { ok: false, mensaje: MENSAJE_SUBIR_FOTO_MI_FICHA };
  }
}

/*
  Quita la foto: primero la deja en null en la ficha (la página pública deja
  de mostrarla ya) y después vacía la carpeta propia, que es limpieza y no
  puede hacer fallar la operación. `rutaActual` es la que la página tiene por
  guardada: sólo se usa si listar la carpeta falla, y sólo si cuelga de la
  carpeta de esta cuenta.
*/
async function quitarFotoDeMiFicha(userId, rutaActual) {
  if (!esUsuarioDeMiFicha(userId)) {
    registrarErrorMiFicha("quitar-foto-sin-usuario", null);
    return { ok: false, mensaje: MENSAJE_QUITAR_FOTO_MI_FICHA };
  }

  const cliente = clienteSupabaseMiFicha();
  if (!cliente) {
    registrarErrorMiFicha("quitar-foto-sin-cliente", null);
    return { ok: false, mensaje: MENSAJE_QUITAR_FOTO_MI_FICHA };
  }

  try {
    const { data, error } = await cliente
      .from("fichas_colaborador")
      .update({ foto_path: null })
      .eq("id", userId)
      .select("foto_path")
      .maybeSingle();
    if (error) {
      registrarErrorMiFicha("quitar-foto", error);
      return { ok: false, mensaje: MENSAJE_QUITAR_FOTO_MI_FICHA };
    }
    if (!data) {
      registrarErrorMiFicha("quitar-foto-sin-fila", null);
      return { ok: false, mensaje: MENSAJE_QUITAR_FOTO_MI_FICHA };
    }

    // El respaldo, si listar falla, sólo puede ser una ruta de la carpeta propia.
    const respaldo = typeof rutaActual === "string" && rutaActual.startsWith(`${userId}/`) ? rutaActual : null;
    await limpiarCarpetaDeFoto(cliente, userId, null, respaldo, "quitar-foto-retirar");
    return { ok: true };
  } catch (error) {
    registrarErrorMiFicha("quitar-foto-excepcion", error);
    return { ok: false, mensaje: MENSAJE_QUITAR_FOTO_MI_FICHA };
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    obtenerMiFicha,
    guardarMiFicha,
    subirFotoDeMiFicha,
    quitarFotoDeMiFicha,
    urlDeFotoDeMiFicha,
  });
}
