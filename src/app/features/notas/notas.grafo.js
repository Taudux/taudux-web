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

/* Debajo de esta energía el dibujo ya no cambia a ojo y se detiene el bucle:
   un rAF eterno gasta batería por nada. */
const ENERGIA_MINIMA_NOTAS = 0.05;
const TICKS_MAXIMOS_NOTAS = 600;

const RADIO_MINIMO_NOTAS = 16;
const RADIO_MAXIMO_NOTAS = 42;

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
  /* El centro va clavado en el origen: es el nodo en el que está parado el
     lector y moverlo haría que toda la escena se deslizara sin motivo. */
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
  Escala y desplazamiento para que todo lo simulado entre en el canvas con
  margen. Se recalcula en cada cuadro: mientras la simulación se expande, la
  vista se aleja sola y nunca hay nodos fuera de cuadro.
*/
function calcularEncuadre(cuerpos, ancho, alto) {
  let maximo = LONGITUD_ENLACE_NOTAS;
  cuerpos.forEach((cuerpo) => {
    maximo = Math.max(maximo, Math.hypot(cuerpo.x, cuerpo.y) + cuerpo.radio + 34);
  });

  const disponible = Math.min(ancho, alto) / 2;
  return {
    escala: Math.min(1.25, disponible / maximo),
    centroX: ancho / 2,
    centroY: alto / 2,
  };
}

function aPantalla(cuerpo, encuadre) {
  return {
    x: encuadre.centroX + cuerpo.x * encuadre.escala,
    y: encuadre.centroY + cuerpo.y * encuadre.escala,
    radio: cuerpo.radio * Math.max(0.55, encuadre.escala),
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

function colorDeNodo(cuerpo, resaltado) {
  if (cuerpo.esCentro) return "#7dd3fc";
  if (resaltado) return "#00e1ff";
  return cuerpo.nodo.tipo === "nota" ? "#9aa7b2" : "#4fc3e8";
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
    contexto.lineWidth = tocaResaltado ? 2 : 1;
    contexto.strokeStyle =
      arista.tipo === "relacion"
        ? `rgba(0, 225, 255, ${tocaResaltado ? 0.55 : 0.22})`
        : `rgba(255, 255, 255, ${tocaResaltado ? 0.45 : 0.16})`;
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
    contexto.fillStyle = cuerpo.esCentro ? "rgba(125, 211, 252, 0.20)" : "rgba(13, 15, 17, 0.92)";
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
    contexto.fillStyle = resaltado || cuerpo.esCentro ? "#ffffff" : "rgba(255,255,255,0.78)";
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
function montarGrafoDeNotas({ contenedor, listaAccesible, arbol, nodo, vista, alNavegar }) {
  const datos = vistaDeGrafo(arbol, nodo);
  const cuerpos = prepararSimulacion(datos);

  const canvas = document.createElement("canvas");
  canvas.className = "notas__grafo-lienzo";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    `Mapa de ${datos.centro.titulo} con ${datos.nodos.length} ramas. La lista siguiente contiene los mismos destinos.`
  );
  contenedor.replaceChildren(canvas);

  const contexto = canvas.getContext("2d");
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
  }

  function dibujar() {
    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;
    const encuadre = calcularEncuadre(cuerpos, ancho, alto);
    contexto.clearRect(0, 0, ancho, alto);
    dibujarAristas(contexto, cuerpos, datos.aristas, encuadre, rutaResaltada);
    dibujarNodos(contexto, cuerpos, encuadre, rutaResaltada);
    return encuadre;
  }

  function animar() {
    if (!vivo) return;
    const energia = avanzarSimulacion(cuerpos, datos.aristas);
    dibujar();
    ticks += 1;
    if (energia < ENERGIA_MINIMA_NOTAS || ticks > TICKS_MAXIMOS_NOTAS) {
      cuadroPendiente = null;
      return;
    }
    cuadroPendiente = requestAnimationFrame(animar);
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
    if (cuerpo.esCentro && cuerpo.nodo.tipo === "raiz") return;
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
    },
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    radioDeNodo,
    posicionInicial,
    prepararSimulacion,
    avanzarSimulacion,
    calcularEncuadre,
    LONGITUD_ENLACE_NOTAS,
    RADIO_MINIMO_NOTAS,
    RADIO_MAXIMO_NOTAS,
  });
}
