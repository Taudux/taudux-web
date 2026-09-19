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
      { nombre: "Samael Flores", corto: "Samael", slug: "samael" },
      { nombre: "María José de la Cruz", corto: "María José", slug: "maria-jose" },
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
    { nombre: "Samael Flores", corto: "Samael", slug: "samael" },
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
    { nombre: "Samael", corto: "Samael", slug: "samael" },
    { nombre: "Iván", corto: "Iván", slug: "ivan" },
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
    { nombre: "Flores", corto: "Flores", slug: "flores" },
    { nombre: "profe-ivan", corto: "profe-ivan", slug: "profe-ivan" },
    { nombre: "anonimo", corto: "anonimo", slug: "anonimo" },
  ]);
});

test("never lets extra RPC columns reach the result", async () => {
  const { listarColaboradores } = createHarness({
    data: [
      {
        id: "123e4567-e89b-42d3-a456-426614174000",
        nombre: "Samael",
        apellidos: "Flores",
        slug: "samael",
        telefono: "+52 442 000 0000",
        rol: "admin",
        es_prueba: false,
      },
    ],
  });
  const result = await listarColaboradores();

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ["corto", "nombre", "slug"]);
  assert.equal(JSON.stringify(result).includes("442"), false);
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
    data: [{ nombre: "Válido", corto: "Válido", slug: "diego-de-la-cruz" }],
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
