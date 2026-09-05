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

/* La identidad de quien NO tiene cuenta.
 *
 * Con cuenta, `Authorization` alcanza: el servidor saca el uuid del token y
 * ese uuid es el mismo en todas las peticiones. Sin cuenta no hay token, y el
 * servidor identifica por este header. Si no llega, `_id_anonimo()` genera un
 * uuid NUEVO en cada petición — y entonces la tabla que se guardó al extraer
 * queda bajo una identidad que la descarga ya no sabe pedir: 404 `sin_datos`.
 *
 * Vive en `localStorage` y no en una cookie porque la cookie de sesión de
 * Flask no cruza orígenes — ésa es la mitad de F29.
 *
 * OJO CON QUÉ ES ESTE VALOR HOY. Nació como un contador de cuota, y mientras
 * el anónimo no podía descargar eso era todo lo que hacía: cambiarlo desde la
 * consola sólo confundía la propia cuenta de uno. Al abrirle la descarga
 * cambió de naturaleza: `api_descargar()` busca la tabla con
 * `_ultima_tabla.get(_identidad())`, y para quien no tiene cuenta esa
 * identidad ES este id. O sea que quien mande el id de otra persona se baja
 * el estado de cuenta de otra persona.
 *
 * Lo que hoy lo sostiene es la ENTROPÍA y nada más: el servidor lo genera con
 * `uuid4().hex` (122 bits) y no lo acepta si no tiene forma de hex de 16 a 40.
 * Adivinarlo no es viable. Pero no está firmado, no expira y no se valida
 * contra nadie, así que quien lo obtenga lo usa: es un bearer token de facto
 * sobre datos financieros, con la única suerte de que la ventana es corta
 * (`_ultima_tabla` vive en memoria y se desaloja por FIFO).
 *
 * Escrito acá para que el día que se le quiera dar más alcance —persistir la
 * tabla, alargarle la vida, indexar algo más por esta clave— se lea antes de
 * hacerlo y no después.
 */
const CLAVE_SESION_ANON = "taudux.extractor.sesion_anon";

/* `localStorage` LANZA, no devuelve null, cuando el navegador bloquea el
 * almacenamiento del sitio (incógnito con sitios restringidos, cookies de
 * terceros apagadas). Sin estas guardas, esa persona no perdería la cuota:
 * perdería la página, porque la excepción corta la función que la estaba
 * pintando. Sin almacenamiento el extractor funciona igual, sólo que cada
 * pestaña es una identidad nueva.
 */
function leerSesionAnon() {
  try {
    return localStorage.getItem(CLAVE_SESION_ANON) || null;
  } catch (error) {
    return null;
  }
}

function recordarSesionAnon(id) {
  // `null` es lo que manda el servidor cuando hay cuenta. No es "borrá lo
  // guardado": es "esto no aplica acá". Borrarlo haría que cerrar sesión
  // estrenara identidad anónima y perdiera la tabla recién extraída.
  if (!id) return;
  try {
    localStorage.setItem(CLAVE_SESION_ANON, id);
  } catch (error) {
    // Ver `leerSesionAnon()`: sin almacenamiento se sigue, no se rompe.
  }
}

// El token se relee en CADA llamada, no una vez al cargar: entre que se abre la
// página y se pide algo pueden pasar minutos, y Supabase lo renueva en el medio.
async function apiFetch(ruta, opciones = {}) {
  const cabeceras = new Headers(opciones.headers || {});

  // Va SIEMPRE, incluso con sesión: cuesta un header y evita que iniciar o
  // cerrar sesión a mitad de un análisis parta la identidad en dos. El
  // servidor lo ignora cuando hay token (`_identidad()` sólo mira el header
  // en la rama `anonimo`).
  const sesionAnon = leerSesionAnon();
  if (sesionAnon) cabeceras.set("X-Sesion-Anon", sesionAnon);

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
