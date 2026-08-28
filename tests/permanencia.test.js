/* La medición de permanencia, y sobre todo SU LÍMITE.
 *
 * Mide cuánto tiempo ACTIVO pasa alguien en el extractor, para contestar
 * "¿cuánto tarda la gente en usar esto?" — la pregunta del histograma del
 * panel. Lo que este archivo blinda no es que la medición exista: es que NO
 * CREZCA hacia la identidad.
 *
 * El cuerpo que viaja es una lista CERRADA de cuatro claves. `user_id`, el
 * correo, el id anónimo (`X-Sesion-Anon`) o cualquier cosa que permita señalar
 * a una persona son datos personales (LFPDPPP), y agregarlos convertiría una
 * métrica agregada en un rastro por individuo — exactamente lo que se retiró
 * del panel el 2026-08-28 al quitar "Quién lo usa y cuánto".
 *
 * LA CUARTA CLAVE ENTRÓ EL 2026-08-29 Y NO ES GRATIS. `es_admin` existe para
 * que el interruptor "excluir a los administradores" gobierne también esta
 * sección; hasta entonces la sección declaraba en pantalla que no podía.
 *
 * El costo, dicho acá porque es donde se nota: con uno o dos administradores,
 * una fila marcada `es_admin: true` señala en la práctica a una persona
 * concreta. La diferencia que lo hace aceptable es QUIÉN queda señalado — el
 * dueño del sitio, no quien lo usa—, y que se declara en el aviso de
 * privacidad. Las filas de los demás siguen sin nada que las distinga.
 *
 * Y sólo alcanza a los admins CON SESIÓN: uno que navegue sin iniciarla llega
 * como anónimo y se cuenta como tal, igual que en las otras tres secciones,
 * que excluyen por `user_id` y tampoco pueden verlo.
 *
 * Mismo criterio y misma forma que `extractor-analitica.test.js` usa para el
 * evento de GA4: los comentarios se quitan antes de mirar el código, para que
 * explicar qué NO puede viajar —nombrándolo— no haga fallar ningún aserto.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MODULO = "src/app/core/telemetry/permanencia.js";
const PAGINA = "src/app/features/transactions/index.html";
const EXTRACTOR = "src/app/features/transactions/extractor.js";

const sinComentariosJs = (js) => js
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

const codigo = () =>
  sinComentariosJs(fs.readFileSync(path.join(ROOT, MODULO), "utf8"));

test("the visit body is a closed list: seconds, session, outcome, admin flag", () => {
  /*
    El aserto captura el objeto que se serializa y valida clave por clave
    contra una lista blanca. Agregar `user_id` —el error más fácil de cometer,
    y el que suena más inocente— pone este test en rojo.
  */
  const cuerpo = codigo().match(/JSON\.stringify\(\{([\s\S]*?)\}\)/);
  assert.ok(cuerpo, "el cuerpo del beacon debe declararse inline y completo");

  /*
    Se parte por comas y se toma el identificador de cada entrada, en vez de
    buscar `clave:`. La primera versión hacía eso último y contaba UNA sola
    clave: las propiedades abreviadas (`segundos,`) no llevan dos puntos — que
    es justo la forma en que alguien agregaría `userId,` sin pensarlo.
  */
  const claves = cuerpo[1]
    .split(",")
    .map((trozo) => trozo.trim())
    .filter(Boolean)
    .map((trozo) => trozo.split(":")[0].trim());

  const permitidas = new Set([
    "segundos", "con_sesion", "extrajo", "es_admin",
  ]);
  for (const clave of claves) {
    assert.ok(
      permitidas.has(clave),
      `la clave "${clave}" no está permitida: el cuerpo mide una visita, ` +
        "no identifica a quien la hizo"
    );
  }
  assert.equal(claves.length, 4, "las cuatro, ni una más ni una menos");
});

test("no identity of any kind reaches the endpoint", () => {
  /*
    El complemento del test anterior: aquél valida lo que SÍ viaja; éste
    prohíbe por nombre lo que nunca debe entrar, aunque alguien lo meta por
    otra vía que no sea ese `JSON.stringify`.
  */
  const js = codigo();

  ["user_id", "userId", "sesion_anon", "sesionAnon", "correo", "email",
   "Authorization", "access_token"].forEach((prohibido) => {
    assert.doesNotMatch(
      js,
      new RegExp(prohibido),
      `"${prohibido}" no puede aparecer: una visita se cuenta, no se atribuye`
    );
  });
});

test("the admin flag defaults to false, which is the safe direction", () => {
  /*
    Si el aviso del servidor no llega —una pantalla que cargue el módulo sin
    pedir `cuota`, o una respuesta que falle— la visita tiene que contarse como
    de alguien común.

    La dirección importa y no es simétrica. Con `false` por defecto, la visita
    de un admin perdido se cuela entre las normales: ensucia un poco. Con `true`
    por defecto, TODA visita cuyo aviso se pierda desaparecería de la vista
    filtrada — que es la que el interruptor enciende para leer el uso real. El
    error barato es contar de más, no borrar.
  */
  const js = codigo();

  assert.match(
    js,
    /let esAdmin\s*=\s*false/,
    "arranca en false: sin aviso, la visita no es de un administrador"
  );
  assert.match(
    js,
    /esAdmin\s*=\s*Boolean\(/,
    "y sólo cambia por el evento, normalizado a booleano"
  );
});

test("time is ACTIVE time: it pauses when the tab stops being visible", () => {
  /*
    Una pestaña abierta toda la noche no son ocho horas de uso. Sin la pausa,
    el histograma mediría cuánto tiempo dejó la pestaña abierta, que es otra
    cosa y además no le sirve a nadie.
  */
  const js = codigo();

  assert.match(js, /visibilitychange/, "escucha el cambio de visibilidad");
  assert.match(
    js,
    /visibilityState\s*===\s*"hidden"/,
    "y distingue oculta de visible, no sólo que el evento ocurrió"
  );
  assert.match(
    js,
    /function pausar\(\)[\s\S]{0,200}?acumulado \+=/,
    "al ocultarse acumula lo corrido y deja de contar"
  );
});

test("it leaves with sendBeacon, never with beforeunload", () => {
  /*
    `beforeunload` no dispara de forma fiable en móvil —el sistema puede matar
    la pestaña sin avisar— y encima rompe el bfcache, que penaliza a quien
    vuelve con el botón atrás. `sendBeacon` sobrevive a la descarga de la
    página sin retener nada.
  */
  const js = codigo();

  assert.match(js, /navigator\.sendBeacon/, "el envío va por beacon");
  assert.doesNotMatch(js, /beforeunload/, "y nunca por beforeunload");
  assert.match(
    js,
    /typeof navigator\.sendBeacon !== "function"/,
    "con guarda: sin soporte no se rompe la página, simplemente no se mide"
  );
});

test("implausible durations never leave the browser", () => {
  /*
    El endpoint no lleva autenticación —una visita anónima también cuenta— así
    que la primera criba se hace acá. No vuelve al endpoint invulnerable: lo
    vuelve aburrido, que para un histograma agregado alcanza.
  */
  const js = codigo();

  assert.match(js, /MINIMO_SEGUNDOS/, "hay un piso");
  assert.match(js, /MAXIMO_SEGUNDOS/, "y un techo");
  assert.match(
    js,
    /segundos < MINIMO_SEGUNDOS \|\| segundos > MAXIMO_SEGUNDOS/,
    "y fuera de rango no se envía nada"
  );
});

test("it sends once, and the code says what that costs", () => {
  /*
    Sin un identificador de visita no hay forma de ACTUALIZAR una fila ya
    escrita, y dárselo a un endpoint sin autenticación abriría la puerta a que
    alguien sobreescriba filas ajenas. La consecuencia —el tiempo posterior a
    la primera salida no se cuenta— es una decisión, no un descuido, y tiene
    que estar escrita donde se toma.
  */
  const js = codigo();
  assert.match(js, /entregado/, "una sola entrega por visita");

  /*
    La prosa se normaliza en DOS pasos, y los dos hicieron falta:

      1. Quitar el `*` con que cada línea de un bloque de comentario arranca.
         Sin esto, colapsar espacios deja "NO se * cuenta", que no matchea.
      2. Colapsar los espacios, para que una frase partida por el ajuste de
         línea —"ese tiempo NO se ⏎ cuenta"— se lea entera.

    Es la trampa que el CLAUDE.md advierte sobre las cadenas partidas, y caer
    en ella cuesta un test rojo contra un archivo que sí dice lo que se le pide.
  */
  const prosa = fs
    .readFileSync(path.join(ROOT, MODULO), "utf8")
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\s+/g, " ");

  assert.match(
    prosa,
    /no se cuenta|no se mide|se pierde/i,
    "y el archivo declara qué queda sin medir, en vez de dejarlo implícito"
  );
});

test("the extractor tells it about the session and the outcome, by event", () => {
  /*
    El módulo no le pregunta nada a nadie: la página le avisa. Así no depende
    de `auth.service.js` ni de Supabase y puede cargarse en pantallas que no
    tengan ninguno de los dos.

    Y el aviso de sesión manda un BOOLEANO. Si algún día alguien le pasa el
    plan crudo, el uuid o el correo "porque ya lo tiene a mano", el aserto de
    lista cerrada de arriba no lo atraparía — el dato entraría por acá.
  */
  const extractor = sinComentariosJs(
    fs.readFileSync(path.join(ROOT, EXTRACTOR), "utf8"));

  assert.match(
    extractor,
    /taudux:permanencia-sesion[\s\S]{0,160}?conSesion:\s*cuota\.plan !== "anonimo"/,
    "avisa si hubo sesión, como booleano y resuelto por el servidor"
  );
  /*
    El mismo evento carga si quien visita es administrador, y viene del
    SERVIDOR: `cuota.es_admin` lo resuelve `_es_admin()` leyendo `perfiles.rol`.
    El front no lo deduce — no hay una segunda fuente para el rol.

    Va en ESTE evento y no en uno propio a propósito: los dos datos se conocen
    en el mismo instante y viajan a la misma fila. Dos eventos podrían llegar
    desapareados y escribir una visita con la sesión de una y el rol de otra.
  */
  assert.match(
    extractor,
    /taudux:permanencia-sesion[\s\S]{0,220}?esAdmin:\s*!!cuota\.es_admin/,
    "avisa si quien visita es admin, como booleano y resuelto por el servidor"
  );
  assert.match(
    extractor,
    /taudux:permanencia-extraccion/,
    "y avisa cuando la visita llegó a producir una tabla"
  );

  const avisos = extractor.match(/taudux:permanencia-sesion/g) || [];
  assert.equal(avisos.length, 1,
    "un solo punto de aviso: dos podrían discrepar");
});

test("the extractor page loads it after the client that owns the API base", () => {
  /*
    El orden de los <script> es una dependencia real en este sitio: son scripts
    clásicos que comparten el scope global, y `permanencia.js` usa la constante
    `API` que declara `api-cliente.js`. Cargarlo antes lo deja sin destino.
  */
  const html = fs.readFileSync(path.join(ROOT, PAGINA), "utf8");

  const cliente = html.indexOf("transactions/api-cliente.js");
  const permanencia = html.indexOf("telemetry/permanencia.js");

  assert.notEqual(permanencia, -1, "la página tiene que cargar el módulo");
  assert.ok(
    cliente !== -1 && permanencia > cliente,
    "y cargarlo DESPUÉS de api-cliente.js, de donde sale la URL de la API"
  );
});
