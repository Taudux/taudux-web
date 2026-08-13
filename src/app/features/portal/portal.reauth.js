/*
  Núcleo puro del re-intento de borrado de cuenta tras reautenticarse con
  Google. Sin DOM y sin acceso a storage: sólo decide si la marca dejada antes
  de salir sigue siendo válida al volver, igual que portal.secciones.js decide
  la sección activa sin tocar el documento.

  Por qué la marca no alcanza con "existe y no venció": reautenticarConGoogle
  pide prompt: "select_account" (mismo parámetro que el login), así que el
  usuario puede volver con una cuenta de Google DISTINTA de la que pidió el
  borrado. Sin comparar el id de usuario, un borrado terminaría apuntando a la
  sesión equivocada — irreversible. reauthEliminarEsValida exige coincidencia
  exacta de usuarioId, no sólo vigencia.
*/

const CLAVE_REAUTH_ELIMINAR = "taudux_reauth_eliminar";
const REAUTH_ELIMINAR_VIGENCIA_MS = 10 * 60 * 1000;

function marcaDeReauthEliminar(usuarioId, ahora) {
  return { usuarioId, guardadoEn: ahora };
}

function reauthEliminarEsValida(marca, usuarioIdActual, ahora) {
  if (!marca || typeof marca !== "object") return false;
  if (!marca.usuarioId || marca.usuarioId !== usuarioIdActual) return false;
  if (typeof marca.guardadoEn !== "number") return false;
  return ahora - marca.guardadoEn <= REAUTH_ELIMINAR_VIGENCIA_MS;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    CLAVE_REAUTH_ELIMINAR,
    REAUTH_ELIMINAR_VIGENCIA_MS,
    marcaDeReauthEliminar,
    reauthEliminarEsValida,
  });
}
