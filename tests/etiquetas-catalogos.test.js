const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const { LIMITES_MI_FICHA } = require(
  path.join(ROOT, "src/app/features/colaboradores/mi-ficha/mi-ficha.logica.js"),
);
const { CATALOGOS_DE_ETIQUETAS } = require(path.join(ROOT, "src/app/core/etiquetas/catalogo.service.js"));

/*
  Cuántas entradas tiene que tener cada catálogo para valer la pena. El piso
  es porque un catálogo corto no sugiere nada útil —el desplegable tope a
  ocho— y el techo, para que nadie lo convierta en un volcado sin curar ni lo
  haga competir con el texto libre, que sigue permitido. Los idiomas son una
  lista finita y conocida: por eso su rango es el más chico.
*/
const TAMANOS = {
  herramientas: { min: 100, max: 300 },
  habilidades: { min: 40, max: 120 },
  idiomas: { min: 20, max: 80 },
};

const CATALOGOS = CATALOGOS_DE_ETIQUETAS.map((nombre) => {
  const ruta = path.join(ROOT, "src/content/etiquetas", `${nombre}.json`);
  const crudo = fs.readFileSync(ruta, "utf8");
  return { nombre, crudo, datos: JSON.parse(crudo) };
});

/*
  La misma clave con la que el widget compara y ordena: sin acentos, en
  minúsculas y con los espacios colapsados. Vive acá duplicada a propósito —
  si el día de mañana la del widget cambia, este archivo tiene que fallar y no
  seguirla en silencio.
*/
function clave(texto) {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

// Los tres archivos existen y ninguno sobra: el servicio los nombra a los tres.
test("there is one catalog file per name the service knows", () => {
  assert.deepEqual([...CATALOGOS_DE_ETIQUETAS], ["herramientas", "habilidades", "idiomas"]);
  const archivos = fs.readdirSync(path.join(ROOT, "src/content/etiquetas")).filter((n) => n.endsWith(".json"));
  assert.deepEqual(archivos.sort(), ["habilidades.json", "herramientas.json", "idiomas.json"]);
});

for (const { nombre, crudo, datos } of CATALOGOS) {
  test(`${nombre}: the catalog is a versioned object with a plain array of strings`, () => {
    assert.equal(datos.version, 1);
    assert.ok(Array.isArray(datos.etiquetas), "etiquetas tiene que ser un arreglo");
    for (const etiqueta of datos.etiquetas) {
      assert.equal(typeof etiqueta, "string", `${JSON.stringify(etiqueta)} no es texto`);
    }
    assert.deepEqual(Object.keys(datos), ["version", "etiquetas"], "sin campos de más");
  });

  test(`${nombre}: the catalog holds a useful amount of entries`, () => {
    const { min, max } = TAMANOS[nombre];
    assert.ok(datos.etiquetas.length >= min, `muy corto: ${datos.etiquetas.length}`);
    assert.ok(datos.etiquetas.length <= max, `muy largo: ${datos.etiquetas.length}`);
  });

  /*
    Los mismos límites que el CHECK de la 0041 le pone a cada elemento de una
    lista de etiquetas: una entrada que el catálogo sugiera y la base rechace
    sería una trampa puesta a mano.
  */
  test(`${nombre}: every entry passes the same per-item rules the 0041 CHECK enforces`, () => {
    const { min, max } = LIMITES_MI_FICHA.etiqueta;
    for (const etiqueta of datos.etiquetas) {
      const largo = [...etiqueta].length;
      assert.ok(largo >= min && largo <= max, `"${etiqueta}" mide ${largo}, fuera de ${min}-${max}`);
      assert.equal(etiqueta, etiqueta.trim(), `"${etiqueta}" tiene espacios en los bordes`);
      assert.ok(!/[\u0000-\u001F\u007F]/.test(etiqueta), `"${etiqueta}" trae caracteres de control`);
      assert.ok(
        !/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(etiqueta),
        `"${etiqueta}" trae caracteres bidireccionales`,
      );
    }
  });

  /*
    Dos entradas que sólo difieren en mayúsculas o acentos son la misma para la
    búsqueda y para la dedupe del widget: una de las dos nunca se podría elegir.
  */
  test(`${nombre}: no two entries collide once normalized`, () => {
    const vistas = new Map();
    for (const etiqueta of datos.etiquetas) {
      const k = clave(etiqueta);
      assert.ok(!vistas.has(k), `"${etiqueta}" choca con "${vistas.get(k)}"`);
      vistas.set(k, etiqueta);
    }
  });

  /*
    Ordenado por la clave normalizada, no por el texto crudo: así "pandas" cae
    entre "OpenTelemetry" y "Perl" y no al final por ser minúscula.
  */
  test(`${nombre}: the entries are sorted by their normalized key`, () => {
    const ordenado = [...datos.etiquetas].sort((a, b) => {
      const ka = clave(a);
      const kb = clave(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    assert.deepEqual(datos.etiquetas, ordenado);
  });

  // El archivo lo edita gente a mano: dos espacios de sangría y salto final.
  test(`${nombre}: the file stays hand-editable: two-space indent and a trailing newline`, () => {
    assert.ok(crudo.endsWith("\n"), "falta el salto de línea final");
    assert.equal(crudo, JSON.stringify(datos, null, 2) + "\n");
  });
}

/*
  La aserción que justifica haber partido el catálogo: una etiqueta pertenece
  a UNA lista. Si "REST" volviera a herramientas mientras "REST API" vive en
  habilidades no chocarían —son claves distintas—, pero sí chocaría cualquier
  descuido más literal, que es el que de verdad pasa al copiar entradas.
*/
test("no normalized key appears in two catalogs at once", () => {
  const duenos = new Map();
  for (const { nombre, datos } of CATALOGOS) {
    for (const etiqueta of datos.etiquetas) {
      const k = clave(etiqueta);
      const previo = duenos.get(k);
      assert.ok(!previo, `"${etiqueta}" está en ${nombre} y en ${previo?.nombre} (como "${previo?.etiqueta}")`);
      duenos.set(k, { nombre, etiqueta });
    }
  }
});
