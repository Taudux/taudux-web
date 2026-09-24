const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const RUTA_SERVICIO = "src/app/core/colaboradores/ficha.service.js";
const SOURCE = fs.readFileSync(RUTA_SERVICIO, "utf8");

const MENSAJE_CARGAR = "No se pudo cargar tu ficha. Intenta de nuevo.";
const MENSAJE_GUARDAR = "No se pudo guardar tu ficha. Intenta de nuevo.";

const USUARIO = "123e4567-e89b-42d3-a456-426614174000";

// Las catorce columnas de la ficha (0039/0040/0041) que el dueño puede escribir.
const COLUMNAS = Object.freeze([
  "puesto",
  "sector",
  "ubicacion",
  "herramientas",
  "habilidades",
  "idiomas",
  "empresa",
  "empresa_enlace",
  "modalidad_trabajo",
  "anio_inicio",
  "bio",
  "linkedin",
  "github",
  "correo",
]);

const FICHA = Object.freeze({
  puesto: "Arquitectura de datos",
  sector: "Data warehousing",
  ubicacion: "Querétaro, MX",
  herramientas: ["PostgreSQL", "Python", "GCP"],
  habilidades: ["Modelado de datos", "ETL"],
  idiomas: ["Español", "Inglés"],
  empresa: "Taudux",
  empresa_enlace: "https://taudux.com",
  modalidad_trabajo: "Híbrido",
  anio_inicio: 2018,
  bio: "Diseña pipelines y modelos de datos.\nConvierte tablas desordenadas en decisiones.",
  linkedin: "https://www.linkedin.com/in/ejemplo-valeria-ortiz",
  github: null,
  correo: "valeria@example.com",
});

// Lo que un formulario descuidado podría mandar de más: nada de esto puede
// llegar a la base. `id` en el UPDATE fallaría con 42501 (el grant no la
// incluye) y en el INSERT apuntaría a la fila de otra cuenta.
const FICHA_CON_EXTRAS = Object.freeze({
  ...FICHA,
  id: "00000000-0000-4000-8000-000000000000",
  creado_en: "2026-09-19T00:00:00Z",
  actualizado_en: "2026-09-19T00:00:00Z",
  es_colaborador: true,
  nombre: "Valeria",
});

/*
  supabaseClient falso: cada consulta encadenada se registra como una lista de
  pasos [método, ...args] desde `from()`. Al llegar al final (maybeSingle o
  single) consume la siguiente respuesta programada, que puede ser
  { data, error } o { lanza } para simular un fallo de red. Una consulta sin
  respuesta programada lanza; los tests cuentan las consultas, así que una de
  más no pasa desapercibida.
*/
function crearClienteFalso(respuestas) {
  const consultas = [];
  const cola = [...respuestas];
  const cliente = {
    from(...args) {
      const pasos = [["from", ...args]];
      consultas.push(pasos);
      const cadena = {};
      for (const metodo of ["select", "update", "insert", "upsert", "eq"]) {
        cadena[metodo] = (...argumentos) => {
          pasos.push([metodo, ...argumentos]);
          return cadena;
        };
      }
      for (const metodo of ["maybeSingle", "single"]) {
        cadena[metodo] = async () => {
          pasos.push([metodo]);
          const respuesta = cola.shift();
          if (!respuesta) throw new Error("consulta sin respuesta programada");
          if (respuesta.lanza) throw respuesta.lanza;
          return { data: respuesta.data ?? null, error: respuesta.error ?? null };
        };
      }
      return cadena;
    },
  };
  return { consultas, cliente };
}

// console.error se captura para verificar el registro sin ensuciar la salida.
function createHarness(respuestas = []) {
  const logs = [];
  const { consultas, cliente } = crearClienteFalso(respuestas);
  const context = {
    console: { error: (...args) => logs.push(args) },
    supabaseClient: cliente,
  };
  vm.runInNewContext(SOURCE, context);
  return {
    consultas,
    logs,
    obtenerMiFicha: context.obtenerMiFicha,
    guardarMiFicha: context.guardarMiFicha,
  };
}

// Contexto sin cliente: el servicio se carga sin que exista supabaseClient.
function createHarnessSinCliente({ preludio } = {}) {
  const logs = [];
  const context = { console: { error: (...args) => logs.push(args) } };
  vm.createContext(context);
  if (preludio) {
    // Reproduce supabase-client.js cuando el CDN no cargó: el script lanza al
    // inicializar su `const` global y el binding queda en TDZ para siempre.
    assert.throws(() => vm.runInContext(preludio, context));
  }
  vm.runInContext(SOURCE, context);
  return { logs, obtenerMiFicha: context.obtenerMiFicha, guardarMiFicha: context.guardarMiFicha };
}

const SIN_CLIENTE = [
  ["supabaseClient is not defined", {}],
  [
    "supabase-client.js failed to initialize",
    { preludio: "const supabaseClient = window.supabase.createClient();" },
  ],
];

// Copia a un objeto del contexto principal para comparar con deepEqual estricto
// (los objetos creados dentro de vm tienen otro Object.prototype).
function plano(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function metodos(consulta) {
  return consulta.map(([metodo]) => metodo);
}

// Argumentos del paso `metodo` de una consulta (el primero que aparezca).
function argumentosDe(consulta, metodo) {
  const paso = consulta.find(([nombre]) => nombre === metodo);
  assert.ok(paso, `la consulta no llamó a ${metodo}()`);
  return paso.slice(1);
}

// El select debe nombrar las columnas una por una: con `*` se colaría
// cualquier columna que la tabla gane más adelante (id, fechas…).
function columnasDelSelect(consulta) {
  const [texto] = argumentosDe(consulta, "select");
  assert.equal(typeof texto, "string");
  assert.equal(texto.includes("*"), false, `select con comodín: ${texto}`);
  return texto
    .split(",")
    .map((columna) => columna.trim())
    .sort();
}

function assertEsActualizacion(consulta) {
  assert.deepEqual(metodos(consulta), ["from", "update", "eq", "select", "maybeSingle"]);
  assert.deepEqual(argumentosDe(consulta, "from"), ["fichas_colaborador"]);
  assert.deepEqual(argumentosDe(consulta, "eq"), ["id", USUARIO]);
  assert.deepEqual(columnasDelSelect(consulta), [...COLUMNAS].sort());
  const [campos] = argumentosDe(consulta, "update");
  assert.deepEqual(Object.keys(campos).sort(), [...COLUMNAS].sort());
  assert.equal(Object.hasOwn(campos, "id"), false, "el UPDATE no puede llevar id");
  return campos;
}

function assertEsAlta(consulta) {
  assert.deepEqual(metodos(consulta), ["from", "insert", "select", "single"]);
  assert.deepEqual(argumentosDe(consulta, "from"), ["fichas_colaborador"]);
  assert.deepEqual(columnasDelSelect(consulta), [...COLUMNAS].sort());
  const [fila] = argumentosDe(consulta, "insert");
  assert.deepEqual(Object.keys(fila).sort(), ["id", ...COLUMNAS].sort());
  return fila;
}

// === obtenerMiFicha ==========================================================

test("obtenerMiFicha reads the own card by id with an explicit column list and maybeSingle", async () => {
  const { consultas, logs, obtenerMiFicha } = createHarness([{ data: FICHA }]);
  const result = await obtenerMiFicha(USUARIO);

  assert.equal(consultas.length, 1);
  assert.deepEqual(metodos(consultas[0]), ["from", "select", "eq", "maybeSingle"]);
  assert.deepEqual(argumentosDe(consultas[0], "from"), ["fichas_colaborador"]);
  assert.deepEqual(columnasDelSelect(consultas[0]), [...COLUMNAS].sort());
  assert.deepEqual(argumentosDe(consultas[0], "eq"), ["id", USUARIO]);
  assert.deepEqual(plano(result), { ok: true, data: plano(FICHA) });
  assert.equal(logs.length, 0);
});

test("obtenerMiFicha returns data null when the collaborator has no card yet", async () => {
  const { logs, obtenerMiFicha } = createHarness([{ data: null }]);
  const result = await obtenerMiFicha(USUARIO);

  assert.deepEqual(plano(result), { ok: true, data: null });
  assert.equal(logs.length, 0);
});

test("obtenerMiFicha reports a failure and logs it when the query returns an error", async () => {
  const { logs, obtenerMiFicha } = createHarness([
    { error: { code: "PGRST301", message: "JWT expired" } },
  ]);
  const result = await obtenerMiFicha(USUARIO);

  assert.deepEqual(plano(result), { ok: false, mensaje: MENSAJE_CARGAR });
  assert.equal(logs.length, 1);
  assert.match(JSON.stringify(logs[0]), /PGRST301/);
});

test("obtenerMiFicha reports a failure without throwing when the query throws", async () => {
  const { logs, obtenerMiFicha } = createHarness([{ lanza: new TypeError("Failed to fetch") }]);
  const result = await obtenerMiFicha(USUARIO);

  assert.deepEqual(plano(result), { ok: false, mensaje: MENSAJE_CARGAR });
  assert.equal(logs.length, 1);
});

test("obtenerMiFicha fails without calling the client when the user id is missing", async () => {
  for (const userId of [undefined, null, "", "   ", 42]) {
    const { consultas, logs, obtenerMiFicha } = createHarness([{ data: FICHA }]);
    const result = await obtenerMiFicha(userId);

    assert.deepEqual(plano(result), { ok: false, mensaje: MENSAJE_CARGAR }, `userId = ${userId}`);
    assert.equal(consultas.length, 0, `userId = ${userId}`);
    assert.equal(logs.length, 1, `userId = ${userId}`);
  }
});

for (const [caso, opciones] of SIN_CLIENTE) {
  test(`obtenerMiFicha reports a failure without throwing when ${caso}`, async () => {
    const { logs, obtenerMiFicha } = createHarnessSinCliente(opciones);
    const result = await obtenerMiFicha(USUARIO);

    assert.equal(result.ok, false);
    assert.equal(result.mensaje, MENSAJE_CARGAR);
    assert.equal(logs.length, 1);
  });
}

// === guardarMiFicha ==========================================================

test("guardarMiFicha updates an existing card with only the fourteen card columns and never sends id", async () => {
  const { consultas, logs, guardarMiFicha } = createHarness([{ data: FICHA }]);
  const result = await guardarMiFicha(USUARIO, FICHA_CON_EXTRAS);

  assert.equal(consultas.length, 1, "con la ficha ya creada no hay INSERT");
  const campos = assertEsActualizacion(consultas[0]);
  assert.deepEqual(plano(campos), plano(FICHA));
  for (const extra of ["id", "creado_en", "actualizado_en", "es_colaborador", "nombre"]) {
    assert.equal(Object.hasOwn(campos, extra), false, `${extra} llegó al UPDATE`);
  }
  assert.deepEqual(plano(result), { ok: true, data: plano(FICHA) });
  assert.equal(logs.length, 0);
});

// Una fila guardada es una ficha completa: el enlace que no viene se guarda
// como null (lo borra), no se omite del payload.
test("guardarMiFicha sends null for a card column the caller leaves out", async () => {
  const { consultas, guardarMiFicha } = createHarness([{ data: FICHA }]);
  const { linkedin, correo, ...sinEnlaces } = FICHA;
  await guardarMiFicha(USUARIO, sinEnlaces);

  const campos = assertEsActualizacion(consultas[0]);
  assert.equal(campos.linkedin, null);
  assert.equal(campos.correo, null);
});

test("guardarMiFicha never calls upsert", async () => {
  const { consultas, guardarMiFicha } = createHarness([{ data: null }, { data: FICHA }]);
  await guardarMiFicha(USUARIO, FICHA);

  for (const consulta of consultas) {
    assert.equal(metodos(consulta).includes("upsert"), false);
  }
});

test("guardarMiFicha inserts id plus the fourteen card columns when the update finds no row", async () => {
  const { consultas, logs, guardarMiFicha } = createHarness([{ data: null }, { data: FICHA }]);
  const result = await guardarMiFicha(USUARIO, FICHA_CON_EXTRAS);

  assert.equal(consultas.length, 2);
  assertEsActualizacion(consultas[0]);
  const fila = assertEsAlta(consultas[1]);
  assert.deepEqual(plano(fila), { id: USUARIO, ...plano(FICHA) });
  assert.deepEqual(plano(result), { ok: true, data: plano(FICHA) });
  assert.equal(logs.length, 0);
});

// Otra pestaña creó la ficha entre el UPDATE y el INSERT: el INSERT choca con
// la PK y un segundo UPDATE ya la encuentra.
test("guardarMiFicha retries the update once when the insert hits 23505", async () => {
  const { consultas, guardarMiFicha } = createHarness([
    { data: null },
    { error: { code: "23505", message: "duplicate key value violates unique constraint" } },
    { data: FICHA },
  ]);
  const result = await guardarMiFicha(USUARIO, FICHA);

  assert.equal(consultas.length, 3);
  assertEsActualizacion(consultas[0]);
  assertEsAlta(consultas[1]);
  assertEsActualizacion(consultas[2]);
  assert.deepEqual(plano(result), { ok: true, data: plano(FICHA) });
});

test("guardarMiFicha fails with the generic message when the retry after 23505 still finds no row", async () => {
  const { consultas, logs, guardarMiFicha } = createHarness([
    { data: null },
    { error: { code: "23505", message: "duplicate key value violates unique constraint" } },
    { data: null },
  ]);
  const result = await guardarMiFicha(USUARIO, FICHA);

  assert.equal(consultas.length, 3, "el reintento es uno solo");
  assert.deepEqual(plano(result), { ok: false, mensaje: MENSAJE_GUARDAR });
  assert.ok(logs.length >= 1);
});

/*
  Cada código de Postgres se traduce a un mensaje para el usuario, en el paso
  que sea. Un error en el UPDATE corta ahí: no se intenta el INSERT.
*/
const ERRORES = [
  {
    caso: "42501 on the insert (account not marked as collaborator)",
    respuestas: [{ data: null }, { error: { code: "42501", message: "new row violates row-level security policy" } }],
    consultas: 2,
    mensaje: "Sólo los colaboradores pueden editar su ficha.",
  },
  {
    caso: "42501 on the retry after 23505",
    respuestas: [
      { data: null },
      { error: { code: "23505", message: "duplicate key" } },
      { error: { code: "42501", message: "permission denied for table fichas_colaborador" } },
    ],
    consultas: 3,
    mensaje: "Sólo los colaboradores pueden editar su ficha.",
  },
  {
    caso: "23514 on the update",
    respuestas: [{ error: { code: "23514", message: "violates check constraint fichas_colaborador_bio_valida" } }],
    consultas: 1,
    mensaje: "Revisa tu ficha: algún dato no tiene el formato esperado.",
  },
  {
    caso: "23514 on the insert",
    respuestas: [{ data: null }, { error: { code: "23514", message: "violates check constraint" } }],
    consultas: 2,
    mensaje: "Revisa tu ficha: algún dato no tiene el formato esperado.",
  },
  {
    caso: "23502 on the insert",
    respuestas: [{ data: null }, { error: { code: "23502", message: "null value in column \"puesto\"" } }],
    consultas: 2,
    mensaje: "Faltan datos obligatorios en tu ficha.",
  },
  {
    caso: "23502 on the update",
    respuestas: [{ error: { code: "23502", message: "null value in column \"bio\"" } }],
    consultas: 1,
    mensaje: "Faltan datos obligatorios en tu ficha.",
  },
  {
    caso: "an unknown code on the update",
    respuestas: [{ error: { code: "PGRST301", message: "JWT expired" } }],
    consultas: 1,
    mensaje: MENSAJE_GUARDAR,
  },
  {
    caso: "an unknown code on the insert",
    respuestas: [{ data: null }, { error: { code: "08006", message: "connection failure" } }],
    consultas: 2,
    mensaje: MENSAJE_GUARDAR,
  },
  {
    caso: "an error without a code",
    respuestas: [{ error: { message: "algo raro" } }],
    consultas: 1,
    mensaje: MENSAJE_GUARDAR,
  },
];

for (const { caso, respuestas, consultas: esperadas, mensaje } of ERRORES) {
  test(`guardarMiFicha maps ${caso} to its message and logs it`, async () => {
    const { consultas, logs, guardarMiFicha } = createHarness(respuestas);
    const result = await guardarMiFicha(USUARIO, FICHA);

    assert.deepEqual(plano(result), { ok: false, mensaje });
    assert.equal(consultas.length, esperadas);
    assert.equal(logs.length, 1);
    const ultimo = respuestas.at(-1).error;
    if (ultimo.code) assert.match(JSON.stringify(logs[0]), new RegExp(ultimo.code));
  });
}

test("guardarMiFicha reports the generic failure without throwing when a call throws", async () => {
  for (const respuestas of [
    [{ lanza: new TypeError("Failed to fetch") }],
    [{ data: null }, { lanza: new TypeError("Failed to fetch") }],
    [{ data: null }, { error: { code: "23505", message: "duplicate key" } }, { lanza: new TypeError("Failed to fetch") }],
  ]) {
    const { consultas, logs, guardarMiFicha } = createHarness(respuestas);
    const result = await guardarMiFicha(USUARIO, FICHA);

    assert.deepEqual(plano(result), { ok: false, mensaje: MENSAJE_GUARDAR });
    assert.equal(consultas.length, respuestas.length);
    assert.equal(logs.length, 1);
  }
});

test("guardarMiFicha fails without calling the client when the user id is missing", async () => {
  for (const userId of [undefined, null, "", "   ", 42]) {
    const { consultas, logs, guardarMiFicha } = createHarness([{ data: FICHA }]);
    const result = await guardarMiFicha(userId, FICHA);

    assert.deepEqual(plano(result), { ok: false, mensaje: MENSAJE_GUARDAR }, `userId = ${userId}`);
    assert.equal(consultas.length, 0, `userId = ${userId}`);
    assert.equal(logs.length, 1, `userId = ${userId}`);
  }
});

test("guardarMiFicha fails without calling the client when the card is not an object", async () => {
  for (const ficha of [undefined, null, "rol", 7, ["rol"]]) {
    const { consultas, logs, guardarMiFicha } = createHarness([{ data: FICHA }]);
    const result = await guardarMiFicha(USUARIO, ficha);

    assert.deepEqual(plano(result), { ok: false, mensaje: MENSAJE_GUARDAR }, `ficha = ${JSON.stringify(ficha)}`);
    assert.equal(consultas.length, 0, `ficha = ${JSON.stringify(ficha)}`);
    assert.equal(logs.length, 1, `ficha = ${JSON.stringify(ficha)}`);
  }
});

for (const [caso, opciones] of SIN_CLIENTE) {
  test(`guardarMiFicha reports a failure without throwing when ${caso}`, async () => {
    const { logs, guardarMiFicha } = createHarnessSinCliente(opciones);
    const result = await guardarMiFicha(USUARIO, FICHA);

    assert.equal(result.ok, false);
    assert.equal(result.mensaje, MENSAJE_GUARDAR);
    assert.equal(logs.length, 1);
  });
}

// === Módulo ==================================================================

test("exports exactly obtenerMiFicha and guardarMiFicha as a frozen object", () => {
  const modulo = require(`../${RUTA_SERVICIO}`);

  assert.deepEqual(Object.keys(modulo).sort(), ["guardarMiFicha", "obtenerMiFicha"]);
  assert.equal(Object.isFrozen(modulo), true);
});
