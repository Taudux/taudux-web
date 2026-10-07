/*
  La página de Slides: pinta el catálogo de presentaciones, el formulario para
  subir una y el visor. El catálogo lo pide a cargarCatalogoDeSlides()
  (slides.service.js) y la lógica pura (acotar el índice, mapear teclas,
  normalizar una entrada, categorías, fechas, validar el formulario) sale de
  slides.logica.js. Acá sólo hay DOM.

  El hash es la fuente de verdad de qué se ve: `#/<slug>` abre esa
  presentación en el visor, cualquier otra cosa (incluido vacío) muestra el
  catálogo. Es el mismo patrón que colaboradores.js usa para su perfil. No hay
  botón de volver: el visor deja toda la ventana a la diapositiva, y al
  catálogo se regresa con "atrás" o con "Slides" en el menú.

  EL CATÁLOGO. Una grilla de tarjetas (portada 16:10, categoría, título,
  «autor · fecha») con una fila de filtros por categoría encima. Las
  presentaciones privadas —«Solo administradores» y «Por revisar»— no van en la
  grilla: van en un <details> hasta arriba, que arranca cerrado y recuerda
  cómo lo dejó la persona. Quién ve qué lo decide la RLS (0048); acá sólo se
  reparte lo que llegó.

  SUBIR. El botón «Subir presentación» sólo aparece para administradores y
  autores, y es una comodidad: quien lo forzara en la consola se toparía con la
  RLS. El administrador elige autor y visibilidad; un autor sube siempre a su
  nombre y «por revisar».

  EDITAR (0049). Cada tarjeta de una presentación SUBIDA lleva un lápiz en la
  esquina de la portada para el administrador (en todas) y para su autor (sólo
  en las suyas). Abre el mismo formulario en modo edición: archivo opcional,
  «Quitar portada» y «Borrar presentación», que pide una confirmación dentro
  del propio diálogo. Un autor no elige autor ni visibilidad, y toda edición suya
  vuelve la presentación a «por revisar» (lo fuerza la base, no esta página).

  Cada presentación es un deck: un único HTML con todas sus diapositivas como
  `<section class="slide">`, que corre dentro de un <iframe> del mismo origen y
  expone `window.slidesDeck` — `{ total, indice(), ir(n) }` — más un evento
  `slides:cambio` en cada cambio de diapositiva (ver deck.js de cada carpeta).
  Los decks SUBIDOS no se abren directo: los abre la página puente
  /content/slides/_subida/, que cumple el mismo contrato. El visor sólo carga
  el <iframe> UNA VEZ por presentación (con `location.replace`, nunca
  `iframe.src`: ver cargarPresentacionEnIframe); moverse entre diapositivas de
  la MISMA presentación no recarga nada, llama a `slidesDeck.ir(n)` del propio
  deck.

  El teclado se conecta dos veces, con responsabilidades que no se pisan:
  - en `document` (la página): flechas, PageUp/Down, espacio, Home/End y F,
    mientras el foco esté afuera del <iframe>.
  - en el `document` DEL IFRAME, después de cada `load`: sólo F. Las flechas
    de ahí adentro ya las escucha el propio deck (ver deck.js); escucharlas
    también acá las movería DOS veces por cada tecla.

  Si el deck no expone `slidesDeck` (un HTML que no sigue el contrato), el
  visor lo muestra igual: los botones de navegación quedan deshabilitados y
  el contador se queda vacío, pero pantalla completa sigue andando.

  Si el deck declara `slidesDeck.controlesPropios` (el puente lo hace cuando el
  deck subido trae sus propios botones, como el de QR), el visor esconde los
  suyos: dos barras de navegación a la vez no tienen sentido.
*/
(function () {
  const AVISOS = {
    cargando: "Cargando presentaciones…",
    error: "No se pudieron cargar las presentaciones. Reintenta cuando tengas conexión.",
    vacio: "Todavía no hay presentaciones para mostrar.",
  };

  /* Cómo dejó la persona el desplegable de privadas. Preferencia de
     comodidad: si el storage está bloqueado, arranca cerrado y ya. */
  const LLAVE_PRIVADAS_ABIERTAS = "taudux_slides_privadas_abiertas";

  /* `#/<slug>` -> "slug", o "" si el hash no tiene esa forma. Mismo formato
     que notas.arbol.js, simplificado: acá no hay vistas ni segmentos, sólo
     qué presentación abrir. */
  function slugDesdeHash(hash) {
    const crudo = typeof hash === "string" ? hash.trim().replace(/^#/, "") : "";
    const partes = crudo.split("/").map((parte) => parte.trim().toLowerCase()).filter(Boolean);
    return partes[0] || "";
  }

  function leerPreferencia(llave) {
    try {
      return window.localStorage.getItem(llave);
    } catch {
      return null;
    }
  }

  function guardarPreferencia(llave, valor) {
    try {
      window.localStorage.setItem(llave, valor);
    } catch {
      // Sin storage no se recuerda nada; no es un error.
    }
  }

  function iniciar() {
    // Sin la lógica pura no hay nada que pintar de forma confiable; el HTML
    // estático ya muestra el catálogo vacío, que es mejor que un error a
    // mitad de render.
    if (typeof normalizarPresentacion !== "function") return undefined;

    const porId = (id) => document.getElementById(id);
    const el = {
      catalogo: porId("slidesCatalogo"),
      visor: porId("slidesVisor"),
      aviso: porId("slidesAviso"),
      avisoMensaje: porId("slidesAvisoMensaje"),
      reintentar: porId("slidesReintentar"),
      grilla: porId("slidesGrilla"),
      privadas: porId("slidesPrivadas"),
      privadasTitulo: porId("slidesPrivadasTitulo"),
      grillaPrivadas: porId("slidesGrillaPrivadas"),
      filtros: porId("slidesFiltros"),
      subir: porId("slidesSubir"),
      visorTitulo: porId("slidesVisorTitulo"),
      contador: porId("slidesContador"),
      marco: porId("slidesMarco"),
      iframe: porId("slidesIframe"),
      controles: document.querySelector(".slides__controles"),
      anterior: porId("slidesAnterior"),
      siguiente: porId("slidesSiguiente"),
      pantallaCompleta: porId("slidesPantallaCompleta"),
    };

    if (Object.values(el).some((nodo) => !nodo)) return undefined;

    // El formulario es opcional para el resto de la página: sin él (o sin el
    // servicio de subida) el botón simplemente no aparece.
    const form = {
      dialogo: porId("slidesDialogo"),
      formulario: porId("slidesForm"),
      titulo: porId("slidesFormTitulo"),
      descripcion: porId("slidesFormDescripcion"),
      categoria: porId("slidesFormCategoria"),
      categorias: porId("slidesFormCategorias"),
      portada: porId("slidesFormPortada"),
      archivo: porId("slidesFormArchivo"),
      archivoAyuda: porId("slidesFormArchivoAyuda"),
      autorCampo: porId("slidesFormAutorCampo"),
      autor: porId("slidesFormAutor"),
      visibilidadCampo: porId("slidesFormVisibilidadCampo"),
      notaAutor: porId("slidesFormNotaAutor"),
      error: porId("slidesFormError"),
      cancelar: porId("slidesFormCancelar"),
      enviar: porId("slidesFormEnviar"),
      dialogoTitulo: porId("slidesDialogoTitulo"),
      quitarPortadaCampo: porId("slidesFormQuitarPortadaCampo"),
      quitarPortada: porId("slidesFormQuitarPortada"),
      avisoRevision: porId("slidesFormAvisoRevision"),
      borrarZona: porId("slidesFormBorrarZona"),
      borrar: porId("slidesFormBorrar"),
      borrarConfirmar: porId("slidesFormBorrarConfirmar"),
      borrarSi: porId("slidesFormBorrarSi"),
      borrarNo: porId("slidesFormBorrarNo"),
    };
    const hayFormulario = Object.values(form).every(Boolean)
      && typeof subirSlide === "function"
      && typeof cargarPermisosDeSlides === "function";
    // Editar y borrar necesitan además sus funciones del servicio: sin ellas
    // la página sigue subiendo, sólo que sin el lápiz.
    const hayEdicion = hayFormulario
      && typeof editarSlide === "function"
      && typeof borrarSlide === "function";

    // El catálogo cargado (entradas ya normalizadas y válidas) y qué se está
    // mostrando ahora mismo. `totalActual` e `indiceActual` los manda el
    // propio deck (por `slidesDeck` al conectar y por el evento
    // `slides:cambio` después); mientras no haya deck conectado quedan en 0.
    let catalogo = [];
    let permisos = { admin: false, autor: false, usuarioId: null };
    let categoriaActiva = "";
    let urlsDePortada = new Map();
    let presentacionActual = null;
    let indiceActual = 0;
    let totalActual = 0;
    let deckConectado = false;
    let conectada = false;
    let laminasDetectadas = 0;
    let subiendo = false;
    // La presentación que se está editando, o null si el formulario sube una nueva.
    let edicionActual = null;

    el.reintentar.addEventListener("click", reintentarCarga);
    el.anterior.addEventListener("click", () => irA(indiceActual - 1));
    el.siguiente.addEventListener("click", () => irA(indiceActual + 1));
    el.pantallaCompleta.addEventListener("click", alternarPantallaCompleta);
    el.iframe.addEventListener("load", manejarCargaDelIframe);
    document.addEventListener("keydown", (evento) => manejarTecla(evento, evento.target));
    // El puente (deck subido con botones propios) pide pantalla completa por
    // aquí: el marco vive en esta página, no en el iframe.
    document.addEventListener("slides:alternar-pantalla-completa", alternarPantallaCompleta);

    el.privadas.addEventListener("toggle", () => {
      guardarPreferencia(LLAVE_PRIVADAS_ABIERTAS, el.privadas.open ? "1" : "0");
    });
    el.privadas.open = leerPreferencia(LLAVE_PRIVADAS_ABIERTAS) === "1";

    if (hayFormulario) conectarFormulario();

    return cargarCatalogo();

    /* ---------- Carga del catálogo ---------- */

    async function cargarCatalogo() {
      el.reintentar.disabled = true;
      el.grilla.setAttribute("aria-busy", "true");
      mostrarAviso(AVISOS.cargando, { error: false });

      let resultado = null;
      let resultadoPermisos = null;
      try {
        [resultado, resultadoPermisos] = await Promise.all([
          cargarCatalogoDeSlides(),
          typeof cargarPermisosDeSlides === "function"
            ? cargarPermisosDeSlides()
            : Promise.resolve(null),
        ]);
      } catch {
        // El servicio nunca lanza: esto es su script que no llegó a cargar.
      } finally {
        el.grilla.setAttribute("aria-busy", "false");
        el.reintentar.disabled = false;
      }

      if (!resultado || !resultado.ok) {
        montarCatalogo([]);
        mostrarAviso(AVISOS.error, { error: true });
        el.reintentar.hidden = false;
        return false;
      }

      permisos = {
        admin: Boolean(resultadoPermisos && resultadoPermisos.admin),
        autor: Boolean(resultadoPermisos && resultadoPermisos.autor),
        usuarioId: (resultadoPermisos && resultadoPermisos.usuarioId) || null,
      };
      el.subir.hidden = !(hayFormulario && (permisos.admin || permisos.autor));

      // Cada entrada se normaliza y las que no pasan la validación se
      // descartan: una presentación rota no debe tumbar a las demás. El
      // servicio ya arma `url`, `origen`, `visibilidad` y las rutas de
      // portada; acá se conservan y los campos normalizados les ganan.
      const normalizadas = (resultado.catalogo || [])
        .map((entrada) => {
          const resultadoEntrada = normalizarPresentacion(entrada && entrada.slug, entrada);
          if (!resultadoEntrada.ok) return null;
          return { ...entrada, ...resultadoEntrada.presentacion };
        })
        .filter(Boolean);

      montarCatalogo(normalizadas);
      el.reintentar.hidden = true;

      if (normalizadas.length === 0) mostrarAviso(AVISOS.vacio, { error: false });
      else ocultarAviso();

      if (!conectada) {
        conectada = true;
        ponerCatalogoDetras();
        window.addEventListener("hashchange", aplicarHash);
      }

      aplicarHash();
      firmarPortadasYRepintar(normalizadas);
      return true;
    }

    async function reintentarCarga() {
      const cargada = await cargarCatalogo();
      if (!cargada) el.aviso.focus();
    }

    // Las portadas subidas viven en un bucket privado y se leen con URL
    // firmada. Se piden DESPUÉS de pintar: las tarjetas ya están y sólo
    // ganan su imagen cuando llega.
    async function firmarPortadasYRepintar(lista) {
      if (typeof firmarPortadasDeSlides !== "function") return;
      if (!lista.some((item) => item.portada_path)) return;
      const urls = await firmarPortadasDeSlides(lista);
      if (urls.size === 0 || lista !== catalogo) return;
      urlsDePortada = urls;
      pintarCatalogo();
    }

    function mostrarAviso(mensaje, { error }) {
      el.aviso.hidden = false;
      el.aviso.classList.toggle("slides__aviso--error", error);
      escribir(el.avisoMensaje, mensaje);
    }

    function ocultarAviso() {
      el.aviso.hidden = true;
      el.aviso.classList.remove("slides__aviso--error");
      escribir(el.avisoMensaje, "");
    }

    /* ---------- Construcción del catálogo ---------- */

    function montarCatalogo(lista) {
      catalogo = lista;
      urlsDePortada = new Map();
      pintarCatalogo();
    }

    // Reparte el catálogo entre la grilla (lo público, filtrable por
    // categoría) y el desplegable de privadas, y vuelve a pintar las dos.
    function pintarCatalogo() {
      const { publicas, privadas } = repartirCatalogo(catalogo);

      pintarFiltros(publicas);
      const visibles = filtrarPorCategoria(publicas, categoriaActiva);
      el.grilla.replaceChildren(...visibles.map(crearCelda));

      // Un autor sólo ve en el desplegable lo suyo «por revisar»: lo que un
      // administrador le dejó en «Solo administradores» no es para él.
      const delDesplegable = permisos.admin
        ? privadas
        : privadas.filter((item) => item.visibilidad === "por_revisar");
      el.privadas.hidden = delDesplegable.length === 0;
      escribir(
        el.privadasTitulo,
        permisos.admin
          ? `🔒 Solo administradores · ${delDesplegable.length}`
          : "Mis presentaciones por revisar"
      );
      el.grillaPrivadas.replaceChildren(...delDesplegable.map(crearCelda));
    }

    // La fila de filtros: «Todas» primero y el resto alfabético. Con una sola
    // categoría (o ninguna) no hay nada que filtrar y no se muestra.
    function pintarFiltros(publicas) {
      const categorias = listarCategorias(publicas);
      if (categoriaActiva && !categorias.some((c) => claveDeCategoria(c) === categoriaActiva)) {
        categoriaActiva = "";
      }

      el.filtros.hidden = categorias.length <= 1;
      if (categorias.length <= 1) {
        el.filtros.replaceChildren();
        return;
      }

      const opciones = [{ texto: "Todas", clave: "" }].concat(
        categorias.map((texto) => ({ texto, clave: claveDeCategoria(texto) }))
      );
      el.filtros.replaceChildren(...opciones.map(({ texto, clave }) => {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "slides__filtro";
        boton.textContent = texto;
        boton.setAttribute("aria-pressed", String(clave === categoriaActiva));
        boton.addEventListener("click", () => {
          categoriaActiva = clave;
          pintarCatalogo();
        });
        return boton;
      }));
    }

    function crearCelda(presentacion) {
      const celda = document.createElement("li");
      celda.className = "slides__celda";

      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "slides__tarjeta";
      boton.setAttribute("aria-label", `Abrir ${presentacion.titulo}`);
      // La descripción no se ve en la tarjeta: queda como texto al pasar el
      // mouse y para el lector de pantalla.
      if (presentacion.descripcion) {
        boton.title = presentacion.descripcion;
        const descripcion = document.createElement("span");
        descripcion.className = "u-visually-hidden";
        descripcion.id = `slides-descripcion-${presentacion.slug}`;
        descripcion.textContent = presentacion.descripcion;
        boton.setAttribute("aria-describedby", descripcion.id);
        boton.append(descripcion);
      }
      boton.addEventListener("click", () => abrirDesdeCatalogo(presentacion.slug));

      boton.append(crearPortada(presentacion));

      if (presentacion.categoria) {
        const categoria = document.createElement("span");
        categoria.className = "slides__categoria";
        categoria.textContent = presentacion.categoria;
        boton.append(categoria);
      }

      const titulo = document.createElement("span");
      titulo.className = "slides__tarjeta-titulo";
      titulo.textContent = presentacion.titulo;
      boton.append(titulo);

      const meta = [presentacion.autor, fechaCorta(presentacion.actualizado)].filter(Boolean).join(" · ");
      if (meta) {
        const pie = document.createElement("span");
        pie.className = "slides__meta";
        pie.textContent = meta;
        boton.append(pie);
      }

      celda.append(boton);

      if (permisos.admin && presentacion.visibilidad === "por_revisar") {
        const publicar = document.createElement("button");
        publicar.type = "button";
        publicar.className = "slides__publicar";
        publicar.textContent = "Publicar";
        publicar.setAttribute("aria-label", `Publicar ${presentacion.titulo}`);
        publicar.addEventListener("click", () => publicarDesdeCatalogo(presentacion, publicar));
        celda.append(publicar);
      }

      // El lápiz va como HERMANO de la tarjeta (un <button> no anida otro) y
      // se posiciona sobre la esquina de la portada. Sólo en lo subido: lo del
      // repositorio no se edita desde acá. El administrador lo ve en todas y el
      // autor sólo en las suyas; la RLS decide de verdad.
      if (hayEdicion && presentacion.origen === "subida" && (permisos.admin || presentacion.es_mio)) {
        celda.append(crearBotonEditar(presentacion));
      }

      return celda;
    }

    function crearBotonEditar(presentacion) {
      const editar = document.createElement("button");
      editar.type = "button";
      editar.className = "slides__editar";
      editar.setAttribute("aria-label", `Editar ${presentacion.titulo}`);
      editar.title = "Editar";

      const ns = "http://www.w3.org/2000/svg";
      const icono = document.createElementNS(ns, "svg");
      icono.setAttribute("viewBox", "0 0 24 24");
      icono.setAttribute("aria-hidden", "true");
      icono.setAttribute("focusable", "false");
      icono.setAttribute("class", "slides__editar-icono");
      const trazo = document.createElementNS(ns, "path");
      trazo.setAttribute("d", "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z");
      icono.append(trazo);
      editar.append(icono);

      editar.addEventListener("click", () => abrirFormulario(presentacion));
      return editar;
    }

    // La portada: la imagen si hay, y si no (o si no carga) un degradado de
    // color fijo por categoría con sus iniciales. Las etiquetas «N láminas» y
    // «Por revisar» van encima en los dos casos.
    function crearPortada(presentacion) {
      const portada = document.createElement("span");
      portada.className = "slides__portada";
      portada.style.background = degradadoDeCategoria(presentacion.categoria);

      const iniciales = inicialesDeCategoria(presentacion.categoria || presentacion.titulo);
      if (iniciales) {
        const marca = document.createElement("span");
        marca.className = "slides__iniciales";
        marca.setAttribute("aria-hidden", "true");
        marca.textContent = iniciales;
        portada.append(marca);
      }

      const url = presentacion.portada_url || urlsDePortada.get(presentacion.portada_path) || "";
      if (url) {
        const imagen = document.createElement("img");
        imagen.className = "slides__portada-imagen";
        imagen.alt = "";
        imagen.loading = "lazy";
        imagen.decoding = "async";
        imagen.addEventListener("error", () => imagen.remove());
        imagen.src = url;
        portada.append(imagen);
      }

      const laminas = textoLaminas(presentacion.total_laminas);
      if (laminas) {
        const etiqueta = document.createElement("span");
        etiqueta.className = "slides__laminas";
        etiqueta.textContent = laminas;
        portada.append(etiqueta);
      }

      if (presentacion.visibilidad === "por_revisar") {
        const estado = document.createElement("span");
        estado.className = "slides__estado";
        estado.textContent = "Por revisar";
        portada.append(estado);
      }

      return portada;
    }

    async function publicarDesdeCatalogo(presentacion, boton) {
      boton.disabled = true;
      const resultado = await publicarSlide(presentacion.id);
      if (typeof mostrarToast === "function") {
        mostrarToast(
          resultado.ok ? `«${presentacion.titulo}» ya es pública.` : resultado.mensaje,
          resultado.ok ? "success" : "error"
        );
      }
      if (resultado.ok) await cargarCatalogo();
      else boton.disabled = false;
    }

    /* ---------- Subir una presentación ---------- */

    function conectarFormulario() {
      el.subir.addEventListener("click", () => abrirFormulario());
      form.cancelar.addEventListener("click", () => form.dialogo.close());
      form.formulario.addEventListener("submit", enviarFormulario);
      form.archivo.addEventListener("change", leerArchivoElegido);
      form.descripcion.addEventListener("input", ajustarAltoDeDescripcion);
      form.borrar.addEventListener("click", pedirConfirmacionDeBorrado);
      form.borrarNo.addEventListener("click", cancelarBorrado);
      form.borrarSi.addEventListener("click", borrarPresentacion);
      // Esc o el fondo cierran el diálogo, salvo en mitad de una subida.
      form.dialogo.addEventListener("cancel", (evento) => {
        if (subiendo) evento.preventDefault();
      });
    }

    function campoError(nombre) {
      return porId(`slidesForm${nombre}Error`);
    }

    function limpiarErrores() {
      form.formulario.querySelectorAll(".slides__campo-error").forEach((nodo) => { nodo.textContent = ""; });
      form.formulario.querySelectorAll("[aria-invalid]").forEach((nodo) => nodo.removeAttribute("aria-invalid"));
      form.error.textContent = "";
    }

    // La descripción crece con su texto en vez de scrollear (ver
    // #slidesFormDescripcion en slides.css). Donde `field-sizing: content` ya
    // lo hace el CSS no hay nada que hacer; en el resto (Firefox, Safari) el
    // alto se copia del contenido.
    function ajustarAltoDeDescripcion() {
      if (typeof CSS !== "undefined" && CSS.supports && CSS.supports("field-sizing", "content")) return;
      form.descripcion.style.height = "";
      form.descripcion.style.height = `${form.descripcion.scrollHeight}px`;
    }

    // Abre el formulario: sin argumento sube una presentación nueva; con una
    // presentación del catálogo la edita. Cada apertura deja TODO como si
    // fuera la primera, para que editar y luego subir no arrastre nada.
    async function abrirFormulario(presentacion = null) {
      const editando = Boolean(presentacion && presentacion.origen === "subida");
      edicionActual = editando ? presentacion : null;

      quitarOpcionPorRevisar();
      form.formulario.reset();
      limpiarErrores();
      laminasDetectadas = 0;

      escribir(form.dialogoTitulo, editando ? "Editar presentación" : "Subir presentación");
      escribir(form.enviar, textoDeEnviar());
      escribir(form.archivoAyuda, textoDeAyudaDelArchivo());
      form.archivo.required = !editando;

      form.autorCampo.hidden = !permisos.admin;
      form.visibilidadCampo.hidden = !permisos.admin;
      form.notaAutor.hidden = permisos.admin;
      form.autor.required = permisos.admin;

      // Lo propio de editar: la portada sólo se puede quitar si hay una, el
      // borrado arranca sin confirmar y quien no es administrador sabe de
      // antemano que lo público vuelve a revisión.
      form.quitarPortadaCampo.hidden = !(editando && presentacion.portada_path);
      form.avisoRevision.hidden = !(editando && !permisos.admin && presentacion.visibilidad === "publico");
      form.borrarZona.hidden = !editando;
      cancelarBorrado();

      if (editando) rellenarFormulario(presentacion);

      form.dialogo.showModal();
      // Ya visible: recién ahora el campo tiene alto que medir.
      ajustarAltoDeDescripcion();
      form.titulo.focus();

      // Las sugerencias y la lista de autores llegan después de abrir: el
      // formulario ya se puede llenar mientras tanto.
      cargarSugerencias();
      if (permisos.admin) cargarAutores(editando ? presentacion : null);
    }

    function textoDeEnviar() {
      return edicionActual ? "Guardar cambios" : "Subir";
    }

    function textoDeAyudaDelArchivo() {
      return edicionActual
        ? "Déjalo vacío para conservar el archivo actual."
        : "Un solo .html de hasta 15 MB, con sus láminas en section.slide.";
    }

    function rellenarFormulario(presentacion) {
      form.titulo.value = presentacion.titulo || "";
      form.descripcion.value = presentacion.descripcion || "";
      form.categoria.value = presentacion.categoria || "";
      if (!permisos.admin) return;

      // Mientras llega la lista de autores, el actual ya está elegido.
      if (presentacion.autor_id) {
        form.autor.replaceChildren(
          new Option("Elige al autor", ""),
          new Option(presentacion.autor || "Autor actual", presentacion.autor_id)
        );
        form.autor.value = presentacion.autor_id;
      }

      // Una presentación «por revisar» puede seguir así: es una tercera
      // opción que sólo existe mientras se edita una así.
      if (presentacion.visibilidad === "por_revisar") agregarOpcionPorRevisar();
      const radio = form.formulario.querySelector(`input[name="visibilidad"][value="${presentacion.visibilidad}"]`);
      if (radio) radio.checked = true;
    }

    function agregarOpcionPorRevisar() {
      const etiqueta = document.createElement("label");
      etiqueta.className = "slides__radio";
      etiqueta.dataset.opcionPorRevisar = "true";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "visibilidad";
      radio.value = "por_revisar";
      const texto = document.createElement("span");
      texto.textContent = "Por revisar";
      etiqueta.append(radio, texto);
      form.visibilidadCampo.insertBefore(etiqueta, campoError("Visibilidad"));
    }

    function quitarOpcionPorRevisar() {
      form.visibilidadCampo.querySelectorAll("[data-opcion-por-revisar]").forEach((nodo) => nodo.remove());
    }

    /* ---------- Borrar (con confirmación dentro del diálogo) ---------- */

    function pedirConfirmacionDeBorrado() {
      form.borrar.hidden = true;
      form.borrarConfirmar.hidden = false;
      form.borrarNo.focus();
    }

    function cancelarBorrado() {
      form.borrarConfirmar.hidden = true;
      form.borrar.hidden = false;
    }

    async function borrarPresentacion() {
      const presentacion = edicionActual;
      if (!presentacion || subiendo) return;
      subiendo = true;
      form.error.textContent = "";
      alternarOcupado(true);
      form.borrarSi.textContent = "Borrando…";

      try {
        const resultado = await borrarSlide({
          id: presentacion.id,
          archivoPath: presentacion.archivo_path,
          portadaPath: presentacion.portada_path,
        });
        if (!resultado.ok) {
          form.error.textContent = resultado.mensaje;
          cancelarBorrado();
          return;
        }

        form.dialogo.close();
        if (typeof mostrarToast === "function") mostrarToast("Presentación borrada.", "success");
        await cargarCatalogo();
      } finally {
        subiendo = false;
        form.borrarSi.textContent = "Sí, borrar";
        alternarOcupado(false);
      }
    }

    // Mientras algo se guarda o se borra, nada del formulario se puede tocar.
    function alternarOcupado(ocupado) {
      form.enviar.disabled = ocupado;
      form.cancelar.disabled = ocupado;
      form.borrar.disabled = ocupado;
      form.borrarSi.disabled = ocupado;
      form.borrarNo.disabled = ocupado;
    }

    // Las categorías ya usadas: las del catálogo que se ve (incluye las del
    // repositorio) más las que devuelve categorias_slides().
    async function cargarSugerencias() {
      const conocidas = new Set(categoriasConocidas());
      if (typeof cargarCategoriasDeSlides === "function") {
        const resultado = await cargarCategoriasDeSlides();
        if (resultado.ok) resultado.categorias.forEach((c) => conocidas.add(c));
      }
      const opciones = listarCategorias([...conocidas].map((categoria) => ({ categoria })));
      form.categorias.replaceChildren(...opciones.map((categoria) => {
        const opcion = document.createElement("option");
        opcion.value = categoria;
        return opcion;
      }));
    }

    function categoriasConocidas() {
      return listarCategorias(catalogo);
    }

    // Con `actual` (la presentación que se edita) preselecciona a su autor
    // cuando llega la lista; si ya no está marcado y por eso no viene en ella,
    // lo deja como opción para que guardar sin tocarlo no lo cambie.
    async function cargarAutores(actual = null) {
      const seleccionado = (actual && actual.autor_id) || form.autor.value;
      form.autor.replaceChildren(new Option("Elige al autor", ""));
      const resultado = await cargarAutoresDeSlides();
      if (!resultado.ok) {
        campoError("Autor").textContent = resultado.mensaje;
        return;
      }
      const hayActual = Boolean(actual && actual.autor_id);
      if (resultado.autores.length === 0 && !hayActual) {
        campoError("Autor").textContent =
          "Todavía no hay autores marcados. Marca a alguien en Supabase antes de subir.";
        return;
      }
      resultado.autores.forEach((autor) => form.autor.append(new Option(autor.nombre, autor.id)));
      if (hayActual && !resultado.autores.some((autor) => autor.id === actual.autor_id)) {
        form.autor.append(new Option(actual.autor || "Autor actual", actual.autor_id));
      }
      if (seleccionado) form.autor.value = seleccionado;
    }

    // Cuenta las láminas del HTML elegido, igual que las cuenta el puente:
    // `section.slide` en el documento parseado, sin ejecutar nada.
    async function leerArchivoElegido() {
      laminasDetectadas = 0;
      campoError("Archivo").textContent = "";
      form.archivo.removeAttribute("aria-invalid");

      const archivo = form.archivo.files && form.archivo.files[0];
      if (!archivo) {
        escribir(form.archivoAyuda, textoDeAyudaDelArchivo());
        return;
      }

      try {
        const texto = await archivo.text();
        const documento = new DOMParser().parseFromString(texto, "text/html");
        laminasDetectadas = contarLaminas(documento);
      } catch {
        laminasDetectadas = 0;
      }

      if (laminasDetectadas > 0) {
        escribir(form.archivoAyuda, `Se detectaron ${textoLaminas(laminasDetectadas)}.`);
      } else {
        escribir(form.archivoAyuda, textoDeAyudaDelArchivo());
        campoError("Archivo").textContent = "No se encontró ninguna lámina (section.slide) en ese archivo.";
        form.archivo.setAttribute("aria-invalid", "true");
      }
    }

    // La portada se recorta al centro a 16:10 y se reduce a 1200x750 en un
    // <canvas>; sale como WebP. Devuelve null si el navegador no pudo.
    async function prepararPortada(archivo) {
      try {
        const imagen = await createImageBitmap(archivo);
        const recorte = rectanguloDeRecorte(imagen.width, imagen.height);
        if (!recorte) return null;
        const lienzo = document.createElement("canvas");
        lienzo.width = PORTADA_ANCHO;
        lienzo.height = PORTADA_ALTO;
        const contexto = lienzo.getContext("2d");
        contexto.drawImage(
          imagen, recorte.sx, recorte.sy, recorte.sw, recorte.sh, 0, 0, PORTADA_ANCHO, PORTADA_ALTO
        );
        if (typeof imagen.close === "function") imagen.close();
        const blob = await new Promise((resolver) => lienzo.toBlob(resolver, "image/webp", 0.85));
        return blob && blob.type === "image/webp" ? blob : null;
      } catch {
        return null;
      }
    }

    function mostrarErroresDeCampo(errores) {
      const campos = {
        titulo: ["Titulo", form.titulo],
        descripcion: ["Descripcion", form.descripcion],
        categoria: ["Categoria", form.categoria],
        portada: ["Portada", form.portada],
        archivo: ["Archivo", form.archivo],
        autor: ["Autor", form.autor],
        visibilidad: ["Visibilidad", null],
      };
      let primero = null;
      Object.entries(errores).forEach(([clave, mensaje]) => {
        const [nombre, control] = campos[clave] || [];
        if (!nombre) return;
        campoError(nombre).textContent = mensaje;
        if (control) {
          control.setAttribute("aria-invalid", "true");
          if (!primero) primero = control;
        }
      });
      if (primero) primero.focus();
    }

    async function enviarFormulario(evento) {
      evento.preventDefault();
      if (subiendo) return;
      limpiarErrores();

      const edicion = edicionActual;
      const archivo = form.archivo.files && form.archivo.files[0];
      const portadaElegida = form.portada.files && form.portada.files[0];
      const visibilidad = form.formulario.querySelector('input[name="visibilidad"]:checked');

      const validacion = validarSubida(
        {
          titulo: form.titulo.value,
          descripcion: form.descripcion.value,
          categoria: form.categoria.value,
          portada: portadaElegida,
          archivo,
          autorId: form.autor.value,
          visibilidad: visibilidad ? visibilidad.value : "",
        },
        {
          esAdmin: permisos.admin,
          categorias: categoriasConocidas(),
          slugsOcupados: catalogo.map((item) => item.slug),
          ...(edicion ? { modo: "edicion", slugPropio: edicion.slug } : {}),
        }
      );
      if (!validacion.ok) {
        mostrarErroresDeCampo(validacion.errores);
        return;
      }

      // Al editar el archivo es opcional: sólo se cuentan láminas si se eligió
      // uno. Al subir, la validación ya garantizó que hay archivo.
      if (archivo && laminasDetectadas < 1) {
        // Todavía no terminó de leerse, o de verdad no trae láminas.
        await leerArchivoElegido();
        if (laminasDetectadas < 1) {
          form.archivo.focus();
          return;
        }
      }

      subiendo = true;
      alternarOcupado(true);
      form.enviar.textContent = edicion ? "Guardando…" : "Subiendo…";

      try {
        let portada = null;
        if (portadaElegida) {
          portada = await prepararPortada(portadaElegida);
          if (!portada) {
            mostrarErroresDeCampo({ portada: "Tu navegador no pudo preparar la portada. Prueba con otra imagen." });
            return;
          }
        }

        const resultado = edicion
          ? await editarSlide({
            id: edicion.id,
            slug: edicion.slug,
            autorIdActual: edicion.autor_id,
            archivoPathActual: edicion.archivo_path,
            portadaPathActual: edicion.portada_path,
            visibilidadActual: edicion.visibilidad,
            versionActual: edicion.version,
            titulo: form.titulo.value,
            descripcion: form.descripcion.value,
            categoria: form.categoria.value,
            categoriasExistentes: categoriasConocidas(),
            archivo: archivo || undefined,
            totalLaminas: archivo ? laminasDetectadas : undefined,
            portada: portada || undefined,
            quitarPortada: form.quitarPortada.checked,
            // Sólo un administrador decide autor y visibilidad: para el
            // resto ni se mandan (la base los ignoraría de todos modos).
            autorId: permisos.admin ? form.autor.value : undefined,
            visibilidad: permisos.admin && visibilidad ? visibilidad.value : undefined,
          })
          : await subirSlide({
            titulo: form.titulo.value,
            descripcion: form.descripcion.value,
            categoria: form.categoria.value,
            categoriasExistentes: categoriasConocidas(),
            archivo,
            portada,
            totalLaminas: laminasDetectadas,
            autorId: form.autor.value,
            visibilidad: visibilidad ? visibilidad.value : "",
          });

        if (!resultado.ok) {
          form.error.textContent = resultado.mensaje;
          return;
        }

        form.dialogo.close();
        if (typeof mostrarToast === "function") {
          const aRevision = resultado.visibilidad === "por_revisar" && !permisos.admin;
          let mensaje = "Presentación subida.";
          if (edicion) {
            mensaje = aRevision
              ? "Cambios guardados. Un administrador la revisará antes de publicarla."
              : "Cambios guardados.";
          } else if (resultado.visibilidad === "por_revisar") {
            mensaje = "Listo. Un administrador la revisará antes de publicarla.";
          }
          mostrarToast(mensaje, "success");
        }
        await cargarCatalogo();
      } finally {
        subiendo = false;
        form.enviar.textContent = textoDeEnviar();
        alternarOcupado(false);
      }
    }

    /* ---------- Hash: qué se ve ---------- */

    /*
      "Atrás" desde el visor tiene que llevar al catálogo, siempre. Cada
      entrada del historial que abre el visor lleva la marca
      `{ slidesVisor: true }`; si la página arranca en `#/<slug>` sin esa
      marca (un enlace directo), se entró de afuera y detrás no hay catálogo:
      se reescribe la entrada actual como catálogo y se apila el visor
      encima. Con la marca (una recarga) no se toca nada, para no duplicar el
      catálogo en el historial.
    */
    function ponerCatalogoDetras() {
      const slug = slugDesdeHash(window.location.hash);
      if (!slug || !catalogo.some((item) => item.slug === slug)) return;
      if (window.history.state && window.history.state.slidesVisor) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      window.history.pushState({ slidesVisor: true }, "", `#/${slug}`);
    }

    // pushState no dispara `hashchange`, por eso se aplica a mano.
    function abrirDesdeCatalogo(slug) {
      window.history.pushState({ slidesVisor: true }, "", `#/${slug}`);
      aplicarHash();
    }

    function aplicarHash() {
      const slug = slugDesdeHash(window.location.hash);
      const presentacion = slug ? catalogo.find((item) => item.slug === slug) : null;
      if (presentacion) abrirVisor(presentacion);
      else cerrarVisor();
    }

    function abrirVisor(presentacion) {
      const esNueva = presentacionActual?.slug !== presentacion.slug;
      presentacionActual = presentacion;

      el.catalogo.hidden = true;
      el.visor.hidden = false;

      if (esNueva) cargarPresentacionEnIframe(presentacion);
      if (esNueva) el.visorTitulo.focus();
    }

    function cerrarVisor() {
      if (!presentacionActual) { el.catalogo.hidden = false; el.visor.hidden = true; return; }
      presentacionActual = null;
      deckConectado = false;
      // Navegar a about:blank descarga el deck (para sus gráficas y su
      // animación de fondo, si tuviera) en vez de dejarlo corriendo oculto.
      try {
        el.iframe.contentWindow.location.replace("about:blank");
      } catch {
        // Mismo origen siempre en este visor; si algún día no lo fuera, no
        // pasa nada por no poder descargarlo a mano.
      }
      el.marco.classList.remove("slides__marco--subida", "slides__marco--llena");
      el.controles.hidden = false;
      el.catalogo.hidden = false;
      el.visor.hidden = true;
    }

    /* ---------- Carga del deck en el <iframe> ---------- */

    // Una presentación se carga UNA sola vez en el <iframe>: moverse entre
    // sus diapositivas después es cosa de `slidesDeck.ir(n)`, no de volver a
    // navegar. `location.replace` y no `iframe.src`: asignar `src` apila una
    // entrada en el historial por cada carga, y "atrás" retrocedía ahí en vez
    // de volver al catálogo.
    function cargarPresentacionEnIframe(presentacion) {
      indiceActual = 0;
      totalActual = 0;
      deckConectado = false;
      // Un deck subido deja ver el cielo de la página detrás del marco: el
      // marco negro es de los decks del repositorio, que pintan su propio fondo.
      el.marco.classList.toggle("slides__marco--subida", presentacion.origen === "subida");
      // Sólo los decks de la excepción (el QR) llenan el alto; el resto de
      // los subidos va en 16:9 con los botones del visor, como los del repo.
      el.marco.classList.toggle("slides__marco--llena", llenaElVisor(presentacion));
      el.controles.hidden = false;
      escribir(el.visorTitulo, presentacion.titulo);
      escribir(el.contador, "");
      el.iframe.title = presentacion.titulo;
      actualizarControles();
      el.iframe.contentWindow.location.replace(presentacion.url);
    }

    // Cada `load` reemplaza el documento entero del <iframe>, y con él,
    // cualquier listener agregado en la carga anterior — no hace falta
    // desconectar nada a mano. También dispara al cerrar el visor (navegar a
    // about:blank), por eso el primer chequeo.
    function manejarCargaDelIframe() {
      if (!presentacionActual) return;

      let ventana = null;
      try {
        ventana = el.iframe.contentWindow;
      } catch {
        ventana = null;
      }
      if (!ventana) return;

      try {
        ventana.addEventListener("keydown", (evento) => manejarTeclaDelIframe(evento, evento.target));
        ventana.document.addEventListener("slides:cambio", recibirCambioDeDeck);
      } catch {
        // Un origen distinto (no debería pasar acá) se queda sin teclado ni
        // contador dentro del iframe; los botones de la página siguen
        // deshabilitados, como con cualquier deck sin `slidesDeck`.
      }

      const deck = ventana.slidesDeck;
      if (deck && typeof deck.ir === "function" && typeof deck.indice === "function") {
        indiceActual = indiceAcotado(deck.indice(), deck.total);
        totalActual = Number.isFinite(deck.total) ? deck.total : 0;
        deckConectado = true;
        // El deck trae su propia barra: la del visor sobra, pero sólo en los
        // que llenan el visor. Los demás conservan ‹ ⛶ › abajo (2026-10-07).
        el.controles.hidden = llenaElVisor(presentacionActual) && deck.controlesPropios === true;
      } else {
        indiceActual = 0;
        totalActual = 0;
        deckConectado = false;
      }
      actualizarControles();
    }

    function recibirCambioDeDeck(evento) {
      if (!presentacionActual) return;
      const detalle = (evento && evento.detail) || {};
      if (Number.isFinite(detalle.total)) totalActual = detalle.total;
      // Los decks subidos publican `slidesDeck` antes de descargar su HTML, así
      // que sólo en el primer cambio saben si traen botones propios.
      if (typeof detalle.controlesPropios === "boolean") {
        el.controles.hidden = llenaElVisor(presentacionActual) && detalle.controlesPropios;
      }
      indiceActual = indiceAcotado(detalle.indice, totalActual);
      actualizarControles();
    }

    function actualizarControles() {
      escribir(el.contador, totalActual > 0 ? `${indiceActual + 1} / ${totalActual}` : "");
      if (presentacionActual) {
        el.iframe.title = totalActual > 0
          ? `${presentacionActual.titulo}: diapositiva ${indiceActual + 1} de ${totalActual}`
          : presentacionActual.titulo;
      }
      el.anterior.disabled = !deckConectado || indiceActual <= 0;
      el.siguiente.disabled = !deckConectado || totalActual <= 0 || indiceActual >= totalActual - 1;
    }

    /* ---------- Navegación entre diapositivas de la MISMA presentación ---------- */

    // Nunca recarga el <iframe>: le pide al deck que se mueva. El propio
    // deck dispara `slides:cambio` al terminar show(), que es lo que
    // actualiza `indiceActual` y los controles — acá no hace falta
    // adelantarse a eso.
    function irA(indicePropuesto) {
      if (!presentacionActual || !deckConectado) return;
      const acotado = indiceAcotado(indicePropuesto, totalActual);
      if (acotado === indiceActual) return;

      let ventana = null;
      try {
        ventana = el.iframe.contentWindow;
      } catch {
        ventana = null;
      }
      if (!ventana || !ventana.slidesDeck) return;
      ventana.slidesDeck.ir(acotado);
    }

    /* ---------- Teclado de la página (afuera del <iframe>) ---------- */

    function manejarTecla(evento, elementoObjetivo) {
      if (!presentacionActual) return;
      const accion = accionParaTecla(evento.key, elementoObjetivo);
      if (!accion) return;

      evento.preventDefault();
      if (accion === "siguiente") irA(indiceActual + 1);
      else if (accion === "anterior") irA(indiceActual - 1);
      else if (accion === "primera") irA(0);
      else if (accion === "ultima") irA(totalActual - 1);
      else if (accion === "pantalla-completa") alternarPantallaCompleta();
    }

    /* ---------- Teclado DENTRO del <iframe>: sólo F ----------
       Las flechas, Home, End, PageUp/Down y espacio ya las escucha el propio
       deck (ver deck.js de cada carpeta) para moverse entre sus
       diapositivas; escucharlas también acá las movería dos veces por cada
       tecla. Se reutiliza accionParaTecla (mismo mapa que la página) y se
       descarta cualquier acción que no sea pantalla completa. */
    function manejarTeclaDelIframe(evento, elementoObjetivo) {
      const accion = accionParaTecla(evento.key, elementoObjetivo);
      if (accion !== "pantalla-completa") return;
      evento.preventDefault();
      alternarPantallaCompleta();
    }

    /* ---------- Pantalla completa ---------- */

    function alternarPantallaCompleta() {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
        return;
      }
      const solicitar = el.marco.requestFullscreen || el.marco.webkitRequestFullscreen;
      solicitar?.call(el.marco);
    }
  }

  function escribir(nodo, texto) {
    if (nodo.textContent !== texto) nodo.textContent = texto;
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
