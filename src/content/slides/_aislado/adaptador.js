/*
  Adaptador que se anexa al deck dentro del marco aislado (ver index.html).
  Corre en el MISMO documento que el JavaScript del deck, con origen opaco.

  Hace tres cosas, sin tocar la lógica del deck:
  1. Le cuenta al puente en qué lámina está (mensaje "slides:estado"), leyendo
     la clase `active` / `is-active` que el propio deck mueve.
  2. Obedece al puente: siguiente, anterior e ir(n) PULSAN los botones del
     deck (#next, #prev) para que corra su lógica (los pasos de un árbol, los
     contadores); si no existen, marca la clase a mano.
  3. Cede la pantalla completa: la maneja el visor, no el deck. Un marco
     aislado puede no tener permiso, así que `requestFullscreen` avisa al
     puente en vez de ejecutarse.

  Hacia el padre se escribe con "*" porque un origen opaco no tiene otro
  destino posible; quien recibe valida `event.source`. Las funciones puras
  están en adaptador.logica.js. El puente descarga los dos archivos y los
  manda al marco como texto, logica primero, en un mismo <script>.
*/
(function () {
  const padre = window.parent;
  if (!padre || padre === window) return;

  const avisar = (mensaje) => {
    try {
      padre.postMessage(mensaje, "*");
    } catch {
      // Sin padre al que avisar: no hay nada que hacer.
    }
  };

  /* ---------- Estado ---------- */

  let ultimo = "";
  function informarEstado(forzar) {
    const estado = estadoDe(document);
    const huella = `${estado.indice}/${estado.total}/${estado.controlesPropios}`;
    if (!forzar && huella === ultimo) return;
    ultimo = huella;
    avisar(estado);
  }

  // Cualquier cambio de clase (la navegación del deck) o la llegada de nodos
  // nuevos se refleja al puente, agrupado por cuadro.
  let pendiente = 0;
  function programar() {
    if (pendiente) return;
    pendiente = requestAnimationFrame(() => {
      pendiente = 0;
      informarEstado(false);
    });
  }
  new MutationObserver(programar).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
    childList: true,
  });

  /* ---------- Órdenes del puente ---------- */

  function paso(direccion) {
    const boton = document.getElementById(direccion === "siguiente" ? "next" : "prev");
    if (!boton) return false;
    boton.click();
    return true;
  }

  function irA(destino) {
    const laminas = laminasDe(document);
    if (laminas.length === 0) return;
    const meta = Math.min(laminas.length - 1, Math.max(0, destino));
    const actual = indiceActivo(laminas);

    // Un paso adyacente se da con UN clic: si la lámina tiene pasos internos
    // (un árbol), el clic los avanza y el visor ve el deck como lo diseñó su
    // autor. Para saltos largos se pulsa hasta llegar, con tope.
    let direccion = pasoHacia(actual, meta);
    let restantes = Math.abs(meta - actual) === 1 ? 1 : limiteDePasos(laminas.length);
    while (direccion && restantes > 0) {
      if (!paso(direccion)) {
        marcarActiva(laminas, meta);
        break;
      }
      restantes -= 1;
      direccion = pasoHacia(indiceActivo(laminasDe(document)), meta);
    }
    informarEstado(true);
  }

  window.addEventListener("message", (evento) => {
    if (evento.source !== padre) return;
    const orden = ordenDelPuente(evento.data);
    if (!orden) return;
    if (orden.tipo === "slides:consulta") {
      informarEstado(true);
      return;
    }
    if (orden.tipo === "slides:ir") {
      irA(orden.indice);
      return;
    }
    const actual = indiceActivo(laminasDe(document));
    irA(actual + (orden.tipo === "slides:siguiente" ? 1 : -1));
  });

  /* ---------- Pantalla completa: la tiene el visor ---------- */

  const pedirAlVisor = () => {
    avisar({ tipo: "slides:pantalla-completa" });
    return Promise.resolve();
  };
  try {
    Element.prototype.requestFullscreen = pedirAlVisor;
    if ("webkitRequestFullscreen" in Element.prototype) Element.prototype.webkitRequestFullscreen = pedirAlVisor;
    document.exitFullscreen = pedirAlVisor;
  } catch {
    // Si el navegador no deja reemplazarlas, el deck se queda con la suya.
  }

  informarEstado(true);
})();
