const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");
const AUTH_SERVICE_SOURCE = read("src/app/core/auth/auth.service.js");
const PORTAL_JS_SOURCE = read("src/app/features/portal/portal.js");
const PORTAL_HTML = read("src/app/features/portal/index.html");

const {
  CLAVE_REAUTH_ELIMINAR,
  REAUTH_ELIMINAR_VIGENCIA_MS,
  marcaDeReauthEliminar,
  reauthEliminarEsValida,
} = require("../src/app/features/portal/portal.reauth.js");

/*
  Bloque A — núcleo puro de portal.reauth.js, corrido de verdad vía require.

  select_account (auth.service.js) deja al usuario volver con una cuenta de
  Google DISTINTA de la que pidió el borrado. reauthEliminarEsValida es lo
  único que impide que ese cambio de cuenta borre la sesión equivocada: no
  alcanza con "hay una marca y no venció", el usuarioId tiene que coincidir.
*/

test("una marca recién guardada, del mismo usuario, es válida", () => {
  const ahora = 1_000_000;
  const marca = marcaDeReauthEliminar("user-1", ahora);
  assert.equal(reauthEliminarEsValida(marca, "user-1", ahora), true);
});

test("una marca vencida (fuera de REAUTH_ELIMINAR_VIGENCIA_MS) es inválida", () => {
  const ahora = 1_000_000;
  const marca = marcaDeReauthEliminar("user-1", ahora);
  const masTarde = ahora + REAUTH_ELIMINAR_VIGENCIA_MS + 1;
  assert.equal(reauthEliminarEsValida(marca, "user-1", masTarde), false);
});

test("justo en el límite de vigencia todavía es válida", () => {
  const ahora = 1_000_000;
  const marca = marcaDeReauthEliminar("user-1", ahora);
  const limite = ahora + REAUTH_ELIMINAR_VIGENCIA_MS;
  assert.equal(reauthEliminarEsValida(marca, "user-1", limite), true);
});

test("una marca de OTRO usuario es inválida: select_account permite volver con una cuenta distinta", () => {
  const ahora = 1_000_000;
  const marca = marcaDeReauthEliminar("user-1", ahora);
  assert.equal(reauthEliminarEsValida(marca, "user-2", ahora), false);
});

test("sin marca, o con una marca malformada, no hay reauth válida", () => {
  const ahora = 1_000_000;
  assert.equal(reauthEliminarEsValida(null, "user-1", ahora), false);
  assert.equal(reauthEliminarEsValida(undefined, "user-1", ahora), false);
  assert.equal(reauthEliminarEsValida({}, "user-1", ahora), false);
  assert.equal(reauthEliminarEsValida({ usuarioId: "user-1" }, "user-1", ahora), false);
  assert.equal(
    reauthEliminarEsValida({ usuarioId: "user-1", guardadoEn: "no-es-numero" }, "user-1", ahora),
    false,
  );
});

test("CLAVE_REAUTH_ELIMINAR es una clave de sessionStorage propia, distinta de taudux_auth_next", () => {
  assert.equal(CLAVE_REAUTH_ELIMINAR, "taudux_reauth_eliminar");
});

/* Bloque B — auth.service.js: reautenticarConGoogle es hermana de
   iniciarSesionConGoogle (que tiene su redirectTo fijado por
   tests/oauth-google.test.js), apunta al portal en vez de a oauth-callback, y
   no la modifica. */

function crearContextoAuthService(signInWithOAuthImpl) {
  const calls = [];
  const context = {
    window: { location: { origin: "https://taudux.com" } },
    supabaseClient: {
      auth: {
        async signInWithOAuth(args) {
          calls.push(args);
          return signInWithOAuthImpl ? signInWithOAuthImpl(args) : { data: {}, error: null };
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(AUTH_SERVICE_SOURCE, context);
  return { calls, context };
}

test("reautenticarConGoogle pide el provider google apuntando al portal, no al oauth-callback", async () => {
  const { calls, context } = crearContextoAuthService();
  const resultado = await context.reautenticarConGoogle();

  assert.equal(resultado.ok, true);
  assert.equal(calls.length, 1);
  const [llamada] = calls;
  assert.equal(llamada.provider, "google");
  assert.equal(llamada.options.redirectTo, "https://taudux.com/app/features/portal/");
  assert.equal(llamada.options.queryParams.prompt, "select_account");
});

test("reautenticarConGoogle traduce un error del proveedor a un mensaje ok:false", async () => {
  const { context } = crearContextoAuthService(() => ({
    data: null,
    error: { code: "provider_disabled" },
  }));
  const resultado = await context.reautenticarConGoogle();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.mensaje, "El acceso con Google no está disponible en este momento.");
});

test("iniciarSesionConGoogle sigue apuntando a oauth-callback: reautenticarConGoogle no la modifica", async () => {
  const { calls, context } = crearContextoAuthService();
  await context.iniciarSesionConGoogle();
  assert.equal(calls[0].options.redirectTo, "https://taudux.com/app/features/auth/oauth-callback/");
});

/* Bloque C — portal.js: la rama sin contraseña de configurarEliminarCuenta. */

function cuerpoDeFuncion(fuente, firma) {
  const match = fuente.match(new RegExp(`${firma}\\s*{[\\s\\S]*?\\n  }`));
  assert.ok(match, `${firma} not found`);
  return match[0];
}

test("antes de salir a Google se guarda la marca de reauth en sessionStorage, no en localStorage", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "function configurarEliminarCuenta\\(session\\)");
  assert.match(cuerpo, /sessionStorage\.setItem\(\s*CLAVE_REAUTH_ELIMINAR/);
  assert.doesNotMatch(cuerpo, /localStorage\.setItem\(\s*CLAVE_REAUTH_ELIMINAR/);
});

test("el botón que dispara la salida a Google pasa por establecerBotonOcupado (contrato de bfcache)", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "function configurarEliminarCuenta\\(session\\)");
  const ocupado = cuerpo.indexOf("establecerBotonOcupado");
  const salida = cuerpo.indexOf("reautenticarConGoogle(");
  assert.ok(ocupado >= 0 && salida >= 0, "falta establecerBotonOcupado o reautenticarConGoogle");
  assert.ok(ocupado < salida, "establecerBotonOcupado debe llamarse antes de salir a Google");
});

/* Bloque D — retomar al volver: la marca se valida antes del diálogo, y el
   diálogo antes del borrado. Mismo invariante de orden que
   tests/portal.test.js:343, ahora para el camino de Google. */

test("retomarEliminarCuentaTrasGoogle valida la marca antes del diálogo, y el diálogo antes del borrado", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function retomarEliminarCuentaTrasGoogle\\([^)]*\\)");

  const validacion = cuerpo.indexOf("reauthEliminarEsValida(");
  const dialogo = cuerpo.indexOf("confirmarConTexto");
  const borrado = cuerpo.indexOf("eliminarCuenta()");
  assert.ok(validacion >= 0 && dialogo >= 0 && borrado >= 0, "faltan los tres pasos");
  assert.ok(validacion < dialogo, "la marca debe validarse antes del diálogo");
  assert.ok(dialogo < borrado, "el diálogo debe confirmarse antes de borrar");
});

test("retomarEliminarCuentaTrasGoogle borra la marca antes de validarla, sea cual sea el resultado", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function retomarEliminarCuentaTrasGoogle\\([^)]*\\)");
  const limpieza = cuerpo.indexOf("limpiarMarcaReauthEliminar(");
  const validacion = cuerpo.indexOf("reauthEliminarEsValida(");
  assert.ok(limpieza >= 0, "falta limpiarMarcaReauthEliminar()");
  assert.ok(limpieza < validacion, "la marca debe limpiarse antes de validarla, no después");
});

test("limpiarMarcaReauthEliminar borra CLAVE_REAUTH_ELIMINAR de sessionStorage, no de localStorage", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "function limpiarMarcaReauthEliminar\\(\\)");
  assert.match(cuerpo, /sessionStorage\.removeItem\(\s*CLAVE_REAUTH_ELIMINAR/);
  assert.doesNotMatch(cuerpo, /localStorage\.removeItem\(\s*CLAVE_REAUTH_ELIMINAR/);
});

/*
  Bloque E — inicializarPortal sólo espera el canje del ?code= (y sólo retoma
  el borrado) cuando HAY marca. Cancelar en Google vuelve sin ?code=: con la
  marca presente pero sin código, no se espera nada ni se abre el diálogo —
  se limpia en silencio (ver tieneCodigoOauthEnUrl en portal.reauth.js).
*/

test("inicializarPortal sólo espera la sesión post-Google cuando hay marca de reauth pendiente", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  assert.match(cuerpo, /leerMarcaReauthEliminar\(/);
  assert.match(cuerpo, /tieneCodigoOauthEnUrl\(/);
  assert.match(cuerpo, /esperarSesionTrasReauth\(/);
  assert.match(cuerpo, /retomarEliminarCuentaTrasGoogle\(/);
});

/*
  Bloque E-bis — R1-001: volver de Google con OTRA cuenta.

  select_account deja elegir una cuenta distinta de la que pidió el borrado, y
  esa sesión se establece de verdad. Si el portal la puebla y la revela antes de
  comparar el usuarioId, muestra el perfil ajeno y —peor— deja esa sesión viva:
  un segundo intento de borrado arrancaría desde ella, guardaría la marca con
  SU id, coincidiría al volver, y borraría la cuenta equivocada. Por eso la
  comparación tiene que ocurrir antes de tocar nada, y el mismatch tiene que
  cerrar la sesión, no sólo abortar el borrado.
*/

test("la marca se valida antes de traer el perfil, no después de revelar el portal", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  const validacion = cuerpo.indexOf("reauthEliminarEsValida(");
  const perfil = cuerpo.indexOf("obtenerPerfil(");
  assert.ok(validacion >= 0, "falta la validación temprana de la marca");
  assert.ok(perfil >= 0, "falta obtenerPerfil");
  assert.ok(validacion < perfil, "la marca debe validarse antes de traer el perfil de esa sesión");
});

test("la validación temprana corta antes del gate de sesión", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  const validacion = cuerpo.indexOf("reauthEliminarEsValida(");
  const gate = cuerpo.indexOf("await requerirSesion(");
  assert.ok(validacion >= 0 && gate >= 0, "faltan la validación o requerirSesion");
  assert.ok(validacion < gate, "la validación debe ocurrir antes de requerirSesion");
});

test("volver con otra cuenta de Google cierra esa sesión en vez de dejarla activa", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  assert.match(
    cuerpo,
    /cerrarSesion\(\{\s*scope:\s*"local"\s*\}\)/,
    "el mismatch debe cerrar la sesión que no corresponde",
  );
});

test("el mensaje de cuenta distinta nombra el motivo en vez de decir sólo que no se pudo verificar", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  assert.match(
    cuerpo,
    /mostrarFalloReauth\(\s*\n?\s*"[^"]*otra cuenta[^"]*"/,
    "el aviso debe decir que se eligió otra cuenta, no un genérico",
  );
});

/* Bloque F — markup: el aviso ya no ofrece un enlace por correo, ofrece
   reautenticarse con Google. */

test("el aviso de eliminar-cuenta ofrece continuar con Google, no un enlace por correo", () => {
  assert.match(PORTAL_HTML, /id="botonReautenticarGoogle"/);
  assert.doesNotMatch(PORTAL_HTML, /id="botonEnlaceEliminarCuenta"/);
});

/*
  Bloque G — los dos caminos en los que el borrado no ocurre y antes no se
  avisaba nada. Ninguno borra ni rompe: el problema era que la página recargaba
  con el panel colapsado y se leía como "el botón no hizo nada".
*/

test("cancelar en Google avisa en vez de volver en silencio", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  assert.match(cuerpo, /parametrosErrorAuth\(/);
  // access_denied (cancelación deliberada) se distingue del resto de errores,
  // igual que en oauth-callback.js.
  assert.match(cuerpo, /access_denied/);
});

test("el aviso de cancelación se emite después de revelar el contenido, no sobre la pantalla de arranque", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  const revelado = cuerpo.indexOf("contenido.hidden = false");
  const aviso = cuerpo.indexOf("mostrarToast(avisoReauth");
  assert.ok(revelado >= 0 && aviso >= 0, "faltan el revelado del contenido o el aviso");
  assert.ok(revelado < aviso, "el toast debe emitirse después de revelar el portal");
});

test("el diálogo de confirmación se abre con el portal ya revelado, no sobre la pantalla de arranque", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  const revelado = cuerpo.indexOf("contenido.hidden = false");
  const retomo = cuerpo.indexOf("retomarEliminarCuentaTrasGoogle(");
  assert.ok(revelado >= 0 && retomo >= 0, "faltan el revelado del contenido o el retomo");
  assert.ok(revelado < retomo, "el portal debe revelarse antes de abrir el diálogo modal");
});

test("un canje que no termina a tiempo muestra el fallo y frena la inicialización", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  // El resultado de la espera deja de descartarse: sin capturarlo, un timeout
  // seguía de largo hasta requerirSesion() y pateaba al login sin explicación.
  assert.match(cuerpo, /=\s*await esperarSesionTrasReauth\(/);
  const fallo = cuerpo.indexOf("mostrarFalloReauth(");
  const gate = cuerpo.indexOf("await requerirSesion(");
  assert.ok(fallo >= 0 && gate >= 0, "faltan mostrarFalloReauth o requerirSesion");
  assert.ok(fallo < gate, "el fallo debe mostrarse antes de llegar al gate de sesión");
});

test("mostrarFalloReauth apaga el aria-busy del bloque de arranque", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "function mostrarFalloReauth\\([^)]*\\)");
  assert.match(cuerpo, /aria-busy"?,\s*"false"/);
});

test("la marca se limpia también en los dos caminos de fallo, no sólo en el feliz", () => {
  const cuerpo = cuerpoDeFuncion(PORTAL_JS_SOURCE, "async function inicializarPortal\\(\\)");
  const limpiezas = cuerpo.match(/limpiarMarcaReauthEliminar\(\)/g) || [];
  assert.ok(
    limpiezas.length >= 2,
    "cancelación y timeout deben limpiar la marca; si no, la próxima carga reabre el diálogo",
  );
});

test("el portal carga portal.reauth.js antes que portal.js", () => {
  const reauth = PORTAL_HTML.indexOf("portal/portal.reauth.js");
  const portal = PORTAL_HTML.indexOf("portal/portal.js");
  assert.ok(reauth > -1 && portal > -1, "faltan los <script> esperados");
  assert.ok(reauth < portal, "portal.reauth.js debe cargar antes que portal.js");
});
