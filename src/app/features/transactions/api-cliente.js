/* Cliente de la API del extractor, compartido por la herramienta y su panel.
 *
 * Resuelve dos cosas que ninguna de las dos pantallas puede dar por sentadas,
 * y que en el proyecto original no hacían falta porque allá un mismo servidor
 * Flask servía la página y la API:
 *
 *   1. **La API vive en otro origen.** Acá la pantalla la sirve Vercel y el
 *      Python corre en Cloud Run, así que una ruta relativa como `/api/extraer`
 *      pegaría contra taudux.com, donde no hay ninguna API.
 *
 *   2. **La identidad viaja en el token, no en una cookie.** El simulador se
 *      identificaba con una cookie de sesión que el propio cliente escribía —en
 *      producción eso significaría que cualquiera se declara administrador—.
 *      Cada llamada lleva el token de Supabase y el servidor lo verifica contra
 *      el servidor de Auth antes de creer nada.
 */
const API = "https://extractor-taudux-953578674176.northamerica-south1.run.app";

// El token se relee en CADA llamada, no una vez al cargar: entre que se abre la
// página y se pide algo pueden pasar minutos, y Supabase lo renueva en el medio.
async function apiFetch(ruta, opciones = {}) {
  const cabeceras = new Headers(opciones.headers || {});

  try {
    const sesion = typeof obtenerSesion === "function" ? await obtenerSesion() : null;
    if (sesion && sesion.access_token) {
      cabeceras.set("Authorization", `Bearer ${sesion.access_token}`);
    }
  } catch (error) {
    // Sin sesión no se aborta: hay endpoints que responden igual sin ella, y
    // los que no, contestan 401 con su propio mensaje. Fallar acá dejaría a la
    // persona sin saber por qué no pasó nada.
    console.warn("[extractor] no se pudo leer la sesión:", error);
  }

  return fetch(`${API}${ruta}`, { ...opciones, headers: cabeceras });
}
