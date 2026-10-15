/*
  Cableado del editor de foto de "Mi ficha" (2026-10-13): el diálogo de dos
  pasos (elegir y encuadrar), el dibujo en canvas, la exportación y la vista
  previa redonda.

  LA FOTO SE PUBLICA EN EL ACTO. «Guardar cambios» exporta el recorte (un Blob
  WebP; la ENTRADA es sólo JPG o PNG) y se lo entrega a `subir`, y «Quitar»
  llama a `quitar`: las dos funciones las pone mi-ficha.js (que conoce la
  sesión) y salen de core/colaboradores/ficha.service.js. Este archivo no tiene
  código de red: sólo sabe qué hacer con lo que esas funciones contesten. Es
  independiente de «Guardar ficha», que nunca toca la foto.

  `crearEditorDeFoto` devuelve `{ fijar }`: mi-ficha.js lo llama al cargar la
  ficha con la foto que ya estaba guardada, para que la vista previa la
  muestre tras recargar.

  La validación y la geometría (qué cubre el recorte, cuánto puede moverse la
  foto, de qué tamaño sale el archivo) están en mi-ficha.foto.logica.js, que se
  carga antes y deja sus funciones en el ámbito global. Acá sólo hay DOM:
  eventos, canvas y el estado del diálogo.

  El dibujo de la vista previa y el de la exportación son LA MISMA función
  (dibujarEncuadre) sobre un lienzo de distinto lado: así el archivo sale
  encuadrado exactamente como se vio.
*/

function crearEditorDeFoto({ subir, quitar }) {
  const dialogo = document.getElementById("editorFoto");
  if (!dialogo || typeof estadoInicialDeFoto !== "function") return null;

  const porId = (id) => document.getElementById(id);
  const titulo = porId("editorFotoTitulo");
  const aviso = porId("editorFotoAviso");
  const pasoElegir = porId("editorFotoPasoElegir");
  const pasoEditar = porId("editorFotoPasoEditar");
  const zona = porId("editorFotoZona");
  const archivo = porId("editorFotoArchivo");
  const lienzo = porId("editorFotoLienzo");
  const zoom = porId("editorFotoZoom");
  const zoomValor = porId("editorFotoZoomValor");
  const rotar = porId("editorFotoRotar");
  const rotarValor = porId("editorFotoRotarValor");

  const botonGuardar = porId("editorFotoGuardar");
  const errorDeFoto = porId("miFichaFotoError");

  const vista = porId("miFichaFotoVista");
  const vistaImg = porId("miFichaFotoImg");
  const botonSubir = porId("miFichaFotoSubir");
  const botonCambiar = porId("miFichaFotoCambiar");
  const botonQuitar = porId("miFichaFotoQuitar");

  const CLASE_PAGINA_BLOQUEADA = "editor-foto-abierto";
  const CLASE_ZONA_SOBRE = "editor-foto__zona--sobre";
  const CLASE_VISTA_CON_FOTO = "mi-ficha__foto-vista--con-foto";
  const TITULO_ELEGIR = "Subir foto";
  const TITULO_EDITAR = "Editar foto";
  const TEXTO_GUARDAR = botonGuardar.textContent;
  const TEXTO_GUARDANDO = "Guardando…";
  const MENSAJE_SUBIR = "No se pudo guardar tu foto. Intenta de nuevo.";
  const MENSAJE_QUITAR = "No se pudo quitar tu foto. Intenta de nuevo.";

  // La foto publicada: su ruta en el bucket. Null mientras no haya foto.
  let rutaGuardada = null;
  // Una subida o un borrado en curso: el segundo clic no dispara otra petición.
  let guardando = false;
  let quitando = false;

  // La imagen abierta en el editor y su encuadre.
  let imagen = null;
  let anchoOriginal = 0;
  let altoOriginal = 0;
  let estado = estadoInicialDeFoto();

  // Cada lectura de archivo toma un número: si llega otra mientras la primera
  // todavía decodifica, la vieja se descarta en vez de pisar a la nueva.
  let turnoDeLectura = 0;
  let cuadroPendiente = 0;
  let puntero = null;

  /* ---------- Avisos y pasos ---------- */

  function mostrarAviso(mensaje) {
    aviso.textContent = mensaje;
    aviso.hidden = mensaje === "";
  }

  function mostrarPaso(paso) {
    const editando = paso === "editar";
    pasoElegir.hidden = editando;
    pasoEditar.hidden = !editando;
    titulo.textContent = editando ? TITULO_EDITAR : TITULO_ELEGIR;
  }

  /* ---------- Abrir y cerrar ---------- */

  function liberarImagen() {
    if (imagen && typeof imagen.close === "function") imagen.close();
    imagen = null;
    anchoOriginal = 0;
    altoOriginal = 0;
  }

  function abrirEditor() {
    turnoDeLectura += 1;
    liberarImagen();
    estado = estadoInicialDeFoto();
    mostrarAviso("");
    mostrarPaso("elegir");
    // Sin esto, volver a elegir el MISMO archivo no dispararía `change`.
    archivo.value = "";
    document.documentElement.classList.add(CLASE_PAGINA_BLOQUEADA);
    if (typeof dialogo.showModal === "function") dialogo.showModal();
    else dialogo.setAttribute("open", "");
  }

  // `close` cubre la ✕, Esc y «Guardar cambios»: es el único lugar que
  // devuelve el scroll a la página.
  dialogo.addEventListener("close", () => {
    turnoDeLectura += 1;
    document.documentElement.classList.remove(CLASE_PAGINA_BLOQUEADA);
    zona.classList.remove(CLASE_ZONA_SOBRE);
    liberarImagen();
  });

  porId("editorFotoCerrar").addEventListener("click", () => dialogo.close());

  /* ---------- Paso 1: elegir ---------- */

  // Los dos caminos de la foto actual: el navegador soltaría el archivo sobre
  // el diálogo y navegaría a él si nadie cancela el evento.
  dialogo.addEventListener("dragover", (evento) => evento.preventDefault());
  dialogo.addEventListener("drop", (evento) => evento.preventDefault());

  zona.addEventListener("dragenter", (evento) => {
    evento.preventDefault();
    zona.classList.add(CLASE_ZONA_SOBRE);
  });
  zona.addEventListener("dragover", (evento) => {
    evento.preventDefault();
    if (evento.dataTransfer) evento.dataTransfer.dropEffect = "copy";
    zona.classList.add(CLASE_ZONA_SOBRE);
  });
  zona.addEventListener("dragleave", (evento) => {
    // dragleave también salta al pasar sobre un hijo: sólo cuenta salir.
    if (evento.relatedTarget && zona.contains(evento.relatedTarget)) return;
    zona.classList.remove(CLASE_ZONA_SOBRE);
  });
  zona.addEventListener("drop", (evento) => {
    evento.preventDefault();
    zona.classList.remove(CLASE_ZONA_SOBRE);
    const soltado = evento.dataTransfer && evento.dataTransfer.files && evento.dataTransfer.files[0];
    if (soltado) recibirArchivo(soltado);
  });

  porId("editorFotoElegir").addEventListener("click", () => archivo.click());
  archivo.addEventListener("change", () => {
    const elegido = archivo.files && archivo.files[0];
    if (elegido) recibirArchivo(elegido);
  });

  /*
    createImageBitmap decodifica fuera del hilo principal; si no existe (o
    falla con un formato que el navegador no abre) se prueba con un <img>, y
    si tampoco, el archivo es ilegible. El formato lo decide el navegador:
    un .heic renombrado a .jpg pasa el chequeo por tipo y cae acá.
  */
  function decodificar(blob) {
    const conImg = () => new Promise((resolver, rechazar) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolver(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error("no se pudo abrir")); };
      img.src = url;
    });
    if (typeof createImageBitmap !== "function") return conImg();
    return createImageBitmap(blob).catch(conImg);
  }

  async function recibirArchivo(elegido) {
    const turno = ++turnoDeLectura;
    mostrarAviso("");

    const veredicto = validarArchivoDeFoto(elegido);
    if (!veredicto.ok) { mostrarAviso(veredicto.mensaje); return; }

    let decodificada;
    try {
      decodificada = await decodificar(elegido);
    } catch (error) {
      if (turno === turnoDeLectura) mostrarAviso(MENSAJES_DE_FOTO.ilegible);
      return;
    }
    if (turno !== turnoDeLectura) {
      if (typeof decodificada.close === "function") decodificada.close();
      return;
    }

    const ancho = decodificada.width;
    const alto = decodificada.height;
    const medidas = validarDimensionesDeFoto(ancho, alto);
    if (!medidas.ok) {
      if (typeof decodificada.close === "function") decodificada.close();
      mostrarAviso(medidas.mensaje);
      return;
    }

    liberarImagen();
    imagen = decodificada;
    anchoOriginal = ancho;
    altoOriginal = alto;
    estado = estadoInicialDeFoto();
    sincronizarControles();
    mostrarPaso("editar");
    medirLienzo();
    dibujarVista();
    lienzo.focus();
  }

  porId("editorFotoOtra").addEventListener("click", () => {
    turnoDeLectura += 1;
    mostrarAviso("");
    archivo.value = "";
    mostrarPaso("elegir");
    porId("editorFotoElegir").focus();
  });

  /* ---------- Paso 2: dibujo ---------- */

  /*
    Dibuja el encuadre en un contexto cuadrado de `lado` píxeles. Es la ÚNICA
    función que dibuja: la vista previa le pasa el lado del canvas y la
    exportación el de la salida. El orden de las transformaciones es el que
    documenta mi-ficha.foto.logica.js.
  */
  function dibujarEncuadre(contexto, lado) {
    const escala = escalaDeFoto(estado, anchoOriginal, altoOriginal) * lado;
    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = "high";
    contexto.save();
    contexto.translate(lado / 2 + estado.desplazamientoX * lado, lado / 2 + estado.desplazamientoY * lado);
    contexto.rotate((estado.rotacion * Math.PI) / 180);
    contexto.rotate((estado.giro90 * Math.PI) / 2);
    contexto.scale(estado.volteoH ? -1 : 1, estado.volteoV ? -1 : 1);
    contexto.scale(escala, escala);
    contexto.drawImage(imagen, -anchoOriginal / 2, -altoOriginal / 2);
    contexto.restore();
  }

  // El canvas se dibuja a su tamaño real en pantalla (por la densidad de
  // píxeles): un canvas de 480 estirado por CSS se vería borroso en retina.
  function medirLienzo() {
    const lado = Math.round(lienzo.clientWidth * (window.devicePixelRatio || 1));
    if (lado > 0 && (lienzo.width !== lado || lienzo.height !== lado)) {
      lienzo.width = lado;
      lienzo.height = lado;
    }
  }

  function dibujarVista() {
    if (!imagen) return;
    const contexto = lienzo.getContext("2d");
    contexto.clearRect(0, 0, lienzo.width, lienzo.height);
    dibujarEncuadre(contexto, lienzo.width);
  }

  // Varios eventos de puntero por cuadro: se dibuja una sola vez por cuadro.
  // No es un bucle: cada llamada se pide a sí misma sólo cuando algo cambió.
  function pedirDibujo() {
    if (cuadroPendiente) return;
    cuadroPendiente = requestAnimationFrame(() => {
      cuadroPendiente = 0;
      dibujarVista();
    });
  }

  // Tras cualquier cambio: la foto tiene que seguir cubriendo el recorte.
  function aplicarCambio() {
    const acotado = limitarDesplazamientoDeFoto(estado, anchoOriginal, altoOriginal);
    estado = { ...estado, ...acotado };
    pedirDibujo();
  }

  function sincronizarControles() {
    zoom.value = String(estado.zoom);
    zoomValor.textContent = estado.zoom.toFixed(1);
    rotar.value = String(estado.rotacion);
    rotarValor.textContent = `${estado.rotacion}°`;
  }

  function cambiarZoom(valor) {
    estado = { ...estado, zoom: Math.round(limitarZoomDeFoto(valor) * 10) / 10 };
    sincronizarControles();
    aplicarCambio();
  }

  zoom.addEventListener("input", () => cambiarZoom(Number.parseFloat(zoom.value)));
  rotar.addEventListener("input", () => {
    estado = { ...estado, rotacion: Math.round(limitarRotacionDeFoto(Number.parseFloat(rotar.value))) };
    sincronizarControles();
    aplicarCambio();
  });

  porId("editorFotoGirarIzq").addEventListener("click", () => { estado = girarFoto(estado, -1); aplicarCambio(); });
  porId("editorFotoGirarDer").addEventListener("click", () => { estado = girarFoto(estado, 1); aplicarCambio(); });
  porId("editorFotoVoltearH").addEventListener("click", () => { estado = voltearFoto(estado, "h"); aplicarCambio(); });
  porId("editorFotoVoltearV").addEventListener("click", () => { estado = voltearFoto(estado, "v"); aplicarCambio(); });

  /* ---------- Paso 2: arrastrar y teclado ---------- */

  /*
    Pointer Events: sirven igual para mouse, lápiz y dedo. La captura va en el
    canvas, así el arrastre sigue aunque el puntero se salga de él. El
    desplazamiento se guarda como fracción del lado visible (L = 1).
  */
  lienzo.addEventListener("pointerdown", (evento) => {
    if (!imagen || (evento.pointerType === "mouse" && evento.button !== 0)) return;
    puntero = { id: evento.pointerId, x: evento.clientX, y: evento.clientY };
    lienzo.setPointerCapture(evento.pointerId);
    lienzo.classList.add("editor-foto__lienzo--arrastrando");
    evento.preventDefault();
  });

  lienzo.addEventListener("pointermove", (evento) => {
    if (!puntero || evento.pointerId !== puntero.id) return;
    const ladoVisible = lienzo.clientWidth || 1;
    estado = {
      ...estado,
      desplazamientoX: estado.desplazamientoX + (evento.clientX - puntero.x) / ladoVisible,
      desplazamientoY: estado.desplazamientoY + (evento.clientY - puntero.y) / ladoVisible,
    };
    puntero.x = evento.clientX;
    puntero.y = evento.clientY;
    aplicarCambio();
  });

  function soltarPuntero(evento) {
    if (!puntero || evento.pointerId !== puntero.id) return;
    if (lienzo.hasPointerCapture(evento.pointerId)) lienzo.releasePointerCapture(evento.pointerId);
    puntero = null;
    lienzo.classList.remove("editor-foto__lienzo--arrastrando");
  }
  lienzo.addEventListener("pointerup", soltarPuntero);
  lienzo.addEventListener("pointercancel", soltarPuntero);

  // Las flechas mueven la foto en la dirección de la flecha. Se cancela el
  // evento: sin eso el diálogo scrollearía.
  const FLECHAS = Object.freeze({
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  });

  lienzo.addEventListener("keydown", (evento) => {
    if (!imagen) return;
    const flecha = FLECHAS[evento.key];
    if (flecha) {
      evento.preventDefault();
      estado = {
        ...estado,
        desplazamientoX: estado.desplazamientoX + flecha[0] * PASO_DE_FLECHA_DE_FOTO,
        desplazamientoY: estado.desplazamientoY + flecha[1] * PASO_DE_FLECHA_DE_FOTO,
      };
      aplicarCambio();
    } else if (evento.key === "+" || evento.key === "=") {
      evento.preventDefault();
      cambiarZoom(estado.zoom + ZOOM_PASO_DE_FOTO);
    } else if (evento.key === "-" || evento.key === "_") {
      evento.preventDefault();
      cambiarZoom(estado.zoom - ZOOM_PASO_DE_FOTO);
    }
  });

  // El canvas cambia de lado con el diálogo (una columna en pantallas
  // angostas): hay que repintarlo a su tamaño nuevo.
  function alCambiarDeTamano() {
    if (!imagen || pasoEditar.hidden) return;
    medirLienzo();
    aplicarCambio();
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(alCambiarDeTamano).observe(lienzo);
  else window.addEventListener("resize", alCambiarDeTamano);

  /* ---------- Guardar: exportar y publicar ---------- */

  function exportar() {
    const lado = ladoDeSalidaDeFoto(ladoDeRecorteEnPixelesFuente(estado, anchoOriginal, altoOriginal));
    const fuera = document.createElement("canvas");
    fuera.width = lado;
    fuera.height = lado;
    dibujarEncuadre(fuera.getContext("2d"), lado);
    return new Promise((resolver) => fuera.toBlob(resolver, "image/webp", CALIDAD_WEBP_DE_FOTO));
  }

  // El error de subir lo muestra el propio diálogo (mostrarAviso); éste es
  // para lo que pasa fuera de él: quitar la foto, o una subida cuyo diálogo ya
  // se cerró.
  function mostrarErrorDeFoto(mensaje) {
    errorDeFoto.textContent = mensaje;
    errorDeFoto.hidden = mensaje === "";
  }

  // «Subir foto» cuando no hay; «Cambiar» y «Quitar» cuando sí. Mientras se
  // quita, los tres se apagan.
  function actualizarGrupo() {
    const hayFoto = rutaGuardada !== null;
    const hayImagen = vistaImg.getAttribute("src") !== null;
    vistaImg.hidden = !hayImagen;
    vista.classList.toggle(CLASE_VISTA_CON_FOTO, hayImagen);
    botonSubir.hidden = hayFoto;
    botonCambiar.hidden = !hayFoto;
    botonQuitar.hidden = !hayFoto;
    for (const boton of [botonSubir, botonCambiar, botonQuitar]) boton.disabled = quitando;
  }

  /*
    Fija la foto publicada: `ruta` es la del bucket y `url` la pública con la
    que se pinta. Sin ruta, no hay foto. Con ruta pero sin url (no se pudo
    armar) la foto existe y se puede quitar, aunque la vista previa no pueda
    mostrarla. El `src` sólo se escribe si cambió.
  */
  function fijar({ ruta = null, url = null } = {}) {
    rutaGuardada = typeof ruta === "string" && ruta !== "" ? ruta : null;
    const imagenNueva = rutaGuardada !== null && typeof url === "string" && url !== "" ? url : null;
    if (imagenNueva === null) {
      if (vistaImg.getAttribute("src") !== null) vistaImg.removeAttribute("src");
    } else if (vistaImg.getAttribute("src") !== imagenNueva) {
      vistaImg.setAttribute("src", imagenNueva);
    }
    actualizarGrupo();
  }

  botonGuardar.addEventListener("click", async () => {
    if (!imagen || guardando) return;
    guardando = true;
    const turno = turnoDeLectura;
    botonGuardar.disabled = true;
    botonGuardar.textContent = TEXTO_GUARDANDO;
    mostrarAviso("");
    let mensaje = MENSAJE_SUBIR;
    try {
      const blob = await exportar();
      // Si mientras tanto se cerró el diálogo no hay nada que guardar.
      if (turno !== turnoDeLectura) return;
      if (!blob) { mostrarAviso(MENSAJES_DE_FOTO.exportar); return; }

      const resultado = await subir(blob);
      if (resultado && resultado.ok && resultado.data) {
        fijar({ ruta: resultado.data.foto_path, url: resultado.data.url });
        mostrarErrorDeFoto("");
        // La foto ya está publicada. Si el diálogo se cerró mientras subía,
        // no hay nada que cerrar ni a dónde devolver el foco.
        if (turno === turnoDeLectura) {
          dialogo.close();
          botonCambiar.focus();
        }
        return;
      }
      if (resultado && resultado.mensaje) mensaje = resultado.mensaje;
    } catch (error) {
      console.error("[mi-ficha.foto]", error);
    } finally {
      guardando = false;
      botonGuardar.disabled = false;
      botonGuardar.textContent = TEXTO_GUARDAR;
    }
    // Sólo se llega acá si algo falló. En el diálogo abierto, el aviso queda
    // ahí y el diálogo sigue abierto para reintentar.
    if (turno === turnoDeLectura) mostrarAviso(mensaje);
    else mostrarErrorDeFoto(mensaje);
  });

  botonQuitar.addEventListener("click", async () => {
    if (quitando || rutaGuardada === null) return;
    quitando = true;
    mostrarErrorDeFoto("");
    actualizarGrupo();
    let resultado = null;
    try {
      resultado = await quitar(rutaGuardada);
    } catch (error) {
      console.error("[mi-ficha.foto]", error);
    }
    quitando = false;
    if (resultado && resultado.ok) {
      fijar();
      botonSubir.focus();
      return;
    }
    // La foto sigue publicada: no se toca la vista previa.
    mostrarErrorDeFoto((resultado && resultado.mensaje) || MENSAJE_QUITAR);
    actualizarGrupo();
    botonQuitar.focus();
  });

  botonSubir.addEventListener("click", abrirEditor);
  botonCambiar.addEventListener("click", abrirEditor);

  actualizarGrupo();
  return Object.freeze({ fijar });
}
