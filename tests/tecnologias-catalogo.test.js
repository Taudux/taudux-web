const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const RUTA_CATALOGO = path.join(ROOT, "src/content/tecnologias/catalogo.json");
const CRUDO = fs.readFileSync(RUTA_CATALOGO, "utf8");
const CATALOGO = JSON.parse(CRUDO);

const { LIMITES_MI_FICHA } = require(
  path.join(ROOT, "src/app/features/colaboradores/mi-ficha/mi-ficha.logica.js"),
);

/*
  La misma clave con la que el widget compara y ordena: sin acentos, en
  minúsculas y con los espacios colapsados. Vive acá duplicada a propósito —
  si el día de mañana la del widget cambia, este archivo tiene que fallar y no
  seguirla en silencio.
*/
function clave(texto) {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

test("the catalog is a versioned object with a plain array of strings", () => {
  assert.equal(CATALOGO.version, 1);
  assert.ok(Array.isArray(CATALOGO.tecnologias), "tecnologias tiene que ser un arreglo");
  for (const tecnologia of CATALOGO.tecnologias) {
    assert.equal(typeof tecnologia, "string", `${JSON.stringify(tecnologia)} no es texto`);
  }
  assert.deepEqual(Object.keys(CATALOGO), ["version", "tecnologias"], "sin campos de más");
});

/*
  Tiene que valer la pena bajarlo: un catálogo de diez entradas no sugiere
  nada útil. El techo es para que nadie lo convierta en un volcado sin curar.
*/
test("the catalog holds a useful amount of entries", () => {
  assert.ok(CATALOGO.tecnologias.length >= 100, `muy corto: ${CATALOGO.tecnologias.length}`);
  assert.ok(CATALOGO.tecnologias.length <= 300, `muy largo: ${CATALOGO.tecnologias.length}`);
});

/*
  Los mismos límites que el CHECK de la 0041 le pone a cada elemento de
  herramientas: una entrada que el catálogo sugiera y la base rechace sería
  una trampa puesta a mano.
*/
test("every entry passes the same per-item rules the 0041 CHECK enforces", () => {
  const { min, max } = LIMITES_MI_FICHA.etiqueta;
  for (const tecnologia of CATALOGO.tecnologias) {
    const largo = [...tecnologia].length;
    assert.ok(largo >= min && largo <= max, `"${tecnologia}" mide ${largo}, fuera de ${min}-${max}`);
    assert.equal(tecnologia, tecnologia.trim(), `"${tecnologia}" tiene espacios en los bordes`);
    assert.ok(!/[\u0000-\u001F\u007F]/.test(tecnologia), `"${tecnologia}" trae caracteres de control`);
    assert.ok(
      !/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(tecnologia),
      `"${tecnologia}" trae caracteres bidireccionales`,
    );
  }
});

/*
  Dos entradas que sólo difieren en mayúsculas o acentos son la misma para la
  búsqueda y para la dedupe del widget: una de las dos nunca se podría elegir.
*/
test("no two entries collide once normalized", () => {
  const vistas = new Map();
  for (const tecnologia of CATALOGO.tecnologias) {
    const k = clave(tecnologia);
    assert.ok(!vistas.has(k), `"${tecnologia}" choca con "${vistas.get(k)}"`);
    vistas.set(k, tecnologia);
  }
});

/*
  Ordenado por la clave normalizada, no por el texto crudo: así "pandas" cae
  entre "OpenTelemetry" y "Perl" y no al final por ser minúscula.
*/
test("the entries are sorted by their normalized key", () => {
  const ordenado = [...CATALOGO.tecnologias].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  assert.deepEqual(CATALOGO.tecnologias, ordenado);
});

// El archivo lo edita gente a mano: dos espacios de sangría y salto final.
test("the file stays hand-editable: two-space indent and a trailing newline", () => {
  assert.ok(CRUDO.endsWith("\n"), "falta el salto de línea final");
  assert.equal(CRUDO, JSON.stringify(CATALOGO, null, 2) + "\n");
});
