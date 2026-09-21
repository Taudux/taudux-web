const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const leer = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

/*
  En el navegador estos dos scripts son globales clásicos y comparten un solo
  ámbito: mi-ficha.etiquetas.logica.js usa LIMITES_MI_FICHA, MENSAJES_MI_FICHA
  y errorDeElementoEtiquetaMiFicha de mi-ficha.logica.js sin importarlos.
  require() aísla cada archivo, así que acá se reproduce ese ámbito y, de
  paso, se prueba que el orden de carga que declara el HTML es el que el
  módulo necesita.
*/
const contexto = vm.createContext({});
vm.runInContext(leer("src/app/features/colaboradores/mi-ficha/mi-ficha.logica.js"), contexto);
vm.runInContext(leer("src/app/features/colaboradores/mi-ficha/mi-ficha.etiquetas.logica.js"), contexto);

const {
  normalizarClaveEtiqueta,
  agregarEtiqueta,
  quitarEtiqueta,
  moverEtiqueta,
  sugerenciasDeEtiqueta,
  indiceMasCercano,
} = contexto;

/*
  Las constantes se leen por require: un `const` de nivel superior no se asoma
  al contexto de vm, sólo las declaraciones de función. Cargar el archivo con
  require aparte es inocuo porque sus funciones sólo tocan las globales del
  otro script cuando se las llama, no al definirse.
*/
const { LIMITES_MI_FICHA } = require(
  path.join(ROOT, "src/app/features/colaboradores/mi-ficha/mi-ficha.logica.js"),
);
const { MAXIMO_SUGERENCIAS_ETIQUETAS } = require(
  path.join(ROOT, "src/app/features/colaboradores/mi-ficha/mi-ficha.etiquetas.logica.js"),
);

// Copia al contexto principal para comparar con deepEqual estricto (los
// arreglos creados dentro de vm tienen otro Array.prototype). Mismo recurso
// que `plano()` en tests/ficha.service.test.js.
function plano(valor) {
  return JSON.parse(JSON.stringify(valor));
}

const CATALOGO = Object.freeze([
  "Angular",
  "AWS",
  "Metodologías ágiles",
  "pandas",
  "PostgreSQL",
  "Power BI",
  "Python",
  "React",
  "React Native",
  "Supabase",
]);

/* ---------- La clave con la que se compara ---------- */

test("the key ignores case, accents and surrounding or repeated spaces", () => {
  assert.equal(normalizarClaveEtiqueta("PostgreSQL"), "postgresql");
  assert.equal(normalizarClaveEtiqueta("postgresql"), "postgresql");
  assert.equal(normalizarClaveEtiqueta("  PostgreSQL  "), "postgresql");
  assert.equal(normalizarClaveEtiqueta("Metodologías ágiles"), "metodologias agiles");
  assert.equal(normalizarClaveEtiqueta("React    Native"), "react native");
  assert.equal(normalizarClaveEtiqueta("REACT native"), normalizarClaveEtiqueta("React Native"));
});

test("anything that is not text has no key", () => {
  for (const valor of [null, undefined, 7, [], {}]) {
    assert.equal(normalizarClaveEtiqueta(valor), "");
  }
});

/* ---------- Agregar ---------- */

test("a technology is added at the end, trimmed, on a new array", () => {
  const herramientas = ["Python"];

  const resultado = agregarEtiqueta("herramientas", herramientas, "  PostgreSQL  ");

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(resultado.lista), ["Python", "PostgreSQL"]);
  assert.deepEqual(herramientas, ["Python"], "el arreglo de entrada no se toca");
});

// El catálogo sugiere, nunca restringe: es la decisión de fondo del editor.
test("a technology outside the catalog is added just the same", () => {
  const resultado = agregarEtiqueta("herramientas", [], "Un framework que nadie conoce");

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(resultado.lista), ["Un framework que nadie conoce"]);
});

test("an empty or blank text is refused without touching the tools list", () => {
  const herramientas = ["Python"];
  for (const vacio of ["", "   ", null, undefined, 7]) {
    const resultado = agregarEtiqueta("herramientas", herramientas, vacio);
    assert.equal(resultado.ok, false, JSON.stringify(vacio));
    assert.equal(resultado.motivo, "vacio");
    assert.equal(resultado.lista, herramientas, "devuelve el mismo arreglo, no una copia");
  }
});

test("the twelfth is the last one that fits", () => {
  const once = Array.from({ length: 11 }, (_, i) => `T${i}`);

  const doceava = agregarEtiqueta("herramientas", once, "T11");
  assert.equal(doceava.ok, true);
  assert.equal(doceava.lista.length, LIMITES_MI_FICHA.herramientas.max);

  const treceava = agregarEtiqueta("herramientas", doceava.lista, "T12");
  assert.equal(treceava.ok, false);
  assert.equal(treceava.motivo, "muchas");
  assert.equal(treceava.lista.length, LIMITES_MI_FICHA.herramientas.max);
});

/*
  Los mismos dos motivos que decide mi-ficha.logica.js por elemento: lo que el
  editor deja entrar es exactamente lo que la base va a aceptar.
*/
test("a technology too long or with forbidden characters is refused, with its reason", () => {
  const largo = agregarEtiqueta("herramientas", [], "a".repeat(LIMITES_MI_FICHA.etiqueta.max + 1));
  assert.equal(largo.ok, false);
  assert.equal(largo.motivo, "largo");

  assert.equal(agregarEtiqueta("herramientas", [], "a".repeat(LIMITES_MI_FICHA.etiqueta.max)).ok, true);

  for (const control of ["\u0000", "\t", "\u007f"]) {
    const resultado = agregarEtiqueta("herramientas", [], `Po${control}stgres`);
    assert.equal(resultado.ok, false, JSON.stringify(control));
    assert.equal(resultado.motivo, "caracteres");
  }

  // Los de formato bidireccional, que `[[:cntrl:]]` no cubre y la 0041
  // rechaza aparte.
  for (const bidi of ["\u200e", "\u202a", "\u2066"]) {
    const resultado = agregarEtiqueta("herramientas", [], `Postgres${bidi}`);
    assert.equal(resultado.ok, false, JSON.stringify(bidi));
    assert.equal(resultado.motivo, "caracteres");
  }
});

/* ---------- No repetir ---------- */

test("a repeat is refused and points at the one already there", () => {
  const herramientas = ["Python", "PostgreSQL", "AWS"];

  for (const repetida of ["PostgreSQL", "postgresql", "  POSTGRESQL  "]) {
    const resultado = agregarEtiqueta("herramientas", herramientas, repetida);
    assert.equal(resultado.ok, false, repetida);
    assert.equal(resultado.motivo, "duplicado");
    assert.equal(resultado.indice, 1, "el índice sirve para señalar la etiqueta que ya está");
    assert.equal(resultado.lista, herramientas);
  }
});

test("accents do not make a second entry either", () => {
  const herramientas = ["Metodologías ágiles"];

  const resultado = agregarEtiqueta("herramientas", herramientas, "Metodologias agiles");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, "duplicado");
  assert.equal(resultado.indice, 0);
});

/*
  La ficha guardada manda: si viene con dos variantes de la misma tecnología
  —posible, porque hasta hoy nada dedupeaba— se muestran las dos. La dedupe es
  un guardián de la entrada, no una limpieza de lo que ya existe.
*/
test("a tools list that already repeats is left alone; only new entries are guarded", () => {
  const conRepetida = ["PostgreSQL", "postgresql"];

  const resultado = agregarEtiqueta("herramientas", conRepetida, "Python");

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(resultado.lista), ["PostgreSQL", "postgresql", "Python"]);
});

/* ---------- Quitar ---------- */

test("removing takes the one at that position, on a new array", () => {
  const herramientas = ["Python", "PostgreSQL", "AWS"];

  const resultado = quitarEtiqueta(herramientas, 1);

  assert.deepEqual(plano(resultado), ["Python", "AWS"]);
  assert.deepEqual(herramientas, ["Python", "PostgreSQL", "AWS"]);
});

test("removing a position that is not there changes nothing", () => {
  const herramientas = ["Python", "PostgreSQL"];
  for (const indice of [-1, 2, 99, null, undefined, 1.5, "1"]) {
    assert.equal(quitarEtiqueta(herramientas, indice), herramientas, JSON.stringify(indice));
  }
});

/* ---------- Reordenar ---------- */

test("a technology moves to its new position, on a new array", () => {
  const herramientas = ["A", "B", "C", "D"];

  assert.deepEqual(plano(moverEtiqueta(herramientas, 0, 2)), ["B", "C", "A", "D"]);
  assert.deepEqual(plano(moverEtiqueta(herramientas, 3, 0)), ["D", "A", "B", "C"]);
  assert.deepEqual(plano(moverEtiqueta(herramientas, 2, 1)), ["A", "C", "B", "D"]);
  assert.deepEqual(herramientas, ["A", "B", "C", "D"], "el arreglo de entrada no se toca");
});

/*
  El destino se acota a los bordes en vez de dar la vuelta: quien arrastra
  hasta la orilla espera que la etiqueta se quede ahí, no que reaparezca del
  otro lado. Mismo criterio que moverSeleccion() en el roster.
*/
test("a destination past the edges is clamped, never wrapped", () => {
  const herramientas = ["A", "B", "C"];

  assert.deepEqual(plano(moverEtiqueta(herramientas, 2, -5)), ["C", "A", "B"]);
  assert.deepEqual(plano(moverEtiqueta(herramientas, 0, 99)), ["B", "C", "A"]);
});

test("a move that does not move, or that starts nowhere, returns the same array", () => {
  const herramientas = ["A", "B", "C"];

  assert.equal(moverEtiqueta(herramientas, 1, 1), herramientas, "al mismo lugar");
  assert.equal(moverEtiqueta(herramientas, 0, -3), herramientas, "ya estaba en el borde");
  assert.equal(moverEtiqueta(herramientas, 2, 9), herramientas, "ya estaba en el otro borde");
  for (const origen of [-1, 3, null, undefined, 1.5]) {
    assert.equal(moverEtiqueta(herramientas, origen, 0), herramientas, JSON.stringify(origen));
  }
  assert.equal(moverEtiqueta(herramientas, 0, null), herramientas, "destino que no es un índice");
});

/* ---------- Sugerir ---------- */

test("the search matches anywhere in the name, not only at the start", () => {
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "gres")), ["PostgreSQL"]);
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "supa")), ["Supabase"]);
});

test("the search ignores case and accents", () => {
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "POSTGRE")), ["PostgreSQL"]);
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "agiles")), ["Metodologías ágiles"]);
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "ágiles")), ["Metodologías ágiles"]);
});

// Quien teclea "pa" busca "pandas", no "Supabase".
test("the ones that start with the query come first", () => {
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "pa")), ["pandas", "Supabase"]);
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "an")), ["Angular", "pandas"]);
});

test("what is already in the tools list is not offered again", () => {
  assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, "react", ["React"])), ["React Native"]);
  assert.deepEqual(
    plano(sugerenciasDeEtiqueta(CATALOGO, "react", ["  REACT  ", "react native"])),
    [],
    "tampoco distinguiendo mayúsculas ni espacios",
  );
});

test("an empty query suggests nothing; one character already suggests", () => {
  for (const vacia of ["", "   ", null, undefined, 7]) {
    assert.deepEqual(plano(sugerenciasDeEtiqueta(CATALOGO, vacia)), [], JSON.stringify(vacia));
  }
  // Una sola letra ya sugiere. No se fija la lista entera porque "s" aparece
  // dentro de media docena de nombres; lo que importa es que haya algo y que
  // la que empieza por ella vaya adelante.
  const conUnaLetra = plano(sugerenciasDeEtiqueta(CATALOGO, "s"));
  assert.ok(conUnaLetra.length > 0, "una sola letra ya sugiere");
  assert.equal(conUnaLetra[0], "Supabase", "y la que empieza por ella va primero");
});

/*
  El tope existe para que el desplegable no tape la página: en el catálogo
  real, "a" coincide con media lista.
*/
test("the suggestions are capped, by default at the limit of the widget", () => {
  const muchas = Array.from({ length: 40 }, (_, i) => `Etiqueta ${i}`);

  assert.equal(sugerenciasDeEtiqueta(muchas, "etiqueta").length, MAXIMO_SUGERENCIAS_ETIQUETAS);
  assert.equal(MAXIMO_SUGERENCIAS_ETIQUETAS, 8);
  assert.equal(sugerenciasDeEtiqueta(muchas, "etiqueta", [], 3).length, 3);
  assert.deepEqual(plano(sugerenciasDeEtiqueta(muchas, "etiqueta", [], 0)), []);
});

// Sin catálogo el editor sigue vivo: se escribe y se agrega a mano.
test("a missing or broken catalog suggests nothing instead of failing", () => {
  for (const roto of [[], null, undefined, "PostgreSQL", [7, null, "", {}]]) {
    assert.deepEqual(plano(sugerenciasDeEtiqueta(roto, "post")), [], JSON.stringify(roto));
  }
});

/* ---------- Arrastre ---------- */

test("the nearest center wins, by plain distance", () => {
  const centros = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ];

  assert.equal(indiceMasCercano(centros, { x: 10, y: 0 }), 0);
  assert.equal(indiceMasCercano(centros, { x: 90, y: 5 }), 1);
  assert.equal(indiceMasCercano(centros, { x: 500, y: 0 }), 2);
});

// Las etiquetas envuelven en varias filas: el eje vertical cuenta igual.
test("the vertical axis counts too, because the tags wrap into rows", () => {
  const centros = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ];

  assert.equal(indiceMasCercano(centros, { x: 0, y: 40 }), 0);
  assert.equal(indiceMasCercano(centros, { x: 0, y: 60 }), 1);
});

/*
  Con empate gana el primero: si alternara, dos etiquetas a la misma distancia
  se intercambiarían en cada frame aunque el puntero no se mueva.
*/
test("a tie goes to the first one", () => {
  const centros = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  assert.equal(indiceMasCercano(centros, { x: 50, y: 0 }), 0);
});

test("without centers or without a point there is no destination", () => {
  assert.equal(indiceMasCercano([], { x: 0, y: 0 }), -1);
  assert.equal(indiceMasCercano(null, { x: 0, y: 0 }), -1);
  for (const punto of [null, undefined, {}, { x: 1 }, { x: "1", y: 2 }]) {
    assert.equal(indiceMasCercano([{ x: 0, y: 0 }], punto), -1, JSON.stringify(punto));
  }
});

test("centers that are not points are skipped, not counted", () => {
  const centros = [null, { x: 500, y: 0 }, { x: 10, y: 0 }];

  assert.equal(indiceMasCercano(centros, { x: 0, y: 0 }), 2);
});
