/*
  El cielo de estrellas del convertidor: el mismo del inicio y del extractor.

  ES UNA COPIA DELIBERADA de la configuración de cargarEstrellas() en
  transactions/extractor.js, que a su vez copia la de home/home.js. Se sigue el
  criterio ya establecido en colaboradores.fondo.js: extraer esto a un módulo
  compartido obligaría a tocar home.js y el orden de scripts del inicio, y esta
  página no justifica ese riesgo.

  El costo de copiar es que las copias se desfasen en silencio. Si ajustas el
  cielo del inicio, trae el cambio también acá.

  El posicionamiento del lienzo (#particulas-fondo fijo, detrás de todo) lo pone
  markdown.css, igual que extractor.css lo hace allá.

  Si el CDN no carga, la página funciona igual: es atmósfera, no funcionalidad.
*/
function cargarEstrellasConvertidor() {
  if (!window.tsParticles) return;

  window.tsParticles.load("particulas-fondo", {
    /* 30 fps basta para partículas que derivan lento y reduce a la mitad el
       costo de redibujar el canvas de pantalla completa en cada frame. */
    fpsLimit: 30,
    fullScreen: { enable: false, zIndex: 0 },
    background: { color: { value: "transparent" } },
    particles: {
      number: { value: 120, density: { enable: true, width: 1920, height: 1080 } },
      color: { value: ["#00d7ff", "#1d63ff", "#c8f7ff"] },
      links: { enable: false },
      move: {
        enable: true, speed: { min: 0.12, max: 0.55 },
        direction: "none", random: true, straight: false,
        outModes: { default: "out" },
      },
      shape: { type: "circle" },
      shadow: { enable: true, blur: 3, color: { value: "#00d2ff" }, offset: { x: 0, y: 0 } },
      opacity: {
        value: { min: 0.12, max: 0.72 },
        animation: { enable: true, speed: 0.45, minimumValue: 0.08, sync: false },
      },
      size: {
        value: { min: 0.5, max: 2.1 },
        animation: { enable: true, speed: 0.8, minimumValue: 0.35, sync: false },
      },
    },
    interactivity: {
      events: { onHover: { enable: false }, onClick: { enable: false }, resize: true },
    },
    detectRetina: true,
  });
}

// Los scripts del CDN van con defer: puede que aún no existan al correr esto.
if (window.tsParticles) {
  cargarEstrellasConvertidor();
} else {
  window.addEventListener("load", cargarEstrellasConvertidor);
}
