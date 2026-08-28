/*
  Fondo ambiental del entorno de programación: un mosaico de Voronoi que respira
  despacio detrás del código. La geometría vive en practica.voronoi.js; acá solo
  hay canvas, tiempo y color.

  LA REGLA QUE MANDA: el código es lo principal. Todo lo de abajo está calibrado
  para que el fondo se sienta y no se mire —trazos finísimos, movimiento con
  período de casi un minuto, y ningún cambio brusco salvo cuando el alumno
  ejecuta algo, que es justo cuando está mirando el resultado y no el editor.

  POR QUÉ SE PUEDE ANIMAR SIN CULPA: el código del alumno corre en un worker, así
  que el hilo principal está libre precisamente mientras se ejecuta. El momento en
  que el fondo más se mueve es el que menos compite con nada.

  El canvas es decorativo puro: no comunica información que no esté ya en la
  pantalla, así que va aria-hidden. Es lo contrario del grafo de notas, que SÍ
  comunica y por eso allá se acompaña de una lista de enlaces reales.
*/

/* El canvas no lee variables CSS, así que la paleta se repite acá — igual que en
   notas.grafo.js, y por el mismo motivo. */
const COLOR_TRAZO_FONDO = "0, 225, 255";
const COLOR_EXITO_FONDO = "37, 211, 102";
const COLOR_ERROR_FONDO = "229, 72, 77";

/*
  El mosaico se dibuja FUERTE, como parte del diseño de la pantalla. Lo que lo
  apaga detrás del código no es esta opacidad, sino el panel de vidrio del editor:
  al 88% de opacidad más desenfoque, deja pasar alrededor del 12% de lo que hay
  detrás. Así el fondo se ve en los márgenes y se insinúa bajo el texto, con un
  solo dibujo y sin recortes ni máscaras.
*/
const OPACIDAD_TRAZO = 0.2;
const OPACIDAD_TRAZO_ACTIVO = 0.5;

/*
  Relleno propio de cada celda, muy tenue y estable en el tiempo. Sin él el
  mosaico es un alambrado; con él tiene cuerpo y se lee como una superficie —que
  es lo que lo vuelve diseño y no diagrama.
*/
const RELLENO_CELDA_MINIMO = 0.012;
const RELLENO_CELDA_MAXIMO = 0.05;

/* Un ciclo completo de deriva dura ~50 s: a esa velocidad el mosaico cambia sin
   que se pueda percibir el movimiento mirándolo de frente. */
const PERIODO_DERIVA_MS = 50000;
const AMPLITUD_DERIVA = 26;

/* 24 fps alcanzan de sobra para algo que se mueve así de lento, y recortan el
   costo del redibujado a menos de la mitad frente a 60. */
const MS_POR_CUADRO = 1000 / 24;

const DURACION_PULSO_MS = 1800;
const COLUMNAS_BASE = 7;
const FILAS_BASE = 5;

function prefiereMenosMovimientoFondo() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/*
  Monta el fondo sobre un <canvas> ya presente y devuelve los avisos que el
  entorno le manda: cuándo empieza a ejecutar y cómo terminó. Nunca lanza: un
  fondo que falla no puede impedir programar.
*/
function montarFondoDeCodigo(canvas) {
  const contexto = canvas.getContext("2d");
  if (!contexto) return { ejecutando() {}, terminado() {}, detener() {} };

  const quieto = prefiereMenosMovimientoFondo();

  let semillas = [];
  let ancho = 0;
  let alto = 0;
  let cuadro = null;
  let ultimoDibujo = 0;

  /* Estado del pulso: null en reposo. Guarda cuándo arrancó y de qué color es. */
  let pulso = null;
  let ejecutando = false;

  function medir() {
    const densidad = Math.min(window.devicePixelRatio || 1, 2);
    ancho = canvas.clientWidth;
    alto = canvas.clientHeight;

    canvas.width = Math.round(ancho * densidad);
    canvas.height = Math.round(alto * densidad);
    contexto.setTransform(densidad, 0, 0, densidad, 0, 0);

    /*
      Más columnas en pantallas anchas para que las celdas no se estiren: lo que
      se busca es un tamaño de celda parecido siempre, no un número fijo.
    */
    const columnas = Math.max(4, Math.round((ancho / 1400) * COLUMNAS_BASE));
    const filas = Math.max(3, Math.round((alto / 900) * FILAS_BASE));
    semillas = sembrarCeldas({ ancho, alto, columnas, filas });
  }

  function posicionDerivada(semilla, tiempo) {
    const angulo = (tiempo / PERIODO_DERIVA_MS) * Math.PI * 2 * semilla.velocidad + semilla.fase;
    return {
      x: semilla.x + Math.cos(angulo) * AMPLITUD_DERIVA,
      y: semilla.y + Math.sin(angulo * 0.7) * AMPLITUD_DERIVA,
    };
  }

  /*
    El pulso es un anillo que se expande desde el centro. Cada celda se ilumina
    cuando el frente la cruza y se apaga detrás: visualmente es el mismo gesto que
    un campo de distancias creciendo, que es exactamente lo que define un Voronoi.
  */
  function intensidadDelPulso(centro, tiempo) {
    if (!pulso) return 0;

    const transcurrido = tiempo - pulso.inicio;
    if (transcurrido < 0 || transcurrido > DURACION_PULSO_MS) return 0;

    const avance = transcurrido / DURACION_PULSO_MS;
    const alcance = Math.hypot(ancho, alto) / 2;
    const radioFrente = avance * alcance * 1.15;
    const distancia = Math.hypot(centro.x - ancho / 2, centro.y - alto / 2);

    const grosor = alcance * 0.28;
    const cercania = 1 - Math.abs(distancia - radioFrente) / grosor;
    if (cercania <= 0) return 0;

    // Se desvanece hacia el final para que el pulso no termine de golpe.
    return cercania * (1 - avance);
  }

  function dibujar(tiempo) {
    contexto.clearRect(0, 0, ancho, alto);

    const posiciones = quieto
      ? semillas
      : semillas.map((semilla) => posicionDerivada(semilla, tiempo));
    const celdas = celdasDeVoronoi(posiciones, ancho, alto);

    contexto.lineWidth = 1;

    celdas.forEach((celda, indice) => {
      if (celda.length < 3) return;

      const centro = centroidePoligono(celda);
      const intensidad = intensidadDelPulso(centro, tiempo);
      const color = pulso ? pulso.color : COLOR_TRAZO_FONDO;

      contexto.beginPath();
      contexto.moveTo(celda[0].x, celda[0].y);
      for (let punto = 1; punto < celda.length; punto += 1) {
        contexto.lineTo(celda[punto].x, celda[punto].y);
      }
      contexto.closePath();

      /*
        El brillo de cada celda sale de la fase de su semilla, no del azar por
        cuadro: si se sorteara en cada dibujo, el mosaico titilaría como estática
        de televisor en vez de quedarse quieto.
      */
      const semilla = semillas[indice];
      const variacion = semilla ? (Math.sin(semilla.fase) + 1) / 2 : 0.5;
      const relleno =
        RELLENO_CELDA_MINIMO + variacion * (RELLENO_CELDA_MAXIMO - RELLENO_CELDA_MINIMO);

      contexto.fillStyle = `rgba(${color}, ${relleno + intensidad * 0.12})`;
      contexto.fill();

      const opacidad = OPACIDAD_TRAZO + intensidad * (OPACIDAD_TRAZO_ACTIVO - OPACIDAD_TRAZO);
      contexto.strokeStyle = `rgba(${color}, ${opacidad})`;
      contexto.stroke();
    });

    if (pulso && tiempo - pulso.inicio > DURACION_PULSO_MS) {
      // Mientras corre el código el pulso se repite; al terminar, se apaga.
      pulso = ejecutando ? { inicio: tiempo, color: COLOR_TRAZO_FONDO } : null;
    }
  }

  function animar(tiempo) {
    cuadro = requestAnimationFrame(animar);

    if (tiempo - ultimoDibujo < MS_POR_CUADRO) return;
    ultimoDibujo = tiempo;
    dibujar(tiempo);
  }

  function arrancar() {
    if (cuadro !== null || quieto) return;
    cuadro = requestAnimationFrame(animar);
  }

  function pausar() {
    if (cuadro === null) return;
    cancelAnimationFrame(cuadro);
    cuadro = null;
  }

  medir();
  dibujar(0);
  arrancar();

  /* Una pestaña en segundo plano no tiene por qué gastar batería dibujando. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pausar();
    else arrancar();
  });

  let temporizadorMedida = null;
  window.addEventListener("resize", () => {
    clearTimeout(temporizadorMedida);
    temporizadorMedida = setTimeout(() => {
      medir();
      dibujar(performance.now());
    }, 150);
  });

  return {
    ejecutando() {
      ejecutando = true;
      pulso = { inicio: performance.now(), color: COLOR_TRAZO_FONDO };
      // Con movimiento reducido igual se dibuja una vez: hay respuesta, sin animación.
      if (quieto) dibujar(performance.now());
    },

    /*
      Un último pulso teñido según cómo terminó. Es la única señal de color del
      fondo, y llega en el momento en que el alumno mira la salida.
    */
    terminado(ok) {
      ejecutando = false;
      pulso = {
        inicio: performance.now(),
        color: ok ? COLOR_EXITO_FONDO : COLOR_ERROR_FONDO,
      };
      if (quieto) dibujar(performance.now());
    },

    detener: pausar,
  };
}
