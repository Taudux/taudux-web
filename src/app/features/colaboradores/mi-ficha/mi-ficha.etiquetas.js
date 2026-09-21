/*
  Editor de etiquetas genérico: un combobox de texto libre con sugerencias de
  un catálogo, un listbox de sugerencias y una lista de etiquetas ya elegidas
  que se pueden quitar y reordenar (con el teclado o arrastrando). Hoy sólo lo
  usa el Stack de "Mi ficha" (mi-ficha.js); se separa de ahí para que mañana
  lo puedan instanciar también Herramientas, Habilidades e Idiomas, cada uno
  con su propio prefijo de id de opción (ver más abajo) y sus propios nodos
  del DOM.

  La lógica pura de agregar/quitar/mover/sugerir sigue en
  mi-ficha.etiquetas.logica.js (agregarEtiqueta, quitarEtiqueta, moverEtiqueta,
  sugerenciasDeEtiqueta, indiceMasCercano) y este archivo depende de esas
  globales, igual que mi-ficha.etiquetas.logica.js depende de mi-ficha.logica.js:
  por eso se carga después de ambos y antes de mi-ficha.js.

  Esta fábrica no conoce el formulario: no sabe qué es `campos`, ni cómo se
  pinta un error de página. Recibe marcarError/limpiarError ya resueltos para
  su campo (definidos en el cierre de iniciar(), en mi-ficha.js) y sólo toca
  los nodos del DOM que le pasan.

  crearEditorDeEtiquetas recibe:
    campo             la clave en LIMITES_MI_FICHA y MENSAJES_MI_FICHA, por
                      ejemplo "stack".
    input             el combobox de texto.
    opciones          el <ul role="listbox"> de sugerencias.
    lista             el <ul> de las etiquetas ya elegidas.
    estado            la región aria-live de anuncios del widget (duplicados,
                      reordenar).
    ayuda             el <p> con el texto de ayuda del campo.
    prefijoIdOpcion   el prefijo de los id de cada <li role="option">. Tiene
                      que ser distinto por instancia: con dos listbox en la
                      misma página, dos instancias que generaran el mismo id
                      escribirían el mismo aria-activedescendant y el lector
                      de pantalla anunciaría la opción equivocada.
    textoAyuda        el texto de ayuda cuando todavía se puede escribir.
    textoAyudaLlena   el texto de ayuda cuando ya se llegó al máximo.
    nombrePlural      completa el aviso de duplicado: "ya está en tu
                      ${nombrePlural}.".
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
const CLASE_ETIQUETA_DUPLICADA = "mi-ficha__etiqueta--duplicada";

function crearEditorDeEtiquetas({
  campo,
  input,
  opciones,
  lista,
  estado,
  ayuda,
  prefijoIdOpcion,
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
  let resaltadaSugerencia = -1;
  let arrastre = null;

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

  function pintarLista() {
    lista.replaceChildren(...valores.map(crearEtiqueta));
  }

  /*
    Una etiqueta: una manija para reordenar (por teclado o arrastrando), el
    texto y un botón para quitarla. La manija y el botón de quitar son texto
    plano (no un span decorativo adentro): así evento.target en un clic o un
    pointerdown es siempre el botón, nunca un hijo suyo.
  */
  function crearEtiqueta(tecnologia, indice) {
    const item = document.createElement("li");
    item.className = "mi-ficha__etiqueta";

    const manija = document.createElement("button");
    manija.type = "button";
    manija.className = "mi-ficha__etiqueta-manija";
    manija.setAttribute("aria-label", `Reordenar ${tecnologia}`);
    manija.setAttribute("data-indice-stack", String(indice));
    manija.textContent = "⠿";
    manija.addEventListener("keydown", (evento) => manejarTecladoManija(evento, indice));
    manija.addEventListener("pointerdown", (evento) => iniciarArrastre(evento, indice));

    const texto = document.createElement("span");
    texto.className = "mi-ficha__etiqueta-texto";
    texto.textContent = tecnologia;

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "mi-ficha__etiqueta-quitar";
    quitar.setAttribute("aria-label", `Quitar ${tecnologia}`);
    quitar.textContent = "×";
    quitar.addEventListener("click", () => quitarEnIndice(indice));

    item.append(manija, texto, quitar);
    return item;
  }

  function enfocarManija(indice) {
    const item = lista.children[indice];
    if (!item) return;
    item.children[0].focus();
  }

  /*
    Al quitar, el foco va a la manija que quedó en el mismo índice; si ya no
    hay ninguna ahí (se quitó la última), a la anterior; si la lista quedó
    vacía, al input. Cuando quita Backspace (con `gestionarFoco: false`) el
    foco ya está en el input y se queda ahí: moverlo a una manija sería
    sorprender a quien sigue escribiendo.
  */
  function enfocarTrasQuitar(indiceQuitado) {
    if (valores.length === 0) { input.focus(); return; }
    enfocarManija(Math.min(indiceQuitado, valores.length - 1));
  }

  function quitarEnIndice(indice, { gestionarFoco = true } = {}) {
    const anterior = valores;
    valores = quitarEtiqueta(valores, indice);
    if (valores === anterior) return;
    pintarLista();
    actualizarLimite();
    if (gestionarFoco) enfocarTrasQuitar(indice);
  }

  function quitarUltima() {
    if (valores.length === 0) return;
    quitarEnIndice(valores.length - 1, { gestionarFoco: false });
  }

  // Reordenar desde la manija: el foco sigue a la etiqueta en su nueva
  // posición, y se anuncia por la región aria-live del widget.
  function mover(origen, destino) {
    const anterior = valores;
    valores = moverEtiqueta(valores, origen, destino);
    if (valores === anterior) return;
    const posicionFinal = Math.min(Math.max(destino, 0), valores.length - 1);
    pintarLista();
    enfocarManija(posicionFinal);
    anunciar(`${valores[posicionFinal]}, posición ${posicionFinal + 1} de ${valores.length}.`);
  }

  function manejarTecladoManija(evento, indice) {
    let destino;
    if (evento.key === "ArrowLeft") destino = indice - 1;
    else if (evento.key === "ArrowRight") destino = indice + 1;
    else if (evento.key === "Home") destino = 0;
    else if (evento.key === "End") destino = valores.length - 1;
    else return;
    evento.preventDefault();
    mover(indice, destino);
  }

  /*
    Arrastre con Pointer Events, como el recorte de portadas
    (gestionar-curso.portada.js). La captura va en `lista` (el contenedor, que
    nunca se recrea) y no en la manija que inició el arrastre: cada
    movimiento repinta la lista entera, y una manija capturada que desaparece
    del DOM perdería la captura a mitad de camino.
  */
  function iniciarArrastre(evento, indice) {
    arrastre = { pointerId: evento.pointerId, actual: indice };
    lista.setPointerCapture?.(evento.pointerId);
  }

  /*
    `children` es una HTMLCollection, no un arreglo: no tiene .map, .filter ni
    .forEach. Hay que copiarla. El DOM falso de los tests la finge con un
    arreglo de verdad, así que acá la suite no avisa; lo cubre un test de
    mi-ficha.pagina.test.js que lee este archivo (y mi-ficha.js).
  */
  function centrosDeEtiquetas() {
    return Array.from(lista.children).map((item) => {
      const rect = item.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
  }

  function moverArrastre(evento) {
    if (!arrastre || evento.pointerId !== arrastre.pointerId) return;
    const destino = indiceMasCercano(centrosDeEtiquetas(), { x: evento.clientX, y: evento.clientY });
    if (destino === -1 || destino === arrastre.actual) return;
    const anterior = valores;
    valores = moverEtiqueta(valores, arrastre.actual, destino);
    if (valores === anterior) return;
    arrastre.actual = Math.min(Math.max(destino, 0), valores.length - 1);
    pintarLista();
  }

  function terminarArrastre(evento) {
    if (!arrastre || evento.pointerId !== arrastre.pointerId) return;
    lista.releasePointerCapture?.(evento.pointerId);
    arrastre = null;
  }

  lista.addEventListener("pointermove", moverArrastre);
  lista.addEventListener("pointerup", terminarArrastre);
  lista.addEventListener("pointercancel", terminarArrastre);

  /* ---------- Sugerencias ---------- */

  function idDeOpcion(indice) {
    return `${prefijoIdOpcion}${indice}`;
  }

  function cerrarListbox() {
    sugerenciasActuales = [];
    resaltadaSugerencia = -1;
    opciones.hidden = true;
    opciones.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  /*
    Las opciones nunca reciben foco (role="option" sin tabindex): el resaltado
    se lleva con aria-activedescendant en el input y aria-selected en la
    opción, y se resuelve en mousedown con preventDefault() para que el clic
    nunca le quite el foco al input.
  */
  function pintarOpciones() {
    if (sugerenciasActuales.length === 0) { cerrarListbox(); return; }

    opciones.replaceChildren(...sugerenciasActuales.map((tecnologia, indice) => {
      const opcion = document.createElement("li");
      opcion.setAttribute("id", idDeOpcion(indice));
      opcion.setAttribute("role", "option");
      opcion.setAttribute("aria-selected", String(indice === resaltadaSugerencia));
      opcion.className = indice === resaltadaSugerencia
        ? "mi-ficha__stack-opcion mi-ficha__stack-opcion--resaltada"
        : "mi-ficha__stack-opcion";
      opcion.textContent = tecnologia;
      opcion.addEventListener("mousedown", (evento) => {
        evento.preventDefault();
        procesarConfirmacion(tecnologia);
      });
      return opcion;
    }));

    opciones.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (resaltadaSugerencia === -1) input.removeAttribute("aria-activedescendant");
    else input.setAttribute("aria-activedescendant", idDeOpcion(resaltadaSugerencia));
  }

  function actualizarSugerencias() {
    sugerenciasActuales = sugerenciasDeEtiqueta(catalogo, input.value, valores);
    resaltadaSugerencia = -1;
    pintarOpciones();
  }

  // Con tope en los extremos y sin dar la vuelta: abre el desplegable si
  // hacía falta y, si ya había algo resaltado, se mueve un paso desde ahí.
  function moverResaltado(delta) {
    if (sugerenciasActuales.length === 0) {
      sugerenciasActuales = sugerenciasDeEtiqueta(catalogo, input.value, valores);
      if (sugerenciasActuales.length === 0) return;
      resaltadaSugerencia = delta > 0 ? 0 : sugerenciasActuales.length - 1;
    } else if (resaltadaSugerencia === -1) {
      resaltadaSugerencia = delta > 0 ? 0 : sugerenciasActuales.length - 1;
    } else {
      resaltadaSugerencia = Math.min(Math.max(resaltadaSugerencia + delta, 0), sugerenciasActuales.length - 1);
    }
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
      anunciar(`${valores[resultado.indice]} ya está en tu ${nombrePlural}.`);
      resaltarEtiquetaDuplicada(resultado.indice);
      return;
    }

    if (resultado.motivo === "muchas") {
      anunciar(MENSAJES_MI_FICHA[campo].muchas);
      return;
    }

    marcarError(MENSAJES_MI_FICHA[campo][resultado.motivo]);
  }

  // Enter y "," confirman la opción resaltada; sin ninguna resaltada,
  // confirman el texto libre.
  function confirmarEntrada() {
    const texto = resaltadaSugerencia >= 0 && resaltadaSugerencia < sugerenciasActuales.length
      ? sugerenciasActuales[resaltadaSugerencia]
      : input.value;
    procesarConfirmacion(texto);
  }

  input.addEventListener("input", actualizarSugerencias);

  input.addEventListener("keydown", (evento) => {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      moverResaltado(1);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      moverResaltado(-1);
    } else if (evento.key === "Enter" || evento.key === ",") {
      evento.preventDefault();
      confirmarEntrada();
    } else if (evento.key === "Escape") {
      if (!opciones.hidden) {
        evento.preventDefault();
        cerrarListbox();
      }
    } else if (evento.key === "Backspace") {
      if (input.value === "") quitarUltima();
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
