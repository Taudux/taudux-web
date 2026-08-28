/* Cuánto tiempo ACTIVO pasa alguien en una pantalla — sin decir quién.
 *
 * Contesta la pregunta del histograma del panel: ¿la gente resuelve lo suyo en
 * un minuto o se queda diez? Con eso se decide si la herramienta estorba o no.
 *
 * POR QUÉ ESTO EXISTE SI GA4 YA MIDE PERMANENCIA
 *
 * Porque el dato de GA4 vive en Google, no acá. El sitio sólo ESCRIBE a GA4:
 * no hay una sola línea que lea de vuelta. Traer esa métrica al panel exigiría
 * la Data API, una cuenta de servicio, una credencial en Cloud Run y un
 * tercero más en la cadena — para un número que igual no sería auditable.
 *
 * Y hay tres cosas que ese camino no arregla:
 *
 *   · Los bloqueadores tumban GA4. `extractor.js` ya tiene un guard
 *     `typeof gtag === "function"` justamente por eso, y no hay forma de saber
 *     a cuánta gente se pierde.
 *   · La definición de "engagement" la pone Google, con sus reglas. No es
 *     "cuánto estuvo en la herramienta".
 *   · El aviso de privacidad todavía debe declarar GA4. Apoyarse más en él
 *     agranda esa deuda; esta medición ya quedó declarada.
 *
 * Es lo que `openspec/docs/transacciones-financieras/limites-y-medicion.md` ya
 * decía: "En NUESTRA base, sin Google de por medio".
 *
 * Los dos números NO van a coincidir, y no es un error: miden cosas distintas.
 *
 * QUÉ VIAJA, Y ES UNA LISTA CERRADA
 *
 * Tres claves: los segundos, si había sesión iniciada (un booleano, no un
 * nombre) y si la visita llegó a producir una tabla. Nada más. No viaja
 * `user_id`, ni el correo, ni el id anónimo — y `tests/permanencia.test.js` lo
 * blinda clave por clave: agregar una pone la suite en rojo.
 *
 * El motivo no es estético. El 2026-08-28 se retiró del panel la sección
 * "Quién lo usa y cuánto" justamente porque cruzaba identidad con horario, y
 * eso es un perfil de uso. Medir la permanencia POR PERSONA sería lo mismo con
 * otro eje. El histograma no lo necesita: cuenta visitas, no gente.
 *
 * POR QUÉ TIEMPO ACTIVO Y NO TIEMPO DE RELOJ
 *
 * Una pestaña abierta toda la noche no son ocho horas de uso. El contador se
 * pausa en cuanto la pestaña deja de estar a la vista y se reanuda al volver.
 *
 * POR QUÉ `sendBeacon` Y NO `beforeunload`
 *
 * `beforeunload` no dispara de forma fiable en móvil —el sistema puede matar
 * la pestaña sin avisar— y además rompe el bfcache, que castiga a quien vuelve
 * con el botón atrás. `sendBeacon` sobrevive a la descarga de la página sin
 * retener nada ni bloquear la salida.
 *
 * LO QUE ESTA MEDICIÓN NO PUEDE HACER, DICHO ACÁ Y NO DESCUBIERTO DESPUÉS
 *
 * Se entrega UNA sola vez por visita. Si alguien se va a otra pestaña —lo que
 * dispara la entrega— y después vuelve y sigue trabajando, ese tiempo NO se
 * cuenta.
 *
 * Se podría arreglar mandando un identificador de visita y actualizando la
 * fila, pero este endpoint no lleva autenticación (una visita anónima también
 * cuenta), y una clave que elige el cliente sobre un endpoint abierto es una
 * puerta para sobreescribir filas ajenas. Entre subcontar y abrir esa puerta,
 * se subcuenta — y la sección del panel lo declara en pantalla en vez de
 * presentar el número como si fuera exacto.
 *
 * Y hay una pérdida que ninguna técnica evita: cerrar la tapa, quedarse sin
 * batería o matar el navegador no avisan a nadie.
 *
 * DEPENDE DEL ORDEN DE CARGA. Usa la constante `API` que declara
 * `api-cliente.js`; son scripts clásicos que comparten el scope global, así
 * que tiene que cargarse DESPUÉS de aquél.
 */
(() => {
  "use strict";

  const RUTA = "/api/visita";

  /* El rango plausible de una visita.
   *
   * Por debajo del piso no hubo visita: fue un rebote, y contarlo hundiría el
   * histograma con ruido. Por encima del techo hay una pestaña olvidada —o
   * alguien empujando basura a un endpoint sin autenticación—. Es la primera
   * criba, y la segunda está en el servidor: ésta se puede saltar con la
   * consola abierta. */
  const MINIMO_SEGUNDOS = 3;
  const MAXIMO_SEGUNDOS = 4 * 60 * 60;

  let acumulado = 0;      // milisegundos ya contados, con la pestaña a la vista
  let desde = null;       // cuándo volvió a estar visible; null = pausado
  let conSesion = false;
  let extrajo = false;
  let entregado = false;

  /* `performance.now()` y no `Date.now()`: es monótono, así que un ajuste del
     reloj del sistema —o el cambio de horario— no inventa ni borra minutos.
     El fallback existe para navegadores donde no esté. */
  const reloj = () => (
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now());

  function reanudar() {
    if (desde === null) desde = reloj();
  }

  function pausar() {
    if (desde === null) return;
    acumulado += reloj() - desde;
    desde = null;
  }

  function segundosActivos() {
    const enCurso = desde === null ? 0 : reloj() - desde;
    return Math.round((acumulado + enCurso) / 1000);
  }

  function entregar() {
    if (entregado) return;

    const segundos = segundosActivos();
    if (segundos < MINIMO_SEGUNDOS || segundos > MAXIMO_SEGUNDOS) return;

    if (typeof navigator === "undefined"
        || typeof navigator.sendBeacon !== "function") return;

    /* Se manda como texto plano a propósito: así el navegador lo trata como
       petición simple y no dispara el preflight de CORS, que un beacon en
       plena descarga de la página no llegaría a completar. El servidor lo
       parsea sin fiarse del `Content-Type`. */
    const cuerpo = JSON.stringify({
      segundos,
      con_sesion: conSesion,
      extrajo,
    });

    entregado = navigator.sendBeacon(`${API}${RUTA}`, cuerpo);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pausar();
      entregar();
    } else {
      reanudar();
    }
  });

  /* `pagehide` cubre la navegación y el cierre en escritorio, donde
     `visibilitychange` puede no llegar a tiempo. La guarda de `entregado` hace
     que los dos caminos no dupliquen la fila. */
  window.addEventListener("pagehide", () => {
    pausar();
    entregar();
  });

  /* La página avisa por evento en vez de que este módulo pregunte por la
     sesión: así no depende de `auth.service.js` ni de Supabase, y puede
     cargarse en pantallas que no tengan ninguno de los dos. */
  window.addEventListener("taudux:permanencia-sesion", (evento) => {
    conSesion = Boolean(evento.detail && evento.detail.conSesion);
  });

  window.addEventListener("taudux:permanencia-extraccion", () => {
    extrajo = true;
  });

  if (typeof document !== "undefined" && document.visibilityState !== "hidden") {
    reanudar();
  }
})();
