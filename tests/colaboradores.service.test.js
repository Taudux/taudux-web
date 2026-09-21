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
  Los campos de la ficha (0039/0040/0041), con los nombres de la base. Quien
  todavía no llenó la suya los trae en null: el RPC hace left join. Una fila
  que ni siquiera trae la columna (el RPC de la 0038) queda igual, en null.
*/
const SIN_FICHA = Object.freeze({
  puesto: null,
  sector: null,
  ubicacion: null,
  herramientas: null,
  habilidades: null,
  idiomas: null,
  empresa: null,
  empresa_enlace: null,
  modalidad_trabajo: null,
  anio_inicio: null,
  bio: null,
  linkedin: null,
  github: null,
  correo: null,
});
const sinFicha = (identidad) => ({ ...identidad, ...SIN_FICHA });
const LISTAS_DE_ETIQUETAS = Object.freeze(["herramientas", "habilidades", "idiomas"]);
const CAMPOS_PUBLICOS = ["nombre", "corto", "slug", ...Object.keys(SIN_FICHA)].sort();

// Una fila completa como la entrega `listar_colaboradores()` de la 0041.
const FILA_CON_FICHA = Object.freeze({
  nombre: "Valeria",
  apellidos: "Ortiz",
  slug: "valeria",
  puesto: "Arquitectura de datos",
  sector: "Data warehousing",
  ubicacion: "Querétaro, MX",
  herramientas: ["PostgreSQL", "Python", "GCP"],
  habilidades: ["Arquitectura de software", "TDD"],
  idiomas: ["Español", "Inglés"],
  empresa: "Datalab",
  empresa_enlace: "https://datalab.example.com",
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
      herramientas: ["PostgreSQL", "Python", "GCP"],
      habilidades: ["Arquitectura de software", "TDD"],
      idiomas: ["Español", "Inglés"],
      empresa: "Datalab",
      empresa_enlace: "https://datalab.example.com",
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
  Las tres listas de etiquetas se pintan como píldoras: sólo pasan si son un
  arreglo de textos. Cualquier otra forma (el texto suelto del prototipo,
  números, un null adentro) llega como null. Si está completo o no lo decide
  tienePerfil(), no el servicio: por eso el arreglo vacío pasa tal cual —y
  habilidades e idiomas nacen vacías, así que es su caso normal.
*/
test("tag lists only pass as an array of strings; anything else becomes null", async () => {
  for (const campo of LISTAS_DE_ETIQUETAS) {
    for (const valor of ["PostgreSQL · Python", [1, 2], ["Python", null], { 0: "Python" }, 7]) {
      const { listarColaboradores } = createHarness({ data: [{ ...FILA_CON_FICHA, [campo]: valor }] });
      const result = await listarColaboradores();
      assert.equal(result.data[0][campo], null, `${campo} = ${JSON.stringify(valor)}`);
    }

    for (const valor of [["Python"], []]) {
      const { listarColaboradores } = createHarness({ data: [{ ...FILA_CON_FICHA, [campo]: valor }] });
      const result = await listarColaboradores();
      assert.deepEqual(plano(result.data[0][campo]), valor);
    }
  }
});

/*
  EL TEST QUE FALTABA. El mapper del servicio es una lista blanca campo por
  campo, y agregar columnas al RPC no lo toca: la 0041 trajo habilidades,
  idiomas, empresa y empresa_enlace, el pintado se escribió contra una muestra
  que sí las tenía, y entre la base y la página se caían sin que nada fallara.
  Por eso la forma esperada no se escribe a mano acá —quedaría igual de ciega—
  sino que se lee del RETURNS TABLE de la migración que define el RPC.

  `apellidos` es la única columna que no sale con su nombre: el servicio la
  funde en `nombre` y `corto`.
*/
function columnasDelRpcDeColaboradores() {
  const carpeta = "supabase/migrations";
  const FIRMA = "create function public.listar_colaboradores()";
  const definen = fs
    .readdirSync(carpeta)
    .filter((nombre) => nombre.endsWith(".sql"))
    .sort()
    .filter((nombre) => fs.readFileSync(`${carpeta}/${nombre}`, "utf8").includes(FIRMA));
  assert.ok(definen.length > 0, "ninguna migración define listar_colaboradores()");

  const fuente = fs.readFileSync(`${carpeta}/${definen[definen.length - 1]}`, "utf8");
  const abre = fuente.indexOf("(", fuente.indexOf("returns table", fuente.indexOf(FIRMA)));
  const cierra = fuente.indexOf(")", abre);
  assert.ok(abre > 0 && cierra > abre, "no se pudo leer el RETURNS TABLE del RPC");

  return fuente
    .slice(abre + 1, cierra)
    .split(",")
    .map((declaracion) => declaracion.trim().split(/\s+/)[0])
    .filter(Boolean);
}

test("every column the RPC returns reaches the page under its own name", async () => {
  const columnas = columnasDelRpcDeColaboradores();
  // Guarda de la guarda: si la lectura del SQL se rompe, el deepEqual de abajo
  // pasaría a comparar contra casi nada y dejaría de probar algo.
  for (const columna of ["nombre", "apellidos", "slug", "herramientas", "correo"]) {
    assert.ok(columnas.includes(columna), `el RETURNS TABLE leído no trae ${columna}`);
  }

  const esperadas = [...columnas.filter((columna) => columna !== "apellidos"), "corto"].sort();
  const { listarColaboradores } = createHarness({ data: [FILA_CON_FICHA] });
  const result = await listarColaboradores();

  assert.deepEqual(Object.keys(result.data[0]).sort(), esperadas);
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
