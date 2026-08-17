const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const {
  radioDeNodo,
  posicionInicial,
  prepararSimulacion,
  avanzarSimulacion,
  calcularEncuadre,
  RADIO_MINIMO_NOTAS,
  RADIO_MAXIMO_NOTAS,
} = require(path.join(ROOT, "src/app/features/notas/notas.grafo.js"));

/*
  En el navegador estos scripts son globales clásicos y comparten un solo ámbito:
  notas.markdown.js usa sinCodigo y normalizarParaBusqueda de notas.arbol.js sin
  importarlos. require() aísla cada archivo, así que acá hay que reproducir ese
  ámbito compartido antes de ejercitar el renderizador.
*/
Object.assign(globalThis, require(path.join(ROOT, "src/app/core/notas/notas.arbol.js")));

const {
  tieneFormulas,
  idDeEncabezado,
  CDN_MARKED,
  CDN_HLJS,
  CDN_KATEX,
} = require(path.join(ROOT, "src/app/features/notas/notas.markdown.js"));

const paginaNotas = read("src/app/features/notas/index.html");

/*
  El grafo no se puede probar mirándolo: es un canvas. Lo que sí se puede
  blindar son las decisiones que lo hacen usable —que el mapa se acomode igual
  en cada visita, que quepa en pantalla y que ninguna rama se vuelva invisible—
  y el cableado de la página, que es donde un archivo renombrado deja el área
  en blanco sin ningún error de sintaxis.
*/

/* ------------------------------------------------------------------ */
/* Simulación del grafo                                                */
/* ------------------------------------------------------------------ */

function vistaFalsa(cantidadDeHijos) {
  const hijo = (indice) => ({
    ruta: `area/tema-${indice}`,
    titulo: `Tema ${indice}`,
    tipo: "tema",
    segmentos: ["area", `tema-${indice}`],
    notasDescendientes: new Array(indice + 1).fill("nota"),
  });

  return {
    centro: {
      ruta: "area",
      titulo: "Área",
      tipo: "area",
      segmentos: ["area"],
      notasDescendientes: new Array(10).fill("nota"),
    },
    nodos: Array.from({ length: cantidadDeHijos }, (_, indice) => hijo(indice)),
    aristas: Array.from({ length: cantidadDeHijos }, (_, indice) => ({
      origen: "area",
      destino: `area/tema-${indice}`,
      tipo: "jerarquia",
    })),
  };
}

/*
  Con Math.random el mismo nivel se acomodaría distinto en cada visita y el
  lector perdería la memoria espacial del mapa, que es lo único que vuelve útil
  a un grafo frente a una lista.
*/
test("el mapa se acomoda igual cada vez que se abre el mismo nivel", () => {
  const vista = vistaFalsa(5);
  const primera = prepararSimulacion(vista);
  const segunda = prepararSimulacion(vista);

  for (let paso = 0; paso < 120; paso += 1) {
    avanzarSimulacion(primera, vista.aristas);
    avanzarSimulacion(segunda, vista.aristas);
  }

  [...primera.keys()].forEach((ruta) => {
    assert.equal(primera.get(ruta).x, segunda.get(ruta).x);
    assert.equal(primera.get(ruta).y, segunda.get(ruta).y);
  });
});

test("las posiciones iniciales se reparten en círculo sin superponerse", () => {
  const posiciones = Array.from({ length: 6 }, (_, indice) => posicionInicial(indice, 6));
  const claves = new Set(posiciones.map(({ x, y }) => `${x.toFixed(4)},${y.toFixed(4)}`));
  assert.equal(claves.size, 6);
});

test("el nodo del centro no se mueve", () => {
  const vista = vistaFalsa(4);
  const cuerpos = prepararSimulacion(vista);
  for (let paso = 0; paso < 200; paso += 1) avanzarSimulacion(cuerpos, vista.aristas);

  const centro = cuerpos.get("area");
  assert.equal(centro.x, 0);
  assert.equal(centro.y, 0);
});

test("la simulación se estabiliza en vez de animarse para siempre", () => {
  const vista = vistaFalsa(7);
  const cuerpos = prepararSimulacion(vista);

  let energia = Infinity;
  for (let paso = 0; paso < 600 && energia > 0.05; paso += 1) {
    energia = avanzarSimulacion(cuerpos, vista.aristas);
  }
  assert.equal(energia <= 0.05, true, `la energía quedó en ${energia}`);
});

test("ningún nodo termina con coordenadas inválidas", () => {
  /* Una división por una distancia cero propagaría NaN a todo el lienzo y el
     grafo quedaría en blanco sin lanzar ningún error. */
  const vista = vistaFalsa(3);
  const cuerpos = prepararSimulacion(vista);
  cuerpos.forEach((cuerpo) => {
    if (cuerpo.esCentro) return;
    cuerpo.x = 0;
    cuerpo.y = 0;
  });

  for (let paso = 0; paso < 50; paso += 1) avanzarSimulacion(cuerpos, vista.aristas);
  cuerpos.forEach((cuerpo) => {
    assert.equal(Number.isFinite(cuerpo.x), true);
    assert.equal(Number.isFinite(cuerpo.y), true);
  });
});

/*
  Escala lineal y una rama de 60 notas junto a otra de 3: la segunda quedaría
  como un punto invisible. La raíz cuadrada es lo que mantiene legible el mapa
  cuando el árbol crece de forma despareja.
*/
test("una rama chica sigue siendo visible junto a una enorme", () => {
  const chica = { tipo: "tema", notasDescendientes: new Array(3).fill("n") };
  const enorme = { tipo: "tema", notasDescendientes: new Array(60).fill("n") };

  const radioChico = radioDeNodo(chica, 60);
  assert.equal(radioChico >= RADIO_MINIMO_NOTAS, true);
  assert.equal(radioChico > RADIO_MINIMO_NOTAS * 1.15, true, "la rama chica quedó al mínimo");
  assert.equal(radioDeNodo(enorme, 60) <= RADIO_MAXIMO_NOTAS, true);
});

test("una nota siempre tiene el radio mínimo, sin importar el nivel", () => {
  assert.equal(radioDeNodo({ tipo: "nota", notasDescendientes: ["a"] }, 50), RADIO_MINIMO_NOTAS);
});

test("el encuadre achica lo suficiente para que todo entre en pantalla", () => {
  const vista = vistaFalsa(9);
  const cuerpos = prepararSimulacion(vista);
  for (let paso = 0; paso < 400; paso += 1) avanzarSimulacion(cuerpos, vista.aristas);

  const ancho = 900;
  const alto = 600;
  const encuadre = calcularEncuadre(cuerpos, ancho, alto);

  cuerpos.forEach((cuerpo) => {
    const x = encuadre.centroX + cuerpo.x * encuadre.escala;
    const y = encuadre.centroY + cuerpo.y * encuadre.escala;
    assert.equal(x >= 0 && x <= ancho, true, `${cuerpo.nodo.ruta} se salió en x: ${x}`);
    assert.equal(y >= 0 && y <= alto, true, `${cuerpo.nodo.ruta} se salió en y: ${y}`);
  });
});

/* ------------------------------------------------------------------ */
/* Renderizado del markdown                                            */
/* ------------------------------------------------------------------ */

/*
  KaTeX con sus fuentes es lo más pesado que carga esta sección. Solo baja si la
  nota tiene fórmulas, y un `$` dentro de un bloque de código no es una fórmula.
*/
test("KaTeX solo se considera necesario cuando hay fórmulas de verdad", () => {
  assert.equal(tieneFormulas("Una fórmula $x^2$ en línea."), true);
  assert.equal(tieneFormulas("En bloque:\n$$\\sum_i x_i$$"), true);
  assert.equal(tieneFormulas("Sin nada de matemáticas."), false);
  assert.equal(tieneFormulas("```bash\necho $HOME $PATH\n```"), false);
  assert.equal(tieneFormulas("Instala con `pip install $PAQUETE` nada más."), false);
});

test("los encabezados repetidos no comparten id", () => {
  const usados = new Set();
  assert.equal(idDeEncabezado("Cómo se evalúa", usados), "como-se-evalua");
  assert.equal(idDeEncabezado("Cómo se evalúa", usados), "como-se-evalua-2");
});

test("un encabezado sin caracteres utilizables igual recibe un id", () => {
  assert.equal(idDeEncabezado("¿?¡!", new Set()), "seccion");
});

/*
  Mismo criterio que el catálogo de runtimes del playground: una URL de CDN sin
  versión fija es una dependencia que puede cambiar bajo los pies y romper
  producción sin que nadie toque el repositorio.
*/
test("las bibliotecas externas van con versión fija", () => {
  [CDN_MARKED, CDN_HLJS, CDN_KATEX].forEach((url) => {
    assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\//, `${url} debería venir de jsDelivr`);
    assert.match(url, /@\d+\.\d+\.\d+\//, `${url} necesita una versión exacta`);
  });
});

/* ------------------------------------------------------------------ */
/* Cableado de la página                                               */
/* ------------------------------------------------------------------ */

/*
  Los scripts del sitio son globales clásicos, sin módulos ni empaquetador: el
  orden del HTML ES la resolución de dependencias. Si notas.js se cargara antes
  que notas.arbol.js, la página quedaría en blanco con un ReferenceError y nada
  más lo detectaría.
*/
test("los scripts del área de notas se cargan en orden de dependencia", () => {
  const orden = [
    "/app/core/notas/notas.arbol.js",
    "/app/core/notas/notas.service.js",
    "/app/features/notas/notas.markdown.js",
    "/app/features/notas/notas.lista.js",
    "/app/features/notas/notas.lectura.js",
    "/app/features/notas/notas.grafo.js",
    "/app/features/notas/notas.js",
  ];

  const posiciones = orden.map((ruta) => {
    const posicion = paginaNotas.indexOf(ruta);
    assert.notEqual(posicion, -1, `la página no carga ${ruta}`);
    return posicion;
  });

  posiciones.forEach((posicion, indice) => {
    if (indice === 0) return;
    assert.equal(
      posicion > posiciones[indice - 1],
      true,
      `${orden[indice]} se carga antes que ${orden[indice - 1]}`
    );
  });
});

test("la telemetría se carga antes que el servicio que la usa", () => {
  assert.equal(
    paginaNotas.indexOf("/app/core/telemetry/operaciones.js") <
      paginaNotas.indexOf("/app/core/notas/notas.service.js"),
    true
  );
});

test("la página trae los contenedores que el controlador busca por id", () => {
  const ids = [
    "notasTitulo",
    "notasIntro",
    "notasMigas",
    "notasBuscar",
    "notasEstado",
    "notasEstadoMensaje",
    "notasReintentar",
    "notasResultados",
    "notasLista",
    "notasGrafo",
    "notasGrafoLienzo",
    "notasGrafoLista",
    "notasLectura",
    "notasVistaLista",
    "notasVistaGrafo",
  ];
  ids.forEach((id) => {
    assert.match(paginaNotas, new RegExp(`id="${id}"`), `falta el elemento #${id}`);
  });
});

test("la navegación del sitio incluye las notas", () => {
  const navbar = read("src/app/shared/navbar/navbar.js");
  assert.match(navbar, /texto: "Notas", href: "\/app\/features\/notas\/", habilitado: true/);
  assert.match(read("src/sitemap.xml"), /taudux\.com\/app\/features\/notas\//);
});

/*
  El área es pública y no consulta Supabase, pero la barra de navegación sí
  resuelve la sesión. Sin auth.service.js el navbar deja el botón "Acceder"
  invisible, que es su modo de fallo silencioso.
*/
test("la página carga lo que el navbar compartido necesita", () => {
  ["@supabase/supabase-js@2", "/app/core/auth/auth.service.js", "/app/shared/navbar/navbar.js"].forEach(
    (dependencia) => {
      assert.equal(paginaNotas.includes(dependencia), true, `falta ${dependencia}`);
    }
  );
});
