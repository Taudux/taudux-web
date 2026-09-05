/* "Recordarme": la sesión sobrevive al cierre del navegador, si te lo piden.
 *
 * Por qué existe este test. Hasta el 2026-08-23 la sesión vivía siempre en
 * `sessionStorage` y moría al cerrar la pestaña. Eso NO era un descuido: era la
 * mitigación de no tener timeout de inactividad ni vida máxima de sesión, que
 * en Supabase requieren plan Pro (`audit-auth-asvs.md:186-194`).
 *
 * Al hacerla persistente esa mitigación desaparece, así que lo que este archivo
 * blinda no es "que la casilla exista" — es que las tres propiedades que
 * abaratan el riesgo sigan en pie:
 *
 *   1. **Es opt-in.** Quien no toca nada conserva el comportamiento de antes.
 *   2. **Cerrar sesión la olvida.** En un equipo compartido, cerrar sesión
 *      tiene que significar exactamente eso.
 *   3. **Falla al lado seguro.** Si el storage está bloqueado, se cae a
 *      `sessionStorage`, nunca al revés.
 *
 * La pieza previa —el CSP del commit `d1336f0`— es lo que frena el XSS con el
 * que se roba un token de `localStorage`. Este cambio se apoya en aquél.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const leer = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

const LOGIN_HTML = "src/app/features/auth/login/index.html";
const LOGIN_JS = "src/app/features/auth/login/login.js";
const CLIENTE = "src/app/core/supabase/supabase-client.js";
const SERVICIO = "src/app/core/auth/auth.service.js";

const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

/* Los asertos de ORDEN miran el código, no la prosa que lo explica.
   Este repo documenta el porqué al lado de cada decisión, así que un
   comentario que nombra la llave o la función aparece antes que su uso real —
   y medir posiciones contra eso da verde por el motivo equivocado. */
const sinComentariosJs = (js) =>
  js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* El nombre de la llave se fija acá y se exige idéntico en los tres archivos
   que la tocan. Sin esto, un typo en uno de ellos deja la preferencia muda: se
   escribiría bajo una llave y se leería bajo otra, sin error visible. */
const LLAVE = "taudux_recordarme";

test("the login form offers a 'remember me' checkbox", () => {
  const html = sinComentariosHtml(leer(LOGIN_HTML));

  assert.match(html, /id="recordarme"/, "falta la casilla");
  assert.match(html, /type="checkbox"[^>]*id="recordarme"|id="recordarme"[^>]*type="checkbox"/,
    "debe ser un checkbox");
});

test("it is born UNCHECKED — persisting is an explicit choice", () => {
  /*
    **La propiedad más importante del cambio.**

    Quien no toca nada conserva el comportamiento seguro de siempre: la sesión
    muere al cerrar la pestaña. Persistirla es una decisión que la persona toma
    sabiendo que su equipo la va a recordar — y en un equipo compartido esa
    diferencia es todo.
  */
  const html = sinComentariosHtml(leer(LOGIN_HTML));
  const casilla = html.match(/<input[^>]*id="recordarme"[^>]*>/)?.[0] ?? "";

  assert.ok(casilla, "no se encontró el input de la casilla");
  assert.doesNotMatch(casilla, /\schecked/,
    "la casilla NO debe nacer marcada: persistir la sesión es opt-in");
});

test("the checkbox lives inside the form, not floating next to it", () => {
  // Fuera del `<form>` no la alcanzaría `establecerFormularioOcupado`
  // (`auth-ui.js:146`), que deshabilita los controles mientras el login viaja.
  const html = sinComentariosHtml(leer(LOGIN_HTML));
  const form = html.match(/<form[^>]*id="loginForm"[\s\S]*?<\/form>/)?.[0] ?? "";

  assert.ok(form, "no se encontró el formulario de login");
  assert.match(form, /id="recordarme"/,
    "la casilla debe estar dentro del <form>");
});

test("the client picks its storage from the preference, not from a constant", () => {
  /*
    El `storage` que recibe `createClient` no puede ser una constante, y ésa
    fue la causa de un BLOCKER: `supabase-client.js` se carga antes que
    `login.js`, así que congelar la elección al construir el cliente la deja
    fijada ANTES de que la persona toque la casilla.

    Hoy es un objeto que resuelve el destino en cada lectura y escritura, así
    que la decisión vigente es siempre la del instante en que se guarda el
    token.
  */
  const js = leer(CLIENTE);

  assert.doesNotMatch(
    js,
    /storage:\s*window\.sessionStorage\s*,/,
    "el storage ya no puede ser una constante: depende de la preferencia"
  );
  assert.match(js, /window\.localStorage/, "debe poder elegir localStorage");
  assert.match(js, /window\.sessionStorage/, "y seguir cayendo a sessionStorage");
  assert.ok(js.includes(LLAVE), `debe leer la llave ${LLAVE}`);
});

test("the preference itself lives in localStorage — anywhere else is useless", () => {
  /*
    En `sessionStorage` la preferencia moriría al cerrar el navegador, o sea
    justo en el momento que tiene que sobrevivir. Es el único dato del par que
    NO puede vivir atado a la pestaña.
  */
  const js = leer(CLIENTE);

  // La llave se declara como constante, así que el aserto sigue esa
  // indirección en vez de buscar el literal pegado al `getItem` — que fue el
  // primer intento, y fallaba con código correcto.
  assert.match(
    js,
    new RegExp(`const\\s+LLAVE_RECORDARME\\s*=\\s*"${LLAVE}"`),
    `la llave debe llamarse ${LLAVE}`
  );
  assert.match(
    js,
    /localStorage\.getItem\(LLAVE_RECORDARME\)/,
    "y leerse de localStorage: en sessionStorage moriría justo cuando debe sobrevivir"
  );
});

test("reading the preference degrades silently, like the rest of the repo", () => {
  // Convención transversal: TODO acceso a storage va en try/catch — un
  // navegador con storage bloqueado no puede tumbar el arranque del cliente.
  const js = leer(CLIENTE);

  assert.match(js, /try\s*\{[\s\S]*?catch/,
    "el acceso a storage debe ir en try/catch");
});

test("if storage fails, it falls back to sessionStorage — never the other way", () => {
  /*
    El fallback tiene dirección, y equivocarla sería peor que no tener la
    funcionalidad: un navegador con storage bloqueado terminaría con la sesión
    persistida sin que nadie lo haya pedido.
  */
  const js = leer(CLIENTE);
  const recordarme = js.match(/function recordarme\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(recordarme, "debe existir un helper `recordarme()` aislable");
  assert.match(
    recordarme,
    /catch\s*\{[\s\S]*?return false/,
    "el catch debe devolver false: es el camino a sessionStorage, el lado seguro"
  );
  /* La dirección del fallback se comprueba EJECUTÁNDOLA, más abajo, en
     "un storage bloqueado cae del lado seguro".

     Acá vivía un regex contra la forma literal de la expresión ternaria. Se
     quitó porque ataba el test a cómo estaba escrito el código en vez de a lo
     que hace: al arreglar un BLOCKER cambiando esa línea, el test se puso rojo
     contra código correcto y más seguro. Un aserto que se rompe cuando
     arreglás un bug está midiendo la cosa equivocada. */
});

test("the choice is written BEFORE the login travels, not after", () => {
  /*
    El orden importa y no es cosmético: el token se escribe DURANTE
    `iniciarSesion()`, y el almacenamiento se resuelve en ese mismo instante.
    Si la preferencia se guardara después, la sesión ya habría caído del lado
    equivocado.
  */
  /*
    Se comparan las POSICIONES de la llamada al helper y del login, no de la
    llave: la palabra `taudux_recordarme` aparece antes en un comentario que
    la explica, y medir contra eso daba verde por el motivo equivocado.
  */
  const js = sinComentariosJs(leer(LOGIN_JS));

  assert.match(js, /localStorage\.setItem\("taudux_recordarme"/,
    "login.js debe escribir la preferencia en localStorage");

  const iGuardar = js.indexOf("guardarPreferenciaRecordarme();");
  const iLogin = js.indexOf("await iniciarSesion(");

  assert.notEqual(iGuardar, -1, "falta la llamada al helper antes del submit");
  assert.notEqual(iLogin, -1, "no se encontró la llamada a iniciarSesion");
  assert.ok(iGuardar < iLogin,
    "la preferencia debe guardarse ANTES de llamar a iniciarSesion()");
});

test("Google's redirect keeps the choice — it leaves the browser and comes back", () => {
  /*
    `signInWithOAuth` navega a `accounts.google.com` a página completa. Al
    volver, el documento es NUEVO y `supabase-client.js` se ejecuta otra vez:
    si la preferencia no se guardó antes de irse, quien entra con Google nunca
    es recordado.

    Es el mismo patrón que `portal.js:359-367` usa para su marca de reauth.
  */
  const js = sinComentariosJs(leer(LOGIN_JS));
  const bloque = js.match(/googleButton\.addEventListener[\s\S]*?\n\}\);/)?.[0] ?? "";

  assert.ok(bloque, "no se encontró el listener del botón de Google");

  const iGuardar = bloque.indexOf("guardarPreferenciaRecordarme();");
  const iGoogle = bloque.indexOf("await iniciarSesionConGoogle(");

  assert.notEqual(iGuardar, -1,
    "el listener de Google también debe guardar la preferencia");
  assert.ok(iGuardar < iGoogle,
    "debe guardarse ANTES del redirect: el documento que vuelve es otro");
});

test("signing out forgets the preference", () => {
  /*
    En un equipo compartido, cerrar sesión tiene que significar exactamente
    eso. Si la preferencia sobreviviera, el siguiente login nacería marcado y
    la persona siguiente heredaría una sesión persistente que no pidió.
  */
  const js = leer(SERVICIO);
  const cerrar = js.match(/async function cerrarSesion[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(cerrar, "no se encontró cerrarSesion()");
  assert.ok(cerrar.includes(LLAVE),
    "cerrarSesion() debe borrar la preferencia de recordarme");
});

test("the dangling ADR-006 pointer is gone from the client", () => {
  /*
    `supabase-client.js` citaba `decisions.md → ADR-006` para justificar la
    sesión por pestaña. **Ese archivo no existe**: la carpeta se disolvió en la
    auditoría del 2026-08-22 y ese ADR nunca llegó a Engram.

    Como este cambio revierte justamente esa decisión, dejar el puntero sería
    mandar a alguien a buscar una explicación que no está en ningún lado.
  */
  const js = leer(CLIENTE);

  /*
    Se prohíbe el PUNTERO ("ver decisions.md → ADR-006"), no la palabra.

    La primera versión de este aserto buscaba `decisions.md` en todo el archivo
    y saltaba con el comentario que explica, justamente, que ese archivo ya no
    existe. Ese es el incentivo exacto que no queremos crear: castigar a quien
    documenta bien una eliminación. Es el mismo criterio que ya usa
    `extractor-admin.test.js` con sus asertos de ausencia.
  */
  assert.doesNotMatch(js, /ver\s+decisions\.md/i,
    "el archivo decisions.md ya no existe: el comentario debe explicar, no remitir");
  assert.doesNotMatch(js, /—\s*ver\s+decisions/i,
    "no debe quedar ningún puntero a la carpeta de decisiones disuelta");
  assert.match(js, /Pro/,
    "y debe explicar la razón real: los controles de sesión requieren plan Pro");
});

/*
  EL TEST QUE FALTABA, y su ausencia dejó pasar un BLOCKER.

  Los diez de arriba son asertos ESTÁTICOS: regex sobre el texto fuente. No
  ejecutan una línea, así que no pueden ver lo único que importa acá — a qué
  storage va a parar el token cuando la persona cambia su elección.

  El defecto que no vieron: `storage` se fijaba al construir el cliente, o sea
  al cargar la página, y la casilla se marca DESPUÉS. La sesión se escribía en
  el storage viejo, el documento siguiente miraba el nuevo, y la persona
  quedaba deslogueada justo después de loguearse. Con los 591 tests en verde.

  Se ejecuta el archivo real con `node:vm`, mismo mecanismo que ya usa
  `auth-callback-guard.test.js`, contra un `window` y unos storages de mentira.
*/
const vm = require("node:vm");

/* Un storage de mentira con la superficie que usa Supabase. Guarda en un Map
   para poder mirar dónde terminó cada cosa. */
const storageFalso = () => {
  const datos = new Map();
  return {
    datos,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
};

/* Ejecuta `supabase-client.js` de verdad y devuelve el `storage` que le pasó a
   Supabase, junto con los dos storages falsos para poder inspeccionarlos. */
const cargarCliente = ({ recordarmeGuardado }) => {
  const local = storageFalso();
  const sesion = storageFalso();
  if (recordarmeGuardado !== undefined) {
    local.setItem("taudux_recordarme", recordarmeGuardado);
  }

  let opciones = null;
  const contexto = {
    localStorage: local,
    sessionStorage: sesion,
    window: {
      localStorage: local,
      sessionStorage: sesion,
      supabase: {
        createClient: (_url, _clave, opts) => {
          opciones = opts;
          return { auth: {} };
        },
      },
    },
  };
  vm.createContext(contexto);
  vm.runInContext(leer("src/app/core/supabase/supabase-client.js"), contexto);

  return { storage: opciones.auth.storage, local, sesion };
};

test("sin la preferencia marcada, el token va al almacenamiento de la pestaña", () => {
  const { storage, local, sesion } = cargarCliente({});

  storage.setItem("sb-yqkvgfqplmbbcebrivpt-auth-token", "tok");

  assert.equal(sesion.datos.get("sb-yqkvgfqplmbbcebrivpt-auth-token"), "tok",
    "sin marcar, la sesión muere con la pestaña");
  assert.equal(local.datos.has("sb-yqkvgfqplmbbcebrivpt-auth-token"), false);
});

test("con la preferencia ya marcada, el token va al almacenamiento persistente", () => {
  const { storage, local, sesion } = cargarCliente({ recordarmeGuardado: "1" });

  storage.setItem("sb-yqkvgfqplmbbcebrivpt-auth-token", "tok");

  assert.equal(local.datos.get("sb-yqkvgfqplmbbcebrivpt-auth-token"), "tok");
  assert.equal(sesion.datos.has("sb-yqkvgfqplmbbcebrivpt-auth-token"), false);
});

test("marcar la casilla DESPUÉS de cargar la página cambia el destino del token", () => {
  /*
    **ÉSTE es el test que atrapa el BLOCKER**, y describe el flujo real: la
    página carga sin preferencia, la persona marca la casilla, `login.js`
    escribe la llave, y recién entonces Supabase guarda la sesión.

    Si el storage se decide al construir el cliente, este aserto falla: el
    token cae en la pestaña y el documento siguiente —que ya lee la
    preferencia nueva— no lo encuentra y lo borra.
  */
  const { storage, local, sesion } = cargarCliente({});

  // Lo que hace `guardarPreferenciaRecordarme()` al enviar el formulario.
  local.setItem("taudux_recordarme", "1");

  storage.setItem("sb-yqkvgfqplmbbcebrivpt-auth-token", "tok");

  assert.equal(local.datos.get("sb-yqkvgfqplmbbcebrivpt-auth-token"), "tok",
    "la decisión se toma al escribir, no al cargar la página");
  assert.equal(sesion.datos.has("sb-yqkvgfqplmbbcebrivpt-auth-token"), false,
    "y no debe quedar una copia huérfana en la pestaña");
});

test("desmarcar después de cargar también se respeta, en el sentido inverso", () => {
  /* El camino de vuelta importa igual: quien tenía la sesión persistida y
     decide no seguir recordado no puede terminar con el token en disco. */
  const { storage, local, sesion } = cargarCliente({ recordarmeGuardado: "1" });

  local.removeItem("taudux_recordarme");

  storage.setItem("sb-yqkvgfqplmbbcebrivpt-auth-token", "tok");

  assert.equal(sesion.datos.get("sb-yqkvgfqplmbbcebrivpt-auth-token"), "tok");
  assert.equal(local.datos.has("sb-yqkvgfqplmbbcebrivpt-auth-token"), false);
});

test("leer y borrar también siguen la preferencia del momento", () => {
  /* No alcanza con que `setItem` acierte: si `getItem` mira el storage
     equivocado, la sesión existe y el cliente no la ve — que se lee en
     pantalla exactamente igual que no tenerla. */
  const { storage, local } = cargarCliente({});

  local.setItem("taudux_recordarme", "1");
  storage.setItem("sb-yqkvgfqplmbbcebrivpt-auth-token", "tok");

  assert.equal(storage.getItem("sb-yqkvgfqplmbbcebrivpt-auth-token"), "tok",
    "lo escrito se puede volver a leer");

  storage.removeItem("sb-yqkvgfqplmbbcebrivpt-auth-token");
  assert.equal(local.datos.has("sb-yqkvgfqplmbbcebrivpt-auth-token"), false,
    "y el borrado alcanza al storage donde de verdad está");
});

test("un storage bloqueado cae del lado seguro, nunca al revés", () => {
  /*
    Modo privado estricto o políticas del navegador pueden hacer que
    `localStorage` lance al tocarlo. La dirección del fallback importa más que
    su existencia: al revés, un navegador con el storage capado terminaría
    persistiendo sesiones que nadie pidió.

    Reemplaza al regex que antes ataba este aserto a la forma literal del
    código. Acá se ejecuta.
  */
  const sesion = storageFalso();
  const bloqueado = {
    getItem: () => { throw new Error("storage bloqueado"); },
    setItem: () => { throw new Error("storage bloqueado"); },
    removeItem: () => { throw new Error("storage bloqueado"); },
  };

  let opciones = null;
  const contexto = {
    localStorage: bloqueado,
    sessionStorage: sesion,
    window: {
      localStorage: bloqueado,
      sessionStorage: sesion,
      supabase: { createClient: (_u, _c, o) => { opciones = o; return { auth: {} }; } },
    },
  };
  vm.createContext(contexto);
  vm.runInContext(leer("src/app/core/supabase/supabase-client.js"), contexto);

  opciones.auth.storage.setItem("sb-yqkvgfqplmbbcebrivpt-auth-token", "tok");

  assert.equal(sesion.datos.get("sb-yqkvgfqplmbbcebrivpt-auth-token"), "tok",
    "con localStorage bloqueado la sesión va a la pestaña, no se pierde ni se persiste");
});
