/*
  El editor de foto de "Mi ficha": la lógica pura de
  mi-ficha.foto.logica.js (validación, estado del encuadre y geometría del
  recorte) y, leyendo el fuente, el marcado del diálogo en el index.html. El
  dibujo en canvas y los eventos de puntero viven en mi-ficha.foto.js y
  dependen del navegador: acá no se ejercitan.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CARPETA = "src/app/features/colaboradores/mi-ficha";
const read = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

const HTML = read(`${CARPETA}/index.html`);
const FOTO_JS = read(`${CARPETA}/mi-ficha.foto.js`);
const FOTO_LOGICA = read(`${CARPETA}/mi-ficha.foto.logica.js`);

const {
  TIPOS_DE_FOTO_ADMITIDOS,
  PESO_MAXIMO_DE_FOTO_BYTES,
  LADO_MAXIMO_DE_FOTO_PX,
  LADO_MAXIMO_DE_SALIDA_PX,
  CALIDAD_WEBP_DE_FOTO,
  CALIDAD_JPEG_DE_FOTO,
  MENSAJES_DE_FOTO,
  validarArchivoDeFoto,
  validarDimensionesDeFoto,
  estadoInicialDeFoto,
  girarFoto,
  voltearFoto,
  escalaDeFoto,
  dimensionesGiradasDeFoto,
  limitarDesplazamientoDeFoto,
  ladoDeRecorteEnPixelesFuente,
  ladoDeSalidaDeFoto,
} = require(`../${CARPETA}/mi-ficha.foto.logica.js`);

const MB = 1024 * 1024;

/* ---------- Validación del archivo ---------- */

test("JPEG and PNG up to 20 MB are accepted; WebP is output only", () => {
  for (const type of ["image/jpeg", "image/png"]) {
    assert.deepEqual(validarArchivoDeFoto({ type, size: 1 * MB }), { ok: true }, type);
  }
  assert.deepEqual(validarArchivoDeFoto({ type: "image/jpeg", size: 20 * MB }), { ok: true });
  assert.deepEqual([...TIPOS_DE_FOTO_ADMITIDOS], ["image/jpeg", "image/png"]);
});

test("WebP, GIF, AVIF and anything that is not JPEG or PNG are rejected with the format message", () => {
  for (const type of ["image/webp", "image/gif", "image/avif", "image/svg+xml", "image/heic", "application/pdf", "text/plain", ""]) {
    const veredicto = validarArchivoDeFoto({ type, size: 1000 });
    assert.equal(veredicto.ok, false, type);
    assert.equal(veredicto.motivo, "formato", type);
    assert.equal(veredicto.mensaje, "Ese formato no se admite. Usa JPG o PNG.");
  }
  assert.equal(validarArchivoDeFoto(null).motivo, "formato");
  assert.equal(validarArchivoDeFoto({}).motivo, "formato");
});

test("a file over 20 MB is rejected with the weight message; exactly 20 MB still fits", () => {
  const veredicto = validarArchivoDeFoto({ type: "image/png", size: 20 * MB + 1 });
  assert.equal(veredicto.ok, false);
  assert.equal(veredicto.motivo, "peso");
  assert.equal(veredicto.mensaje, "La foto pesa más de 20 MB. Elige una más ligera.");
  assert.equal(PESO_MAXIMO_DE_FOTO_BYTES, 20 * MB);
  assert.equal(validarArchivoDeFoto({ type: "image/png", size: 20 * MB }).ok, true);
});

test("a size that is not a number is not trusted", () => {
  for (const size of [undefined, NaN, -1, "10"]) {
    assert.equal(validarArchivoDeFoto({ type: "image/png", size }).motivo, "peso", String(size));
  }
});

test("the format is checked before the weight", () => {
  assert.equal(validarArchivoDeFoto({ type: "image/gif", size: 30 * MB }).motivo, "formato");
});

/* ---------- Validación de las dimensiones ---------- */

test("each side may be up to 8000 px; one more is rejected with the size message", () => {
  assert.equal(LADO_MAXIMO_DE_FOTO_PX, 8000);
  assert.deepEqual(validarDimensionesDeFoto(8000, 8000), { ok: true });
  assert.deepEqual(validarDimensionesDeFoto(1, 1), { ok: true });

  for (const [ancho, alto] of [[8001, 100], [100, 8001], [9000, 9000]]) {
    const veredicto = validarDimensionesDeFoto(ancho, alto);
    assert.equal(veredicto.ok, false, `${ancho}x${alto}`);
    assert.equal(veredicto.motivo, "dimensiones");
    assert.equal(veredicto.mensaje, "La foto mide más de 8000 px de lado. Elige una más pequeña.");
  }
});

test("an image without a usable side is the unreadable-image message, not a size error", () => {
  for (const [ancho, alto] of [[0, 0], [0, 100], [100, 0], [-5, 10], [NaN, 10], [undefined, undefined]]) {
    const veredicto = validarDimensionesDeFoto(ancho, alto);
    assert.equal(veredicto.ok, false, `${ancho}x${alto}`);
    assert.equal(veredicto.motivo, "ilegible");
    assert.equal(
      veredicto.mensaje,
      "No pudimos abrir esa imagen. Si es una foto de iPhone, expórtala como JPG.",
    );
  }
});

/* ---------- Giros y volteos ---------- */

test("turning wraps around 0..3 in both directions", () => {
  let estado = estadoInicialDeFoto();
  const vistos = [];
  for (let i = 0; i < 5; i += 1) {
    estado = girarFoto(estado, 1);
    vistos.push(estado.giro90);
  }
  assert.deepEqual(vistos, [1, 2, 3, 0, 1]);

  assert.equal(girarFoto(estadoInicialDeFoto(), -1).giro90, 3);
  assert.equal(girarFoto(girarFoto(estadoInicialDeFoto(), -1), -1).giro90, 2);
});

test("turning returns a new state, recenters the photo and keeps the rest", () => {
  const antes = { ...estadoInicialDeFoto(), zoom: 2, rotacion: 12, volteoH: true, desplazamientoX: 0.3, desplazamientoY: -0.2 };
  const despues = girarFoto(antes, 1);

  assert.notEqual(despues, antes);
  assert.equal(antes.giro90, 0, "el estado de entrada no se toca");
  assert.equal(despues.desplazamientoX, 0);
  assert.equal(despues.desplazamientoY, 0);
  assert.equal(despues.zoom, 2);
  assert.equal(despues.rotacion, 12);
  assert.equal(despues.volteoH, true);
});

test("flipping toggles and a second flip undoes the first", () => {
  const base = estadoInicialDeFoto();
  const h = voltearFoto(base, "h");
  assert.equal(h.volteoH, true);
  assert.equal(h.volteoV, false);
  assert.equal(voltearFoto(h, "h").volteoH, false);

  const v = voltearFoto(base, "v");
  assert.equal(v.volteoV, true);
  assert.equal(v.volteoH, false);
  assert.equal(voltearFoto(v, "v").volteoV, false);
  assert.equal(base.volteoH, false, "el estado de entrada no se toca");
});

test("a horizontal flip stays horizontal on screen after an odd turn", () => {
  const girada = girarFoto(estadoInicialDeFoto(), 1);
  const volteada = voltearFoto(girada, "h");
  // El eje local está cruzado con el de pantalla: el bit que cambia es el otro.
  assert.equal(volteada.volteoV, true);
  assert.equal(volteada.volteoH, false);

  const vertical = voltearFoto(girada, "v");
  assert.equal(vertical.volteoH, true);
  assert.equal(vertical.volteoV, false);

  // Con el giro de 180° los ejes vuelven a coincidir.
  assert.equal(voltearFoto(girarFoto(girada, 1), "h").volteoH, true);
});

/* ---------- Geometría ---------- */

test("at zoom 1 without rotation the shorter side of the photo fits the crop square exactly", () => {
  const estado = estadoInicialDeFoto();
  assert.ok(Math.abs(escalaDeFoto(estado, 4000, 3000) * 3000 - 1) < 1e-12);
  assert.ok(Math.abs(escalaDeFoto(estado, 3000, 4000) * 3000 - 1) < 1e-12);
  // Con un giro de 90° el lado corto sigue siendo el mismo.
  const girada = girarFoto(estado, 1);
  assert.ok(Math.abs(escalaDeFoto(girada, 4000, 3000) * 3000 - 1) < 1e-12);
  assert.deepEqual(dimensionesGiradasDeFoto(girada, 4000, 3000), { ancho: 3000, alto: 4000 });
});

/*
  La prueba de cobertura, hecha por fuera de la implementación: se lleva cada
  esquina del cuadro al marco de la foto (restando el desplazamiento y
  deshaciendo la rotación libre) y tiene que caer dentro del rectángulo de la
  foto ya escalado.
*/
function cuadroCubierto(estado, ancho, alto) {
  const { desplazamientoX, desplazamientoY } = limitarDesplazamientoDeFoto(estado, ancho, alto);
  const girada = dimensionesGiradasDeFoto(estado, ancho, alto);
  const escala = escalaDeFoto(estado, ancho, alto);
  const theta = (estado.rotacion * Math.PI) / 180;
  const margen = 1e-9;
  const huecos = [];
  for (const [px, py] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const qx = px - desplazamientoX;
    const qy = py - desplazamientoY;
    const fx = qx * Math.cos(theta) + qy * Math.sin(theta);
    const fy = -qx * Math.sin(theta) + qy * Math.cos(theta);
    if (Math.abs(fx) > (girada.ancho * escala) / 2 + margen) huecos.push([px, py, "x"]);
    if (Math.abs(fy) > (girada.alto * escala) / 2 + margen) huecos.push([px, py, "y"]);
  }
  return huecos;
}

test("whatever the offset, the photo keeps covering the crop square at several zooms, rotations and turns", () => {
  const fotos = [[4000, 3000], [3000, 4000], [1000, 1000], [8000, 500]];
  const desplazamientos = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [5, 5], [-5, -5], [0.13, -0.27]];
  let casos = 0;
  for (const [ancho, alto] of fotos) {
    for (const zoom of [1, 1.3, 2, 3]) {
      for (const rotacion of [-45, -30, -7, 0, 12, 45]) {
        for (const giro90 of [0, 1, 2, 3]) {
          for (const [desplazamientoX, desplazamientoY] of desplazamientos) {
            const estado = { ...estadoInicialDeFoto(), zoom, rotacion, giro90, desplazamientoX, desplazamientoY };
            assert.deepEqual(
              cuadroCubierto(estado, ancho, alto),
              [],
              `hueco con ${ancho}x${alto} zoom ${zoom} rotación ${rotacion} giro ${giro90} desplazamiento ${desplazamientoX},${desplazamientoY}`,
            );
            casos += 1;
          }
        }
      }
    }
  }
  assert.ok(casos > 1000, "premisa: se recorrieron todas las combinaciones");
});

test("an offset that already fits is left exactly as it is", () => {
  const estado = { ...estadoInicialDeFoto(), zoom: 3, desplazamientoX: 0.2, desplazamientoY: -0.15 };
  const resultado = limitarDesplazamientoDeFoto(estado, 4000, 3000);
  assert.ok(Math.abs(resultado.desplazamientoX - 0.2) < 1e-12);
  assert.ok(Math.abs(resultado.desplazamientoY + 0.15) < 1e-12);
});

test("at zoom 1 a landscape photo moves sideways but not up or down", () => {
  const estado = { ...estadoInicialDeFoto(), desplazamientoX: 5, desplazamientoY: 5 };
  const resultado = limitarDesplazamientoDeFoto(estado, 4000, 3000);
  // 4000x3000: sobra (4/3 - 1) / 2 del lado a cada lado, y nada en vertical.
  assert.ok(Math.abs(resultado.desplazamientoX - (4 / 3 - 1) / 2) < 1e-12);
  assert.equal(resultado.desplazamientoY, 0);
});

test("a square photo at zoom 1 without rotation cannot move at all", () => {
  const resultado = limitarDesplazamientoDeFoto({ ...estadoInicialDeFoto(), desplazamientoX: 1, desplazamientoY: -1 }, 2000, 2000);
  assert.equal(resultado.desplazamientoX, 0);
  assert.equal(resultado.desplazamientoY, 0);
});

test("a broken offset is treated as centered instead of spreading NaN", () => {
  const resultado = limitarDesplazamientoDeFoto({ ...estadoInicialDeFoto(), zoom: 2, desplazamientoX: NaN, desplazamientoY: undefined }, 4000, 3000);
  assert.equal(resultado.desplazamientoX, 0);
  assert.equal(resultado.desplazamientoY, 0);
});

test("rotating zooms in just enough that the corners stay covered", () => {
  const sinRotar = escalaDeFoto(estadoInicialDeFoto(), 3000, 3000);
  const rotada = escalaDeFoto({ ...estadoInicialDeFoto(), rotacion: 45 }, 3000, 3000);
  // A 45° el cuadro visto desde la foto mide raíz de 2 veces su lado.
  assert.ok(Math.abs(rotada / sinRotar - Math.SQRT2) < 1e-9);
});

/* ---------- Tamaño de salida ---------- */

test("the output never grows past the real crop: no upscaling", () => {
  assert.equal(ladoDeSalidaDeFoto(600), 600);
  assert.equal(ladoDeSalidaDeFoto(600.9), 600);
  assert.equal(ladoDeSalidaDeFoto(1023.99), 1023);
  assert.equal(ladoDeSalidaDeFoto(1), 1);
});

test("the output is capped at 1024 px", () => {
  assert.equal(LADO_MAXIMO_DE_SALIDA_PX, 1024);
  assert.equal(ladoDeSalidaDeFoto(1024), 1024);
  assert.equal(ladoDeSalidaDeFoto(1025), 1024);
  assert.equal(ladoDeSalidaDeFoto(8000), 1024);
});

test("the output side is never zero or broken", () => {
  for (const lado of [0, 0.4, -10, NaN, Infinity, undefined]) {
    const salida = ladoDeSalidaDeFoto(lado);
    assert.ok(Number.isInteger(salida) && salida >= 1 && salida <= 1024, `${lado} -> ${salida}`);
  }
});

test("the crop side in source pixels shrinks as the zoom grows, and feeds the output side", () => {
  const sinZoom = ladoDeRecorteEnPixelesFuente(estadoInicialDeFoto(), 4000, 3000);
  const conZoom = ladoDeRecorteEnPixelesFuente({ ...estadoInicialDeFoto(), zoom: 3 }, 4000, 3000);
  assert.ok(Math.abs(sinZoom - 3000) < 1e-9);
  assert.ok(Math.abs(conZoom - 1000) < 1e-9);
  assert.equal(ladoDeSalidaDeFoto(sinZoom), 1024);
  assert.equal(ladoDeSalidaDeFoto(conZoom), 1000, "con zoom 3 el recorte real mide 1000 px: no se agranda");
});

test("the export quality is WebP at 0.92", () => {
  assert.equal(CALIDAD_WEBP_DE_FOTO, 0.92);
  assert.match(FOTO_JS, /\}, "image\/webp", CALIDAD_WEBP_DE_FOTO\);/);
});

test("when toBlob does not hand back a WebP (Safari) the export falls back to JPEG at 0.88", () => {
  assert.equal(CALIDAD_JPEG_DE_FOTO, 0.88);
  assert.match(FOTO_JS, /webp && webp\.type === "image\/webp"/);
  assert.match(FOTO_JS, /"image\/jpeg",\s+CALIDAD_JPEG_DE_FOTO/);
  assert.match(FOTO_JS, /jpeg && jpeg\.type === "image\/jpeg" \? jpeg : null/);
});

/* ---------- Fuentes ---------- */

test("the pure logic touches no DOM and exports through the module guard", () => {
  const sinComentarios = FOTO_LOGICA
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(sinComentarios, /\b(?:document|window|localStorage|fetch|canvas|Image)\b/);
  assert.match(FOTO_LOGICA, /if \(typeof module === "object" && module\.exports\) \{/);
});

test("the photo wiring has no network code of its own: it only calls the functions mi-ficha.js hands it", () => {
  const sinComentarios = FOTO_JS
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(sinComentarios, /\b(?:fetch|XMLHttpRequest|sendBeacon|supabase|supabaseClient)\b|\.upload\(|\.storage\b/);
  assert.doesNotMatch(sinComentarios, /innerHTML|insertAdjacentHTML|outerHTML/);
});

/* ---------- Marcado del diálogo ---------- */

const MARCADO = HTML.replace(/<!--[\s\S]*?-->/g, "");
const etiqueta = (id) => {
  const encontrada = MARCADO.match(new RegExp(`<\\w+\\b[^>]*\\sid="${id}"[^>]*>`));
  assert.ok(encontrada, `falta #${id}`);
  return encontrada[0];
};
const atributo = (marca, nombre) => marca.match(new RegExp(`\\s${nombre}="([^"]*)"`))?.[1] ?? null;

test("the four tool buttons are named by an aria-label and their icons are hidden from assistive tech", () => {
  const botones = {
    editorFotoGirarIzq: "Girar a la izquierda",
    editorFotoGirarDer: "Girar a la derecha",
    editorFotoVoltearH: "Voltear horizontal",
    editorFotoVoltearV: "Voltear vertical",
  };
  for (const [id, nombre] of Object.entries(botones)) {
    assert.equal(atributo(etiqueta(id), "aria-label"), nombre, id);
    const cuerpo = MARCADO.match(new RegExp(`<button\\b[^>]*\\sid="${id}"[^>]*>([\\s\\S]*?)</button>`));
    assert.ok(cuerpo, `#${id} no es un botón`);
    assert.match(cuerpo[1], /<svg\b[^>]*\saria-hidden="true"/, `el icono de #${id} no está oculto`);
    assert.doesNotMatch(cuerpo[1].replace(/<svg[\s\S]*?<\/svg>/g, ""), /\S/, `#${id} lleva texto además del icono`);
  }
});

test("the file input accepts exactly JPEG and PNG", () => {
  const entrada = etiqueta("editorFotoArchivo");
  assert.match(entrada, /^<input\b/);
  assert.equal(atributo(entrada, "type"), "file");
  assert.equal(atributo(entrada, "accept"), "image/jpeg,image/png");
});

test("the dialog is labelled by its title, has a close button and two steps", () => {
  const dialogo = etiqueta("editorFoto");
  assert.match(dialogo, /^<dialog\b/);
  assert.equal(atributo(dialogo, "aria-labelledby"), "editorFotoTitulo");
  etiqueta("editorFotoTitulo");
  assert.equal(atributo(etiqueta("editorFotoCerrar"), "aria-label"), "Cerrar");
  etiqueta("editorFotoPasoElegir");
  assert.match(etiqueta("editorFotoPasoEditar"), /\shidden\b/, "el paso de editar arranca oculto");
});

test("the crop canvas is focusable and explains its keys", () => {
  const lienzo = etiqueta("editorFotoLienzo");
  assert.match(lienzo, /^<canvas\b/);
  assert.equal(atributo(lienzo, "tabindex"), "0");
  assert.match(atributo(lienzo, "aria-label"), /flechas.*\+ o −/);
});

test("zoom runs from 1 to 3 and rotation from -45 to 45, each with its own output", () => {
  const zoom = etiqueta("editorFotoZoom");
  assert.deepEqual(
    ["type", "min", "max", "step"].map((nombre) => atributo(zoom, nombre)),
    ["range", "1", "3", "0.1"],
  );
  const rotar = etiqueta("editorFotoRotar");
  assert.deepEqual(
    ["type", "min", "max", "step"].map((nombre) => atributo(rotar, nombre)),
    ["range", "-45", "45", "1"],
  );
  assert.match(etiqueta("editorFotoZoomValor"), /^<output\b/);
  assert.match(etiqueta("editorFotoRotarValor"), /^<output\b/);
  assert.match(MARCADO, /<label\b[^>]*\sfor="editorFotoZoom"[^>]*>Zoom<\/label>/);
  assert.match(MARCADO, /<label\b[^>]*\sfor="editorFotoRotar"[^>]*>Rotar<\/label>/);
});

test("the notices live in a polite live region inside the dialog", () => {
  const aviso = etiqueta("editorFotoAviso");
  assert.equal(atributo(aviso, "aria-live"), "polite");
  const dialogo = MARCADO.match(/<dialog\b[\s\S]*?<\/dialog>/)[0];
  assert.ok(dialogo.includes('id="editorFotoAviso"'));
});

test("the dialog never uses the words Filter or Adjust (nor their Spanish forms)", () => {
  const visible = MARCADO.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.doesNotMatch(visible, /filter|adjust|filtro|ajustar/i);
  assert.doesNotMatch(FOTO_JS, /filter|adjust|filtro|ajustar/i);
});

test("the photo copy is written in tuteo, never voseo", () => {
  const texto = MARCADO.replace(/<[^>]+>/g, " ");
  for (const tuteo of [
    "Arrastra tu foto aquí",
    "Subir foto",
    "Elegir archivo",
    "Elegir otra",
    "Guardar cambios",
    "Cambiar",
    "Quitar",
    "JPG o PNG · hasta 20 MB · cualquier proporción",
    "Tu foto se publica en Colaboradores en cuanto la guardas.",
  ]) {
    assert.ok(texto.includes(tuteo), `falta «${tuteo}»`);
  }
  // El título del segundo paso lo pone el script al cambiar de paso.
  assert.ok(FOTO_JS.includes('TITULO_EDITAR = "Editar foto"'));
  assert.ok(MENSAJES_DE_FOTO.formato.includes("Usa JPG"));
  assert.ok(MENSAJES_DE_FOTO.peso.includes("Elige una más ligera"));

  const todo = (texto + " " + Object.values(MENSAJES_DE_FOTO).join(" ") + " " + FOTO_JS.replace(/\/\*[\s\S]*?\*\//g, "")).toLowerCase();
  const palabrasTodas = todo.split(/[^\p{L}]+/u);
  for (const voseo of ["arrastrá", "elegí", "subí", "usá", "podés", "tenés", "cambiá", "quitá", "guardá", "seleccioná", "soltá", "probá"]) {
    assert.ok(!palabrasTodas.includes(voseo), `el editor de foto dice «${voseo}»`);
  }
});

test("the photo group offers Subir foto first, and Cambiar and Quitar only once there is a photo", () => {
  assert.match(etiqueta("miFichaFotoSubir"), /^<button\b/);
  assert.doesNotMatch(etiqueta("miFichaFotoSubir"), /\shidden\b/);
  assert.match(etiqueta("miFichaFotoCambiar"), /\shidden\b/);
  assert.match(etiqueta("miFichaFotoQuitar"), /\shidden\b/);
  // Es el primer grupo del formulario, antes de Nombre.
  const form = MARCADO.slice(MARCADO.indexOf('id="formMiFicha"'));
  assert.ok(form.indexOf('id="miFichaFoto"') < form.indexOf('id="miFichaNombre"'));
});

test("the page loads the photo logic before its wiring, and both before mi-ficha.js", () => {
  const posicion = (archivo) => {
    const indice = HTML.indexOf(`<script src="/app/features/colaboradores/mi-ficha/${archivo}"></script>`);
    assert.notEqual(indice, -1, `falta ${archivo}`);
    return indice;
  };
  assert.ok(posicion("mi-ficha.foto.logica.js") < posicion("mi-ficha.foto.js"));
  assert.ok(posicion("mi-ficha.foto.js") < posicion("mi-ficha.js"));
});

/* ---------- La foto se publica en el acto (Fase II) ---------- */

test("the photo group has an error line next to the buttons, announced as an alert and hidden until needed", () => {
  const error = etiqueta("miFichaFotoError");
  assert.match(error, /^<p\b/);
  assert.equal(atributo(error, "role"), "alert");
  assert.match(error, /\shidden\b/);
  assert.ok(atributo(error, "class").split(/\s+/).includes("mi-ficha__error"));
  // Dentro del grupo de la foto, no suelta al final del formulario.
  const grupo = MARCADO.slice(MARCADO.indexOf('id="miFichaFoto"'), MARCADO.indexOf('id="miFichaNombre"'));
  assert.ok(grupo.includes('id="miFichaFotoError"'));
});

test("the page no longer says the photo is not saved", () => {
  const texto = MARCADO.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(texto, /Por ahora no se guarda|al recargar la página desaparece/);
  assert.doesNotMatch(HTML + FOTO_JS, /Fase I\b|FASE I\b/);
});

test("mi-ficha.foto.js exposes a factory that returns fijar, like the tag editor, and no longer keeps a local copy of the photo", () => {
  assert.match(FOTO_JS, /^function crearEditorDeFoto\(\{ subir, quitar \}\) \{/m);
  assert.match(FOTO_JS, /return Object\.freeze\(\{ fijar \}\);/);
  assert.doesNotMatch(FOTO_JS.replace(/\/\*[\s\S]*?\*\//g, ""), /fotoRecortada|urlDeVista/);
});

test("Mi ficha does not need colaboradores.service.js: ficha.service.js builds the photo URL itself", () => {
  const scripts = [...MARCADO.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map(([, src]) => src);
  assert.ok(scripts.includes("/app/core/colaboradores/ficha.service.js"));
  assert.ok(!scripts.includes("/app/core/colaboradores/colaboradores.service.js"));
  assert.match(read("src/app/core/colaboradores/ficha.service.js"), /^function urlDeFotoDeMiFicha\(ruta\)/m);
});

/* ---------- Migración 0050 ---------- */

const MIGRACION = read("supabase/migrations/0050_foto_colaborador.sql");
// Sin comentarios: las aserciones son sobre el SQL que se ejecuta, no sobre lo
// que la cabecera explica (que menciona SELECT, UPDATE y otras palabras).
const SQL_0050 = MIGRACION.replace(/--.*$/gm, "");
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUTA_RE = `^${UUID_RE}/${UUID_RE}\\.webp$`;
// La 0051 amplía la extensión: el SQL la escribe con grupo de captura y los
// servicios JS con grupo sin captura.
const RUTA_RE_0051 = `^${UUID_RE}/${UUID_RE}\\.(webp|jpg)$`;
const RUTA_RE_0051_SERVICIO = `^${UUID_RE}/${UUID_RE}\\.(?:webp|jpg)$`;

test("0050 adds a nullable foto_path column, idempotently", () => {
  assert.match(SQL_0050, /alter table public\.fichas_colaborador\s+add column if not exists foto_path text;/);
  assert.doesNotMatch(SQL_0050, /foto_path text\s+not null/);
});

test("0050 checks that foto_path is <uuid>/<uuid>.webp and that its folder is the card's own id", () => {
  assert.match(SQL_0050, /drop constraint if exists fichas_colaborador_foto_path_valida/);
  const check = SQL_0050.match(/add constraint fichas_colaborador_foto_path_valida check \(([\s\S]*?)\n  \);/);
  assert.ok(check, "falta el CHECK");
  assert.ok(check[1].includes(`foto_path ~ '${RUTA_RE}'`), "la regex del CHECK");
  assert.match(check[1], /split_part\(foto_path, '\/', 1\) = id::text/);
});

test("0050 grants update on foto_path but not insert, and keeps the rest of the 0041 grant", () => {
  const COLUMNAS_0041 = "puesto, sector, ubicacion, herramientas, habilidades, idiomas,\\s+empresa, empresa_enlace, modalidad_trabajo, anio_inicio, bio,\\s+linkedin, github, correo";
  const insert = SQL_0050.match(/grant insert \(([^)]*)\)/);
  const update = SQL_0050.match(/grant update \(([^)]*)\)/);
  assert.ok(insert && update, "faltan los grants");
  assert.match(insert[1], new RegExp(`^id, ${COLUMNAS_0041}$`));
  assert.doesNotMatch(insert[1], /foto_path/);
  assert.match(update[1], new RegExp(`^${COLUMNAS_0041}, foto_path$`));
  assert.match(SQL_0050, /grant (?:insert|update) \([^)]*\)\s+on table public\.fichas_colaborador to authenticated;/);
});

test("0050 recreates listar_colaboradores() with foto_path at the end and the same security as before", () => {
  assert.match(SQL_0050, /drop function if exists public\.listar_colaboradores\(\);/);
  const retorno = SQL_0050.match(/returns table \(([\s\S]*?)\)\s+language sql/);
  assert.ok(retorno, "falta el RETURNS TABLE");
  const columnas = retorno[1].split(",").map((c) => c.trim().split(/\s+/)[0]);
  assert.equal(columnas.at(-1), "foto_path");
  assert.equal(columnas.at(-2), "correo");
  assert.match(SQL_0050, /f\.correo,\s+f\.foto_path\s+from public\.perfiles p/);
  assert.match(SQL_0050, /language sql\s+stable\s+security definer\s+set search_path = ''/);
  assert.match(SQL_0050, /revoke all on function public\.listar_colaboradores\(\) from public;/);
  assert.match(SQL_0050, /grant execute on function public\.listar_colaboradores\(\) to anon, authenticated;/);
});

test("0050 creates a public, 1 MB, webp-only bucket and re-applies those settings if it already exists", () => {
  assert.match(SQL_0050, /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s+values \(\s+'colaboradores-fotos',\s+'colaboradores-fotos',\s+true,\s+1048576,\s+array\['image\/webp'\]\s+\)/);
  assert.match(SQL_0050, /on conflict \(id\) do update set\s+public = true,\s+file_size_limit = 1048576,\s+allowed_mime_types = array\['image\/webp'\];/);
});

test("0050 lets a marked collaborator insert and delete only in their own folder, with the exact route shape", () => {
  for (const [politica, operacion, clausula] of [
    ["colaboradores_fotos_insert", "insert", "with check"],
    ["colaboradores_fotos_delete", "delete", "using"],
  ]) {
    assert.match(SQL_0050, new RegExp(`drop policy if exists ${politica} on storage\\.objects;`));
    const cuerpo = SQL_0050.match(new RegExp(`create policy ${politica}\\s+on storage\\.objects for ${operacion} to authenticated\\s+${clausula} \\(([\\s\\S]*?)\\n  \\);`));
    assert.ok(cuerpo, `falta la policy ${politica}`);
    assert.match(cuerpo[1], /bucket_id = 'colaboradores-fotos'/);
    assert.ok(cuerpo[1].includes(`name ~ '${RUTA_RE}'`), `${politica}: la regex de la ruta`);
    assert.match(cuerpo[1], /split_part\(name, '\/', 1\) = auth\.uid\(\)::text/);
    assert.match(cuerpo[1], /public\.es_colaborador\(\)/);
  }
});

test("0050's only SELECT policy is for the caller's own folder: nobody lists the bucket, and DELETE can see the rows it deletes", () => {
  const politicas = [...SQL_0050.matchAll(/create policy (\w+)\s+on storage\.objects for (\w+)/g)].map(([, nombre, operacion]) => [nombre, operacion]);
  assert.deepEqual(politicas, [
    ["colaboradores_fotos_insert", "insert"],
    ["colaboradores_fotos_delete", "delete"],
    ["colaboradores_fotos_select", "select"],
  ]);
  const seleccion = SQL_0050.match(/create policy colaboradores_fotos_select\s+on storage\.objects for select to authenticated\s+using \(([\s\S]*?)\n  \);/);
  assert.ok(seleccion, "la policy de SELECT es sólo para authenticated");
  assert.match(seleccion[1], /bucket_id = 'colaboradores-fotos'/);
  assert.match(seleccion[1], /split_part\(name, '\/', 1\) = auth\.uid\(\)::text/);
  // Ni UPDATE (cada foto es un objeto nuevo) ni nada para anon o para todos.
  assert.doesNotMatch(SQL_0050, /for (update|all)\b/i);
  assert.doesNotMatch(SQL_0050, /storage\.objects[^;]*to (anon|public)\b/);
  // La razón de que exista queda escrita donde la va a leer quien la quiera quitar.
  assert.match(MIGRACION, /borra CERO filas/);
});

test("0050 has a preflight with the usual message style and runs in one transaction", () => {
  assert.match(SQL_0050, /^\s*begin;/m);
  assert.match(SQL_0050, /commit;\s*$/);
  for (const requisito of ["public.fichas_colaborador", "public.listar_colaboradores()", "public.es_colaborador()", "storage.buckets", "client_encoding UTF8"]) {
    assert.match(MIGRACION, new RegExp(`0050 preflight failed: [^']*${requisito.replace(/[().]/g, "\\$&")}`), requisito);
  }
});

test("0050 explains why a photo gets a new name every time and that the bucket is public", () => {
  assert.match(MIGRACION, /max-age=3600/);
  assert.match(MIGRACION, /CONSENTIMIENTO/);
  assert.match(MIGRACION, /<user_id>\/<uuid>\.webp/);
});

test("the 0051 route regex, the CHECK and both services agree on the same shape", () => {
  const re = new RegExp(RUTA_RE_0051);
  const base = "5f1a7c2e-90b4-4d6e-b3a8-2e7d41c9f0a6/9b2c1f60-5d3a-4e8b-8a47-0c6f1d2e3a4b";
  assert.ok(re.test(`${base}.webp`));
  assert.ok(re.test(`${base}.jpg`));
  assert.ok(!re.test(`${base}.png`));
  assert.ok(!re.test(`${base}.jpeg`));
  for (const archivo of ["src/app/core/colaboradores/colaboradores.service.js", "src/app/core/colaboradores/ficha.service.js"]) {
    const fuente = read(archivo);
    const patron = fuente.match(/const PATRON_RUTA_FOTO_\w+ = \/(.+)\/;/);
    assert.ok(patron, `${archivo}: falta el patrón`);
    assert.equal(patron[1].replace(/\\\//g, "/").replace(/\\\./g, "\\."), RUTA_RE_0051_SERVICIO, archivo);
  }
});

/* ---------- Migración 0051 ---------- */

const MIGRACION_0051 = read("supabase/migrations/0051_foto_colaborador_jpeg.sql");
const SQL_0051 = MIGRACION_0051.replace(/--.*$/gm, "");

test("0051 widens the foto_path CHECK to .webp or .jpg and keeps the folder rule", () => {
  assert.match(SQL_0051, /drop constraint if exists fichas_colaborador_foto_path_valida/);
  const check = SQL_0051.match(/add constraint fichas_colaborador_foto_path_valida check \(([\s\S]*?)\n  \);/);
  assert.ok(check, "falta el CHECK");
  assert.ok(check[1].includes(`foto_path ~ '${RUTA_RE_0051}'`), "la regex del CHECK");
  assert.match(check[1], /split_part\(foto_path, '\/', 1\) = id::text/);
  assert.match(MIGRACION_0051, /<user_id>\/<uuid>\.jpg/);
});

test("0051 lets the bucket take webp and jpeg at the same 1 MB, idempotently", () => {
  assert.match(SQL_0051, /values \(\s+'colaboradores-fotos',\s+'colaboradores-fotos',\s+true,\s+1048576,\s+array\['image\/webp', 'image\/jpeg'\]\s+\)/);
  assert.match(SQL_0051, /on conflict \(id\) do update set\s+public = true,\s+file_size_limit = 1048576,\s+allowed_mime_types = array\['image\/webp', 'image\/jpeg'\];/);
});

test("0051 recreates the insert and delete policies with the wider extension and leaves select alone", () => {
  for (const nombre of ["insert", "delete"]) {
    assert.match(SQL_0051, new RegExp(`drop policy if exists colaboradores_fotos_${nombre} on storage\\.objects;\\s+create policy colaboradores_fotos_${nombre}`));
  }
  assert.equal(SQL_0051.split(`name ~ '${RUTA_RE_0051}'`).length - 1, 2, "insert y delete");
  assert.doesNotMatch(SQL_0051, /colaboradores_fotos_select/);
  assert.match(SQL_0051, /split_part\(name, '\/', 1\) = auth\.uid\(\)::text\s+and public\.es_colaborador\(\)/);
  assert.match(SQL_0051, /commit;\s*$/);
});
