const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const {
  construirArbolDeNotas,
  parsearHashNotas,
  construirHashNotas,
  resolverRutaDeNotas,
  migasDeNotas,
  vistaDeGrafo,
  buscarEnNotas,
  extraerWikilinks,
  separarFrontmatter,
  validarManifiestoDeNotas,
  VISTA_NOTAS_PREDETERMINADA,
} = require(path.join(ROOT, "src/app/core/notas/notas.arbol.js"));

/*
  El árbol de notas es la única fuente de la que salen las dos vistas del área
  —el listado y el grafo—. Lo que se blinda acá es que ambas puedan confiar en
  él: que una URL compartida lleve a donde dice, que una nota despublicada
  desaparezca de verdad, y que las relaciones del grafo se lean del cuerpo de
  las notas sin inventar enlaces que nunca se escribieron.
*/

/* Manifiesto mínimo que ejercita las dos formas que admite el modelo: un tema
   con notas directas y un tema con subtemas. */
function manifiestoDePrueba() {
  return {
    areas: [
      {
        slug: "datos",
        titulo: "Datos",
        resumen: "Área de datos",
        notas: [],
        hijos: [
          {
            slug: "estadistica",
            titulo: "Estadística",
            resumen: "Tema con notas directas",
            notas: [
              {
                slug: "media-y-mediana",
                titulo: "Media y mediana",
                resumen: "Resumen de media",
                archivo: "datos/estadistica/media-y-mediana.md",
                etiquetas: ["descriptiva"],
                relacionadas: ["k-vecinos"],
              },
            ],
          },
          {
            slug: "modelos",
            titulo: "Modelos",
            resumen: "Tema con subtemas",
            hijos: [
              {
                slug: "supervisado",
                titulo: "Supervisado",
                resumen: "Subtema",
                notas: [
                  {
                    slug: "k-vecinos",
                    titulo: "K vecinos más cercanos",
                    resumen: "Clasificación por distancia",
                    archivo: "datos/modelos/supervisado/k-vecinos.md",
                    etiquetas: [],
                    relacionadas: [],
                  },
                  {
                    slug: "arboles",
                    titulo: "Árboles de decisión",
                    resumen: "Particiones sucesivas",
                    archivo: "datos/modelos/supervisado/arboles.md",
                    etiquetas: [],
                    /* Relación dentro de la MISMA rama visible desde la raíz. */
                    relacionadas: ["k-vecinos"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

test("el árbol conserva la jerarquía y cuenta las notas de toda la rama", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());

  const datos = arbol.porRuta.get("datos");
  assert.equal(datos.tipo, "area");
  assert.equal(datos.hijos.length, 2);
  /* Tres notas repartidas en dos niveles distintos de profundidad. */
  assert.equal(datos.notasDescendientes.length, 3);

  const supervisado = arbol.porRuta.get("datos/modelos/supervisado");
  assert.deepEqual(supervisado.notasDescendientes.sort(), ["arboles", "k-vecinos"]);

  /* Una nota se cuenta a sí misma: así el grafo trata igual a un tema y a una
     nota suelta al calcular tamaños y relaciones de rama. */
  const nota = arbol.porRuta.get("datos/estadistica/media-y-mediana");
  assert.deepEqual(nota.notasDescendientes, ["media-y-mediana"]);
});

/*
  Despublicar es la función de "deshabilitar" del panel de administración. Si la
  nota siguiera apareciendo en el listado o en el grafo, la única forma de
  ocultar algo sería borrarlo del repo y perder el historial.
*/
test("una nota despublicada desaparece del árbol público", () => {
  const manifiesto = manifiestoDePrueba();
  manifiesto.areas[0].hijos[0].notas[0].publicada = false;

  const publico = construirArbolDeNotas(manifiesto);
  assert.equal(publico.notasPorSlug.has("media-y-mediana"), false);
  /* El tema quedó sin notas: se poda, no se muestra vacío. */
  assert.equal(publico.porRuta.has("datos/estadistica"), false);

  const completo = construirArbolDeNotas(manifiesto, { incluirBorradores: true });
  assert.equal(completo.notasPorSlug.has("media-y-mediana"), true);
  assert.equal(completo.porRuta.get("datos/estadistica").notas[0].publicada, false);
});

test("una nota sin el campo publicada se considera publicada", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  assert.equal(arbol.notasPorSlug.get("k-vecinos").publicada, true);
});

/* ------------------------------------------------------------------ */
/* Ruteo                                                               */
/* ------------------------------------------------------------------ */

test("el hash lleva la vista y la ruta, y el viaje de ida y vuelta las conserva", () => {
  const destino = { vista: "grafo", segmentos: ["datos", "modelos"] };
  assert.equal(construirHashNotas(destino), "#/grafo/datos/modelos");
  assert.deepEqual(parsearHashNotas("#/grafo/datos/modelos"), destino);
});

test("un hash sin vista conserva la ruta y cae en la vista predeterminada", () => {
  /* Enlaces viejos o acortados a mano: llevar al área correcta importa más que
     respetar el formato. */
  assert.deepEqual(parsearHashNotas("#/datos/modelos"), {
    vista: VISTA_NOTAS_PREDETERMINADA,
    segmentos: ["datos", "modelos"],
  });
});

test("un hash inservible cae en la portada en vez de dejar la página vacía", () => {
  const portada = { vista: VISTA_NOTAS_PREDETERMINADA, segmentos: [] };
  assert.deepEqual(parsearHashNotas(""), portada);
  assert.deepEqual(parsearHashNotas("#"), portada);
  assert.deepEqual(parsearHashNotas("#///"), portada);
  assert.deepEqual(parsearHashNotas(null), portada);
  assert.deepEqual(parsearHashNotas(undefined), portada);
});

test("el hash tolera mayúsculas y porcentajes mal formados sin lanzar", () => {
  assert.deepEqual(parsearHashNotas("#/GRAFO/Datos"), {
    vista: "grafo",
    segmentos: ["datos"],
  });
  /* decodeURIComponent lanza con un % suelto; no puede tumbar la página. */
  assert.doesNotThrow(() => parsearHashNotas("#/lista/100%"));
});

test("una ruta que ya no existe entrega el ancestro más profundo y lo reporta", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());

  const vivo = resolverRutaDeNotas(arbol, ["datos", "modelos", "supervisado"]);
  assert.equal(vivo.encontrado, true);
  assert.equal(vivo.nodo.ruta, "datos/modelos/supervisado");

  /* Una nota borrada, o un enlace de una versión anterior del árbol. */
  const roto = resolverRutaDeNotas(arbol, ["datos", "modelos", "inventado"]);
  assert.equal(roto.encontrado, false);
  assert.equal(roto.nodo.ruta, "datos/modelos");
});

test("la navegación no desciende por debajo de una nota", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  const resultado = resolverRutaDeNotas(arbol, [
    "datos",
    "estadistica",
    "media-y-mediana",
    "algo-mas",
  ]);
  assert.equal(resultado.nodo.tipo, "nota");
  assert.equal(resultado.nodo.slug, "media-y-mediana");
});

test("las migas van de la portada al nodo actual, incluido", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  const nodo = arbol.porRuta.get("datos/modelos/supervisado");
  assert.deepEqual(
    migasDeNotas(arbol, nodo).map((miga) => miga.titulo),
    ["Notas", "Datos", "Modelos", "Supervisado"]
  );
});

/* ------------------------------------------------------------------ */
/* Grafo                                                               */
/* ------------------------------------------------------------------ */

test("el grafo dibuja el nodo actual con sus hijos colgando", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  const { centro, nodos, aristas } = vistaDeGrafo(arbol, arbol.porRuta.get("datos"));

  assert.equal(centro.ruta, "datos");
  assert.deepEqual(nodos.map((nodo) => nodo.slug), ["estadistica", "modelos"]);
  assert.equal(aristas.filter((arista) => arista.tipo === "jerarquia").length, 2);
});

/*
  Esta es la arista que convierte el árbol en algo que se lee como un mapa de
  conocimiento. media-y-mediana está en la rama "estadistica" y se relaciona con
  k-vecinos, que vive tres niveles adentro de "modelos": la conexión tiene que
  verse ya desde el nivel del área, sin obligar a bajar hasta las hojas.
*/
test("una relación entre ramas distintas se agrega en una arista lateral", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  const { aristas } = vistaDeGrafo(arbol, arbol.porRuta.get("datos"));

  const laterales = aristas.filter((arista) => arista.tipo === "relacion");
  assert.equal(laterales.length, 1);
  assert.deepEqual(
    [laterales[0].origen, laterales[0].destino].sort(),
    ["datos/estadistica", "datos/modelos"]
  );
});

/*
  arboles y k-vecinos están relacionadas y ambas cuelgan de "modelos". Vistas
  desde el área, esa relación no debe dibujarse: sería un bucle del nodo sobre
  sí mismo. Se verá al entrar en la rama.
*/
test("una relación dentro de la misma rama no genera un bucle", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  const { aristas } = vistaDeGrafo(arbol, arbol.porRuta.get("datos"));
  assert.equal(aristas.some((arista) => arista.origen === arista.destino), false);
});

test("dos relaciones entre el mismo par de ramas se dibujan una sola vez", () => {
  const manifiesto = manifiestoDePrueba();
  /* Segunda relación que cruza exactamente las mismas dos ramas. */
  manifiesto.areas[0].hijos[0].notas.push({
    slug: "cuartiles",
    titulo: "Cuartiles",
    resumen: "Otro resumen",
    archivo: "datos/estadistica/cuartiles.md",
    relacionadas: ["arboles"],
  });

  const arbol = construirArbolDeNotas(manifiesto);
  const { aristas } = vistaDeGrafo(arbol, arbol.porRuta.get("datos"));
  assert.equal(aristas.filter((arista) => arista.tipo === "relacion").length, 1);
});

test("una relación declarada en una sola nota vale en ambos sentidos", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  /* media-y-mediana declara a k-vecinos; k-vecinos no declara nada. */
  assert.deepEqual(arbol.notasPorSlug.get("k-vecinos").relacionadas, []);

  const desdeElOtroLado = vistaDeGrafo(arbol, arbol.porRuta.get("datos")).aristas;
  assert.equal(desdeElOtroLado.some((arista) => arista.tipo === "relacion"), true);
});

/* ------------------------------------------------------------------ */
/* Wikilinks                                                           */
/* ------------------------------------------------------------------ */

test("los wikilinks del cuerpo se extraen sin repetir y aceptan alias", () => {
  const markdown = [
    "Ver [[k-means]] y también [[pca|componentes principales]].",
    "Repetido: [[k-means]].",
  ].join("\n");
  assert.deepEqual(extraerWikilinks(markdown), ["k-means", "pca"]);
});

/*
  Sin esto, cualquier nota que muestre cómo seleccionar columnas en pandas
  generaría una relación fantasma hacia una nota llamada "col_a","col_b".
*/
test("un [[enlace]] dentro de código no es un enlace", () => {
  const conBloque = ['```python', 'df[["col_a","col_b"]]', "```", "Texto [[real]]."].join("\n");
  assert.deepEqual(extraerWikilinks(conBloque), ["real"]);

  const conLinea = 'Usa `df[["a","b"]]` para eso, y mira [[otra-nota]].';
  assert.deepEqual(extraerWikilinks(conLinea), ["otra-nota"]);
});

/* El patrón es global y guarda estado entre llamadas: sin reiniciar lastIndex,
   la segunda invocación arranca a media cadena y devuelve de menos. */
test("extraer dos veces seguidas devuelve lo mismo", () => {
  const markdown = "Primero [[uno]], después [[dos]].";
  assert.deepEqual(extraerWikilinks(markdown), extraerWikilinks(markdown));
});

test("texto sin enlaces devuelve una lista vacía", () => {
  assert.deepEqual(extraerWikilinks("Sin enlaces. Un [enlace](http://x) normal."), []);
  assert.deepEqual(extraerWikilinks(""), []);
});

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */

test("la búsqueda ignora acentos y mayúsculas", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  const resultados = buscarEnNotas(arbol, "ARBOLES");
  assert.equal(resultados[0].slug, "arboles");
});

test("todos los términos tienen que aparecer", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  assert.equal(buscarEnNotas(arbol, "media mediana").length, 1);
  assert.equal(buscarEnNotas(arbol, "media inexistente").length, 0);
});

test("la búsqueda recorre todo el árbol y pone las notas primero", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  /* "supervisado" es el título de un tema; "k-vecinos" cuelga de él. */
  const resultados = buscarEnNotas(arbol, "s");
  const tipos = resultados.map((nodo) => nodo.tipo);
  assert.equal(tipos.indexOf("nota") < tipos.lastIndexOf("tema"), true);
});

test("una búsqueda vacía no devuelve el árbol entero", () => {
  const arbol = construirArbolDeNotas(manifiestoDePrueba());
  assert.deepEqual(buscarEnNotas(arbol, "   "), []);
  assert.deepEqual(buscarEnNotas(arbol, ""), []);
});

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

test("un manifiesto sano pasa la validación", () => {
  const { ok, errores } = validarManifiestoDeNotas(manifiestoDePrueba());
  assert.deepEqual(errores, []);
  assert.equal(ok, true);
});

test("la validación detecta slugs repetidos entre hermanos", () => {
  const manifiesto = manifiestoDePrueba();
  manifiesto.areas[0].hijos[1].slug = "estadistica";
  const { ok, errores } = validarManifiestoDeNotas(manifiesto);
  assert.equal(ok, false);
  assert.equal(errores.some((error) => error.includes("repetido entre hermanos")), true);
});

test("la validación detecta un slug de nota repetido en todo el árbol", () => {
  /* Las relacionadas apuntan por slug global: dos notas con el mismo slug harían
     que una relación llevara a un destino arbitrario. */
  const manifiesto = manifiestoDePrueba();
  manifiesto.areas[0].hijos[1].hijos[0].notas[1].slug = "media-y-mediana";
  const { errores } = validarManifiestoDeNotas(manifiesto);
  assert.equal(errores.some((error) => error.includes("ya lo usa")), true);
});

test("la validación rechaza una relación hacia una nota que no existe", () => {
  const manifiesto = manifiestoDePrueba();
  manifiesto.areas[0].hijos[0].notas[0].relacionadas = ["no-existe"];
  const { errores } = validarManifiestoDeNotas(manifiesto);
  assert.equal(errores.some((error) => error.includes('"no-existe", que no existe')), true);
});

test("la validación rechaza temas vacíos y notas sin archivo", () => {
  const manifiesto = manifiestoDePrueba();
  manifiesto.areas[0].hijos.push({ slug: "vacio", titulo: "Vacío", resumen: "Nada" });
  delete manifiesto.areas[0].hijos[0].notas[0].archivo;

  const { errores } = validarManifiestoDeNotas(manifiesto);
  assert.equal(errores.some((error) => error.includes("debe tener notas o subtemas")), true);
  assert.equal(errores.some((error) => error.includes("falta archivo")), true);
});

test("la validación rechaza slugs que no sobreviven a una URL", () => {
  const manifiesto = manifiestoDePrueba();
  manifiesto.areas[0].hijos[0].slug = "Estadística Básica";
  const { errores } = validarManifiestoDeNotas(manifiesto);
  assert.equal(errores.some((error) => error.includes("minúsculas, dígitos y guiones")), true);
});

test("la validación devuelve todos los problemas juntos, no solo el primero", () => {
  const manifiesto = manifiestoDePrueba();
  delete manifiesto.areas[0].hijos[0].notas[0].archivo;
  delete manifiesto.areas[0].hijos[0].notas[0].resumen;
  const { errores } = validarManifiestoDeNotas(manifiesto);
  assert.equal(errores.length >= 2, true);
});

test("un manifiesto sin áreas es un error, no una portada en blanco", () => {
  assert.equal(validarManifiestoDeNotas({ areas: [] }).ok, false);
  assert.equal(validarManifiestoDeNotas({}).ok, false);
  assert.equal(validarManifiestoDeNotas(null).ok, false);
});

/* ------------------------------------------------------------------ */
/* Frontmatter                                                         */
/* ------------------------------------------------------------------ */

/*
  El mismo parser lo usan tools/notas.js para generar el manifiesto y el sitio
  para quitar el bloque antes de renderizar. Si se equivoca, o el índice queda
  sin título o el lector ve "titulo: …" impreso como primer párrafo de la nota.
*/

test("el bloque de metadatos se separa del cuerpo", () => {
  const archivo = [
    "---",
    "titulo: Regresión lineal",
    "resumen: El modelo más simple que sirve de verdad.",
    "---",
    "",
    "El cuerpo empieza aquí.",
  ].join("\n");

  const { datos, cuerpo, tieneFrontmatter, errores } = separarFrontmatter(archivo);
  assert.equal(tieneFrontmatter, true);
  assert.deepEqual(errores, []);
  assert.equal(datos.titulo, "Regresión lineal");
  assert.equal(datos.resumen, "El modelo más simple que sirve de verdad.");
  assert.equal(cuerpo.trim(), "El cuerpo empieza aquí.");
});

/* Un resumen como "MAE, RMSE y R²: qué mide cada una" tiene dos puntos en medio:
   el valor es todo lo que sigue a la primera clave, no hasta el siguiente ":". */
test("un valor puede contener dos puntos y comas", () => {
  const { datos } = separarFrontmatter(
    "---\nresumen: MAE, RMSE y R²: qué mide cada una y por qué importa.\n---\n"
  );
  assert.equal(datos.resumen, "MAE, RMSE y R²: qué mide cada una y por qué importa.");
});

test("las etiquetas se leen en línea o en bloque", () => {
  const enLinea = separarFrontmatter("---\netiquetas: [regresión, modelos lineales]\n---\n");
  assert.deepEqual(enLinea.datos.etiquetas, ["regresión", "modelos lineales"]);

  const enBloque = separarFrontmatter(
    "---\netiquetas:\n  - regresión\n  - modelos lineales\n---\n"
  );
  assert.deepEqual(enBloque.datos.etiquetas, ["regresión", "modelos lineales"]);

  assert.deepEqual(separarFrontmatter("---\netiquetas: []\n---\n").datos.etiquetas, []);
});

test("los booleanos y los números no llegan como texto", () => {
  const { datos } = separarFrontmatter("---\npublicada: false\norden: 2\n---\n");
  assert.equal(datos.publicada, false);
  assert.equal(datos.orden, 2);
});

test("las comillas se retiran, para poder escribir un valor que parezca otra cosa", () => {
  const { datos } = separarFrontmatter('---\ntitulo: "true"\n---\n');
  assert.equal(datos.titulo, "true");
});

/*
  Un "resumen" mal escrito que se descarta en silencio es una tarjeta vacía que
  nadie entiende. El parser reporta y quien genera el manifiesto se planta.
*/
test("una línea que no se entiende se reporta en vez de ignorarse", () => {
  const { errores, datos } = separarFrontmatter("---\ntitulo: Uno\nesto no es válido\n---\n");
  assert.equal(errores.length, 1);
  assert.match(errores[0], /línea 2/);
  /* Lo que sí se entendió se conserva: el error señala una línea, no tira todo. */
  assert.equal(datos.titulo, "Uno");
});

test("un archivo sin bloque de metadatos no es un error, pero se nota", () => {
  const { datos, cuerpo, tieneFrontmatter } = separarFrontmatter("Solo cuerpo, sin bloque.");
  assert.equal(tieneFrontmatter, false);
  assert.deepEqual(datos, {});
  assert.equal(cuerpo, "Solo cuerpo, sin bloque.");
});

/* Tres guiones a mitad de la nota son una línea horizontal de markdown, no el
   fin de los metadatos: el bloque solo cuenta si abre en la primera línea. */
test("un separador --- dentro del texto no se confunde con el bloque", () => {
  const { tieneFrontmatter, cuerpo } = separarFrontmatter("Un párrafo.\n\n---\n\nOtro párrafo.");
  assert.equal(tieneFrontmatter, false);
  assert.equal(cuerpo.includes("---"), true);
});

test("el bloque se reconoce aunque el archivo venga con saltos de Windows", () => {
  const { datos, cuerpo } = separarFrontmatter("---\r\ntitulo: Uno\r\n---\r\n\r\nCuerpo.");
  assert.equal(datos.titulo, "Uno");
  assert.equal(cuerpo.trim(), "Cuerpo.");
});
