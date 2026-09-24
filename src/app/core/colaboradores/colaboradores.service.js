/*
  Servicio de lectura de la lista pública de colaboradores. Depende de
  supabaseClient y debe cargarse después de él; la página es pública, así que
  funciona con la anon key y sin sesión.

  La lista sale del RPC `listar_colaboradores()` (migraciones 0038, 0039,
  0040 y 0041), security definer, que entrega de cada cuenta marcada nombre,
  apellidos y slug, más los campos de su ficha pública (puesto, sector,
  ubicación, herramientas, modalidad de trabajo, año de inicio, bio y
  enlaces). Quien todavía no llenó su ficha los trae en null: el RPC hace
  left join.

  Este servicio vuelve a recortar del lado del cliente: arma cada registro
  campo por campo, así que una columna que el RPC agregue más adelante no
  llega a la página por accidente.
*/

// Mismo formato que el check `perfiles_slug_formato` de la 0038. El slug
// termina en la URL (#/slug), así que una fila que no lo cumpla se descarta.
const PATRON_SLUG_COLABORADOR = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MENSAJE_ERROR_COLABORADORES = "No se pudo cargar la lista de colaboradores.";

function registrarErrorColaboradores(contexto, error) {
  console.error("[colaboradores.service]", { contexto, error });
}

/*
  Si el CDN de Supabase no cargó, supabase-client.js lanza al inicializar su
  `const supabaseClient` y el binding global queda en TDZ para siempre: ahí
  incluso `typeof supabaseClient` lanza ReferenceError. Por eso la consulta va
  dentro de un try y no basta con comparar contra "undefined".
*/
function clienteSupabaseColaboradores() {
  try {
    return typeof supabaseClient === "object" && supabaseClient !== null ? supabaseClient : null;
  } catch {
    return null;
  }
}

function textoDeColaborador(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function tieneSlugDeColaborador(fila) {
  return typeof fila?.slug === "string" && PATRON_SLUG_COLABORADOR.test(fila.slug);
}

// Las tres listas de etiquetas —herramientas, habilidades e idiomas— pasan
// por acá: sólo pasa un arreglo de textos, copiado para no compartirlo con la
// respuesta. Cualquier otra forma llega como null.
function etiquetasDeColaborador(valor) {
  const esListaDeTextos = Array.isArray(valor) && valor.every((elemento) => typeof elemento === "string");
  return esListaDeTextos ? [...valor] : null;
}

// Un campo de ficha pasa tal cual; uno ausente llega como null, igual que el
// de quien todavía no llenó su ficha. Si la ficha alcanza para abrir un
// perfil lo decide tienePerfil() (colaboradores.datos.js), no el servicio.
function campoDeFichaColaborador(valor) {
  return valor ?? null;
}

/*
  Registro público de cada colaborador. `nombre` es el nombre completo que se
  muestra en el perfil y `corto` el que va en la tarjeta del roster; si la
  cuenta no tiene nombre ni apellidos, ambos caen al slug para que la tarjeta
  nunca quede en blanco.

  Los campos de la ficha conservan los nombres de la base. Ojo: `puesto` es el
  puesto que la persona escribe en su ficha; `perfiles.rol` (usuario/admin) es
  otra columna, de otra tabla, y no pasa por acá.
*/
function aColaborador(fila) {
  const nombre = textoDeColaborador(fila.nombre);
  const apellidos = textoDeColaborador(fila.apellidos);
  return {
    nombre: [nombre, apellidos].filter(Boolean).join(" ") || fila.slug,
    corto: nombre || apellidos || fila.slug,
    slug: fila.slug,
    puesto: campoDeFichaColaborador(fila.puesto),
    sector: campoDeFichaColaborador(fila.sector),
    ubicacion: campoDeFichaColaborador(fila.ubicacion),
    herramientas: etiquetasDeColaborador(fila.herramientas),
    habilidades: etiquetasDeColaborador(fila.habilidades),
    idiomas: etiquetasDeColaborador(fila.idiomas),
    empresa: campoDeFichaColaborador(fila.empresa),
    empresa_enlace: campoDeFichaColaborador(fila.empresa_enlace),
    modalidad_trabajo: campoDeFichaColaborador(fila.modalidad_trabajo),
    anio_inicio: campoDeFichaColaborador(fila.anio_inicio),
    bio: campoDeFichaColaborador(fila.bio),
    linkedin: campoDeFichaColaborador(fila.linkedin),
    github: campoDeFichaColaborador(fila.github),
    correo: campoDeFichaColaborador(fila.correo),
  };
}

async function listarColaboradores() {
  const cliente = clienteSupabaseColaboradores();
  if (!cliente) {
    registrarErrorColaboradores("sin-cliente", null);
    return { ok: false, mensaje: MENSAJE_ERROR_COLABORADORES };
  }

  try {
    const { data: filas, error } = await cliente.rpc("listar_colaboradores");
    if (error) {
      registrarErrorColaboradores("listar", error);
      return { ok: false, mensaje: MENSAJE_ERROR_COLABORADORES };
    }
    return { ok: true, data: (filas ?? []).filter(tieneSlugDeColaborador).map(aColaborador) };
  } catch (error) {
    // Fallo de red o respuesta inesperada: la página muestra el error, no se rompe.
    registrarErrorColaboradores("listar-excepcion", error);
    return { ok: false, mensaje: MENSAJE_ERROR_COLABORADORES };
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({ listarColaboradores });
}
