/*
  Geometría del fondo del entorno: parte un rectángulo en celdas de Voronoi.
  Sin DOM y sin canvas, así que Node lo prueba directo.

  QUÉ ES UNA CELDA DE VORONOI. Dadas unas semillas, la celda de una semilla es la
  región de puntos que la tienen a ella como la más cercana. Es la partición que
  aparece sola en la naturaleza —la piel de la jirafa, la espuma, el barro
  agrietado, los granos de un cristal— y por eso encaja con la línea visual del
  sitio mejor que un fractal.

  CÓMO SE CALCULA ACÁ. Se recorta: la celda arranca siendo el rectángulo entero y
  se le va cortando, por cada otra semilla, el semiplano que queda más cerca de
  esa otra. Lo que sobrevive a todos los cortes es la celda.

  Por qué así y no con el algoritmo de Fortune, que es el "correcto" para esto:
  Fortune es O(n log n) pero son varios cientos de líneas con una cola de
  prioridad y una playa de parábolas. Este método es O(n²) en un puñado de líneas,
  y con las pocas decenas de semillas que dibuja el fondo, n² sobre n log n no se
  nota. La misma lógica que llevó a escribir a mano el grafo de notas en vez de
  traer d3.
*/

/*
  Recorta un polígono convexo dejando solo el lado del semiplano que contiene a la
  semilla propia. La frontera es la mediatriz entre las dos semillas: todo punto
  de ese lado está más cerca de la propia que de la ajena.

  Es Sutherland-Hodgman contra una sola recta: se recorre el polígono por aristas
  y, cuando una arista cruza la frontera, se agrega el punto de cruce.
*/
function recortarPorSemiplano(poligono, propia, ajena) {
  const dx = ajena.x - propia.x;
  const dy = ajena.y - propia.y;

  // Dos semillas en el mismo punto no definen mediatriz: no hay nada que cortar.
  if (dx === 0 && dy === 0) return poligono;

  const medioX = (propia.x + ajena.x) / 2;
  const medioY = (propia.y + ajena.y) / 2;

  /*
    Negativo = del lado de la semilla propia. Es la proyección del punto sobre la
    dirección que une las dos semillas, medida desde el punto medio.
  */
  const lado = (punto) => (punto.x - medioX) * dx + (punto.y - medioY) * dy;

  const recortado = [];
  for (let indice = 0; indice < poligono.length; indice += 1) {
    const actual = poligono[indice];
    const siguiente = poligono[(indice + 1) % poligono.length];
    const ladoActual = lado(actual);
    const ladoSiguiente = lado(siguiente);

    if (ladoActual <= 0) recortado.push(actual);

    // Signos distintos: la arista cruza la frontera y hay que partirla.
    if ((ladoActual <= 0) !== (ladoSiguiente <= 0)) {
      const proporcion = ladoActual / (ladoActual - ladoSiguiente);
      recortado.push({
        x: actual.x + proporcion * (siguiente.x - actual.x),
        y: actual.y + proporcion * (siguiente.y - actual.y),
      });
    }
  }

  return recortado;
}

/*
  Área con la fórmula del cordón de zapato. Se usa para descartar celdas
  degeneradas y, en las pruebas, para verificar que las celdas cubren el
  rectángulo entero sin huecos ni solapes.
*/
function areaPoligono(poligono) {
  if (poligono.length < 3) return 0;

  let doble = 0;
  for (let indice = 0; indice < poligono.length; indice += 1) {
    const actual = poligono[indice];
    const siguiente = poligono[(indice + 1) % poligono.length];
    doble += actual.x * siguiente.y - siguiente.x * actual.y;
  }
  return Math.abs(doble) / 2;
}

function centroidePoligono(poligono) {
  if (poligono.length === 0) return null;

  let sumaX = 0;
  let sumaY = 0;
  for (const punto of poligono) {
    sumaX += punto.x;
    sumaY += punto.y;
  }
  return { x: sumaX / poligono.length, y: sumaY / poligono.length };
}

/*
  Devuelve una celda por semilla, en el mismo orden que las semillas, recortadas
  al rectángulo [0,0]-[ancho,alto]. Una celda puede venir vacía si su semilla
  quedó fuera del rectángulo o pisada por otra: quien dibuja debe tolerarlo.
*/
function celdasDeVoronoi(semillas, ancho, alto) {
  const marco = [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: ancho, y: alto },
    { x: 0, y: alto },
  ];

  return semillas.map((propia) => {
    let celda = marco;

    for (const ajena of semillas) {
      if (ajena === propia) continue;
      celda = recortarPorSemiplano(celda, propia, ajena);
      // Sin vértices no queda nada que seguir recortando.
      if (celda.length === 0) break;
    }

    return celda;
  });
}

/*
  Semillas repartidas por el lienzo con una fase propia para la deriva. La
  cuadrícula con desorden —en vez de posiciones al azar puro— evita el defecto
  clásico del azar uniforme: racimos apretados en una zona y vacíos enormes en
  otra, que se ven como manchas y no como una textura pareja.

  `azar` se inyecta para que las pruebas puedan fijar el resultado.
*/
function sembrarCeldas({ ancho, alto, columnas, filas, desorden = 0.65, azar = Math.random }) {
  const semillas = [];
  const pasoX = ancho / columnas;
  const pasoY = alto / filas;

  for (let fila = 0; fila < filas; fila += 1) {
    for (let columna = 0; columna < columnas; columna += 1) {
      semillas.push({
        x: (columna + 0.5) * pasoX + (azar() - 0.5) * pasoX * desorden,
        y: (fila + 0.5) * pasoY + (azar() - 0.5) * pasoY * desorden,
        // Fase y velocidad propias: sin esto todas las celdas laten al unísono.
        fase: azar() * Math.PI * 2,
        velocidad: 0.35 + azar() * 0.65,
      });
    }
  }

  return semillas;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    areaPoligono,
    celdasDeVoronoi,
    centroidePoligono,
    recortarPorSemiplano,
    sembrarCeldas,
  });
}
