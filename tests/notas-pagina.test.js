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
  orbitarConstelacion,
  calcularEncuadre,
  generarEstrellas,
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

const { pasosDeLaRuta } = require(path.join(ROOT, "src/app/features/notas/notas.ruta.js"));

/* La pizarra de QED se mudó a su propio módulo: es fondo de página, no parte del
   grafo. Dentro del lienzo solo quedan las estrellas. */
const { trozosDeFormula, ECUACIONES_QED, ECUACIONES_ESCALERA, MODOS_PIZARRA } = require(
  path.join(ROOT, "src/app/features/notas/notas.pizarra.js")
);

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

/*
  La queja concreta: un nivel de pocos nodos se dibujaba como un cuadrito en
  medio de un lienzo enorme, y al entrar a uno con más nodos "crecía". El mapa
  parecía cambiar de tamaño al navegar. Ahora el encuadre ajusta a la caja de lo
  dibujado, así que el conjunto ocupa una porción parecida del lienzo tenga tres
  nodos o doce.
*/
test("el mapa llena el lienzo tanto con pocos nodos como con muchos", () => {
  const ancho = 900;
  const alto = 600;

  const ocupacion = (cantidad) => {
    const vista = vistaFalsa(cantidad);
    const cuerpos = prepararSimulacion(vista);
    for (let paso = 0; paso < 400; paso += 1) avanzarSimulacion(cuerpos, vista.aristas);

    const encuadre = calcularEncuadre(cuerpos, ancho, alto);
    const xs = [];
    const ys = [];
    cuerpos.forEach((cuerpo) => {
      xs.push(encuadre.centroX + cuerpo.x * encuadre.escala);
      ys.push(encuadre.centroY + cuerpo.y * encuadre.escala);
    });
    return Math.max(
      (Math.max(...xs) - Math.min(...xs)) / ancho,
      (Math.max(...ys) - Math.min(...ys)) / alto
    );
  };

  const pocos = ocupacion(3);
  const muchos = ocupacion(12);

  assert.equal(pocos > 0.55, true, `con 3 nodos solo se ocupó ${pocos.toFixed(2)} del lienzo`);
  assert.equal(muchos > 0.55, true, `con 12 nodos solo se ocupó ${muchos.toFixed(2)} del lienzo`);
});

/*
  La portada no tiene centro: las áreas son conceptos generales, no ramas de un
  tronco llamado "Notas". Sin nodo fijo, la repulsión sola dispersaría la
  constelación al infinito.
*/
test("una constelación sin centro se estabiliza y queda encuadrada", () => {
  const vista = { centro: null, nodos: vistaFalsa(4).nodos, aristas: [] };
  const cuerpos = prepararSimulacion(vista);

  assert.equal(cuerpos.size, 4, "no debería haberse creado un nodo central");

  let energia = Infinity;
  for (let paso = 0; paso < 600 && energia > 0.05; paso += 1) {
    energia = avanzarSimulacion(cuerpos, vista.aristas);
  }
  assert.equal(energia <= 0.05, true, `la constelación no se detuvo: ${energia}`);

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

/*
  El fondo se repinta en cada cuadro de la simulación. Con Math.random las
  estrellas saltarían de lugar sesenta veces por segundo y el cielo titilaría
  como estática.
*/
test("las estrellas del fondo no se mueven entre repintados", () => {
  assert.deepEqual(generarEstrellas(900, 600), generarEstrellas(900, 600));
});

test("el fondo se puebla según el tamaño, sin dispararse", () => {
  const chico = generarEstrellas(400, 300);
  const grande = generarEstrellas(1600, 900);
  assert.equal(chico.length > 0, true);
  assert.equal(grande.length > chico.length, true);
  assert.equal(grande.length <= 260, true, "el cielo no puede crecer sin tope");
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
    "/app/features/notas/notas.pizarra.js",
    "/app/features/notas/notas.grafo.js",
    "/app/features/notas/notas.ruta.js",
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
    "notasRuta",
    "notasRutaLista",
    "notasPizarra",
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

/* ------------------------------------------------------------------ */
/* Ruta: el grafo dirigido de dónde estás                              */
/* ------------------------------------------------------------------ */

/*
  La columna vertebral de la izquierda contesta tres cosas a la vez: dónde estoy,
  cómo llegué y cómo vuelvo. Lo que se blinda acá es que sus dos extremos —el
  nodo base y el actual— queden siempre bien marcados: son los que el lector
  busca de un vistazo, y confundirlos invierte el sentido del grafo.
*/

const arbolDePrueba = construirArbolDeNotas({
  areas: [
    {
      slug: "ml",
      titulo: "Machine Learning",
      resumen: "Área",
      hijos: [
        {
          slug: "no-supervisado",
          titulo: "Aprendizaje no supervisado",
          resumen: "Tema",
          hijos: [
            {
              slug: "clustering",
              titulo: "Clustering",
              resumen: "Subtema",
              notas: [
                {
                  slug: "dbscan",
                  titulo: "DBSCAN",
                  resumen: "Nota",
                  archivo: "ml/no-supervisado/clustering/dbscan.md",
                  relacionadas: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

test("la ruta va del nodo base al nodo actual, en ese orden", () => {
  const destino = arbolDePrueba.porRuta.get("ml/no-supervisado/clustering/dbscan");
  assert.deepEqual(
    pasosDeLaRuta(arbolDePrueba, destino).map((paso) => paso.titulo),
    ["Notas", "Machine Learning", "Aprendizaje no supervisado", "Clustering", "DBSCAN"]
  );
});

test("los dos extremos del grafo quedan marcados y no se confunden", () => {
  const destino = arbolDePrueba.porRuta.get("ml/no-supervisado/clustering/dbscan");
  const pasos = pasosDeLaRuta(arbolDePrueba, destino);

  assert.equal(pasos[0].esBase, true);
  assert.equal(pasos[0].esActual, false);
  assert.equal(pasos[pasos.length - 1].esActual, true);
  assert.equal(pasos[pasos.length - 1].esBase, false);
  /* Exactamente uno de cada: si hubiera dos "actuales", el lector no sabría
     dónde está parado. */
  assert.equal(pasos.filter((paso) => paso.esActual).length, 1);
  assert.equal(pasos.filter((paso) => paso.esBase).length, 1);
});

test("cada paso lleva los segmentos con los que se vuelve a él", () => {
  const destino = arbolDePrueba.porRuta.get("ml/no-supervisado/clustering");
  const pasos = pasosDeLaRuta(arbolDePrueba, destino);

  assert.deepEqual(pasos.map((paso) => paso.segmentos), [
    [],
    ["ml"],
    ["ml", "no-supervisado"],
    ["ml", "no-supervisado", "clustering"],
  ]);
});

/*
  En la portada la ruta tendría un solo nodo, que no informa nada. El panel se
  oculta en ese caso; esta prueba fija la condición que lo decide.
*/
test("en la portada la ruta no tiene de dónde venir", () => {
  assert.equal(pasosDeLaRuta(arbolDePrueba, arbolDePrueba.raiz).length, 1);
});

/* ------------------------------------------------------------------ */
/* Fondo: pizarra de electrodinámica cuántica                          */
/* ------------------------------------------------------------------ */

/*
  El canvas no sabe de LaTeX y Unicode no tiene superíndices para μ ni ν, así
  que las fórmulas se dibujan por trozos. Si el parser falla, el fondo no se
  rompe de forma visible: publica física mal escrita —"F^uv" en vez de F^{μν}—
  y nadie lo nota hasta que alguien que sabe se acerca a la pantalla.
*/

test("los índices de una fórmula se separan de su base", () => {
  assert.deepEqual(trozosDeFormula("F_{μν}F^{μν}"), [
    { texto: "F", tipo: "base" },
    { texto: "μν", tipo: "sub" },
    { texto: "F", tipo: "base" },
    { texto: "μν", tipo: "sup" },
  ]);
});

test("un índice de un solo carácter no necesita llaves", () => {
  assert.deepEqual(trozosDeFormula("a_e"), [
    { texto: "a", tipo: "base" },
    { texto: "e", tipo: "sub" },
  ]);
});

/* Una llave sin cerrar no puede tragarse el resto de la ecuación. */
test("una fórmula mal escrita se dibuja como texto en vez de desaparecer", () => {
  assert.deepEqual(trozosDeFormula("x^{ab"), [{ texto: "x^{ab", tipo: "base" }]);
});

/*
  Solo desaparecen los marcadores de índice. Las llaves del anticonmutador
  {γ^μ, γ^ν} son parte de la notación y tienen que sobrevivir: si el parser se
  comiera cualquier llave, esa ecuación se publicaría mutilada.
*/
test("cada ecuación del mosaico conserva todos sus caracteres visibles", () => {
  const sinMarcadores = (ecuacion) =>
    ecuacion.replace(/[\^_]\{([^}]*)\}/g, "$1").replace(/[\^_]/g, "");

  for (const ecuacion of ECUACIONES_QED) {
    const reconstruida = trozosDeFormula(ecuacion)
      .map((trozo) => trozo.texto)
      .join("");
    assert.equal(reconstruida, sinMarcadores(ecuacion), `se perdió algo en «${ecuacion}»`);
  }
});

test("las llaves que no son de índice sobreviven", () => {
  const reconstruida = trozosDeFormula("{γ^{μ}, γ^{ν}} = 2g^{μν}")
    .map((trozo) => trozo.texto)
    .join("");
  assert.equal(reconstruida, "{γμ, γν} = 2gμν");
});

test("el mosaico no queda vacío ni deja fórmulas sin índices", () => {
  assert.equal(ECUACIONES_QED.length >= 6, true, "un mosaico corto se nota repetido");
  const conIndices = ECUACIONES_QED.filter((ecuacion) => /[\^_]/.test(ecuacion));
  assert.equal(conIndices.length >= 6, true, "sin índices no parece física");
});

/* ------------------------------------------------------------------ */
/* Movimiento de la portada                                            */
/* ------------------------------------------------------------------ */

/*
  Las áreas de la portada flotan en vez de quedarse quietas. La trampa está en
  cómo se aplica esa deriva: sumar el seno en cada cuadro la convierte en una
  caminata que se acumula, y en unos segundos la constelación se estira y se
  desarma sola. Estas pruebas fijan que gire sin deformarse.
*/

function constelacionDePrueba() {
  return new Map([
    ["a", { nodo: { ruta: "a" }, x: 120, y: 0, radio: 20 }],
    ["b", { nodo: { ruta: "b" }, x: -60, y: 104, radio: 20 }],
    ["c", { nodo: { ruta: "c" }, x: -60, y: -104, radio: 20 }],
  ]);
}

function distancias(cuerpos) {
  const lista = [...cuerpos.values()];
  const pares = [];
  for (let i = 0; i < lista.length; i += 1) {
    for (let j = i + 1; j < lista.length; j += 1) {
      pares.push(Math.hypot(lista[i].x - lista[j].x, lista[i].y - lista[j].y));
    }
  }
  return pares;
}

test("la constelación gira sin deformarse ni dispersarse", () => {
  const cuerpos = constelacionDePrueba();
  const iniciales = distancias(cuerpos);

  let desviacionMaxima = 0;
  for (let cuadro = 0; cuadro < 3000; cuadro += 1) {
    orbitarConstelacion(cuerpos, cuadro);
    distancias(cuerpos).forEach((actual, indice) => {
      desviacionMaxima = Math.max(desviacionMaxima, Math.abs(actual - iniciales[indice]));
    });
  }

  /* Con la deriva acumulándose, esta desviación crecía sin techo. */
  assert.equal(
    desviacionMaxima < 2,
    true,
    `la forma se deformó ${desviacionMaxima.toFixed(2)} unidades`
  );
});

test("los nodos de la portada sí se mueven", () => {
  const cuerpos = constelacionDePrueba();
  const inicial = { ...cuerpos.get("a") };

  for (let cuadro = 0; cuadro < 600; cuadro += 1) orbitarConstelacion(cuerpos, cuadro);

  const actual = cuerpos.get("a");
  const recorrido = Math.hypot(actual.x - inicial.x, actual.y - inicial.y);
  assert.equal(recorrido > 5, true, `apenas se movió ${recorrido.toFixed(2)}`);
});

/* El centro común no puede irse a la deriva: si se corre, el encuadre persigue
   la constelación y la vista entera se desliza sin motivo. */
test("el centro de la constelación se queda donde estaba", () => {
  const cuerpos = constelacionDePrueba();
  const centro = () => {
    const lista = [...cuerpos.values()];
    return {
      x: lista.reduce((suma, c) => suma + c.x, 0) / lista.length,
      y: lista.reduce((suma, c) => suma + c.y, 0) / lista.length,
    };
  };

  const antes = centro();
  for (let cuadro = 0; cuadro < 3000; cuadro += 1) orbitarConstelacion(cuerpos, cuadro);
  const despues = centro();

  assert.equal(Math.abs(despues.x - antes.x) < 1, true);
  assert.equal(Math.abs(despues.y - antes.y) < 1, true);
});

/* ------------------------------------------------------------------ */
/* Contexto del área                                                   */
/* ------------------------------------------------------------------ */

/*
  El título dice dónde estás; la descripción, en qué disciplina. Tres niveles
  adentro, lo que evita perderse es que el texto de arriba siga siendo el del
  área y no el del subtema.
*/
test("un nodo profundo sigue perteneciendo a su área", () => {
  const nodo = arbolDePrueba.porRuta.get("ml/no-supervisado/clustering/dbscan");
  assert.equal(areaDeNodo(arbolDePrueba, nodo).slug, "ml");
});

test("la raíz no pertenece a ningún área", () => {
  assert.equal(areaDeNodo(arbolDePrueba, arbolDePrueba.raiz), null);
});

/* ------------------------------------------------------------------ */
/* Los dos ambientes de la pizarra                                     */
/* ------------------------------------------------------------------ */

/*
  La sección tiene dos fondos: la pizarra de QED mientras se explora, y la
  escalera de estados del oscilador armónico al leer una nota. El riesgo de
  tener dos es que uno se quede a medio configurar y salga invisible —o encima
  del texto— sin que nada falle.
*/

test("cada modo trae su juego de ecuaciones y su tinta", () => {
  for (const [nombre, modo] of Object.entries(MODOS_PIZARRA)) {
    assert.equal(modo.ecuaciones.length >= 6, true, `${nombre}: mosaico corto`);
    assert.match(modo.color, /^#[0-9a-f]{6}$/i, `${nombre}: color inválido`);
    assert.equal(modo.alfaEcuaciones > 0, true, `${nombre}: el fondo sería invisible`);
    assert.equal(modo.alfaEcuaciones < 0.3, true, `${nombre}: el fondo taparía el contenido`);
  }
});

/* Un diagrama con líneas detrás de un párrafo sí estorba; renglones de fórmulas
   acompañan. Por eso la lectura no siembra diagramas. */
test("la lectura no lleva diagramas detrás del texto", () => {
  assert.equal(MODOS_PIZARRA.lectura.conDiagramas, false);
  assert.equal(MODOS_PIZARRA.exploracion.conDiagramas, true);
});

test("los dos modos usan ecuaciones distintas", () => {
  assert.notDeepEqual(MODOS_PIZARRA.lectura.ecuaciones, MODOS_PIZARRA.exploracion.ecuaciones);
});

test("las fórmulas de la escalera conservan sus caracteres", () => {
  const sinMarcadores = (ecuacion) =>
    ecuacion.replace(/[\^_]\{([^}]*)\}/g, "$1").replace(/[\^_]/g, "");

  for (const ecuacion of ECUACIONES_ESCALERA) {
    const reconstruida = trozosDeFormula(ecuacion)
      .map((trozo) => trozo.texto)
      .join("");
    assert.equal(reconstruida, sinMarcadores(ecuacion), `se perdió algo en «${ecuacion}»`);
  }
});

/*
  Un elemento con z-index negativo se pinta ANTES que los fondos de los bloques
  en flujo. Devolverle un background opaco a .notas volvería a tapar la pizarra
  por completo, y el síntoma sería "no se ve el fondo por ningún lado".
*/
test("el main de notas no tapa la pizarra con un fondo propio", () => {
  const hoja = read("src/app/features/notas/notas.css");
  const bloque = hoja.slice(hoja.indexOf("\n  .notas {"), hoja.indexOf("\n  .notas__header"));
  assert.equal(
    /background(-color)?\s*:/.test(bloque),
    false,
    ".notas volvió a declarar un fondo y taparía la pizarra fija de atrás"
  );
});
