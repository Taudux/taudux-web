const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const logica = require(path.resolve(__dirname, "..", "src/app/features/slides/slides.logica.js"));
const { normalizarPresentacion } = logica;

/*
  Lógica pura de las tarjetas de Slides y del formulario de subida: los campos
  nuevos del manifiesto, fechas, categorías (filtros y normalización),
  portada de respaldo, slug, recorte de la portada y validación. Sin DOM y sin
  red, igual que slides-logica.test.js.
*/

/* ------------------------------------------------------------------ */
/* normalizarPresentacion: campos de la tarjeta                        */
/* ------------------------------------------------------------------ */

test("normalizarPresentacion conserva categoría, fecha, láminas, autor y portada", () => {
  const resultado = normalizarPresentacion("demo", {
    titulo: "Demo",
    archivo: "index.html",
    categoria: "  Bases de datos ",
    actualizado: "2026-09-25",
    total_laminas: 112,
    autor: " Equipo Taudux ",
    portada: "portada.webp",
  });

  assert.equal(resultado.ok, true, resultado.errores.join("; "));
  assert.equal(resultado.presentacion.categoria, "Bases de datos");
  assert.equal(resultado.presentacion.actualizado, "2026-09-25");
  assert.equal(resultado.presentacion.total_laminas, 112);
  assert.equal(resultado.presentacion.autor, "Equipo Taudux");
  assert.equal(resultado.presentacion.portada, "portada.webp");
});

test("normalizarPresentacion rechaza campos de tarjeta mal formados, todos juntos", () => {
  const resultado = normalizarPresentacion("demo", {
    titulo: "Demo",
    archivo: "index.html",
    categoria: 7,
    actualizado: "ayer",
    total_laminas: 0,
    autor: {},
    portada: "../portada.webp",
  });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.errores.length, 5);
  assert.ok(resultado.errores.some((e) => e.includes("categoría")));
  assert.ok(resultado.errores.some((e) => e.includes("actualizado")));
  assert.ok(resultado.errores.some((e) => e.includes("total_laminas")));
  assert.ok(resultado.errores.some((e) => e.includes("autor")));
  assert.ok(resultado.errores.some((e) => e.includes("portada")));
});

test("normalizarPresentacion exige una portada .webp relativa", () => {
  for (const portada of ["/portada.webp", "https://x.test/p.webp", "portada.png", ""]) {
    const resultado = normalizarPresentacion("demo", { titulo: "Demo", archivo: "index.html", portada });
    assert.equal(resultado.ok, false, `debió rechazar "${portada}"`);
  }
});

test("normalizarPresentacion rechaza una fecha imposible aunque tenga la forma correcta", () => {
  const resultado = normalizarPresentacion("demo", { titulo: "Demo", archivo: "index.html", actualizado: "2026-02-31" });
  assert.equal(resultado.ok, false);
});

/* ------------------------------------------------------------------ */
/* Fechas y etiquetas                                                  */
/* ------------------------------------------------------------------ */

test("fechaCorta da «6 oct 2026» sin que la zona horaria mueva el día", () => {
  assert.equal(logica.fechaCorta("2026-10-06"), "6 oct 2026");
  assert.equal(logica.fechaCorta("2026-01-01"), "1 ene 2026");
  assert.equal(logica.fechaCorta("2026-09-30"), "30 sep 2026");
  assert.equal(logica.fechaCorta("nunca"), "");
  assert.equal(logica.fechaCorta(undefined), "");
  assert.equal(logica.fechaCorta("2026-02-31"), "");
});

test("fechaCorta acepta un timestamp de Postgres", () => {
  // Mediodía UTC: cae el mismo día en cualquier zona horaria real.
  assert.equal(logica.fechaCorta("2026-10-06T12:00:00+00:00"), "6 oct 2026");
});

test("textoLaminas singulariza y se calla sin número válido", () => {
  assert.equal(logica.textoLaminas(1), "1 lámina");
  assert.equal(logica.textoLaminas(26), "26 láminas");
  assert.equal(logica.textoLaminas(0), "");
  assert.equal(logica.textoLaminas(undefined), "");
  assert.equal(logica.textoLaminas(2.5), "");
});

/* ------------------------------------------------------------------ */
/* Categorías                                                          */
/* ------------------------------------------------------------------ */

test("claveDeCategoria ignora mayúsculas, acentos y espacios de más", () => {
  const clave = logica.claveDeCategoria("Análisis   de  DATOS ");
  assert.equal(clave, "analisis de datos");
  assert.equal(logica.claveDeCategoria("analisis de datos"), clave);
  assert.equal(logica.claveDeCategoria(null), "");
});

test("categoriaReconciliada guarda la grafía que ya existía", () => {
  const existentes = ["Análisis de datos", "Bases de datos"];
  assert.equal(logica.categoriaReconciliada("analisis  de DATOS ", existentes), "Análisis de datos");
  assert.equal(logica.categoriaReconciliada("bases de datos", existentes), "Bases de datos");
});

test("categoriaReconciliada deja una categoría nueva con los espacios colapsados", () => {
  assert.equal(logica.categoriaReconciliada("  Diseño   web ", ["Datos"]), "Diseño web");
  assert.equal(logica.categoriaReconciliada("   ", ["Datos"]), "");
  assert.equal(logica.categoriaReconciliada(undefined, []), "");
});

test("listarCategorias deduplica por clave y ordena alfabético", () => {
  const lista = logica.listarCategorias([
    { categoria: "Bases de datos" },
    { categoria: "análisis de datos" },
    { categoria: "Análisis de datos" },
    { categoria: "" },
    {},
    null,
    { categoria: "Humanidades digitales" },
  ]);
  assert.deepEqual(lista, ["análisis de datos", "Bases de datos", "Humanidades digitales"]);
});

test("filtrarPorCategoria: vacío es «Todas» y la clave ignora acentos", () => {
  const catalogo = [
    { slug: "a", categoria: "Análisis de datos" },
    { slug: "b", categoria: "Bases de datos" },
    { slug: "c" },
  ];
  assert.equal(logica.filtrarPorCategoria(catalogo, "").length, 3);
  assert.deepEqual(logica.filtrarPorCategoria(catalogo, "analisis de datos").map((i) => i.slug), ["a"]);
  assert.deepEqual(logica.filtrarPorCategoria(catalogo, "BASES DE DATOS").map((i) => i.slug), ["b"]);
  assert.deepEqual(logica.filtrarPorCategoria(catalogo, "no existe"), []);
});

test("repartirCatalogo manda admins y por_revisar al desplegable y el resto a la grilla", () => {
  const { publicas, privadas } = logica.repartirCatalogo([
    { slug: "repo" },
    { slug: "pub", visibilidad: "publico" },
    { slug: "adm", visibilidad: "admins" },
    { slug: "rev", visibilidad: "por_revisar" },
    null,
  ]);
  assert.deepEqual(publicas.map((i) => i.slug), ["repo", "pub"]);
  assert.deepEqual(privadas.map((i) => i.slug), ["adm", "rev"]);
});

/* ------------------------------------------------------------------ */
/* Portada de respaldo                                                 */
/* ------------------------------------------------------------------ */

test("inicialesDeCategoria saca hasta dos letras, sin acentos", () => {
  assert.equal(logica.inicialesDeCategoria("Bases de datos"), "BD");
  assert.equal(logica.inicialesDeCategoria("Humanidades"), "HU");
  assert.equal(logica.inicialesDeCategoria("Ingeniería de datos"), "ID");
  assert.equal(logica.inicialesDeCategoria("Ñandú"), "NA");
  assert.equal(logica.inicialesDeCategoria(""), "");
  assert.equal(logica.inicialesDeCategoria(undefined), "");
});

test("el degradado de una categoría es fijo, y no depende de mayúsculas ni acentos", () => {
  const a = logica.degradadoDeCategoria("Análisis de datos");
  assert.equal(a, logica.degradadoDeCategoria("analisis de datos"));
  assert.match(a, /^linear-gradient\(135deg, hsl\(\d+ 78% 30%\), hsl\(\d+ 70% 16%\)\)$/);
  assert.notEqual(a, logica.degradadoDeCategoria("Bases de datos"));
  const tono = logica.tonoDeCategoria("Bases de datos");
  assert.ok(tono >= 170 && tono < 300);
});

/* ------------------------------------------------------------------ */
/* Subida: slug, recorte y validación                                  */
/* ------------------------------------------------------------------ */

test("slugDesdeTitulo da kebab-case ASCII y respeta el tope de la columna", () => {
  assert.equal(logica.slugDesdeTitulo("QR de sesión"), "qr-de-sesion");
  assert.equal(logica.slugDesdeTitulo("  Curso SQL — De básico  "), "curso-sql-de-basico");
  assert.equal(logica.slugDesdeTitulo("¿¡?!"), "");
  assert.equal(logica.slugDesdeTitulo(42), "");
  const largo = logica.slugDesdeTitulo("palabra ".repeat(40));
  assert.ok(largo.length <= 80);
  assert.doesNotMatch(largo, /-$/);
  assert.match(logica.slugDesdeTitulo("Ñandú 2026"), /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("rectanguloDeRecorte centra el 16:10 sin deformar", () => {
  // Más ancha que 16:10: recorta los lados.
  assert.deepEqual(logica.rectanguloDeRecorte(2000, 1000), { sx: 200, sy: 0, sw: 1600, sh: 1000 });
  // Más alta: recorta arriba y abajo.
  assert.deepEqual(logica.rectanguloDeRecorte(1600, 1600), { sx: 0, sy: 300, sw: 1600, sh: 1000 });
  // Ya es 16:10: no recorta.
  assert.deepEqual(logica.rectanguloDeRecorte(1200, 750), { sx: 0, sy: 0, sw: 1200, sh: 750 });
  assert.equal(logica.rectanguloDeRecorte(0, 100), null);
  assert.equal(logica.rectanguloDeRecorte(NaN, 100), null);
});

const archivoValido = { name: "deck.html", size: 1000, type: "text/html" };

test("validarSubida de un administrador pide autor y visibilidad", () => {
  const resultado = logica.validarSubida(
    { titulo: "QR de sesión", categoria: "Eventos", archivo: archivoValido },
    { esAdmin: true }
  );
  assert.equal(resultado.ok, false);
  assert.deepEqual(Object.keys(resultado.errores).sort(), ["autor", "visibilidad"]);
});

test("validarSubida de un autor ignora lo que mande de autor y visibilidad: sube por revisar", () => {
  const resultado = logica.validarSubida(
    { titulo: "QR de sesión", categoria: "Eventos", archivo: archivoValido, autorId: "otro", visibilidad: "publico" },
    { esAdmin: false }
  );
  assert.equal(resultado.ok, true, JSON.stringify(resultado.errores));
  assert.equal(resultado.valores.visibilidad, "por_revisar");
  assert.equal(resultado.valores.autorId, "");
  assert.equal(resultado.valores.slug, "qr-de-sesion");
});

test("validarSubida reconcilia la categoría con las existentes", () => {
  const resultado = logica.validarSubida(
    { titulo: "Algo", categoria: "analisis DE datos ", archivo: archivoValido },
    { esAdmin: false, categorias: ["Análisis de datos"] }
  );
  assert.equal(resultado.valores.categoria, "Análisis de datos");
});

test("validarSubida reporta todos los problemas juntos", () => {
  const resultado = logica.validarSubida(
    {
      titulo: "   ",
      descripcion: "x".repeat(601),
      categoria: "",
      archivo: { name: "deck.pdf", size: 10, type: "application/pdf" },
      portada: { name: "p.gif", size: 10, type: "image/gif" },
    },
    { esAdmin: false }
  );
  assert.equal(resultado.ok, false);
  assert.deepEqual(
    Object.keys(resultado.errores).sort(),
    ["archivo", "categoria", "descripcion", "portada", "titulo"]
  );
});

test("validarSubida respeta los topes de 15 MB y de 2 MB", () => {
  const base = { titulo: "Algo", categoria: "Datos" };
  const pesado = logica.validarSubida(
    { ...base, archivo: { name: "d.html", size: logica.LIMITES_SUBIDA.bytesHtml + 1 } },
    { esAdmin: false }
  );
  assert.ok(pesado.errores.archivo);
  const justo = logica.validarSubida(
    { ...base, archivo: { name: "d.html", size: logica.LIMITES_SUBIDA.bytesHtml } },
    { esAdmin: false }
  );
  assert.equal(justo.errores.archivo, undefined);
  const portadaPesada = logica.validarSubida(
    { ...base, archivo: archivoValido, portada: { name: "p.png", size: logica.LIMITES_SUBIDA.bytesPortada + 1, type: "image/png" } },
    { esAdmin: false }
  );
  assert.ok(portadaPesada.errores.portada);
});

test("validarSubida rechaza un título cuyo slug ya existe en el catálogo", () => {
  const resultado = logica.validarSubida(
    { titulo: "Curso SQL", categoria: "Datos", archivo: archivoValido },
    { esAdmin: false, slugsOcupados: ["curso-sql"] }
  );
  assert.ok(resultado.errores.titulo);
});

test("contarLaminas cuenta section.slide y tolera lo que no es un documento", () => {
  let selectorPedido = null;
  const documento = { querySelectorAll: (s) => { selectorPedido = s; return [1, 2, 3]; } };
  assert.equal(logica.contarLaminas(documento), 3);
  assert.equal(selectorPedido, "section.slide");
  assert.equal(logica.contarLaminas(null), 0);
  assert.equal(logica.contarLaminas({}), 0);
});
