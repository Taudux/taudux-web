/*
  Servicio de lectura de la lista pública de colaboradores. Depende de
  supabaseClient y debe cargarse después de él; la página es pública, así que
  funciona con la anon key y sin sesión.

  La lista sale del RPC `listar_colaboradores()` (migración 0038), security
  definer, que entrega sólo nombre, apellidos y slug de las cuentas marcadas.
  Este servicio vuelve a recortar del lado del cliente: arma cada ficha
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

/*
  Ficha pública: sólo nombre, corto y slug. `nombre` es el nombre completo que
  se muestra en el perfil y `corto` el que va en la tarjeta del roster; si la
  cuenta no tiene nombre ni apellidos, ambos caen al slug para que la tarjeta
  nunca quede en blanco.
*/
function aColaborador(fila) {
  const nombre = textoDeColaborador(fila.nombre);
  const apellidos = textoDeColaborador(fila.apellidos);
  return {
    nombre: [nombre, apellidos].filter(Boolean).join(" ") || fila.slug,
    corto: nombre || apellidos || fila.slug,
    slug: fila.slug,
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
