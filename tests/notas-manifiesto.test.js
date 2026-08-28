const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIRECTORIO_NOTAS = path.join(ROOT, "src/content/notas");

const { revisarNotas, ubicarErrorDeJson } = require(path.join(ROOT, "tools/notas.js"));
const { construirArbolDeNotas } = require(path.join(ROOT, "src/app/core/notas/notas.arbol.js"));

/*
  El manifiesto lo escribe una persona a mano: es el esqueleto del área y esa es
  una decisión editorial. El precio de esa libertad es que un error de dedo —una
  coma, un slug mal escrito, un enlace a una nota renombrada— no falla al
  guardar, sino cuando alguien busca la nota y no aparece.

  tools/notas.js es lo único que se interpone. Estas pruebas cubren las dos
  mitades del trato: que el contenido publicado esté sano, y que el validador de
  verdad atrape cada tipo de error en vez de decir "todo en orden" siempre.
*/

/* ------------------------------------------------------------------ */
/* El contenido real del repositorio                                   */
/* ------------------------------------------------------------------ */

test("el área de notas publicada no tiene ningún problema", () => {
  assert.deepEqual(revisarNotas(), []);
});

/*
  La ruta del archivo no se deduce de los slugs —el manifiesto manda—, pero
  cuando coinciden, el repositorio se navega en el editor igual que el sitio en
  el navegador. Vale la pena sostenerlo mientras no haya un motivo para romperlo.
*/
test("la ruta de cada archivo refleja su lugar en el árbol", () => {
  const manifiesto = JSON.parse(
    fs.readFileSync(path.join(DIRECTORIO_NOTAS, "manifiesto.json"), "utf8")
  );
  const arbol = construirArbolDeNotas(manifiesto, { incluirBorradores: true });

  for (const nota of arbol.notasPorSlug.values()) {
    assert.equal(
      nota.archivo,
      `${nota.segmentos.join("/")}.md`,
      `${nota.slug}: se esperaba ${nota.segmentos.join("/")}.md`
    );
  }
});

/* ------------------------------------------------------------------ */
/* Que el validador atrape lo que debe atrapar                         */
/* ------------------------------------------------------------------ */

/*
  Cada caso arma un área de notas mínima en una carpeta temporal, le mete UN
  error y comprueba que el validador lo reporte. Sin esto, el validador podría
  quedarse callado ante cualquier cosa y la prueba de arriba seguiría en verde.
*/
function conAreaDePrueba(preparar) {
  const directorio = fs.mkdtempSync(path.join(os.tmpdir(), "notas-"));

  /*
    Va todo dentro de un solo objeto y no en variables sueltas porque el caso del
    JSON roto necesita REEMPLAZAR el manifiesto por texto, no mutarlo.
  */
  const contexto = {};
  contexto.manifiesto = {
    version: 1,
    areas: [
      {
        slug: "area",
        titulo: "Área",
        resumen: "Un área de prueba",
        notas: [
          {
            slug: "primera",
            titulo: "Primera",
            resumen: "La primera nota",
            archivo: "area/primera.md",
            relacionadas: ["segunda"],
          },
          {
            slug: "segunda",
            titulo: "Segunda",
            resumen: "La segunda nota",
            archivo: "area/segunda.md",
            relacionadas: [],
          },
        ],
      },
    ],
  };

  contexto.archivos = {
    "area/primera.md": "Cuerpo de la primera, que enlaza a [[segunda]].\n",
    "area/segunda.md": "Cuerpo de la segunda.\n",
  };

  preparar(contexto);

  fs.mkdirSync(path.join(directorio, "area"), { recursive: true });
  for (const [relativa, contenido] of Object.entries(contexto.archivos)) {
    fs.writeFileSync(path.join(directorio, relativa), contenido, "utf8");
  }
  fs.writeFileSync(
    path.join(directorio, "manifiesto.json"),
    typeof contexto.manifiesto === "string"
      ? contexto.manifiesto
      : JSON.stringify(contexto.manifiesto, null, 2),
    "utf8"
  );

  try {
    return revisarNotas({ directorio });
  } finally {
    fs.rmSync(directorio, { recursive: true, force: true });
  }
}

test("un área de prueba sana pasa la validación", () => {
  assert.deepEqual(conAreaDePrueba(() => {}), []);
});

test("avisa cuando el manifiesto apunta a un archivo que no existe", () => {
  const problemas = conAreaDePrueba(({ manifiesto }) => {
    manifiesto.areas[0].notas[0].archivo = "area/no-existe.md";
  });
  assert.equal(problemas.some((p) => p.includes("que no existe")), true);
});

test("avisa cuando hay un .md que el manifiesto no declara", () => {
  const problemas = conAreaDePrueba(({ archivos }) => {
    archivos["area/olvidada.md"] = "Una nota que nadie declaró.\n";
  });
  assert.equal(
    problemas.some((p) => p.includes("area/olvidada.md") && p.includes("no lo declara")),
    true
  );
});

/*
  El desajuste más probable de todos: se escribe el [[enlace]] y se olvida
  declararlo, así que el mapa nunca dibuja esa conexión y nadie se entera.
*/
test("avisa cuando el .md enlaza algo que «relacionadas» no declara", () => {
  const problemas = conAreaDePrueba(({ manifiesto }) => {
    manifiesto.areas[0].notas[0].relacionadas = [];
  });
  assert.equal(
    problemas.some((p) => p.includes("[[segunda]]") && p.includes("no lo declara")),
    true
  );
});

test("avisa cuando «relacionadas» declara un enlace que ya no está en el texto", () => {
  const problemas = conAreaDePrueba(({ manifiesto }) => {
    manifiesto.areas[0].notas[1].relacionadas = ["primera"];
  });
  assert.equal(problemas.some((p) => p.includes("ya no lo enlaza")), true);
});

test("avisa cuando un enlace apunta a una nota inexistente", () => {
  const problemas = conAreaDePrueba(({ manifiesto, archivos }) => {
    archivos["area/primera.md"] = "Enlaza a [[fantasma]].\n";
    manifiesto.areas[0].notas[0].relacionadas = ["fantasma"];
  });
  assert.equal(problemas.some((p) => p.includes("que no existe")), true);
});

test("avisa cuando dos notas comparten slug", () => {
  const problemas = conAreaDePrueba(({ manifiesto }) => {
    manifiesto.areas[0].notas[1].slug = "primera";
  });
  assert.equal(problemas.some((p) => p.includes("ya lo usa")), true);
});

test("avisa cuando falta el título o el resumen", () => {
  const problemas = conAreaDePrueba(({ manifiesto }) => {
    delete manifiesto.areas[0].notas[0].titulo;
    delete manifiesto.areas[0].notas[1].resumen;
  });
  assert.equal(problemas.some((p) => p.includes("falta título")), true);
  assert.equal(problemas.some((p) => p.includes("falta resumen")), true);
});

test("avisa cuando un slug no sobreviviría a una URL", () => {
  const problemas = conAreaDePrueba(({ manifiesto }) => {
    manifiesto.areas[0].notas[0].slug = "Primera Nota";
  });
  assert.equal(problemas.some((p) => p.includes("minúsculas, dígitos y guiones")), true);
});

test("avisa cuando el .md trae título propio o metadatos", () => {
  const conEncabezado = conAreaDePrueba(({ archivos }) => {
    archivos["area/segunda.md"] = "# Segunda\n\nCuerpo.\n";
  });
  assert.equal(conEncabezado.some((p) => p.includes("no lleva «# título»")), true);

  const conMetadatos = conAreaDePrueba(({ archivos }) => {
    archivos["area/segunda.md"] = "---\ntitulo: Segunda\n---\n\nCuerpo.\n";
  });
  assert.equal(conMetadatos.some((p) => p.includes("bloque ---")), true);
});

test("avisa cuando una nota está vacía", () => {
  const problemas = conAreaDePrueba(({ archivos }) => {
    archivos["area/segunda.md"] = "\n\n";
  });
  assert.equal(problemas.some((p) => p.includes("está vacía")), true);
});

test("reporta todos los problemas juntos, no solo el primero", () => {
  const problemas = conAreaDePrueba(({ manifiesto, archivos }) => {
    delete manifiesto.areas[0].notas[0].titulo;
    archivos["area/huerfana.md"] = "Sin declarar.\n";
  });
  assert.equal(problemas.length >= 2, true);
});

/* ------------------------------------------------------------------ */
/* El error más común de todos: JSON mal escrito                       */
/* ------------------------------------------------------------------ */

test("un JSON roto se reporta con la línea, no con una posición absoluta", () => {
  const problemas = conAreaDePrueba((contexto) => {
    /* Una coma de más antes del cierre: el error de dedo clásico. */
    contexto.manifiesto = '{\n  "version": 1,\n  "areas": [],\n}\n';
    Object.keys(contexto.archivos).forEach((clave) => delete contexto.archivos[clave]);
  });

  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /no es JSON válido/);
  assert.match(problemas[0], /línea 4/);
});

/*
  "Unexpected token } in JSON at position 1843" obliga a contar caracteres a mano
  en un archivo de miles de líneas. Traducir eso a línea y columna es la
  diferencia entre "hay un error" y "está en la línea 47".
*/
test("la ubicación del error señala la línea y muestra su contenido", () => {
  const texto = '{\n  "uno": 1,\n  "dos": 2,,\n  "tres": 3\n}';
  let mensaje = "";
  try {
    JSON.parse(texto);
  } catch (error) {
    mensaje = ubicarErrorDeJson(texto, error);
  }

  assert.match(mensaje, /línea 3/);
  assert.match(mensaje, /"dos": 2,,/);
});

test("un error de JSON sin posición no rompe el reporte", () => {
  const mensaje = ubicarErrorDeJson("{}", new Error("algo raro sin posición"));
  assert.equal(mensaje, "algo raro sin posición");
});
