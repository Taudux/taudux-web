/*
  Marco aislado de los decks subidos que traen JavaScript (ver index.html).

  Espera UN mensaje { tipo: "slides:deck", html } de la página puente, que es
  su ventana padre, y se reemplaza por ese HTML. Como el documento corre en un
  <iframe sandbox> sin `allow-same-origin`, su origen es opaco: ni el deck ni
  esta página pueden tocar el almacenamiento ni la sesión del sitio.

  `event.origin` de un origen opaco es "null" y no sirve para validar; lo que
  se comprueba es QUIÉN lo mandó: `event.source === window.parent`.
*/
(function () {
  const RUTA_DEL_ADAPTADOR = "/content/slides/_aislado/";
  let recibido = false;

  window.addEventListener("message", (evento) => {
    if (recibido) return;
    if (evento.source !== window.parent) return;
    const datos = evento.data;
    if (!datos || datos.tipo !== "slides:deck" || typeof datos.html !== "string") return;
    recibido = true;

    // El adaptador se anexa al HTML escrito: document.open() borra el
    // documento y sus listeners, y el deck debe correr con el adaptador ya
    // presente. Un navegador interpreta lo que sigue a </html> dentro del body.
    const adaptador =
      `<script src="${RUTA_DEL_ADAPTADOR}adaptador.logica.js"></script>` +
      `<script src="${RUTA_DEL_ADAPTADOR}adaptador.js"></script>`;
    document.open();
    document.write(datos.html + adaptador);
    document.close();
  });
})();
