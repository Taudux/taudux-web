/*
  Fondo de la sección: una pizarra de electrodinámica cuántica —diagramas de
  Feynman y ecuaciones de QED en mosaico— detrás de toda la página.

  Va EXTERIOR al mapa. El lienzo del grafo tiene su propio cielo estrellado y un
  fondo opaco, así que la pizarra solo se ve alrededor: en el encabezado, en los
  márgenes y debajo. Son dos ambientes distintos a propósito —el espacio donde se
  navega y la pizarra donde se piensa— y mezclarlos era justamente lo que hacía
  que las aristas del grafo se confundieran con las líneas del diagrama.

  Vive en su propio módulo y no dentro de notas.grafo.js porque no tiene nada que
  ver con el grafo: es decorado de página. El grafo dibuja datos.

  Se pinta una sola vez por tamaño de ventana: es estático, no anima nada.
*/

const TIPOGRAFIA_FORMULA = '"Source Serif 4", Georgia, serif';

/*
  Ecuaciones en una micro-sintaxis con ^{} y _{}. El canvas no sabe de LaTeX, y
  escribirlas en Unicode plano no alcanza: no existen superíndices para μ ni ν,
  así que F^{μν} terminaría como "F^uv" —física incorrecta a la vista de quien se
  acerque—. Dibujar los índices a mano cuesta treinta líneas y evita eso.
*/
const ECUACIONES_QED = Object.freeze([
  "ℒ = ψ̄(iγ^{μ}D_{μ} − m)ψ − ¼F_{μν}F^{μν}",
  "(iγ^{μ}∂_{μ} − m)ψ = 0",
  "D_{μ} = ∂_{μ} + ieA_{μ}",
  "∂_{μ}F^{μν} = J^{ν}",
  "{γ^{μ}, γ^{ν}} = 2g^{μν}",
  "α = e²/4πε_{0}ħc ≈ 1/137",
  "−ig_{μν}/(q² + iε)",
  "a_{e} = (g − 2)/2",
  "S = T exp(−i∫H_{int} dt)",
  "⟨p′|j^{μ}|p⟩ = ū(p′)Γ^{μ}u(p)",
]);

/*
  Operadores escalera del oscilador armónico. Es el fondo del modo lectura, y no
  es un adorno arbitrario: subir y bajar por una escalera de estados es
  exactamente lo que hace quien recorre estas notas, de lo general a lo
  particular y de vuelta.
*/
const ECUACIONES_ESCALERA = Object.freeze([
  "â|n⟩ = √n |n−1⟩",
  "â^{†}|n⟩ = √(n+1) |n+1⟩",
  "[â, â^{†}] = 1",
  "Ĥ = ħω(â^{†}â + ½)",
  "N̂ = â^{†}â,  N̂|n⟩ = n|n⟩",
  "E_{n} = ħω(n + ½)",
  "|n⟩ = (â^{†})^{n}/√(n!) |0⟩",
  "[Ĥ, â^{†}] = ħω â^{†}",
  "â = √(mω/2ħ)(x̂ + ip̂/mω)",
  "â|0⟩ = 0",
]);

/*
  Los dos ambientes de la sección. Explorar ocurre sobre una pizarra oscura de
  electrodinámica; leer, sobre papel claro con la escalera de estados. Cambian el
  juego de ecuaciones, la tinta y si se siembran diagramas: en la nota no van,
  porque un dibujo con líneas detrás del texto sí estorba la lectura, mientras
  que renglones de fórmulas acompañan sin competir.
*/
const MODOS_PIZARRA = Object.freeze({
  exploracion: {
    ecuaciones: ECUACIONES_QED,
    color: "#cfe2f2",
    alfaEcuaciones: 0.11,
    alfaDiagrama: 0.12,
    conDiagramas: true,
  },
  lectura: {
    ecuaciones: ECUACIONES_ESCALERA,
    color: "#1149a5",
    alfaEcuaciones: 0.07,
    alfaDiagrama: 0,
    conDiagramas: false,
  },
});

/* Parte la fórmula en trozos de base, superíndice y subíndice. Acepta ^{μν} y
   también ^μ, que es como se escribe cuando el índice es uno solo. */
function trozosDeFormula(formula) {
  const trozos = [];
  let base = "";

  const cerrarBase = () => {
    if (base) trozos.push({ texto: base, tipo: "base" });
    base = "";
  };

  for (let i = 0; i < formula.length; i += 1) {
    const caracter = formula[i];
    if (caracter !== "^" && caracter !== "_") {
      base += caracter;
      continue;
    }

    const tipo = caracter === "^" ? "sup" : "sub";
    let contenido = "";

    if (formula[i + 1] === "{") {
      const cierre = formula.indexOf("}", i + 2);
      /* Una llave sin cerrar se trata como texto normal, en vez de tragarse el
         resto de la fórmula. */
      if (cierre === -1) {
        base += caracter;
        continue;
      }
      contenido = formula.slice(i + 2, cierre);
      i = cierre;
    } else {
      contenido = formula[i + 1] || "";
      i += 1;
    }

    cerrarBase();
    trozos.push({ texto: contenido, tipo });
  }

  cerrarBase();
  return trozos;
}

function dibujarFormula(contexto, formula, x, y, tamano) {
  let avance = x;
  trozosDeFormula(formula).forEach((trozo) => {
    const esIndice = trozo.tipo !== "base";
    contexto.font = `${esIndice ? tamano * 0.64 : tamano}px ${TIPOGRAFIA_FORMULA}`;
    const desplazamiento =
      trozo.tipo === "sup" ? -tamano * 0.34 : trozo.tipo === "sub" ? tamano * 0.2 : 0;
    contexto.fillText(trozo.texto, avance, y + desplazamiento);
    avance += contexto.measureText(trozo.texto).width;
  });
  return avance - x;
}

/*
  El mosaico de ecuaciones. Las filas se desplazan media celda de forma alternada
  para que no formen columnas rígidas, que leerían como tabla en vez de como
  pizarra.
*/
function dibujarEcuaciones(contexto, ancho, alto, modo) {
  const tamano = 15;
  const separacionY = 104;
  const separacionX = 320;

  contexto.save();
  contexto.globalAlpha = modo.alfaEcuaciones;
  contexto.fillStyle = modo.color;
  contexto.textAlign = "left";
  contexto.textBaseline = "middle";

  let indice = 0;
  for (let fila = 0, y = separacionY * 0.5; y < alto + separacionY; fila += 1, y += separacionY) {
    const desfase = fila % 2 === 0 ? 0 : -separacionX / 2;
    for (let x = desfase - separacionX * 0.2; x < ancho; x += separacionX) {
      dibujarFormula(contexto, modo.ecuaciones[indice % modo.ecuaciones.length], x, y, tamano);
      indice += 1;
    }
  }

  contexto.restore();
}

/* La línea ondulada del fotón: es lo que distingue un diagrama de Feynman de
   cualquier otro esquema de líneas y puntos. */
function dibujarLineaDeFoton(contexto, x1, y1, x2, y2, amplitud) {
  const largo = Math.hypot(x2 - x1, y2 - y1);
  const pasos = Math.max(8, Math.round(largo / 6));
  const angulo = Math.atan2(y2 - y1, x2 - x1);

  contexto.beginPath();
  for (let paso = 0; paso <= pasos; paso += 1) {
    const avance = paso / pasos;
    const onda = Math.sin(avance * Math.PI * 8) * amplitud;
    const x = x1 + (x2 - x1) * avance - Math.sin(angulo) * onda;
    const y = y1 + (y2 - y1) * avance + Math.cos(angulo) * onda;
    if (paso === 0) contexto.moveTo(x, y);
    else contexto.lineTo(x, y);
  }
  contexto.stroke();
}

/* La punta a media pata indica el sentido del flujo de carga, no la dirección
   del tiempo. */
function dibujarPuntaDeFermion(contexto, x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const angulo = Math.atan2(y2 - y1, x2 - x1);
  const largo = 8;

  contexto.beginPath();
  contexto.moveTo(mx, my);
  contexto.lineTo(mx - Math.cos(angulo - 0.42) * largo, my - Math.sin(angulo - 0.42) * largo);
  contexto.moveTo(mx, my);
  contexto.lineTo(mx - Math.cos(angulo + 0.42) * largo, my - Math.sin(angulo + 0.42) * largo);
  contexto.stroke();
}

/*
  Dispersión de Møller: dos electrones que se repelen intercambiando un fotón
  virtual. Es el diagrama de QED más reconocible, y el que abre casi cualquier
  libro del tema.
*/
function dibujarDiagramaFeynman(contexto, cx, cy, escala, color) {
  const pata = 110 * escala;
  const separacion = 62 * escala;
  const izquierdo = cx - separacion;
  const derecho = cx + separacion;

  contexto.save();
  contexto.strokeStyle = color;
  contexto.fillStyle = color;
  contexto.lineWidth = 1.5;
  contexto.lineCap = "round";

  /* Cuatro patas de electrón: dos entran por la izquierda, dos salen por la
     derecha. */
  const patas = [
    [izquierdo - pata, cy - pata, izquierdo, cy],
    [izquierdo - pata, cy + pata, izquierdo, cy],
    [derecho, cy, derecho + pata, cy - pata],
    [derecho, cy, derecho + pata, cy + pata],
  ];

  patas.forEach(([x1, y1, x2, y2]) => {
    contexto.beginPath();
    contexto.moveTo(x1, y1);
    contexto.lineTo(x2, y2);
    contexto.stroke();
    dibujarPuntaDeFermion(contexto, x1, y1, x2, y2);
  });

  dibujarLineaDeFoton(contexto, izquierdo, cy, derecho, cy, 6 * escala);

  [izquierdo, derecho].forEach((x) => {
    contexto.beginPath();
    contexto.arc(x, cy, 2.8, 0, Math.PI * 2);
    contexto.fill();
  });

  contexto.font = `${12 * escala}px ${TIPOGRAFIA_FORMULA}`;
  contexto.textBaseline = "alphabetic";
  contexto.textAlign = "center";
  contexto.fillText("γ", cx, cy - 14 * escala);

  contexto.restore();
}

/*
  Los diagramas también se repiten: uno solo al centro se perdería en una página
  larga y dejaría zonas de color plano, que es lo que se quería evitar. Se
  siembran en una retícula con las filas alternadas, igual que las ecuaciones.
*/
function dibujarDiagramas(contexto, ancho, alto, modo) {
  const separacionX = 660;
  const separacionY = 560;

  contexto.save();
  contexto.globalAlpha = modo.alfaDiagrama;

  for (let fila = 0, cy = separacionY * 0.35; cy < alto + separacionY; fila += 1, cy += separacionY) {
    const desfase = fila % 2 === 0 ? 0 : separacionX / 2;
    for (let cx = desfase - separacionX * 0.15; cx < ancho + separacionX; cx += separacionX) {
      dibujarDiagramaFeynman(contexto, cx, cy, 0.85, modo.color);
    }
  }

  contexto.restore();
}

function pintarPizarra(canvas, modo) {
  const ancho = window.innerWidth;
  const alto = window.innerHeight;
  const densidad = window.devicePixelRatio || 1;

  canvas.width = Math.round(ancho * densidad);
  canvas.height = Math.round(alto * densidad);
  canvas.style.width = `${ancho}px`;
  canvas.style.height = `${alto}px`;

  const contexto = canvas.getContext("2d");
  contexto.setTransform(densidad, 0, 0, densidad, 0, 0);
  contexto.clearRect(0, 0, ancho, alto);

  if (modo.conDiagramas) dibujarDiagramas(contexto, ancho, alto, modo);
  dibujarEcuaciones(contexto, ancho, alto, modo);
}

/*
  El lienzo va fijo al viewport, así que basta con pintarlo del tamaño de la
  ventana: no hace falta cubrir el alto del documento ni repintar al hacer
  scroll.
*/
function montarPizarraDeNotas(canvas) {
  if (!canvas) return { destruir() {}, usarModo() {} };

  let modoActual = MODOS_PIZARRA.exploracion;
  let redibujoPendiente = null;

  const alRedimensionar = () => {
    /* Redimensionar dispara decenas de eventos por segundo y repintar el mosaico
       entero en cada uno es trabajo tirado: basta con el último. */
    window.clearTimeout(redibujoPendiente);
    redibujoPendiente = window.setTimeout(() => pintarPizarra(canvas, modoActual), 120);
  };

  pintarPizarra(canvas, modoActual);
  window.addEventListener("resize", alRedimensionar);

  return {
    /* Abrir una nota cambia el ambiente completo: de la pizarra de QED sobre
       fondo oscuro a la escalera de estados sobre papel. */
    usarModo(nombre) {
      const modo = MODOS_PIZARRA[nombre];
      if (!modo || modo === modoActual) return;
      modoActual = modo;
      pintarPizarra(canvas, modoActual);
    },
    destruir() {
      window.clearTimeout(redibujoPendiente);
      window.removeEventListener("resize", alRedimensionar);
    },
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    trozosDeFormula,
    ECUACIONES_QED,
    ECUACIONES_ESCALERA,
    MODOS_PIZARRA,
  });
}
