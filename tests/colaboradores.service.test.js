const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const SOURCE = fs.readFileSync("src/app/core/colaboradores/colaboradores.service.js", "utf8");

/*
  El servicio corre en un contexto aislado con un supabaseClient falso. El RPC
  puede responder con { data, error } o lanzar (fallo de red); console.error se
  captura para verificar el registro sin ensuciar la salida de los tests.
*/
function createHarness({ data, error, lanza } = {}) {
  const calls = [];
  const logs = [];
  const context = {
    console: { error: (...args) => logs.push(args) },
    supabaseClient: {
      async rpc(...args) {
        calls.push(args);
        if (lanza) throw lanza;
        return { data: data === undefined ? null : data, error: error ?? null };
      },
    },
  };
  vm.runInNewContext(SOURCE, context);
  return { calls, logs, listarColaboradores: context.listarColaboradores };
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
  return { logs, listarColaboradores: context.listarColaboradores };
}

// Copia a un objeto del contexto principal para comparar con deepEqual estricto
// (los objetos creados dentro de vm tienen otro Object.prototype).
function plano(valor) {
  return JSON.parse(JSON.stringify(valor));
}

/*
  Los campos de la ficha (0039/0040), con los nombres de la base. Quien
  todavía no llenó la suya los trae en null: el RPC hace left join. Una fila
  que ni siquiera trae la columna (el RPC de la 0038) queda igual, en null.
*/
const SIN_FICHA = Object.freeze({
  puesto: null,
  sector: null,
  ubicacion: null,
  stack: null,
  modalidad_trabajo: null,
  anio_inicio: null,
  bio: null,
  linkedin: null,
  github: null,
  correo: null,
});
const sinFicha = (identidad) => ({ ...identidad, ...SIN_FICHA });
const CAMPOS_PUBLICOS = ["nombre", "corto", "slug", ...Object.keys(SIN_FICHA)].sort();

// Una fila completa como la entrega `listar_colaboradores()` de la 0040.
const FILA_CON_FICHA = Object.freeze({
  nombre: "Valeria",
  apellidos: "Ortiz",
  slug: "valeria",
  puesto: "Arquitectura de datos",
  sector: "Data warehousing",
  ubicacion: "Querétaro, MX",
  stack: ["PostgreSQL", "Python", "GCP"],
  modalidad_trabajo: "Híbrido",
  anio_inicio: 2018,
  bio: "Diseña pipelines y modelos de datos.\nConvierte tablas desordenadas en decisiones.",
  linkedin: "https://www.linkedin.com/in/ejemplo-valeria-ortiz",
  github: null,
  correo: "valeria@example.com",
});

test("calls the listar_colaboradores RPC without args and maps rows to nombre, corto and slug", async () => {
  const { calls, logs, listarColaboradores } = createHarness({
    data: [
      { nombre: "Samael", apellidos: "Flores", slug: "samael" },
      { nombre: "María José", apellidos: "de la Cruz", slug: "maria-jose" },
    ],
  });
  const result = await listarColaboradores();

  assert.equal(calls.length, 1);
  assert.deepEqual(plano(calls[0]), ["listar_colaboradores"]);
  assert.deepEqual(plano(result), {
    ok: true,
    data: [
      sinFicha({ nombre: "Samael Flores", corto: "Samael", slug: "samael" }),
      sinFicha({ nombre: "María José de la Cruz", corto: "María José", slug: "maria-jose" }),
    ],
  });
  assert.equal(logs.length, 0);
});

test("trims both name parts and joins them with a single space", async () => {
  const { listarColaboradores } = createHarness({
    data: [{ nombre: "  Samael ", apellidos: " Flores  ", slug: "samael" }],
  });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result.data), [
    sinFicha({ nombre: "Samael Flores", corto: "Samael", slug: "samael" }),
  ]);
});

test("uses only the first name when apellidos is null or blank", async () => {
  const { listarColaboradores } = createHarness({
    data: [
      { nombre: "Samael", apellidos: null, slug: "samael" },
      { nombre: "Iván", apellidos: "   ", slug: "ivan" },
    ],
  });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result.data), [
    sinFicha({ nombre: "Samael", corto: "Samael", slug: "samael" }),
    sinFicha({ nombre: "Iván", corto: "Iván", slug: "ivan" }),
  ]);
});

test("falls back to apellidos and then to the slug when the first name is blank", async () => {
  const { listarColaboradores } = createHarness({
    data: [
      { nombre: "  ", apellidos: "Flores", slug: "flores" },
      { nombre: null, apellidos: null, slug: "profe-ivan" },
      { nombre: "", apellidos: " ", slug: "anonimo" },
    ],
  });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result.data), [
    sinFicha({ nombre: "Flores", corto: "Flores", slug: "flores" }),
    sinFicha({ nombre: "profe-ivan", corto: "profe-ivan", slug: "profe-ivan" }),
    sinFicha({ nombre: "anonimo", corto: "anonimo", slug: "anonimo" }),
  ]);
});

test("passes the card fields through under their database names", async () => {
  const { listarColaboradores } = createHarness({ data: [FILA_CON_FICHA] });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result.data), [
    {
      nombre: "Valeria Ortiz",
      corto: "Valeria",
      slug: "valeria",
      puesto: "Arquitectura de datos",
      sector: "Data warehousing",
      ubicacion: "Querétaro, MX",
      stack: ["PostgreSQL", "Python", "GCP"],
      modalidad_trabajo: "Híbrido",
      anio_inicio: 2018,
      bio: "Diseña pipelines y modelos de datos.\nConvierte tablas desordenadas en decisiones.",
      linkedin: "https://www.linkedin.com/in/ejemplo-valeria-ortiz",
      github: null,
      correo: "valeria@example.com",
    },
  ]);
});

// La colaboradora que todavía no llenó su ficha sale igual (left join), con
// todos los campos de ficha en null: el servicio no los inventa.
test("a collaborator without a card yet keeps every card field null", async () => {
  const { listarColaboradores } = createHarness({
    data: [{ nombre: "Samael", apellidos: "Flores", slug: "samael", ...SIN_FICHA }],
  });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result.data), [
    sinFicha({ nombre: "Samael Flores", corto: "Samael", slug: "samael" }),
  ]);
});

/*
  El stack se pinta unido con " · ": sólo pasa si es un arreglo de textos.
  Cualquier otra forma (el texto suelto del prototipo, números, un null
  adentro) llega como null. Si está completo o no lo decide tienePerfil(), no
  el servicio: por eso el arreglo vacío pasa tal cual.
*/
test("stack only passes as an array of strings; anything else becomes null", async () => {
  for (const stack of ["PostgreSQL · Python", [1, 2], ["Python", null], { 0: "Python" }, 7]) {
    const { listarColaboradores } = createHarness({ data: [{ ...FILA_CON_FICHA, stack }] });
    const result = await listarColaboradores();
    assert.equal(result.data[0].stack, null, `stack = ${JSON.stringify(stack)}`);
  }

  for (const stack of [["Python"], []]) {
    const { listarColaboradores } = createHarness({ data: [{ ...FILA_CON_FICHA, stack }] });
    const result = await listarColaboradores();
    assert.deepEqual(plano(result.data[0].stack), stack);
  }
});

test("never lets extra RPC columns reach the result", async () => {
  const { listarColaboradores } = createHarness({
    data: [
      {
        ...FILA_CON_FICHA,
        id: "123e4567-e89b-42d3-a456-426614174000",
        telefono: "+52 442 000 0000",
        es_prueba: false,
        es_colaborador: true,
        creado_en: "2026-09-19T00:00:00Z",
      },
    ],
  });
  const result = await listarColaboradores();

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data[0]).sort(), CAMPOS_PUBLICOS);
  const json = JSON.stringify(result);
  for (const filtrado of ["442", "123e4567", "es_prueba", "es_colaborador", "creado_en"]) {
    assert.equal(json.includes(filtrado), false, `${filtrado} llegó a la página`);
  }
});

test("drops rows whose slug is missing or not a valid public slug", async () => {
  const { listarColaboradores } = createHarness({
    data: [
      { nombre: "Sin", apellidos: "Slug" },
      { nombre: "Nulo", apellidos: null, slug: null },
      { nombre: "Vacío", apellidos: null, slug: "" },
      { nombre: "Mayúsculas", apellidos: null, slug: "Samael" },
      { nombre: "Guion", apellidos: null, slug: "-samael" },
      { nombre: "Doble", apellidos: null, slug: "sam--ael" },
      { nombre: "Ruta", apellidos: null, slug: "../admin" },
      { nombre: "Número", apellidos: null, slug: 42 },
      null,
      { nombre: "Válido", apellidos: null, slug: "diego-de-la-cruz" },
    ],
  });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result), {
    ok: true,
    data: [sinFicha({ nombre: "Válido", corto: "Válido", slug: "diego-de-la-cruz" })],
  });
});

test("returns an empty list when the RPC returns null data", async () => {
  const { listarColaboradores } = createHarness({ data: null });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result), { ok: true, data: [] });
});

test("reports a failure and logs it when the RPC returns an error", async () => {
  const { logs, listarColaboradores } = createHarness({
    error: { code: "42883", message: "function public.listar_colaboradores() does not exist" },
  });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result), {
    ok: false,
    mensaje: "No se pudo cargar la lista de colaboradores.",
  });
  assert.equal(logs.length, 1);
  assert.match(JSON.stringify(logs[0]), /42883/);
});

test("reports a failure without throwing when the RPC call throws", async () => {
  const { logs, listarColaboradores } = createHarness({ lanza: new TypeError("Failed to fetch") });
  const result = await listarColaboradores();

  assert.deepEqual(plano(result), {
    ok: false,
    mensaje: "No se pudo cargar la lista de colaboradores.",
  });
  assert.equal(logs.length, 1);
});

test("reports a failure without throwing when supabaseClient is not defined", async () => {
  const { logs, listarColaboradores } = createHarnessSinCliente();
  const result = await listarColaboradores();

  assert.equal(result.ok, false);
  assert.equal(result.mensaje, "No se pudo cargar la lista de colaboradores.");
  assert.equal(logs.length, 1);
});

test("reports a failure without throwing when supabase-client.js failed to initialize", async () => {
  const { logs, listarColaboradores } = createHarnessSinCliente({
    preludio: "const supabaseClient = window.supabase.createClient();",
  });
  const result = await listarColaboradores();

  assert.equal(result.ok, false);
  assert.equal(result.mensaje, "No se pudo cargar la lista de colaboradores.");
  assert.equal(logs.length, 1);
});
