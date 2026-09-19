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
*/

// Columnas que el dueño escribe y que se le devuelven. Lista explícita, nunca
// `*`: una columna que la tabla gane después no se lee ni se escribe por
// accidente.
const COLUMNAS_MI_FICHA = Object.freeze([
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
const SELECT_MI_FICHA = COLUMNAS_MI_FICHA.join(", ");

const MENSAJE_CARGAR_MI_FICHA = "No se pudo cargar tu ficha. Intenta de nuevo.";
const MENSAJE_GUARDAR_MI_FICHA = "No se pudo guardar tu ficha. Intenta de nuevo.";

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

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({ obtenerMiFicha, guardarMiFicha });
}
