/*
  El fondo de estrellas del Generador de QR: el mismo cielo del inicio (y del
  extractor de PDF, Slides y Colaboradores).

  ES UNA COPIA DELIBERADA de las opciones de cargarParticulasFondo() en
  home/home.js, igual que colaboradores.fondo.js y slides.fondo.js, y por la
  misma razón: sacarlas a un módulo compartido obligaba a tocar el inicio.
  tests/colaboradores-pagina.test.js compara los literales y falla en cuanto
  uno cambie solo: si ajustas el cielo del inicio, trae el cambio también acá.

  El lienzo lo posiciona qr.css (#particles-fondo, fijo detrás de todo). Si el
  CDN no carga, la página funciona igual: es atmósfera, no funcionalidad.

  Mientras el QR está en pantalla completa, el cielo queda tapado por el
  diálogo blanco pero seguiría animándose: se pausa de verdad y se reanuda al
  cerrar (como hace Slides con su visor). Se observa el atributo `open` del
  diálogo y no `fullscreenchange` porque en iPhone no hay pantalla completa
  para una página: ahí el diálogo se abre como modal y nada más.
*/
function cargarFondoQR() {
  if (!window.tsParticles) return;

  window.tsParticles.load("particles-fondo", {
    /* 30 fps basta para partículas que derivan lento y reduce a la mitad el
       costo de redibujar el canvas de pantalla completa en cada frame. */
    fpsLimit: 30,
    fullScreen: {
      enable: false,
      zIndex: 0,
    },
    background: {
      color: { value: "transparent" },
    },
    particles: {
      number: {
        value: 150,
        density: {
          enable: true,
          width: 1920,
          height: 1080,
        },
      },
      color: {
        /* Cian y azul dominan, y el casi blanco es una de cada cinco: el texto
           es blanco y las estrellas no deben competir con él por tono. El
           azul es #4f8cff y no #1d63ff porque el profundo tiene poca
           luminancia y desaparece en pantallas con poco brillo. */
        value: ["#00d7ff", "#00d7ff", "#5ad7ff", "#4f8cff", "#c8f7ff"],
      },
      links: {
        enable: false,
      },
      move: {
        enable: true,
        speed: { min: 0.12, max: 0.55 },
        direction: "none",
        random: true,
        straight: false,
        outModes: { default: "out" },
      },
      shape: {
        type: "circle",
      },
      shadow: {
        enable: true,
        blur: 3,
        color: { value: "#00d2ff" },
        offset: { x: 0, y: 0 },
      },
      /* El PISO de opacidad es alto a propósito (2026-09-05): en una pantalla
         con poco brillo muere lo cercano al negro, así que ninguna estrella
         baja de 0.35. El techo va a 1 para que las más brillantes lleguen a
         blanco. El tamaño no cambia: el pedido fue brillo, no estrellas más
         grandes.

         `animation.minimumValue` tiene que ir IGUAL que `value.min`: es el
         mínimo hasta donde baja la animación, y si queda por debajo el piso
         declarado no es el piso que se ve. Hay un test que lo fija. */
      opacity: {
        value: { min: 0.35, max: 1 },
        animation: {
          enable: true,
          speed: 0.45,
          minimumValue: 0.35,
          sync: false,
        },
      },
      size: {
        value: { min: 0.5, max: 2.1 },
        animation: {
          enable: true,
          speed: 0.8,
          minimumValue: 0.35,
          sync: false,
        },
      },
    },
    interactivity: {
      events: {
        onHover: { enable: false },
        onClick: { enable: false },
        resize: true,
      },
    },
    detectRetina: true,
  });
}

document.addEventListener("DOMContentLoaded", cargarFondoQR);

/*
  tsParticles v2 expone cada instancia cargada por índice con
  tsParticles.domItem(); ésta es la primera (y única) de la página. Sin
  instancia todavía (el CDN no llegó) no hay nada que pausar ni reanudar.
*/
document.addEventListener("DOMContentLoaded", function () {
  var pantalla = document.getElementById("qrPantalla");
  if (!pantalla) return;
  new MutationObserver(function () {
    var instancia = window.tsParticles && window.tsParticles.domItem(0);
    if (!instancia) return;
    if (pantalla.open) instancia.pause();
    else instancia.play();
  }).observe(pantalla, { attributes: true, attributeFilter: ["open"] });
});
