/*
  Editor de etiquetas genérico: un combobox con sugerencias de un catálogo, un
  listbox de sugerencias y una lista de etiquetas ya elegidas que se pueden
  quitar y reordenar arrastrando. Lo instancian
  Herramientas, Habilidades e Idiomas de "Mi ficha" (mi-ficha.js), cada uno
  con sus propios nodos del DOM.

  Sólo se agrega lo que se ELIGE del catálogo (2026-10-13), y sólo con el
  mouse o el dedo: un clic o toque en una opción. Al abrirse la lista no hay
  nada resaltado (el resaltado es el :hover del CSS), las flechas y Enter no
  hacen nada (Enter sólo evita enviar el formulario), la coma tampoco, y no
  hay texto libre; sin catálogo, simplemente no hay qué agregar. Esc cierra la
  lista. Las etiquetas ya guardadas que no estén en el catálogo se conservan
  tal cual. Tampoco se quita nada con Backspace: una etiqueta se quita con su
  ✕.

  La lógica pura de agregar/quitar/mover/sugerir sigue en
  mi-ficha.etiquetas.logica.js (agregarEtiqueta, quitarEtiqueta, moverEtiqueta,
  sugerenciasDeEtiqueta, destinoDeArrastre) y este archivo depende de esas
  globales, igual que mi-ficha.etiquetas.logica.js depende de mi-ficha.logica.js:
  por eso se carga después de ambos y antes de mi-ficha.js.

  Esta fábrica no conoce el formulario: no sabe qué es `campos`, ni cómo se
  pinta un error de página. Recibe marcarError/limpiarError ya resueltos para
  su campo (definidos en el cierre de iniciar(), en mi-ficha.js) y sólo toca
  los nodos del DOM que le pasan.

  crearEditorDeEtiquetas recibe:
    campo             la clave en LIMITES_MI_FICHA y MENSAJES_MI_FICHA, por
                      ejemplo "herramientas".
    input             el combobox de texto.
    opciones          el <ul role="listbox"> de sugerencias.
    lista             el <ul> de las etiquetas ya elegidas.
    estado            la región aria-live de anuncios del widget (duplicados).
    ayuda             el <p> con el texto de ayuda del campo.
    textoAyuda        el texto de ayuda cuando todavía se puede escribir.
    textoAyudaLlena   el texto de ayuda cuando ya se llegó al máximo.
    nombrePlural      completa el aviso de duplicado: "ya está en tus
                      ${nombrePlural}.". Siempre un sustantivo plural
                      ("herramientas" hoy; mañana, "habilidades" e "idiomas"
                      también lo son), por eso el "tus" va fijo en la
                      plantilla.
    marcarError       (mensaje) => void, ya cerrado sobre el campo del
                      formulario.
    limpiarError      () => void, ídem.

  Devuelve exactamente tres funciones: establecer(valores) (reemplaza la
  lista entera, siempre sobre una copia), leer() (copia del arreglo actual) y
  fijarCatalogo(lista). Todo lo demás queda adentro.
*/

// Cuánto dura resaltada la etiqueta que ya estaba, cuando se intenta
// repetirla. El mismo criterio que el aviso de guardado del extractor.
const DURACION_RESALTADO_DUPLICADO_MS = 1200;
const CLASE_ETIQUETA_DUPLICADA = "mi-ficha__etiquetas-item--duplicada";
// La etiqueta "levantada" mientras se arrastra, y la lista que la contiene.
const CLASE_ETIQUETA_ARRASTRANDO = "mi-ficha__etiquetas-item--arrastrando";
const CLASE_LISTA_ARRASTRANDO = "mi-ficha__etiquetas-lista--arrastrando";
// Lo que dura el deslizamiento de una etiqueta a su nuevo lugar.
const DURACION_REORDENAR_MS = 180;
// Con el dedo, cuánto hay que mantener presionada una etiqueta para levantarla,
// y cuánto puede moverse el dedo antes: si se mueve más, es un scroll.
const ESPERA_ARRASTRE_TACTIL_MS = 250;
const TOLERANCIA_ARRASTRE_TACTIL_PX = 8;

function crearEditorDeEtiquetas({
  campo,
  input,
  opciones,
  lista,
  estado,
  ayuda,
  textoAyuda,
  textoAyudaLlena,
  nombrePlural,
  marcarError,
  limpiarError,
}) {
  // El estado del editor: vive acá y no en el DOM, porque el DOM (el input y
  // las dos listas) es sólo su pintura.
  let valores = [];
  let catalogo = [];
  let sugerenciasActuales = [];
  let arrastre = null;
  // Un toque que todavía no se convierte en arrastre: espera a cumplir
  // ESPERA_ARRASTRE_TACTIL_MS sin moverse.
  let pendiente = null;

  /* ---------- Editor de etiquetas ---------- */

  /*
    Reemplaza la lista entera (al cargar la ficha, o al guardarla y recibir
    de vuelta la versión normalizada). Nunca conserva el arreglo que llega: lo
    que se muta acá es siempre una copia.
  */
  function establecer(nuevosValores) {
    valores = Array.isArray(nuevosValores) ? [...nuevosValores] : [];
    input.value = "";
    cerrarListbox();
    pintarLista();
    actualizarLimite();
  }

  // Con el máximo alcanzado no se puede escribir una más: se avisa en la
  // misma ayuda que ya describe el campo.
  function actualizarLimite() {
    const llena = valores.length >= LIMITES_MI_FICHA[campo].max;
    input.disabled = llena;
    ayuda.textContent = llena ? textoAyudaLlena : textoAyuda;
  }

  function anunciar(mensaje) {
    estado.textContent = mensaje;
  }

  function prefiereMenosMovimiento() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  /*
    Repinta la lista y desliza cada etiqueta que cambió de lugar (técnica
    FLIP): antes de repintar se anota dónde está cada una (clave: su texto, que
    no se repite), y después se la anima desde esa posición vieja hasta la
    nueva con Web Animations. Cubre arrastrar (salvo la etiqueta arrastrada, que
    va con el puntero) y quitar con ✕ (las que quedan se corren). Es una animación corta
    y FINITA —180 ms, una vez— y no un bucle (regla de CLAUDE.md sobre
    animaciones infinitas); con prefers-reduced-motion no se anima nada.
    Donde no existe `animate` (navegadores viejos, el DOM falso de las
    pruebas) simplemente se repinta.

    La etiqueta levantada usa la propiedad individual `scale` en el CSS y
    esta animación sólo mueve `transform`: las dos se componen.
  */
  function pintarLista() {
    const animar = !prefiereMenosMovimiento();
    const antes = new Map();
    if (animar) {
      for (const item of Array.from(lista.children)) {
        const rect = item.getBoundingClientRect?.();
        if (rect) antes.set(item.children[1].textContent, rect);
      }
    }

    lista.replaceChildren(...valores.map(crearEtiqueta));
    marcarEtiquetaArrastrada();

    if (!animar || antes.size === 0) return;
    for (const [indice, item] of Array.from(lista.children).entries()) {
      // La que se arrastra no se desliza: va pegada al puntero (seguirPuntero).
      if (arrastre && indice === arrastre.actual) continue;
      if (typeof item.animate !== "function") continue;
      const anterior = antes.get(item.children[1].textContent);
      const rect = anterior && item.getBoundingClientRect?.();
      if (!rect) continue;
      const dx = anterior.left - rect.left;
      const dy = anterior.top - rect.top;
      if (dx === 0 && dy === 0) continue;
      item.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: DURACION_REORDENAR_MS, easing: "cubic-bezier(.2, .8, .2, 1)" },
      );
    }
  }

  // La clase de "levantada" y su desplazamiento viven en un nodo que cada
  // repintado recrea: se vuelven a poner después de cada uno.
  function marcarEtiquetaArrastrada() {
    if (!arrastre) return;
    lista.children[arrastre.actual]?.classList.add(CLASE_ETIQUETA_ARRASTRANDO);
    seguirPuntero();
  }

  /*
    La etiqueta levantada va pegada al puntero (2026-10-13; antes saltaba de
    hueco en hueco y entre saltos se quedaba quieta, y en el iPhone el dedo se
    separaba de ella). Se la corre con la propiedad individual `translate`
    desde su lugar en el layout hasta donde está el puntero, conservando el
    punto de donde se la tomó; `translate` se compone con el `scale` del
    levantado y con el `transform` de los deslizamientos, sin pisarlos.

    En horizontal no sale de la lista: un elemento transformado también
    cuenta para el ancho que se puede scrollear, y la página nunca scrollea
    en horizontal (regla de CLAUDE.md). En vertical puede asomar una fila por
    arriba o por abajo.
  */
  function seguirPuntero() {
    const item = lista.children[arrastre.actual];
    if (!item || !arrastre.punto) return;
    let izquierda = arrastre.punto.x - arrastre.toma.x;
    let arriba = arrastre.punto.y - arrastre.toma.y;
    const ancho = lista.clientWidth;
    if (Number.isFinite(ancho) && ancho > 0) {
      izquierda = Math.min(Math.max(izquierda, 0), Math.max(ancho - item.offsetWidth, 0));
    }
    const alto = lista.clientHeight;
    if (Number.isFinite(alto) && alto > 0) {
      arriba = Math.min(Math.max(arriba, -item.offsetHeight), alto);
    }
    arrastre.dx = izquierda - item.offsetLeft;
    arrastre.dy = arriba - item.offsetTop;
    item.style.translate = `${arrastre.dx}px ${arrastre.dy}px`;
  }

  // El puntero en coordenadas de la lista, las mismas que las cajas de layout.
  function puntoEnLista(clientX, clientY) {
    const origen = lista.getBoundingClientRect();
    return { x: clientX - origen.left, y: clientY - origen.top };
  }

  /*
    Una etiqueta: la manija ⠿, el texto y un botón para quitarla. El botón de
    quitar es texto plano (no un span decorativo adentro): así evento.target
    en un clic o un pointerdown es siempre el botón, nunca un hijo suyo.

    La manija es sólo un dibujo (2026-10-13): no es un botón, no entra con Tab
    y los lectores de pantalla no la leen. Antes era un botón que reordenaba
    con las flechas, pero se pidió que Tab no se detuviera en ella; desde
    entonces reordenar es sólo arrastrando. Con Tab se recorren las ✕.
  */
  function crearEtiqueta(tecnologia, indice) {
    const item = document.createElement("li");
    item.className = "mi-ficha__etiquetas-item";

    const manija = document.createElement("span");
    manija.className = "mi-ficha__etiquetas-item-manija";
    manija.setAttribute("aria-hidden", "true");
    manija.textContent = "⠿";

    const texto = document.createElement("span");
    texto.className = "mi-ficha__etiquetas-item-texto";
    texto.textContent = tecnologia;

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "mi-ficha__etiquetas-item-quitar";
    quitar.setAttribute("aria-label", `Quitar ${tecnologia}`);
    quitar.textContent = "×";
    quitar.addEventListener("click", () => quitarEnIndice(indice));

    item.append(manija, texto, quitar);
    item.addEventListener("pointerdown", (evento) => tocarEtiqueta(evento, indice, quitar));
    /*
      Mientras se arrastra con el dedo, la página no debe scrollear. En iOS
      Safari eso sólo lo frena un touchmove NO pasivo con preventDefault(); y
      va en la etiqueta y no en la lista porque los eventos táctiles siguen
      llegando al nodo donde empezó el toque aunque un repintado lo haya
      sacado del DOM, y desde ahí ya no suben a la lista.
    */
    item.addEventListener("touchmove", (evento) => {
      if (arrastre) evento.preventDefault();
    }, { passive: false });
    // El menú contextual que Android abre al mantener presionado.
    item.addEventListener("contextmenu", (evento) => evento.preventDefault());
    return item;
  }

  /*
    Al quitar, el foco va a la ✕ de la etiqueta que quedó en el mismo índice;
    si ya no hay ninguna ahí (se quitó la última), a la anterior; si la lista
    quedó vacía, al input.
  */
  function enfocarTrasQuitar(indiceQuitado) {
    if (valores.length === 0) { input.focus(); return; }
    lista.children[Math.min(indiceQuitado, valores.length - 1)]?.children[2].focus();
  }

  function quitarEnIndice(indice) {
    const anterior = valores;
    valores = quitarEtiqueta(valores, indice);
    if (valores === anterior) return;
    pintarLista();
    actualizarLimite();
    enfocarTrasQuitar(indice);
  }

  /*
    Toda la etiqueta se arrastra, menos su ✕ (2026-10-13; antes sólo la
    manija ⠿, y en iPhone el dedo caía sobre el texto y lo seleccionaba). Con
    mouse empieza al instante; con el dedo hay que mantenerla presionada
    ESPERA_ARRASTRE_TACTIL_MS, y si el dedo se mueve antes más de
    TOLERANCIA_ARRASTRE_TACTIL_PX es un scroll y no hay arrastre.
  */
  function tocarEtiqueta(evento, indice, quitar) {
    if (arrastre || pendiente) return;
    if (evento.target === quitar) return;
    if (evento.pointerType === "mouse") {
      if (evento.button > 0) return;
      iniciarArrastre(evento.pointerId, indice, evento.clientX, evento.clientY);
      return;
    }
    pendiente = {
      pointerId: evento.pointerId,
      x: evento.clientX,
      y: evento.clientY,
      // Dónde está el dedo ahora: puede temblar un poco sin cancelar la espera.
      ultimo: { x: evento.clientX, y: evento.clientY },
      temporizador: setTimeout(() => {
        const { ultimo } = pendiente;
        pendiente = null;
        iniciarArrastre(evento.pointerId, indice, ultimo.x, ultimo.y);
      }, ESPERA_ARRASTRE_TACTIL_MS),
    };
  }

  function cancelarPendiente() {
    if (!pendiente) return;
    clearTimeout(pendiente.temporizador);
    pendiente = null;
  }

  /*
    Arrastre con Pointer Events, como el recorte de portadas
    (gestionar-curso.portada.js). La captura va en `lista` (el contenedor, que
    nunca se recrea) y no en la etiqueta que inició el arrastre: cada
    movimiento repinta la lista entera, y una etiqueta capturada que desaparece
    del DOM perdería la captura a mitad de camino.
  */
  function iniciarArrastre(pointerId, indice, clientX, clientY) {
    const item = lista.children[indice];
    arrastre = { pointerId, actual: indice, punto: null, toma: null, dx: 0, dy: 0 };
    if (item && Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const punto = puntoEnLista(clientX, clientY);
      arrastre.punto = punto;
      arrastre.toma = { x: punto.x - item.offsetLeft, y: punto.y - item.offsetTop };
    }
    try {
      lista.setPointerCapture?.(pointerId);
    } catch {
      // Sin captura el arrastre sigue funcionando mientras el puntero esté
      // sobre la lista; no vale la pena abortarlo.
    }
    lista.classList.add(CLASE_LISTA_ARRASTRANDO);
    marcarEtiquetaArrastrada();
  }

  /*
    `children` es una HTMLCollection, no un arreglo: no tiene .map, .filter ni
    .forEach. Hay que copiarla. El DOM falso de los tests la finge con un
    arreglo de verdad, así que acá la suite no avisa; lo cubre un test de
    mi-ficha.pagina.test.js que lee este archivo (y mi-ficha.js).

    Las cajas son de LAYOUT (offsetLeft, offsetTop, offsetWidth, offsetHeight),
    no visuales: getBoundingClientRect() incluye el deslizamiento en curso de
    pintarLista y la escala de la etiqueta levantada, y medir ahí hacía que
    las etiquetas se intercambiaran de ida y vuelta mientras animaban. Los
    offsets son relativos a la lista (position: relative en el CSS), y el
    puntero se lleva a esas mismas coordenadas con el rectángulo de la propia
    lista, que nunca se transforma.
  */
  function cajasDeEtiquetas() {
    return Array.from(lista.children).map((item) => ({
      left: item.offsetLeft,
      top: item.offsetTop,
      width: item.offsetWidth,
      height: item.offsetHeight,
    }));
  }

  function moverArrastre(evento) {
    if (pendiente && evento.pointerId === pendiente.pointerId) {
      const dx = evento.clientX - pendiente.x;
      const dy = evento.clientY - pendiente.y;
      if (Math.hypot(dx, dy) > TOLERANCIA_ARRASTRE_TACTIL_PX) cancelarPendiente();
      else pendiente.ultimo = { x: evento.clientX, y: evento.clientY };
      return;
    }
    if (!arrastre || evento.pointerId !== arrastre.pointerId) return;
    const punto = puntoEnLista(evento.clientX, evento.clientY);
    // Sin coordenadas al empezar, se la toma desde el primer movimiento.
    if (!arrastre.toma) {
      const item = lista.children[arrastre.actual];
      if (item) arrastre.toma = { x: punto.x - item.offsetLeft, y: punto.y - item.offsetTop };
    }
    arrastre.punto = punto;
    const destino = destinoDeArrastre(cajasDeEtiquetas(), arrastre.actual, punto);
    const anterior = valores;
    if (destino !== -1 && destino !== arrastre.actual) {
      valores = moverEtiqueta(valores, arrastre.actual, destino);
    }
    if (valores === anterior) {
      seguirPuntero();
      return;
    }
    arrastre.actual = Math.min(Math.max(destino, 0), valores.length - 1);
    // pintarLista vuelve a pegar la etiqueta al puntero, ya en su hueco nuevo.
    pintarLista();
  }

  /*
    Al soltar, la etiqueta deja de seguir al puntero y se desliza desde donde
    quedó hasta su hueco, con la misma animación corta y finita de
    pintarLista; con prefers-reduced-motion cae directo.
  */
  function soltarEtiqueta() {
    const item = lista.children[arrastre.actual];
    if (!item) return;
    item.style.translate = "";
    const { dx, dy } = arrastre;
    if ((dx === 0 && dy === 0) || prefiereMenosMovimiento() || typeof item.animate !== "function") return;
    item.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: DURACION_REORDENAR_MS, easing: "cubic-bezier(.2, .8, .2, 1)" },
    );
  }

  function terminarArrastre(evento) {
    // Se soltó (o el navegador empezó a scrollear y canceló el puntero) antes
    // de cumplir la espera: fue un toque o un scroll, no un arrastre.
    if (pendiente && evento.pointerId === pendiente.pointerId) cancelarPendiente();
    if (!arrastre || evento.pointerId !== arrastre.pointerId) return;
    soltarEtiqueta();
    arrastre = null;
    lista.classList.remove(CLASE_LISTA_ARRASTRANDO);
    for (const item of Array.from(lista.children)) item.classList.remove(CLASE_ETIQUETA_ARRASTRANDO);
    // Soltar la captura va al final y protegido: si el navegador ya la había
    // soltado por su cuenta, releasePointerCapture lanza y la etiqueta se
    // quedaba «levantada» para siempre (2026-10-13).
    try {
      lista.releasePointerCapture?.(evento.pointerId);
    } catch {
      // La captura ya no estaba: no hay nada que soltar.
    }
  }

  lista.addEventListener("pointermove", moverArrastre);
  lista.addEventListener("pointerup", terminarArrastre);
  lista.addEventListener("pointercancel", terminarArrastre);

  /* ---------- Sugerencias ---------- */

  function cerrarListbox() {
    sugerenciasActuales = [];
    opciones.hidden = true;
    opciones.replaceChildren();
    input.setAttribute("aria-expanded", "false");
  }

  /*
    Las opciones nunca reciben foco (role="option" sin tabindex) y no hay
    resaltado por teclado: el único "resaltado" es el :hover del CSS. Elegir es
    un clic o un toque, que se resuelve en mousedown con preventDefault() para
    que nunca le quite el foco al input.

    El trozo que coincide con lo escrito va en <mark> (negritas por CSS), armado
    con nodos y textContent: lo escrito es texto del usuario y nunca pasa por
    innerHTML.
  */
  function llenarOpcion(opcion, tecnologia) {
    const consulta = normalizarClaveEtiqueta(input.value);
    const inicio = consulta === "" ? -1 : normalizarClaveEtiqueta(tecnologia).indexOf(consulta);
    // La clave normalizada puede cambiar de largo (una letra con acento
    // descompuesta); sólo se resalta cuando los largos coinciden, para no
    // marcar el trozo equivocado.
    const mismoLargo = normalizarClaveEtiqueta(tecnologia).length === tecnologia.length;
    if (inicio === -1 || !mismoLargo) {
      opcion.textContent = tecnologia;
      return;
    }
    const fin = inicio + consulta.length;
    const marca = document.createElement("mark");
    marca.className = "mi-ficha__etiquetas-opcion-coincidencia";
    marca.textContent = tecnologia.slice(inicio, fin);
    opcion.append(
      document.createTextNode(tecnologia.slice(0, inicio)),
      marca,
      document.createTextNode(tecnologia.slice(fin)),
    );
  }

  function pintarOpciones() {
    if (sugerenciasActuales.length === 0) { cerrarListbox(); return; }

    opciones.replaceChildren(...sugerenciasActuales.map((tecnologia) => {
      const opcion = document.createElement("li");
      opcion.setAttribute("role", "option");
      opcion.className = "mi-ficha__etiquetas-opcion";
      llenarOpcion(opcion, tecnologia);
      opcion.addEventListener("mousedown", (evento) => {
        evento.preventDefault();
        procesarConfirmacion(tecnologia);
      });
      return opcion;
    }));

    opciones.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function actualizarSugerencias() {
    sugerenciasActuales = sugerenciasDeEtiqueta(catalogo, input.value, valores);
    pintarOpciones();
  }

  function resaltarEtiquetaDuplicada(indice) {
    const item = lista.children[indice];
    if (!item) return;
    item.classList.add(CLASE_ETIQUETA_DUPLICADA);
    setTimeout(() => item.classList.remove(CLASE_ETIQUETA_DUPLICADA), DURACION_RESALTADO_DUPLICADO_MS);
  }

  /*
    Los motivos de agregarEtiqueta, traducidos: "vacio" no dice nada
    (quien arma la lista ya lo descarta en silencio), "duplicado" avisa por la
    región aria-live y resalta la etiqueta que ya estaba, "muchas" avisa el
    tope y "largo"/"caracteres" son errores de campo como cualquier otro, con
    el marcarError() que recibió esta instancia.
  */
  function procesarConfirmacion(texto) {
    const resultado = agregarEtiqueta(campo, valores, texto);
    cerrarListbox();

    if (resultado.ok) {
      valores = resultado.lista;
      input.value = "";
      pintarLista();
      actualizarLimite();
      limpiarError();
      return;
    }

    if (resultado.motivo === "vacio") return;

    if (resultado.motivo === "duplicado") {
      anunciar(`${valores[resultado.indice]} ya está en tus ${nombrePlural}.`);
      resaltarEtiquetaDuplicada(resultado.indice);
      return;
    }

    if (resultado.motivo === "muchas") {
      anunciar(MENSAJES_MI_FICHA[campo].muchas);
      return;
    }

    marcarError(MENSAJES_MI_FICHA[campo][resultado.motivo]);
  }

  input.addEventListener("input", actualizarSugerencias);

  // Sólo Enter y Esc tienen manejador. Enter no agrega nada (se elige con el
  // mouse o el dedo) pero se cancela: en un campo suelto enviaría el
  // formulario. Las flechas y la coma se dejan en paz.
  input.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
    } else if (evento.key === "Escape") {
      if (!opciones.hidden) {
        evento.preventDefault();
        cerrarListbox();
      }
    }
  });

  /* ---------- API pública ---------- */

  function leer() {
    return [...valores];
  }

  function fijarCatalogo(nuevoCatalogo) {
    catalogo = nuevoCatalogo;
  }

  return Object.freeze({ establecer, leer, fijarCatalogo });
}
