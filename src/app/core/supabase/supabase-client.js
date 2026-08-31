/*
  Cliente de Supabase compartido por toda la aplicación.

  CONFIGURACIÓN REQUERIDA:
  Reemplaza los valores de SUPABASE_URL y SUPABASE_ANON_KEY con los de tu
  proyecto (Supabase → Project Settings → API). Es seguro que estos dos
  valores vivan en el código público del repo: son la URL y la "anon key",
  pensadas para exponerse en el navegador. La seguridad real depende de la
  configuración de Auth en el panel de Supabase, no de ocultar esta clave.

  NUNCA pongas aquí la "service_role key" (esa es secreta y no se usa en
  el navegador).

  DÓNDE VIVE LA SESIÓN, Y POR QUÉ SE ELIGE ACÁ (2026-08-23)

  Hasta hoy era siempre `sessionStorage`: la sesión moría al cerrar la
  pestaña. Eso NO era un descuido, era una mitigación — Supabase sólo ofrece
  timeout de inactividad y vida máxima de sesión en plan Pro, así que una
  sesión que se autodestruye acotaba la ventana de abuso de un token robado
  (ver `openspec/docs/security/audit-auth-asvs.md`).

  Ahora la persona elige, y por defecto sigue siendo `sessionStorage`: sólo
  quien marca "Recordarme" en el login obtiene una sesión que sobrevive al
  cierre del navegador. Se apoya en el CSP que se desplegó antes justamente
  para esto, porque el XSS es el vector con el que se roba un token
  persistido.

  **La decisión se toma acá y no en el login** por una razón de orden: este
  archivo se carga ANTES que `login.js`, y `createClient` fija el `storage` al
  construirse. Para cuando el formulario existe, ya es tarde — así que la
  preferencia se escribe en un documento y la lee el siguiente.

  (El comentario anterior remitía a `decisions.md → ADR-006`. Ese archivo ya no
  existe: la carpeta se disolvió en la auditoría de contexto del 2026-08-22 y
  ese ADR no llegó a Engram. Se explica acá en vez de apuntar a la nada.)

  Debe cargarse antes que auth.service.js y navbar.js.
*/
const SUPABASE_URL = "https://yqkvgfqplmbbcebrivpt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxa3ZnZnFwbG1iYmNlYnJpdnB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODgxOTEsImV4cCI6MjEwMDA2NDE5MX0.wU-ylZ6agwkochwmOGe-7BROByw1qsvYpmqT5xDvF1Y";

// La preferencia vive en localStorage y no en sessionStorage a propósito: es
// lo único que puede sobrevivir al cierre del navegador, que es exactamente lo
// que la casilla significa.
const LLAVE_RECORDARME = "taudux_recordarme";
const LLAVE_SESION = "sb-yqkvgfqplmbbcebrivpt-auth-token";

/*
  ¿Esta persona pidió que la recordemos?

  Falla al lado SEGURO: si el storage está bloqueado —modo privado estricto,
  políticas del navegador— devuelve `false` y la sesión termina en
  `sessionStorage`. La dirección del fallback importa: al revés, un navegador
  con storage capado terminaría persistiendo sesiones que nadie pidió.
*/
function recordarme() {
  try {
    return localStorage.getItem(LLAVE_RECORDARME) === "1";
  } catch {
    return false;
  }
}

/*
  EL DESTINO SE RESUELVE EN CADA OPERACIÓN, NO AL CONSTRUIR EL CLIENTE.

  Parece un rodeo y es el corazón de la función. El cliente se construye cuando
  carga la página; la casilla se marca **después**. Con un `storage` fijado al
  construir, `signInWithPassword` escribía la sesión en el almacenamiento
  ANTERIOR a la elección: el documento siguiente ya leía la preferencia nueva,
  miraba el otro lado, no encontraba nada —y la limpieza de más abajo remataba
  borrando el token recién creado—. La persona quedaba deslogueada justo
  después de loguearse, sin un solo error en consola.

  Con Google era peor: `signInWithOAuth` redirige de inmediato, así que el
  `code_verifier` de PKCE quedaba huérfano en el storage viejo y el callback
  moría por timeout.

  Resolviendo en cada llamada, la decisión siempre es la vigente **en el
  instante de escribir o leer**, y los dos flujos quedan cubiertos por el mismo
  mecanismo, sin tocar ningún sitio de llamada.
*/
function almacenElegido() {
  return recordarme() ? window.localStorage : window.sessionStorage;
}

const almacenamientoDeSesion = {
  getItem: (llave) => almacenElegido().getItem(llave),
  setItem: (llave, valor) => almacenElegido().setItem(llave, valor),
  removeItem: (llave) => almacenElegido().removeItem(llave),
};

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: almacenamientoDeSesion,
    // PKCE para el handshake de OAuth (Google). El code_verifier vive en el
    // mismo storage que la sesión: sobrevive el redirect full-page al
    // proveedor en los dos casos —sessionStorage está atado a la pestaña, que
    // el redirect conserva; localStorage sobrevive a todo—. Los enlaces de
    // correo no dependen de él: usan token_hash + verifyOtp (ver confirm.js /
    // reset-password.js), agnóstico al flowType.
    flowType: "pkce",
  },
});

/*
  Limpieza del token que quedó en el storage que NO se está usando.

  Nació como migración one-shot: la sesión vivía en localStorage y se mudó a
  sessionStorage, así que había que barrer el huérfano. Hoy los dos storages
  son destinos legítimos, y por eso **la limpieza pasó a ser condicional**.

  Sin esta condición habría un bug feo y silencioso: quien marca "Recordarme"
  guarda su sesión en localStorage, y el borrado incondicional se la eliminaría
  en la siguiente carga. La casilla parecería no funcionar, sin un solo error.

  Barrer el storage que no se usa también evita que queden dos sesiones vivas
  en el mismo navegador, que es como se llega a "cerré sesión y sigo dentro".
*/
try {
  // Corre UNA vez al cargar, antes de que exista el formulario, así que acá la
  // preferencia todavía es la de la visita anterior — que es justo la que dice
  // dónde puede haber quedado un huérfano.
  (recordarme() ? window.sessionStorage : window.localStorage)
    .removeItem(LLAVE_SESION);
} catch {
  // Storage bloqueado: no hay nada que limpiar.
}
