/*
  Lógica pura del editor de foto de "Mi ficha" (2026-10-13): validar el
  archivo, el estado del encuadre y la geometría del recorte. Sin DOM, sin
  canvas y sin red, como el resto de los .logica.js: el dibujo y los eventos
  viven en mi-ficha.foto.js, que depende de estas globales y por eso se carga
  después.

  EL ENCUADRE VIVE EN UNIDADES DEL LADO DEL RECORTE (L = 1). El canvas de la
  vista previa mide unos 300 px y la salida hasta 1024, y las dos tienen que
  mostrar exactamente lo mismo: si el estado guardara píxeles de pantalla, el
  archivo exportado saldría encuadrado distinto de lo que se vio. Con L = 1 el
  desplazamiento es una fracción del cuadro, y pasar a cualquier tamaño es
  multiplicar por el lado.

  EL ORDEN DE LAS TRANSFORMACIONES (el mismo en la vista previa y en la
  exportación, de afuera hacia adentro):

      trasladar(desplazamiento) → rotar(libre) → rotar(giro90) → voltear → escalar

  Los volteos van adentro del giro de 90°, así que con un giro impar el eje
  local está cruzado con el de pantalla. voltear() lo compensa: "horizontal"
  siempre es horizontal en pantalla, gire o no la foto.

  EL RECORTE SIEMPRE QUEDA CUBIERTO. Con rotación libre, "el lado corto cabe en
  el cuadro" ya no alcanza: las esquinas del cuadro se salen de la foto. La
  escala mínima que cubre el cuadro a un ángulo θ es
  (|cos θ| + |sen θ|) / lado corto: el cuadro, visto desde la foto, es un
  cuadrado girado cuya caja mide (|cos| + |sen|) por lado. Es conservadora (no
  aprovecha que el cuadro no necesita cubrir sus propias esquinas con
  desplazamiento 0), pero nunca deja un hueco, y con θ = 0 es exactamente
  "cover": a zoom 1 el lado corto de la foto llena el cuadro.
*/

const TIPOS_DE_FOTO_ADMITIDOS = Object.freeze(["image/jpeg", "image/png"]);
const PESO_MAXIMO_DE_FOTO_BYTES = 20 * 1024 * 1024;
// Por lado de la imagen ya decodificada: protege la memoria del navegador, que
// decodifica la foto entera a RGBA (8000 × 8000 son ~256 MB).
const LADO_MAXIMO_DE_FOTO_PX = 8000;
const LADO_MAXIMO_DE_SALIDA_PX = 1024;
const CALIDAD_WEBP_DE_FOTO = 0.92;
// Safari no codifica WebP: si toBlob no entrega WebP, se exporta JPEG.
const CALIDAD_JPEG_DE_FOTO = 0.88;

const ZOOM_MINIMO_DE_FOTO = 1;
const ZOOM_MAXIMO_DE_FOTO = 3;
const ZOOM_PASO_DE_FOTO = 0.1;
const ROTACION_MINIMA_DE_FOTO = -45;
const ROTACION_MAXIMA_DE_FOTO = 45;
const ROTACION_PASO_DE_FOTO = 1;

// Cuánto se mueve la foto con una flecha, como fracción del lado del recorte.
const PASO_DE_FLECHA_DE_FOTO = 0.02;

const MENSAJES_DE_FOTO = Object.freeze({
  formato: "Ese formato no se admite. Usa JPG o PNG.",
  peso: "La foto pesa más de 20 MB. Elige una más ligera.",
  ilegible: "No pudimos abrir esa imagen. Si es una foto de iPhone, expórtala como JPG.",
  dimensiones: "La foto mide más de 8000 px de lado. Elige una más pequeña.",
  // No es de validación: es del paso de exportar, cuando el navegador no
  // pudo producir el archivo (toBlob devuelve null).
  exportar: "No pudimos preparar la foto. Intenta de nuevo.",
});

/* ---------- Validación ---------- */

/*
  Devuelve { ok: true } o { ok: false, motivo, mensaje }. El `type` lo informa
  el navegador a partir de la extensión, no del contenido: es un primer filtro
  barato y la prueba de verdad es decodificar (ver mi-ficha.foto.js). GIF y
  AVIF se rechazan a propósito: la lista es cerrada.
*/
function validarArchivoDeFoto(archivo) {
  const tipo = archivo && typeof archivo.type === "string" ? archivo.type.toLowerCase() : "";
  if (!TIPOS_DE_FOTO_ADMITIDOS.includes(tipo)) {
    return { ok: false, motivo: "formato", mensaje: MENSAJES_DE_FOTO.formato };
  }
  const peso = archivo ? archivo.size : NaN;
  if (typeof peso !== "number" || !Number.isFinite(peso) || peso < 0 || peso > PESO_MAXIMO_DE_FOTO_BYTES) {
    return { ok: false, motivo: "peso", mensaje: MENSAJES_DE_FOTO.peso };
  }
  return { ok: true };
}

// Una imagen sin lado (0 × 0) es una decodificación fallida disfrazada.
function validarDimensionesDeFoto(ancho, alto) {
  const valido = (lado) => typeof lado === "number" && Number.isFinite(lado) && lado > 0;
  if (!valido(ancho) || !valido(alto)) {
    return { ok: false, motivo: "ilegible", mensaje: MENSAJES_DE_FOTO.ilegible };
  }
  if (ancho > LADO_MAXIMO_DE_FOTO_PX || alto > LADO_MAXIMO_DE_FOTO_PX) {
    return { ok: false, motivo: "dimensiones", mensaje: MENSAJES_DE_FOTO.dimensiones };
  }
  return { ok: true };
}

/* ---------- Estado del encuadre ---------- */

function estadoInicialDeFoto() {
  return {
    zoom: 1,
    rotacion: 0,
    giro90: 0,
    volteoH: false,
    volteoV: false,
    desplazamientoX: 0,
    desplazamientoY: 0,
  };
}

function limitarNumeroDeFoto(valor, minimo, maximo) {
  const numero = Number.isFinite(valor) ? valor : minimo;
  return Math.min(Math.max(numero, minimo), maximo);
}

function limitarZoomDeFoto(zoom) {
  return limitarNumeroDeFoto(zoom, ZOOM_MINIMO_DE_FOTO, ZOOM_MAXIMO_DE_FOTO);
}

function limitarRotacionDeFoto(grados) {
  return limitarNumeroDeFoto(grados, ROTACION_MINIMA_DE_FOTO, ROTACION_MAXIMA_DE_FOTO);
}

// Gira 90°: +1 a la derecha (horario), -1 a la izquierda. Siempre devuelve
// un estado nuevo, con la foto otra vez centrada: el desplazamiento de antes
// apuntaba a otra orientación.
function girarFoto(estado, sentido) {
  const paso = sentido < 0 ? -1 : 1;
  return {
    ...estado,
    giro90: (((estado.giro90 + paso) % 4) + 4) % 4,
    desplazamientoX: 0,
    desplazamientoY: 0,
  };
}

// "h" voltea de izquierda a derecha EN PANTALLA y "v" de arriba abajo; con un
// giro impar el eje local está cruzado, así que se cambia el otro bit.
function voltearFoto(estado, eje) {
  const horizontal = eje === "h";
  const impar = estado.giro90 % 2 === 1;
  const cambiaH = horizontal !== impar;
  return cambiaH
    ? { ...estado, volteoH: !estado.volteoH }
    : { ...estado, volteoV: !estado.volteoV };
}

/* ---------- Geometría (L = 1) ---------- */

// Ancho y alto de la foto ya con los giros de 90° aplicados.
function dimensionesGiradasDeFoto(estado, ancho, alto) {
  return estado.giro90 % 2 === 1 ? { ancho: alto, alto: ancho } : { ancho, alto };
}

function radianesDeFoto(grados) {
  return (grados * Math.PI) / 180;
}

// Lado del cuadro, visto desde la foto, por unidad de L: |cos| + |sen|.
function cajaDelCuadroEnFoto(grados) {
  const theta = radianesDeFoto(grados);
  return Math.abs(Math.cos(theta)) + Math.abs(Math.sin(theta));
}

// Unidades de L por píxel de la fuente. Con zoom 1 y sin rotación, el lado
// corto de la foto mide exactamente 1 (cover).
function escalaDeFoto(estado, ancho, alto) {
  const girada = dimensionesGiradasDeFoto(estado, ancho, alto);
  const base = cajaDelCuadroEnFoto(estado.rotacion) / Math.min(girada.ancho, girada.alto);
  return base * limitarZoomDeFoto(estado.zoom);
}

/*
  Acota el desplazamiento para que la foto siga cubriendo el cuadro. Se
  resuelve en el marco de la foto: ahí el cuadro es un rectángulo girado y la
  holgura es independiente por eje; se acota por eje y se vuelve a pantalla.
  Devuelve { desplazamientoX, desplazamientoY }.
*/
function limitarDesplazamientoDeFoto(estado, ancho, alto) {
  const girada = dimensionesGiradasDeFoto(estado, ancho, alto);
  const escala = escalaDeFoto(estado, ancho, alto);
  const caja = cajaDelCuadroEnFoto(estado.rotacion);
  // Holgura por eje (en L); nunca negativa por la escala mínima, salvo
  // redondeo de punto flotante.
  const holguraX = Math.max((girada.ancho * escala - caja) / 2, 0);
  const holguraY = Math.max((girada.alto * escala - caja) / 2, 0);

  const theta = radianesDeFoto(estado.rotacion);
  const cos = Math.cos(theta);
  const sen = Math.sin(theta);
  const x = Number.isFinite(estado.desplazamientoX) ? estado.desplazamientoX : 0;
  const y = Number.isFinite(estado.desplazamientoY) ? estado.desplazamientoY : 0;

  // Pantalla → marco de la foto: rotación de -θ.
  const enFotoX = x * cos + y * sen;
  const enFotoY = -x * sen + y * cos;
  const acotadoX = Math.min(Math.max(enFotoX, -holguraX), holguraX);
  const acotadoY = Math.min(Math.max(enFotoY, -holguraY), holguraY);

  // Marco de la foto → pantalla: rotación de +θ.
  return {
    desplazamientoX: acotadoX * cos - acotadoY * sen,
    desplazamientoY: acotadoX * sen + acotadoY * cos,
  };
}

// Cuántos píxeles de la fuente caben en el lado del recorte.
function ladoDeRecorteEnPixelesFuente(estado, ancho, alto) {
  return 1 / escalaDeFoto(estado, ancho, alto);
}

// Nunca se agranda: si el recorte real mide 600 px de la fuente, el archivo
// mide 600, no 1024. Tope en 1024 y nunca menos de 1.
function ladoDeSalidaDeFoto(ladoRecorteEnPixelesFuente) {
  const lado = Math.floor(ladoRecorteEnPixelesFuente);
  if (!Number.isFinite(lado)) return 1;
  return Math.max(1, Math.min(LADO_MAXIMO_DE_SALIDA_PX, lado));
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    TIPOS_DE_FOTO_ADMITIDOS,
    PESO_MAXIMO_DE_FOTO_BYTES,
    LADO_MAXIMO_DE_FOTO_PX,
    LADO_MAXIMO_DE_SALIDA_PX,
    CALIDAD_WEBP_DE_FOTO,
    CALIDAD_JPEG_DE_FOTO,
    ZOOM_MINIMO_DE_FOTO,
    ZOOM_MAXIMO_DE_FOTO,
    ZOOM_PASO_DE_FOTO,
    ROTACION_MINIMA_DE_FOTO,
    ROTACION_MAXIMA_DE_FOTO,
    ROTACION_PASO_DE_FOTO,
    PASO_DE_FLECHA_DE_FOTO,
    MENSAJES_DE_FOTO,
    validarArchivoDeFoto,
    validarDimensionesDeFoto,
    estadoInicialDeFoto,
    limitarZoomDeFoto,
    limitarRotacionDeFoto,
    girarFoto,
    voltearFoto,
    dimensionesGiradasDeFoto,
    escalaDeFoto,
    limitarDesplazamientoDeFoto,
    ladoDeRecorteEnPixelesFuente,
    ladoDeSalidaDeFoto,
  });
}
