const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  indiceAcotado,
  estaEscribiendoEnCampo,
  accionParaTecla,
  normalizarIndice,
  normalizarPresentacion,
} = require(path.resolve(__dirname, "..", "src/app/features/slides/slides.logica.js"));

/*
  Lógica pura del visor de Slides: acotar el índice de la diapositiva actual,
  mapear teclas a acciones (ignorando el teclado mientras se escribe en un
  campo) y normalizar el índice de carpetas y el manifiesto de una carpeta.
  Sin DOM y sin red, así que se prueba directo, igual que notas.arbol.js.
*/

/* ------------------------------------------------------------------ */
/* indiceAcotado                                                       */
/* ------------------------------------------------------------------ */

test("indiceAcotado se queda dentro de [0, total - 1]", () => {
  assert.equal(indiceAcotado(5, 10), 5);
  assert.equal(indiceAcotado(-3, 10), 0);
  assert.equal(indiceAcotado(99, 10), 9);
  assert.equal(indiceAcotado(0, 10), 0);
  assert.equal(indiceAcotado(9, 10), 9);
});

test("indiceAcotado degrada a 0 con un catálogo vacío o un índice inválido", () => {
  assert.equal(indiceAcotado(5, 0), 0);
  assert.equal(indiceAcotado(NaN, 10), 0);
  assert.equal(indiceAcotado(3, NaN), 0);
  assert.equal(indiceAcotado(3, -1), 0);
});

/* ------------------------------------------------------------------ */
/* estaEscribiendoEnCampo / accionParaTecla                            */
/* ------------------------------------------------------------------ */

test("estaEscribiendoEnCampo reconoce los tres campos de formulario y contenteditable", () => {
  assert.equal(estaEscribiendoEnCampo({ tagName: "INPUT" }), true);
  assert.equal(estaEscribiendoEnCampo({ tagName: "TEXTAREA" }), true);
  assert.equal(estaEscribiendoEnCampo({ tagName: "SELECT" }), true);
  assert.equal(estaEscribiendoEnCampo({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(estaEscribiendoEnCampo({ tagName: "BUTTON" }), false);
  assert.equal(estaEscribiendoEnCampo({ tagName: "DIV" }), false);
  assert.equal(estaEscribiendoEnCampo(null), false);
  assert.equal(estaEscribiendoEnCampo(undefined), false);
});

test("accionParaTecla mapea el repertorio documentado, heredado de deck.js más F/f", () => {
  const mapa = {
    ArrowRight: "siguiente",
    PageDown: "siguiente",
    " ": "siguiente",
    ArrowLeft: "anterior",
    PageUp: "anterior",
    Home: "primera",
    End: "ultima",
    f: "pantalla-completa",
    F: "pantalla-completa",
  };

  for (const [tecla, accion] of Object.entries(mapa)) {
    assert.equal(accionParaTecla(tecla, { tagName: "BODY" }), accion, `tecla "${tecla}"`);
  }
});

test("accionParaTecla devuelve null para una tecla sin mapear", () => {
  assert.equal(accionParaTecla("Escape", { tagName: "BODY" }), null);
  assert.equal(accionParaTecla("a", { tagName: "BODY" }), null);
  assert.equal(accionParaTecla("Tab", { tagName: "BODY" }), null);
});

test("accionParaTecla ignora TODA tecla mapeada mientras el foco escribe en un campo", () => {
  for (const tecla of ["ArrowRight", "ArrowLeft", "Home", "End", "PageUp", "PageDown", " ", "f", "F"]) {
    assert.equal(accionParaTecla(tecla, { tagName: "INPUT" }), null, `"${tecla}" en INPUT`);
    assert.equal(accionParaTecla(tecla, { tagName: "TEXTAREA" }), null, `"${tecla}" en TEXTAREA`);
    assert.equal(accionParaTecla(tecla, { tagName: "SELECT" }), null, `"${tecla}" en SELECT`);
    assert.equal(
      accionParaTecla(tecla, { tagName: "DIV", isContentEditable: true }),
      null,
      `"${tecla}" en contenteditable`
    );
  }
});

/* ------------------------------------------------------------------ */
/* normalizarIndice                                                    */
/* ------------------------------------------------------------------ */

test("normalizarIndice acepta un arreglo de slugs kebab-case únicos, recortando espacios", () => {
  const resultado = normalizarIndice(["visualizacion-de-datos", "  otro-deck  "]);

  assert.equal(resultado.ok, true);
  assert.deepEqual(resultado.errores, []);
  assert.deepEqual(resultado.indice, ["visualizacion-de-datos", "otro-deck"]);
});

test("normalizarIndice rechaza cualquier cosa que no sea un arreglo", () => {
  for (const entrada of [null, undefined, {}, "no-es-arreglo", 42]) {
    const resultado = normalizarIndice(entrada);
    assert.equal(resultado.ok, false);
    assert.deepEqual(resultado.indice, []);
    assert.ok(resultado.errores.some((e) => e.includes("arreglo")));
  }
});

test("normalizarIndice rechaza entradas que no son texto, reportando cuál", () => {
  const resultado = normalizarIndice(["valido-uno", 42, null, ""]);

  assert.equal(resultado.ok, false);
  assert.ok(resultado.errores.some((e) => e.includes("#2")));
  assert.ok(resultado.errores.some((e) => e.includes("#3")));
  assert.ok(resultado.errores.some((e) => e.includes("#4")));
});

test("normalizarIndice rechaza slugs que no son kebab-case", () => {
  const resultado = normalizarIndice(["Con-Mayusculas", "con_guion_bajo", "-empieza-con-guion", "termina-con-guion-"]);

  assert.equal(resultado.ok, false);
  assert.equal(resultado.errores.length, 4);
  ["Con-Mayusculas", "con_guion_bajo", "-empieza-con-guion", "termina-con-guion-"].forEach((slug) => {
    assert.ok(resultado.errores.some((e) => e.includes(slug)), `debe nombrar "${slug}"`);
  });
});

test("normalizarIndice reporta los slugs duplicados por su nombre", () => {
  const resultado = normalizarIndice(["uno", "dos", "uno", "dos", "tres"]);

  assert.equal(resultado.ok, false);
  assert.ok(resultado.errores.some((e) => e.includes('"uno"') && e.includes("duplicado")));
  assert.ok(resultado.errores.some((e) => e.includes('"dos"') && e.includes("duplicado")));
  assert.deepEqual(resultado.indice, ["uno", "dos", "tres"]);
});

/* ------------------------------------------------------------------ */
/* normalizarPresentacion                                              */
/* ------------------------------------------------------------------ */

test("normalizarPresentacion acepta un manifiesto bien formado y recorta espacios", () => {
  const resultado = normalizarPresentacion("visualizacion-de-datos", {
    titulo: "Visualización de datos · Taller",
    descripcion: "  Elegir, leer y explorar gráficas.  ",
    archivo: "index.html",
  });

  assert.equal(resultado.ok, true);
  assert.deepEqual(resultado.errores, []);
  assert.deepEqual(resultado.presentacion, {
    slug: "visualizacion-de-datos",
    titulo: "Visualización de datos · Taller",
    descripcion: "Elegir, leer y explorar gráficas.",
    archivo: "index.html",
  });
});

test("normalizarPresentacion acepta que falte la descripción, que es opcional", () => {
  const resultado = normalizarPresentacion("demo", { titulo: "Demo", archivo: "index.html" });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.presentacion.descripcion, "");
});

test("normalizarPresentacion reporta todos los problemas juntos, no sólo el primero", () => {
  const resultado = normalizarPresentacion("Slug Inválido", {});

  assert.equal(resultado.ok, false);
  assert.ok(resultado.errores.some((e) => e.includes("minúsculas, dígitos y guiones")));
  assert.ok(resultado.errores.some((e) => e.includes("falta título")));
  assert.ok(resultado.errores.some((e) => e.includes("falta archivo")));
});

test("normalizarPresentacion rechaza una descripción que no es texto", () => {
  const resultado = normalizarPresentacion("demo", { titulo: "Demo", archivo: "index.html", descripcion: 42 });

  assert.equal(resultado.ok, false);
  assert.ok(resultado.errores.some((e) => e.includes("descripción debe ser texto")));
});

test("normalizarPresentacion rechaza un archivo absoluto, con \"..\" o con protocolo", () => {
  const casos = [
    ["/index.html", 'no puede empezar con "/"'],
    ["../index.html", 'no puede contener ".."'],
    ["sub/../index.html", 'no puede contener ".."'],
    ["https://ajeno.example/index.html", "no puede llevar protocolo"],
  ];

  casos.forEach(([archivo, fragmento]) => {
    const resultado = normalizarPresentacion("demo", { titulo: "Demo", archivo });
    assert.equal(resultado.ok, false, `"${archivo}" debía rechazarse`);
    assert.ok(resultado.errores.some((e) => e.includes(fragmento)), `"${archivo}": ${resultado.errores.join("; ")}`);
  });
});

test("normalizarPresentacion rechaza un archivo que no termina en .html", () => {
  const resultado = normalizarPresentacion("demo", { titulo: "Demo", archivo: "index.htm" });

  assert.equal(resultado.ok, false);
  assert.ok(resultado.errores.some((e) => e.includes("debe terminar en .html")));
});

test("normalizarPresentacion acepta un archivo relativo dentro de una subcarpeta", () => {
  const resultado = normalizarPresentacion("demo", { titulo: "Demo", archivo: "paginas/index.html" });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.presentacion.archivo, "paginas/index.html");
});

test("normalizarPresentacion tolera entradas basura sin lanzar", () => {
  for (const entrada of [null, undefined, {}, "no-es-objeto", 42, []]) {
    const resultado = normalizarPresentacion("demo", entrada);
    assert.equal(resultado.presentacion.slug, "demo");
    assert.equal(typeof resultado.ok, "boolean");
  }

  for (const slug of [null, undefined, {}, 42, []]) {
    const resultado = normalizarPresentacion(slug, { titulo: "Demo", archivo: "index.html" });
    assert.equal(resultado.ok, false);
    assert.ok(resultado.errores.some((e) => e.includes("falta slug")));
  }
});
