const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const RUTA_SERVICIO = "src/app/core/etiquetas/catalogo.service.js";
const SOURCE = fs.readFileSync(RUTA_SERVICIO, "utf8");

const { CATALOGOS_DE_ETIQUETAS, rutaDeCatalogoDeEtiquetas } = require(path.join(ROOT, RUTA_SERVICIO));

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
  return { peticiones, cargarCatalogoDeEtiquetas: context.cargarCatalogoDeEtiquetas };
}

test("the service knows exactly the three tag catalogs", () => {
  assert.deepEqual([...CATALOGOS_DE_ETIQUETAS], ["herramientas", "habilidades", "idiomas"]);
  assert.ok(Object.isFrozen(CATALOGOS_DE_ETIQUETAS));
});

/*
  La ruta es parte del contrato con vercel.json (outputDirectory "src"): las
  URLs internas se escriben sin el prefijo /src/.
*/
test("each route has no /src/ prefix and points at a real file", () => {
  for (const nombre of CATALOGOS_DE_ETIQUETAS) {
    const ruta = rutaDeCatalogoDeEtiquetas(nombre);
    assert.equal(ruta, `/content/etiquetas/${nombre}.json`);
    assert.ok(
      fs.existsSync(path.join(ROOT, "src", ruta)),
      `la ruta que pide el servicio para ${nombre} tiene que existir en el repo`,
    );
  }
});

/*
  Un nombre que no está en la lista fija ni siquiera se pide: si la ruta se
  armara con lo que llegue, cualquier texto terminaría concatenado en una URL.
*/
test("an unknown catalog name is refused without touching the network", async () => {
  const harness = crearHarness([]);

  for (const nombre of ["stack", "", null, undefined, "../notas/indice", "HERRAMIENTAS"]) {
    const resultado = await harness.cargarCatalogoDeEtiquetas(nombre);
    assert.equal(resultado.ok, false, `${JSON.stringify(nombre)} no debería cargar`);
    assert.equal(resultado.mensaje, "No se pudo cargar el catálogo de etiquetas.");
    assert.equal(resultado.etiquetas, undefined);
  }
  assert.equal(harness.peticiones.length, 0, "ninguno de esos nombres se pide por red");
});

/*
  Dos catálogos distintos no comparten ni caché ni promesa en vuelo. Si la
  promesa fuera una sola —como cuando había un único catálogo—, quien pidiera
  idiomas mientras herramientas viajaba recibiría herramientas.
*/
test("two different catalogs share neither cache nor in-flight promise", async () => {
  const harness = crearHarness([
    respuesta({ cuerpo: { etiquetas: ["Go"] } }),
    respuesta({ cuerpo: { etiquetas: ["Español"] } }),
  ]);

  const [herramientas, idiomas] = await Promise.all([
    harness.cargarCatalogoDeEtiquetas("herramientas"),
    harness.cargarCatalogoDeEtiquetas("idiomas"),
  ]);

  assert.deepEqual([...herramientas.etiquetas], ["Go"]);
  assert.deepEqual([...idiomas.etiquetas], ["Español"]);
  assert.equal(harness.peticiones.length, 2);
  assert.deepEqual(
    harness.peticiones.map((peticion) => peticion.ruta).sort(),
    ["/content/etiquetas/herramientas.json", "/content/etiquetas/idiomas.json"],
  );
});

// Un catálogo cacheado no le sirve la lista a otro que todavía no se pidió.
test("a cached catalog does not answer for a different one", async () => {
  const harness = crearHarness([
    respuesta({ cuerpo: { etiquetas: ["Go"] } }),
    respuesta({ cuerpo: { etiquetas: ["Scrum"] } }),
  ]);

  await harness.cargarCatalogoDeEtiquetas("herramientas");
  const habilidades = await harness.cargarCatalogoDeEtiquetas("habilidades");

  assert.deepEqual([...habilidades.etiquetas], ["Scrum"]);
  assert.equal(harness.peticiones.length, 2);
});

/*
  Los tres catálogos son el MISMO servicio con otro nombre: toda la batería
  corre sobre los tres. Antes de partir el catálogo esto era un archivo solo y
  la parametrización no se probaba; ahora cada caso se ejercita tres veces.
*/
for (const nombre of CATALOGOS_DE_ETIQUETAS) {
  const MENSAJE_CARGA = `No se pudo cargar el catálogo de ${nombre}.`;
  const MENSAJE_VACIO = `El catálogo de ${nombre} está vacío.`;

  test(`${nombre}: the catalog loads from the static route, without cache`, async () => {
    const harness = crearHarness([respuesta({ cuerpo: { version: 1, etiquetas: ["Go", "Rust"] } })]);

    const resultado = await harness.cargarCatalogoDeEtiquetas(nombre);

    assert.equal(resultado.ok, true);
    assert.deepEqual([...resultado.etiquetas], ["Go", "Rust"]);
    assert.equal(harness.peticiones.length, 1);
    assert.equal(harness.peticiones[0].ruta, `/content/etiquetas/${nombre}.json`);
    assert.deepEqual({ ...harness.peticiones[0].opciones }, { cache: "no-cache" });
  });

  // Nadie puede reordenar ni vaciar el catálogo desde otra pantalla.
  test(`${nombre}: the loaded catalog is frozen`, async () => {
    const harness = crearHarness([respuesta({ cuerpo: { etiquetas: ["Go"] } })]);

    const { etiquetas } = await harness.cargarCatalogoDeEtiquetas(nombre);

    assert.ok(Object.isFrozen(etiquetas));
  });

  test(`${nombre}: a second call is served from memory, without asking again`, async () => {
    const harness = crearHarness([respuesta({ cuerpo: { etiquetas: ["Go"] } })]);

    const primero = await harness.cargarCatalogoDeEtiquetas(nombre);
    const segundo = await harness.cargarCatalogoDeEtiquetas(nombre);

    assert.equal(primero.ok, true);
    assert.equal(segundo.ok, true);
    assert.deepEqual([...segundo.etiquetas], ["Go"]);
    assert.equal(harness.peticiones.length, 1, "el catálogo se baja una sola vez");
  });

  // Dos campos de la misma página podrían pedirlo a la vez en el arranque.
  test(`${nombre}: concurrent calls share a single request`, async () => {
    const harness = crearHarness([respuesta({ cuerpo: { etiquetas: ["Go"] } })]);

    const [primero, segundo] = await Promise.all([
      harness.cargarCatalogoDeEtiquetas(nombre),
      harness.cargarCatalogoDeEtiquetas(nombre),
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
    ["a catalog with an empty array is empty", [respuesta({ cuerpo: { etiquetas: [] } })], MENSAJE_VACIO],
    ["a catalog with nothing usable is empty", [respuesta({ cuerpo: { etiquetas: [7, null, ""] } })], MENSAJE_VACIO],
  ];

  for (const [caso, respuestas, mensaje] of FALLOS) {
    test(`${nombre}: ${caso}`, async () => {
      const harness = crearHarness(respuestas);

      const resultado = await harness.cargarCatalogoDeEtiquetas(nombre);

      assert.equal(resultado.ok, false);
      assert.equal(resultado.mensaje, mensaje);
      assert.equal(resultado.etiquetas, undefined);
    });
  }

  // Un catálogo a medio editar no tumba el campo: se usa lo que sirve.
  test(`${nombre}: entries that are not text are dropped, the rest survive`, async () => {
    const harness = crearHarness([
      respuesta({ cuerpo: { etiquetas: ["Go", 7, null, "", "Rust", { nombre: "Zig" }] } }),
    ]);

    const resultado = await harness.cargarCatalogoDeEtiquetas(nombre);

    assert.equal(resultado.ok, true);
    assert.deepEqual([...resultado.etiquetas], ["Go", "Rust"]);
  });

  /*
    El fallo no se cachea. Si se cacheara, una caída momentánea dejaría al campo
    sin sugerencias por el resto de la vida de la página.
  */
  test(`${nombre}: a failure is not cached: the next attempt asks again`, async () => {
    const harness = crearHarness([
      respuesta({ ok: false, tipo: "text/html" }),
      respuesta({ cuerpo: { etiquetas: ["Go"] } }),
    ]);

    const fallido = await harness.cargarCatalogoDeEtiquetas(nombre);
    const logrado = await harness.cargarCatalogoDeEtiquetas(nombre);

    assert.equal(fallido.ok, false);
    assert.equal(logrado.ok, true);
    assert.deepEqual([...logrado.etiquetas], ["Go"]);
    assert.equal(harness.peticiones.length, 2);
  });

  /*
    El catálogo vacío tampoco se cachea, y es el caso que más fácil se cuela: la
    respuesta llegó bien, sólo que sin nada usable. Si se guardara ese arreglo
    vacío, la guarda de la caché lo daría por bueno —un arreglo vacío es
    verdadero— y el campo se quedaría sin sugerencias sin volver a intentarlo.
  */
  test(`${nombre}: an empty catalog is not cached either`, async () => {
    const harness = crearHarness([
      respuesta({ cuerpo: { etiquetas: [] } }),
      respuesta({ cuerpo: { etiquetas: ["Go"] } }),
    ]);

    const vacio = await harness.cargarCatalogoDeEtiquetas(nombre);
    const logrado = await harness.cargarCatalogoDeEtiquetas(nombre);

    assert.equal(vacio.ok, false);
    assert.equal(logrado.ok, true);
    assert.deepEqual([...logrado.etiquetas], ["Go"]);
    assert.equal(harness.peticiones.length, 2);
  });

  /*
    Una promesa en curso que falla tiene que liberarse igual que una que
    funciona: si el `finally` no corriera, este segundo intento devolvería para
    siempre la misma promesa fallida.
  */
  test(`${nombre}: a rejected in-flight promise is released too`, async () => {
    const harness = crearHarness([
      { lanza: new TypeError("Failed to fetch") },
      respuesta({ cuerpo: { etiquetas: ["Go"] } }),
    ]);

    await harness.cargarCatalogoDeEtiquetas(nombre);
    const segundo = await harness.cargarCatalogoDeEtiquetas(nombre);

    assert.equal(segundo.ok, true);
    assert.equal(harness.peticiones.length, 2);
  });
}
