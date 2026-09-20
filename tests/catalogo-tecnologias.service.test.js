const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const RUTA_SERVICIO = "src/app/core/tecnologias/catalogo.service.js";
const SOURCE = fs.readFileSync(RUTA_SERVICIO, "utf8");

const MENSAJE_CARGA = "No se pudo cargar el catálogo de tecnologías.";
const MENSAJE_VACIO = "El catálogo de tecnologías está vacío.";

/*
  Respuesta falsa de fetch. `tipo` importa tanto como el estado: un host
  estático contesta 200 con el index en HTML cuando la ruta no existe, y ese
  es el caso que el servicio tiene que atrapar antes de parsear.
*/
function respuesta({ ok = true, tipo = "application/json", cuerpo = {}, alParsear } = {}) {
  return {
    ok,
    headers: { get: (nombre) => (nombre.toLowerCase() === "content-type" ? tipo : null) },
    json: async () => {
      if (alParsear) throw alParsear;
      return cuerpo;
    },
  };
}

/*
  Cada harness es un contexto nuevo: el servicio cachea en el ámbito del
  módulo, así que dos tests que compartieran contexto se contaminarían. Las
  peticiones se registran para contarlas — una de más no pasa desapercibida.
*/
function crearHarness(respuestas = []) {
  const peticiones = [];
  const cola = [...respuestas];
  const context = {
    fetch: async (ruta, opciones) => {
      peticiones.push({ ruta, opciones });
      const siguiente = cola.shift();
      if (!siguiente) throw new Error("petición sin respuesta programada");
      if (siguiente.lanza) throw siguiente.lanza;
      return siguiente;
    },
  };
  vm.runInNewContext(SOURCE, context);
  return { peticiones, cargarCatalogoDeTecnologias: context.cargarCatalogoDeTecnologias };
}

test("the catalog loads from the static route, without cache", async () => {
  const harness = crearHarness([respuesta({ cuerpo: { version: 1, tecnologias: ["Go", "Rust"] } })]);

  const resultado = await harness.cargarCatalogoDeTecnologias();

  assert.equal(resultado.ok, true);
  assert.deepEqual([...resultado.tecnologias], ["Go", "Rust"]);
  assert.equal(harness.peticiones.length, 1);
  assert.equal(harness.peticiones[0].ruta, "/content/tecnologias/catalogo.json");
  assert.deepEqual({ ...harness.peticiones[0].opciones }, { cache: "no-cache" });
});

/*
  La ruta es parte del contrato con vercel.json (outputDirectory "src"): las
  URLs internas se escriben sin el prefijo /src/. Se lee por require porque un
  `const` de nivel superior no se asoma al contexto de vm, sólo las funciones.
*/
test("the route has no /src/ prefix and points at the real file", () => {
  const { RUTA_CATALOGO_TECNOLOGIAS } = require(path.join(ROOT, RUTA_SERVICIO));
  assert.equal(RUTA_CATALOGO_TECNOLOGIAS, "/content/tecnologias/catalogo.json");
  assert.ok(
    fs.existsSync(path.join(ROOT, "src", RUTA_CATALOGO_TECNOLOGIAS)),
    "la ruta que pide el servicio tiene que existir en el repo",
  );
});

// Nadie puede reordenar ni vaciar el catálogo de otra pantalla.
test("the loaded catalog is frozen", async () => {
  const harness = crearHarness([respuesta({ cuerpo: { tecnologias: ["Go"] } })]);

  const { tecnologias } = await harness.cargarCatalogoDeTecnologias();

  assert.ok(Object.isFrozen(tecnologias));
});

test("a second call is served from memory, without asking again", async () => {
  const harness = crearHarness([respuesta({ cuerpo: { tecnologias: ["Go"] } })]);

  const primero = await harness.cargarCatalogoDeTecnologias();
  const segundo = await harness.cargarCatalogoDeTecnologias();

  assert.equal(primero.ok, true);
  assert.equal(segundo.ok, true);
  assert.deepEqual([...segundo.tecnologias], ["Go"]);
  assert.equal(harness.peticiones.length, 1, "el catálogo se baja una sola vez");
});

// Dos campos de la misma página podrían pedirlo a la vez en el arranque.
test("concurrent calls share a single request", async () => {
  const harness = crearHarness([respuesta({ cuerpo: { tecnologias: ["Go"] } })]);

  const [primero, segundo] = await Promise.all([
    harness.cargarCatalogoDeTecnologias(),
    harness.cargarCatalogoDeTecnologias(),
  ]);

  assert.equal(primero.ok, true);
  assert.equal(segundo.ok, true);
  assert.equal(harness.peticiones.length, 1);
});

/*
  Los cuatro modos de fallar, con el mismo contrato { ok, mensaje } del resto
  de los servicios del proyecto. Ninguno lanza: quien llama sigue adelante.
*/
const FALLOS = [
  ["a 404 is a load failure", [respuesta({ ok: false, tipo: "text/html" })], MENSAJE_CARGA],
  ["a 200 with HTML is a load failure", [respuesta({ tipo: "text/html; charset=utf-8" })], MENSAJE_CARGA],
  ["malformed JSON is a load failure", [respuesta({ alParsear: new SyntaxError("json roto") })], MENSAJE_CARGA],
  ["a network error is a load failure", [{ lanza: new TypeError("Failed to fetch") }], MENSAJE_CARGA],
  ["a catalog without its array is empty", [respuesta({ cuerpo: { version: 1 } })], MENSAJE_VACIO],
  ["a catalog with an empty array is empty", [respuesta({ cuerpo: { tecnologias: [] } })], MENSAJE_VACIO],
  ["a catalog with nothing usable is empty", [respuesta({ cuerpo: { tecnologias: [7, null, ""] } })], MENSAJE_VACIO],
];

for (const [nombre, respuestas, mensaje] of FALLOS) {
  test(nombre, async () => {
    const harness = crearHarness(respuestas);

    const resultado = await harness.cargarCatalogoDeTecnologias();

    assert.equal(resultado.ok, false);
    assert.equal(resultado.mensaje, mensaje);
    assert.equal(resultado.tecnologias, undefined);
  });
}

// Un catálogo a medio editar no tumba el campo: se usa lo que sirve.
test("entries that are not text are dropped, the rest survive", async () => {
  const harness = crearHarness([
    respuesta({ cuerpo: { tecnologias: ["Go", 7, null, "", "Rust", { nombre: "Zig" }] } }),
  ]);

  const resultado = await harness.cargarCatalogoDeTecnologias();

  assert.equal(resultado.ok, true);
  assert.deepEqual([...resultado.tecnologias], ["Go", "Rust"]);
});

/*
  El fallo no se cachea. Si se cacheara, una caída momentánea dejaría al campo
  sin sugerencias por el resto de la vida de la página.
*/
test("a failure is not cached: the next attempt asks again", async () => {
  const harness = crearHarness([
    respuesta({ ok: false, tipo: "text/html" }),
    respuesta({ cuerpo: { tecnologias: ["Go"] } }),
  ]);

  const fallido = await harness.cargarCatalogoDeTecnologias();
  const logrado = await harness.cargarCatalogoDeTecnologias();

  assert.equal(fallido.ok, false);
  assert.equal(logrado.ok, true);
  assert.deepEqual([...logrado.tecnologias], ["Go"]);
  assert.equal(harness.peticiones.length, 2);
});

/*
  El catálogo vacío tampoco se cachea, y es el caso que más fácil se cuela: la
  respuesta llegó bien, sólo que sin nada usable. Si se guardara ese arreglo
  vacío, la guarda de la caché lo daría por bueno —un arreglo vacío es
  verdadero— y el campo se quedaría sin sugerencias sin volver a intentarlo.
*/
test("an empty catalog is not cached either", async () => {
  const harness = crearHarness([
    respuesta({ cuerpo: { tecnologias: [] } }),
    respuesta({ cuerpo: { tecnologias: ["Go"] } }),
  ]);

  const vacio = await harness.cargarCatalogoDeTecnologias();
  const logrado = await harness.cargarCatalogoDeTecnologias();

  assert.equal(vacio.ok, false);
  assert.equal(logrado.ok, true);
  assert.deepEqual([...logrado.tecnologias], ["Go"]);
  assert.equal(harness.peticiones.length, 2);
});

/*
  Una promesa en curso que falla tiene que liberarse igual que una que
  funciona: si el `finally` no corriera, este segundo intento devolvería para
  siempre la misma promesa fallida.
*/
test("a rejected in-flight promise is released too", async () => {
  const harness = crearHarness([
    { lanza: new TypeError("Failed to fetch") },
    respuesta({ cuerpo: { tecnologias: ["Go"] } }),
  ]);

  await harness.cargarCatalogoDeTecnologias();
  const segundo = await harness.cargarCatalogoDeTecnologias();

  assert.equal(segundo.ok, true);
  assert.equal(harness.peticiones.length, 2);
});
