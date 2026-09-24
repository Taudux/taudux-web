/*
  El fondo de estrellas de la página de colaboradores: el mismo cielo del inicio.

  ES UNA COPIA DELIBERADA de las opciones de cargarParticulasFondo() en
  home/home.js. Extraerlas a un módulo compartido obligaba a tocar home.js y el
  orden de scripts del inicio, y esta página no justifica ese riesgo. El costo
  de copiar es que las dos se desfasen en silencio, así que
  tests/colaboradores-pagina.test.js compara los dos literales y falla en cuanto
  uno cambie solo: si ajustas el cielo del inicio, trae el cambio acá también.

  El posicionamiento del lienzo (#particles-fondo fijo, 100lvh) lo pone
  colaboradores.css, igual que home.css lo hace allá.
*/
function cargarFondoColaboradores() {
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

document.addEventListener("DOMContentLoaded", cargarFondoColaboradores);
