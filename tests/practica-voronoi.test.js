const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const {
  areaPoligono,
  celdasDeVoronoi,
  centroidePoligono,
  sembrarCeldas,
} = require(path.join(ROOT, "src/app/features/codigo/practica.voronoi.js"));

/*
  Esta geometría se dibuja de fondo, así que un error no lanza una excepción: deja
  una mancha rara detrás del código y nadie sabe por qué. Las pruebas verifican la
  propiedad que define un Voronoi —cada punto pertenece a la semilla más cercana—
  en vez de comparar contra coordenadas escritas a mano, que no probarían nada.
*/

const ANCHO = 400;
const ALTO = 300;

function distancia(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test("una sola semilla se queda con todo el rectángulo", () => {
  const [celda] = celdasDeVoronoi([{ x: 200, y: 150 }], ANCHO, ALTO);
  assert.equal(Math.round(areaPoligono(celda)), ANCHO * ALTO);
});

test("dos semillas simétricas parten el rectángulo por la mitad", () => {
  const celdas = celdasDeVoronoi([{ x: 100, y: 150 }, { x: 300, y: 150 }], ANCHO, ALTO);

  assert.equal(Math.round(areaPoligono(celdas[0])), (ANCHO * ALTO) / 2);
  assert.equal(Math.round(areaPoligono(celdas[1])), (ANCHO * ALTO) / 2);
});

test("hay exactamente una celda por semilla y en el mismo orden", () => {
  const semillas = sembrarCeldas({ ancho: ANCHO, alto: ALTO, columnas: 4, filas: 3, azar: () => 0.5 });
  const celdas = celdasDeVoronoi(semillas, ANCHO, ALTO);

  assert.equal(celdas.length, semillas.length);
  for (let indice = 0; indice < celdas.length; indice += 1) {
    const centro = centroidePoligono(celdas[indice]);
    assert.ok(centro, `la celda ${indice} no debería venir vacía`);
  }
});

/*
  La propiedad que define el diagrama: si el centroide de una celda estuviera más
  cerca de otra semilla, el recorte estaría mal hecho.
*/
test("el centro de cada celda tiene a su propia semilla como la más cercana", () => {
  let paso = 0;
  const azar = () => {
    paso += 1;
    return (Math.sin(paso * 12.9898) * 43758.5453) % 1;
  };
  const semillas = sembrarCeldas({ ancho: ANCHO, alto: ALTO, columnas: 5, filas: 4, azar });
  const celdas = celdasDeVoronoi(semillas, ANCHO, ALTO);

  celdas.forEach((celda, indice) => {
    const centro = centroidePoligono(celda);
    if (!centro) return;

    const propia = distancia(centro, semillas[indice]);
    semillas.forEach((otra, otroIndice) => {
      if (otroIndice === indice) return;
      assert.ok(
        propia <= distancia(centro, otra) + 1e-9,
        `el centro de la celda ${indice} cae más cerca de la semilla ${otroIndice}`,
      );
    });
  });
});

/*
  Un Voronoi es una PARTICIÓN: las celdas cubren todo el rectángulo, sin huecos ni
  solapes. Si el recorte dejara un hueco se vería como un agujero negro en el
  fondo; si solapara, las celdas se pintarían unas sobre otras.
*/
test("las celdas cubren el rectángulo completo, sin huecos ni solapes", () => {
  let paso = 7;
  const azar = () => {
    paso += 1;
    return Math.abs((Math.sin(paso * 78.233) * 43758.5453) % 1);
  };
  const semillas = sembrarCeldas({ ancho: ANCHO, alto: ALTO, columnas: 6, filas: 4, azar });
  const celdas = celdasDeVoronoi(semillas, ANCHO, ALTO);

  const suma = celdas.reduce((total, celda) => total + areaPoligono(celda), 0);
  assert.ok(
    Math.abs(suma - ANCHO * ALTO) < 1,
    `las áreas suman ${suma.toFixed(2)} y el rectángulo mide ${ANCHO * ALTO}`,
  );
});

test("ninguna celda se sale del rectángulo", () => {
  const semillas = sembrarCeldas({ ancho: ANCHO, alto: ALTO, columnas: 4, filas: 3, azar: () => 0.9 });

  for (const celda of celdasDeVoronoi(semillas, ANCHO, ALTO)) {
    for (const punto of celda) {
      assert.ok(punto.x >= -1e-9 && punto.x <= ANCHO + 1e-9, `x fuera de rango: ${punto.x}`);
      assert.ok(punto.y >= -1e-9 && punto.y <= ALTO + 1e-9, `y fuera de rango: ${punto.y}`);
    }
  }
});

/*
  Dos semillas en el mismo punto no definen una mediatriz. Sin la guarda, la
  división por cero produce NaN y el canvas deja de dibujar sin decir nada.
*/
test("dos semillas pisadas no producen NaN", () => {
  const celdas = celdasDeVoronoi([{ x: 100, y: 100 }, { x: 100, y: 100 }], ANCHO, ALTO);

  for (const celda of celdas) {
    for (const punto of celda) {
      assert.ok(Number.isFinite(punto.x) && Number.isFinite(punto.y), "coordenada no finita");
    }
  }
});

test("sin semillas no hay celdas y no revienta", () => {
  assert.deepEqual(celdasDeVoronoi([], ANCHO, ALTO), []);
});

/* --- Siembra -------------------------------------------------------- */

test("la siembra reparte una semilla por celda de la cuadrícula", () => {
  const semillas = sembrarCeldas({ ancho: ANCHO, alto: ALTO, columnas: 5, filas: 4, azar: () => 0.5 });
  assert.equal(semillas.length, 20);
});

/*
  Sin desorden, las semillas caen justo en el centro de cada casilla: la prueba
  fija que la cuadrícula es la base y el azar solo la perturba.
*/
test("sin desorden las semillas quedan en el centro de su casilla", () => {
  const semillas = sembrarCeldas({
    ancho: ANCHO, alto: ALTO, columnas: 2, filas: 2, desorden: 0, azar: () => 0.5,
  });

  assert.deepEqual(
    semillas.map(({ x, y }) => ({ x, y })),
    [{ x: 100, y: 75 }, { x: 300, y: 75 }, { x: 100, y: 225 }, { x: 300, y: 225 }],
  );
});

/*
  El azar puro amontona semillas en unas zonas y deja vacíos en otras, que se ven
  como manchas en vez de textura. La cuadrícula perturbada acota cuánto puede
  alejarse una semilla de su casilla.
*/
test("el desorden no saca a la semilla de su propia casilla", () => {
  const columnas = 4;
  const filas = 3;
  const pasoX = ANCHO / columnas;
  const pasoY = ALTO / filas;

  for (const valor of [0, 0.25, 0.5, 0.75, 1]) {
    const semillas = sembrarCeldas({
      ancho: ANCHO, alto: ALTO, columnas, filas, desorden: 0.65, azar: () => valor,
    });

    semillas.forEach((semilla, indice) => {
      const centroX = ((indice % columnas) + 0.5) * pasoX;
      const centroY = (Math.floor(indice / columnas) + 0.5) * pasoY;
      assert.ok(Math.abs(semilla.x - centroX) <= pasoX / 2, "se salió de su casilla en x");
      assert.ok(Math.abs(semilla.y - centroY) <= pasoY / 2, "se salió de su casilla en y");
    });
  }
});

test("cada semilla trae su propia fase para que no laten todas juntas", () => {
  let paso = 0;
  const azar = () => {
    paso += 1;
    return (paso % 7) / 7;
  };
  const semillas = sembrarCeldas({ ancho: ANCHO, alto: ALTO, columnas: 3, filas: 3, azar });

  assert.ok(new Set(semillas.map((semilla) => semilla.fase)).size > 1, "las fases no varían");
  for (const semilla of semillas) {
    assert.ok(semilla.velocidad > 0, "la velocidad debe ser positiva");
  }
});
