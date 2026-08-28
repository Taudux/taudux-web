/*
  Vista de grafo del área de notas. Depende de notas.arbol.js.

  Por qué está escrito a mano y no con d3, cytoscape o vis-network: lo que se
  dibuja en cada momento es UN nivel del árbol —el nodo actual y sus hijos—, o
  sea decenas de nodos, nunca miles. Una simulación de fuerzas para ese tamaño
  son unas cien líneas, mientras que la librería más liviana del rubro son
  cientos de kilobytes de CDN que este sitio tendría que vigilar con un test
  igual que hace con el runtime del playground. A cambio, el estilo queda bajo
  control total y combina con el resto de la página.

  El canvas es un dibujo: no es navegable con teclado ni existe para un lector
  de pantalla. Por eso montarGrafoDeNotas pinta SIEMPRE, al lado, una lista de
  enlaces reales con los mismos destinos. No es un extra: es la versión
  accesible de esta vista, y ninguna de las dos puede quedar sin la otra.
*/

/* Distancia de reposo de una arista de jerarquía, en unidades del mundo. El
   ajuste a la pantalla se hace después, al calcular la escala. */
const LONGITUD_ENLACE_NOTAS = 190;
const LONGITUD_RELACION_NOTAS = 280;

const REPULSION_NOTAS = 240000;
const RIGIDEZ_JERARQUIA = 0.012;
const RIGIDEZ_RELACION = 0.004;
const AMORTIGUACION_NOTAS = 0.82;
/* Solo se aplica en la portada, donde no hay nodo fijo. Ver avanzarSimulacion. */
const GRAVEDAD_SIN_CENTRO = 0.012;

/* Debajo de esta energía el dibujo ya no cambia a ojo y se detiene el bucle:
   un rAF eterno gasta batería por nada. */
const ENERGIA_MINIMA_NOTAS = 0.05;
const TICKS_MAXIMOS_NOTAS = 600;

const RADIO_MINIMO_NOTAS = 16;
const RADIO_MAXIMO_NOTAS = 42;

/*
  Velocidad angular de la constelación, en radianes por cuadro. A 60 fps una
  vuelta completa toma poco más de tres minutos: tiene que percibirse como deriva,
  no como un carrusel.
*/
const ROTACION_CONSTELACION = 0.00055;
const DERIVA_CONSTELACION = 0.16;

/*
  La portada no se queda quieta: las áreas orbitan lentamente alrededor de su
  centro común, como un sistema de dos cuerpos cuando son dos, y con una deriva
  propia encima que las hace fluir cuando son más.

  La deriva es senoidal y no aleatoria. Math.random daría un temblor nervioso
  distinto en cada cuadro; dos senos de periodos que no encajan producen un
  recorrido que nunca se repite igual pero siempre es suave, que es lo que se
  lee como partículas flotando.
*/
function orbitarConstelacion(cuerpos, cuadro) {
  const lista = [...cuerpos.values()];
  if (!lista.length) return;

  let centroX = 0;
  let centroY = 0;
  lista.forEach((cuerpo) => {
    centroX += cuerpo.x;
    centroY += cuerpo.y;
  });
  centroX /= lista.length;
  centroY /= lista.length;

  const coseno = Math.cos(ROTACION_CONSTELACION);
  const seno = Math.sin(ROTACION_CONSTELACION);

  lista.forEach((cuerpo, indice) => {
    /* La rotación conserva exactamente las distancias entre nodos: el conjunto
       gira, no se deforma. */
    const dx = cuerpo.x - centroX;
    const dy = cuerpo.y - centroY;
    cuerpo.x = centroX + dx * coseno - dy * seno;
    cuerpo.y = centroY + dx * seno + dy * coseno;

    /*
      La deriva se aplica como DESPLAZAMIENTO respecto del cuadro anterior, no
      sumando el seno cada vez. Sumarlo convierte la oscilación en una caminata
      aleatoria que se acumula: en unos segundos los nodos se alejan entre sí y
      la constelación se estira en vez de flotar. Guardando la deriva previa, el
      desplazamiento queda acotado a la amplitud y vuelve siempre sobre sí mismo.
    */
    const fase = indice * 1.7;
    const derivaX = Math.sin(cuadro * 0.0032 + fase) * DERIVA_CONSTELACION;
    const derivaY = Math.cos(cuadro * 0.0021 + fase * 1.3) * DERIVA_CONSTELACION;

    cuerpo.x += derivaX - (cuerpo.derivaX || 0);
    cuerpo.y += derivaY - (cuerpo.derivaY || 0);
    cuerpo.derivaX = derivaX;
    cuerpo.derivaY = derivaY;
  });
}

function prefiereMenosMovimiento() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/*
  El tamaño comunica cuánto hay detrás del nodo. Raíz cuadrada y no lineal: con
  una rama de 60 notas y otra de 3, la escala lineal deja la segunda invisible.
*/
function radioDeNodo(nodo, maximoDescendientes) {
  if (nodo.tipo === "nota") return RADIO_MINIMO_NOTAS;
  const proporcion = Math.sqrt(nodo.notasDescendientes.length) / Math.sqrt(maximoDescendientes || 1);
  return RADIO_MINIMO_NOTAS + (RADIO_MAXIMO_NOTAS - RADIO_MINIMO_NOTAS) * proporcion;
}

/*
  Posiciones iniciales en círculo y NO aleatorias. Con Math.random el mismo
  nivel se acomoda distinto en cada visita y el lector pierde la memoria
  espacial del mapa, que es justamente lo que hace útil a un grafo.
*/
function posicionInicial(indice, total) {
  const angulo = (indice / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(angulo) * LONGITUD_ENLACE_NOTAS,
    y: Math.sin(angulo) * LONGITUD_ENLACE_NOTAS,
  };
}

function prepararSimulacion(vista) {
  const maximo = vista.nodos.reduce(
    (mayor, nodo) => Math.max(mayor, nodo.notasDescendientes.length),
    1
  );

  const cuerpos = new Map();
  /*
    El centro va clavado en el origen: es el nodo en el que está parado el
    lector y moverlo haría que toda la escena se deslizara sin motivo.

    En la portada NO hay centro —las áreas son conceptos sueltos, no ramas de
    un tronco— y el mapa queda como una constelación: nodos que se repelen sin
    nada que los ate. Ahí quien mantiene el conjunto encuadrado es
    calcularEncuadre, que centra sobre lo dibujado y no sobre el origen.
  */
  if (vista.centro) {
    cuerpos.set(vista.centro.ruta, {
      nodo: vista.centro,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fijo: true,
      radio: Math.min(RADIO_MAXIMO_NOTAS, radioDeNodo(vista.centro, maximo) + 6),
      esCentro: true,
    });
  }

  vista.nodos.forEach((nodo, indice) => {
    const { x, y } = posicionInicial(indice, vista.nodos.length);
    cuerpos.set(nodo.ruta, {
      nodo,
      x,
      y,
      vx: 0,
      vy: 0,
      fijo: false,
      radio: radioDeNodo(nodo, maximo),
      esCentro: false,
    });
  });

  return cuerpos;
}

/* Un paso de la simulación. Devuelve la energía cinética total, que es la señal
   de "ya se acomodó" para detener el bucle. */
function avanzarSimulacion(cuerpos, aristas) {
  const lista = [...cuerpos.values()];

  for (let i = 0; i < lista.length; i += 1) {
    for (let j = i + 1; j < lista.length; j += 1) {
      const a = lista[i];
      const b = lista[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distancia = Math.hypot(dx, dy);
      /* Dos nodos exactamente encima uno del otro dan distancia 0 y la fuerza
         se iría a infinito: se los separa por un eje arbitrario pero estable. */
      if (distancia < 1) {
        dx = (i - j) || 1;
        dy = 1;
        distancia = Math.hypot(dx, dy);
      }
      const fuerza = REPULSION_NOTAS / (distancia * distancia);
      const fx = (dx / distancia) * fuerza;
      const fy = (dy / distancia) * fuerza;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  aristas.forEach((arista) => {
    const a = cuerpos.get(arista.origen);
    const b = cuerpos.get(arista.destino);
    if (!a || !b) return;

    const esJerarquia = arista.tipo === "jerarquia";
    const reposo = esJerarquia ? LONGITUD_ENLACE_NOTAS : LONGITUD_RELACION_NOTAS;
    const rigidez = esJerarquia ? RIGIDEZ_JERARQUIA : RIGIDEZ_RELACION;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distancia = Math.max(1, Math.hypot(dx, dy));
    const desplazamiento = (distancia - reposo) * rigidez;
    const fx = (dx / distancia) * desplazamiento;
    const fy = (dy / distancia) * desplazamiento;

    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  });

  /*
    Sin un nodo fijo, la repulsión no tiene contrapeso y la constelación se
    expande sin fin: la simulación nunca baja de la energía mínima y el encuadre
    la va achicando hasta volverla ilegible. Esta atracción suave hacia el origen
    hace de gravedad y solo actúa cuando no hay centro.
  */
  const hayCentro = lista.some((cuerpo) => cuerpo.fijo);
  if (!hayCentro) {
    lista.forEach((cuerpo) => {
      cuerpo.vx -= cuerpo.x * GRAVEDAD_SIN_CENTRO;
      cuerpo.vy -= cuerpo.y * GRAVEDAD_SIN_CENTRO;
    });
  }

  let energia = 0;
  lista.forEach((cuerpo) => {
    if (cuerpo.fijo) {
      cuerpo.vx = 0;
      cuerpo.vy = 0;
      return;
    }
    cuerpo.vx *= AMORTIGUACION_NOTAS;
    cuerpo.vy *= AMORTIGUACION_NOTAS;
    cuerpo.x += cuerpo.vx;
    cuerpo.y += cuerpo.vy;
    energia += cuerpo.vx * cuerpo.vx + cuerpo.vy * cuerpo.vy;
  });

  return energia;
}

/*
  Escala y desplazamiento para que lo dibujado LLENE el lienzo, no solo para que
  quepa.

  La versión anterior medía la distancia al origen y topaba la escala en 1.25.
  El efecto era que un nivel de tres nodos ocupaba un cuadrito en medio de un
  lienzo enorme y uno de doce lo llenaba: el mapa parecía cambiar de tamaño al
  navegar y sobraba espacio vacío en los niveles chicos. Acá se mide la caja que
  ocupan los nodos y se ajusta a la del lienzo, así que el conjunto se ve del
  mismo tamaño tenga los nodos que tenga.

  El margen es en píxeles de pantalla y no en unidades del mundo porque lo que
  protege —el radio del nodo y su etiqueta— tampoco escala con el zoom.
*/
const MARGEN_HORIZONTAL_NOTAS = 105;
const MARGEN_VERTICAL_NOTAS = 68;
/* Con un solo nodo la caja mide cero y la escala se iría al infinito. */
const ESCALA_MAXIMA_NOTAS = 1.7;
const ESCALA_MINIMA_NOTAS = 0.22;

function calcularEncuadre(cuerpos, ancho, alto) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  cuerpos.forEach((cuerpo) => {
    minX = Math.min(minX, cuerpo.x);
    maxX = Math.max(maxX, cuerpo.x);
    minY = Math.min(minY, cuerpo.y);
    maxY = Math.max(maxY, cuerpo.y);
  });

  if (!Number.isFinite(minX)) {
    return { escala: 1, centroX: ancho / 2, centroY: alto / 2 };
  }

  const anchoDisponible = Math.max(1, ancho - MARGEN_HORIZONTAL_NOTAS * 2);
  const altoDisponible = Math.max(1, alto - MARGEN_VERTICAL_NOTAS * 2);

  const escala = Math.min(
    ESCALA_MAXIMA_NOTAS,
    Math.max(
      ESCALA_MINIMA_NOTAS,
      Math.min(anchoDisponible / Math.max(1, maxX - minX), altoDisponible / Math.max(1, maxY - minY))
    )
  );

  /* Se centra sobre la caja de lo dibujado y no sobre el origen: en la portada
     no hay nodo fijo en el centro y el conjunto quedaría descuadrado. */
  return {
    escala,
    centroX: ancho / 2 - ((minX + maxX) / 2) * escala,
    centroY: alto / 2 - ((minY + maxY) / 2) * escala,
  };
}

function aPantalla(cuerpo, encuadre) {
  return {
    x: encuadre.centroX + cuerpo.x * encuadre.escala,
    y: encuadre.centroY + cuerpo.y * encuadre.escala,
    /*
      El radio acompaña al zoom, pero con topes: sin ellos, un nivel de dos
      nodos los dibujaría como planetas y uno de veinte como alfileres.
    */
    radio: cuerpo.radio * Math.min(1.25, Math.max(0.7, encuadre.escala)),
  };
}

function acortarTexto(contexto, texto, anchoMaximo) {
  if (contexto.measureText(texto).width <= anchoMaximo) return texto;
  let recorte = texto;
  while (recorte.length > 1 && contexto.measureText(`${recorte}…`).width > anchoMaximo) {
    recorte = recorte.slice(0, -1);
  }
  return `${recorte.trim()}…`;
}

/*
  El canvas no lee variables CSS, así que la paleta de marca se repite acá como
  literales: aqua #0cc0df para lo activo y vívido #1149a5 —en rgba, porque el
  relleno va translúcido— para el nodo central. Los azules apagados de las ramas
  son pasos intermedios entre ambos.
*/
const COLOR_AQUA_NOTAS = "#0cc0df";

function colorDeNodo(cuerpo, resaltado) {
  if (cuerpo.esCentro || resaltado) return COLOR_AQUA_NOTAS;
  /* Una hoja se apaga respecto de una rama: el mapa debe leerse por jerarquía
     antes que por etiqueta. */
  return cuerpo.nodo.tipo === "nota" ? "#7f9ec4" : "#3f8fd0";
}

/* ------------------------------------------------------------------ */
/* Fondo                                                               */
/* ------------------------------------------------------------------ */

/*
  El campo de estrellas del landing, bajado de intensidad. Se dibuja dentro del
  mismo lienzo en vez de sumar tsparticles: son unas veinte líneas contra varios
  cientos de kilobytes de CDN, y así las estrellas comparten el ciclo de pintado
  del grafo en lugar de correr una segunda animación por su cuenta.

  Van deliberadamente tenues. El fondo tiene que sugerir profundidad, no competir
  con los nodos: si una estrella se lee tan clara como una hoja del árbol, el ojo
  ya no sabe qué es dato y qué es decorado.
*/
const ESTRELLAS_POR_MEGAPIXEL = 190;
const ESTRELLAS_MAXIMAS = 260;

/*
  Generador determinista. Con Math.random las estrellas saltarían de lugar en
  cada repintado —que ocurre en cada cuadro de la simulación— y el fondo
  titilaría como estática de televisión.
*/
function azarEstable(semilla) {
  let estado = semilla;
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
}

function generarEstrellas(ancho, alto) {
  const cantidad = Math.min(
    ESTRELLAS_MAXIMAS,
    Math.round(((ancho * alto) / 1000000) * ESTRELLAS_POR_MEGAPIXEL)
  );
  const azar = azarEstable(20260827);

  return Array.from({ length: cantidad }, () => ({
    x: azar() * ancho,
    y: azar() * alto,
    /* Unas pocas más grandes dan sensación de profundidad; la mayoría son polvo. */
    radio: azar() < 0.12 ? 1.5 + azar() * 0.9 : 0.5 + azar() * 0.7,
    alfa: 0.14 + azar() * 0.3,
  }));
}

function dibujarEstrellas(contexto, estrellas) {
  contexto.save();
  estrellas.forEach((estrella) => {
    contexto.globalAlpha = estrella.alfa;
    /* Las más grandes toman el aqua de la marca; el resto queda casi blanco,
       como el cielo del landing. */
    contexto.fillStyle = estrella.radio > 1.4 ? COLOR_AQUA_NOTAS : "#cfe2f2";
    contexto.beginPath();
    contexto.arc(estrella.x, estrella.y, estrella.radio, 0, Math.PI * 2);
    contexto.fill();
  });
  contexto.restore();
}

function dibujarAristas(contexto, cuerpos, aristas, encuadre, rutaResaltada) {
  aristas.forEach((arista) => {
    const a = cuerpos.get(arista.origen);
    const b = cuerpos.get(arista.destino);
    if (!a || !b) return;

    const desde = aPantalla(a, encuadre);
    const hasta = aPantalla(b, encuadre);
    const tocaResaltado =
      rutaResaltada && (arista.origen === rutaResaltada || arista.destino === rutaResaltada);

    contexto.save();
    /* La relación va punteada y la jerarquía continua: es la única forma de
       distinguir "esto cuelga de aquello" de "esto se parece a aquello" sin
       agregar una leyenda que nadie lee. */
    contexto.setLineDash(arista.tipo === "relacion" ? [5, 7] : []);
    /*
      Las aristas se subieron de intensidad: con el fondo de QED detrás, a la
      opacidad anterior se confundían con las líneas del diagrama de Feynman y el
      grafo perdía su estructura. Tienen que leerse como lo que son —el dato— por
      encima de la pizarra, que es decorado.
    */
    contexto.lineWidth = tocaResaltado ? 2.4 : 1.5;
    contexto.strokeStyle =
      arista.tipo === "relacion"
        ? `rgba(12, 192, 223, ${tocaResaltado ? 0.9 : 0.55})`
        : `rgba(168, 205, 236, ${tocaResaltado ? 0.85 : 0.5})`;
    contexto.beginPath();
    contexto.moveTo(desde.x, desde.y);
    contexto.lineTo(hasta.x, hasta.y);
    contexto.stroke();
    contexto.restore();
  });
}

function dibujarNodos(contexto, cuerpos, encuadre, rutaResaltada) {
  cuerpos.forEach((cuerpo) => {
    const { x, y, radio } = aPantalla(cuerpo, encuadre);
    const resaltado = cuerpo.nodo.ruta === rutaResaltada;
    const color = colorDeNodo(cuerpo, resaltado);

    contexto.save();
    contexto.shadowColor = color;
    contexto.shadowBlur = resaltado ? 26 : 14;
    contexto.fillStyle = cuerpo.esCentro
      ? "rgba(17, 73, 165, 0.45)"
      : "rgba(4, 16, 31, 0.92)";
    contexto.beginPath();
    contexto.arc(x, y, radio, 0, Math.PI * 2);
    contexto.fill();
    contexto.lineWidth = resaltado || cuerpo.esCentro ? 2.5 : 1.5;
    contexto.strokeStyle = color;
    contexto.stroke();
    contexto.restore();

    /* Una nota se marca con un punto interior: distingue "hoja" de "rama" antes
       de leer la etiqueta. */
    if (cuerpo.nodo.tipo === "nota") {
      contexto.save();
      contexto.fillStyle = color;
      contexto.beginPath();
      contexto.arc(x, y, Math.max(3, radio * 0.22), 0, Math.PI * 2);
      contexto.fill();
      contexto.restore();
    }

    contexto.save();
    contexto.font = `${cuerpo.esCentro ? 600 : 500} 13px "Space Grotesk", sans-serif`;
    contexto.textAlign = "center";
    contexto.textBaseline = "top";
    contexto.fillStyle = resaltado || cuerpo.esCentro ? "#e8eff7" : "rgba(232, 239, 247, 0.72)";
    contexto.fillText(
      acortarTexto(contexto, cuerpo.nodo.titulo, 170),
      x,
      y + radio + 8
    );
    contexto.restore();
  });
}

/*
  Monta el grafo dentro de `contenedor` y devuelve un objeto con destruir(): la
  página cambia de nivel constantemente y cada montaje deja listeners y un bucle
  de animación que hay que poder cortar. Sin eso, navegar diez niveles deja diez
  simulaciones corriendo en paralelo.
*/
function montarGrafoDeNotas({ contenedor, listaAccesible, ayuda, arbol, nodo, vista, alNavegar }) {
  const datos = vistaDeGrafo(arbol, nodo);

  /*
    La instrucción cambia con el nivel: en la portada no hay nodo central del que
    subir, así que prometer que "el centro te devuelve un nivel" mandaría al
    lector a hacer clic en un vacío.
  */
  if (ayuda) {
    ayuda.textContent = datos.centro
      ? "Haz clic en una rama para entrar. El nodo del centro te devuelve un nivel. Las líneas punteadas unen ramas que se citan entre sí."
      : "Cada nodo es un área de conocimiento. Haz clic en una para entrar. Las líneas punteadas unen áreas que se citan entre sí.";
  }
  const cuerpos = prepararSimulacion(datos);

  const canvas = document.createElement("canvas");
  canvas.className = "notas__grafo-lienzo";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    datos.centro
      ? `Mapa de ${datos.centro.titulo} con ${datos.nodos.length} ramas. La lista siguiente contiene los mismos destinos.`
      : `Mapa con ${datos.nodos.length} áreas de conocimiento. La lista siguiente contiene los mismos destinos.`
  );
  contenedor.replaceChildren(canvas);

  const contexto = canvas.getContext("2d");
  let estrellas = [];
  let rutaResaltada = null;
  let cuadroPendiente = null;
  let ticks = 0;
  let vivo = true;

  /* Sin escalar por devicePixelRatio, el texto y los círculos salen borrosos en
     cualquier pantalla moderna. */
  function ajustarTamano() {
    const densidad = window.devicePixelRatio || 1;
    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;
    canvas.width = Math.round(ancho * densidad);
    canvas.height = Math.round(alto * densidad);
    canvas.style.width = `${ancho}px`;
    canvas.style.height = `${alto}px`;
    contexto.setTransform(densidad, 0, 0, densidad, 0, 0);
    estrellas = generarEstrellas(ancho, alto);
  }

  function dibujar() {
    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;
    const encuadre = calcularEncuadre(cuerpos, ancho, alto);
    contexto.clearRect(0, 0, ancho, alto);
    /*
      Dentro del lienzo solo hay cielo. La pizarra de QED vive detrás de la
      página entera (notas.pizarra.js) y queda por fuera de este recuadro: con
      las dos cosas superpuestas, las aristas del grafo competían con las líneas
      del diagrama y la estructura se perdía.
    */
    dibujarEstrellas(contexto, estrellas);
    dibujarAristas(contexto, cuerpos, datos.aristas, encuadre, rutaResaltada);
    dibujarNodos(contexto, cuerpos, encuadre, rutaResaltada);
    return encuadre;
  }

  /*
    La portada se comporta distinto al resto: no es un árbol que se acomoda y se
    queda quieto, sino un espacio donde las áreas flotan. Por eso su bucle no
    termina — el movimiento ES la vista— mientras que dentro de un área la
    simulación se asienta y se detiene, que es lo que permite leer la estructura.
  */
  const esConstelacion = !datos.centro;
  let cuadro = 0;

  function animar() {
    if (!vivo) return;
    cuadro += 1;
    const energia = avanzarSimulacion(cuerpos, datos.aristas);
    if (esConstelacion) orbitarConstelacion(cuerpos, cuadro);
    dibujar();
    ticks += 1;

    const asentado = energia < ENERGIA_MINIMA_NOTAS || ticks > TICKS_MAXIMOS_NOTAS;
    if (asentado && !esConstelacion) {
      cuadroPendiente = null;
      return;
    }
    cuadroPendiente = requestAnimationFrame(animar);
  }

  /*
    Un bucle que no termina seguiría consumiendo batería con la pestaña en
    segundo plano. Los navegadores ya frenan requestAnimationFrame ahí, pero no
    todos lo detienen del todo: cortarlo explícitamente es barato y no depende
    de en qué navegador se abrió.
  */
  function alCambiarVisibilidad() {
    if (document.hidden) {
      if (cuadroPendiente !== null) {
        cancelAnimationFrame(cuadroPendiente);
        cuadroPendiente = null;
      }
      return;
    }
    if (esConstelacion) reanimar();
  }

  function reanimar() {
    if (cuadroPendiente !== null || !vivo) return;
    ticks = 0;
    cuadroPendiente = requestAnimationFrame(animar);
  }

  function cuerpoBajoElPuntero(evento) {
    const marco = canvas.getBoundingClientRect();
    const x = evento.clientX - marco.left;
    const y = evento.clientY - marco.top;
    const encuadre = calcularEncuadre(cuerpos, contenedor.clientWidth, contenedor.clientHeight);

    let encontrado = null;
    cuerpos.forEach((cuerpo) => {
      const posicion = aPantalla(cuerpo, encuadre);
      /* Un margen de 6px vuelve clickeables los nodos chicos sin obligar a
         apuntar con precisión. */
      if (Math.hypot(posicion.x - x, posicion.y - y) <= posicion.radio + 6) {
        encontrado = cuerpo;
      }
    });
    return encontrado;
  }

  function alMover(evento) {
    const cuerpo = cuerpoBajoElPuntero(evento);
    const nuevaRuta = cuerpo ? cuerpo.nodo.ruta : null;
    if (nuevaRuta === rutaResaltada) return;
    rutaResaltada = nuevaRuta;
    canvas.style.cursor = cuerpo ? "pointer" : "default";
    /* Basta con repintar: mover el mouse no altera la física. */
    if (cuadroPendiente === null) dibujar();
  }

  function alHacerClick(evento) {
    const cuerpo = cuerpoBajoElPuntero(evento);
    if (!cuerpo) return;
    /* Hacer clic en el centro sube un nivel; es el gesto que la gente intenta
       antes de buscar las migas. */
    const destino = cuerpo.esCentro
      ? cuerpo.nodo.segmentos.slice(0, -1)
      : cuerpo.nodo.segmentos;
    alNavegar(destino);
  }

  function alSalir() {
    if (rutaResaltada === null) return;
    rutaResaltada = null;
    canvas.style.cursor = "default";
    if (cuadroPendiente === null) dibujar();
  }

  const alRedimensionar = () => {
    ajustarTamano();
    /* El encuadre depende del tamaño, así que hay que repintar aunque la
       simulación ya esté quieta. */
    if (cuadroPendiente === null) dibujar();
  };

  canvas.addEventListener("mousemove", alMover);
  canvas.addEventListener("mouseleave", alSalir);
  canvas.addEventListener("click", alHacerClick);
  window.addEventListener("resize", alRedimensionar);
  document.addEventListener("visibilitychange", alCambiarVisibilidad);

  /* La lista es la versión navegable con teclado del mismo grafo. */
  if (listaAccesible) {
    listaAccesible.replaceChildren(
      ...datos.nodos.map((hijo) => {
        const item = document.createElement("li");
        const enlace = document.createElement("a");
        enlace.href = construirHashNotas({ vista, segmentos: hijo.segmentos });
        enlace.textContent = hijo.titulo;
        /* Resaltar en el canvas al enfocar con teclado mantiene sincronizadas
           las dos mitades: se ve dónde está el foco. */
        enlace.addEventListener("focus", () => {
          rutaResaltada = hijo.ruta;
          if (cuadroPendiente === null) dibujar();
        });
        item.appendChild(enlace);
        return item;
      })
    );
  }

  ajustarTamano();

  if (prefiereMenosMovimiento()) {
    /* Sin animación: se resuelve la simulación de golpe y se pinta el resultado
       final una sola vez. */
    for (let paso = 0; paso < TICKS_MAXIMOS_NOTAS; paso += 1) {
      if (avanzarSimulacion(cuerpos, datos.aristas) < ENERGIA_MINIMA_NOTAS) break;
    }
    dibujar();
  } else {
    reanimar();
  }

  return {
    destruir() {
      vivo = false;
      if (cuadroPendiente !== null) cancelAnimationFrame(cuadroPendiente);
      canvas.removeEventListener("mousemove", alMover);
      canvas.removeEventListener("mouseleave", alSalir);
      canvas.removeEventListener("click", alHacerClick);
      window.removeEventListener("resize", alRedimensionar);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    },
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    radioDeNodo,
    posicionInicial,
    prepararSimulacion,
    avanzarSimulacion,
    orbitarConstelacion,
    calcularEncuadre,
    generarEstrellas,
    LONGITUD_ENLACE_NOTAS,
    RADIO_MINIMO_NOTAS,
    RADIO_MAXIMO_NOTAS,
  });
}
