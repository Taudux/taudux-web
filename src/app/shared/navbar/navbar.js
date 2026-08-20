/*
  Navbar compartido por todas las páginas. Depende de auth.service.js y debe
  cargarse después de ese servicio.
*/

/*
  La jerarquía de 2 niveles vive en el campo `hijos`. Una entrada con `hijos`
  es una cabecera de grupo pura (sin `href`/`habilitado` propios): al
  renderizar se convierte en un acordeón que despliega sus hijos in-place
  dentro del propio panel desplegable, nunca en una navegación a una página
  índice (ver crearAcordeonMenu).
*/
const ENLACES_NAVEGACION_BASE = [
  { texto: "Mi cuenta", href: "/app/features/portal/", habilitado: true },
  {
    texto: "Academy",
    hijos: [
      { texto: "Cursos", href: "/app/features/courses/cursos.html", habilitado: true },
      { texto: "Notas", habilitado: false },
    ],
  },
  { texto: "Noticias", habilitado: false },
  {
    texto: "Tools",
    hijos: [
      {
        texto: "Transacciones financieras",
        href: "/app/features/transactions/",
        habilitado: true,
      },
      {
        // Deshabilitado y sólo para admin: `habilitado: false` lo pinta en gris,
        // `soloAdmin` decide quién llega a verlo siquiera.
        texto: "Detector de imágenes IA",
        href: "/app/features/detector/detector.html",
        habilitado: false,
        soloAdmin: true,
      },
    ],
  },
  { texto: "Proyectos", habilitado: false },
  {
    /*
      Va al final y en primer nivel a propósito: no es una herramienta más, y a
      dos clics dentro de "Tools" un admin no lo encontraría.

      Vivía dentro de `features/transactions/extractor.js`, así que sólo existía
      en esa página: un admin parado en Cursos o en el Portal no tenía cómo
      llegar al panel desde el menú. Al traerlo acá aparece en todas.

      El criterio de rol NO cambió con la mudanza, aunque lo parezca: el
      `es_admin` que devolvía el backend del extractor sale de consultar
      `public.perfiles.rol` (ver `_es_admin()` en extractor/app.py), que es la
      misma fila que lee esto. Cambia quién pregunta, no la fuente.

      Con una excepción que sólo existe en local: si el extractor corre en modo
      simulador, `_es_admin()` se resuelve contra un `set` de correos del código
      en vez de la base. Ahí sí pueden discrepar, y por eso el panel podría
      aparecer o faltar en local sin que signifique nada sobre producción.
    */
    texto: "Panel de administración",
    href: "/app/features/transactions/admin.html",
    habilitado: true,
    soloAdmin: true,
  },
];

/*
  Los items `soloAdmin` desaparecen del menú para quien no lo sea, en vez de
  pintarse en gris: anunciarle una sección que no le corresponde sólo genera
  preguntas. Ojo, esto es cosmética — la URL sigue abriendo para cualquiera
  porque el sitio es estático y no hay servidor que niegue nada. Sirve para
  ordenar el menú, NO como control de acceso.

  Devuelve copias: ENLACES_NAVEGACION_BASE es un módulo compartido entre los dos
  paneles (mobile y cuenta), y filtrarlo en el lugar dejaría el menú recortado
  para el siguiente montaje.
*/
function filtrarEnlacesPorRol(enlaces, esUsuarioAdmin) {
  return enlaces
    .filter((enlace) => !enlace.soloAdmin || esUsuarioAdmin)
    .map((enlace) =>
      enlace.hijos
        ? { ...enlace, hijos: filtrarEnlacesPorRol(enlace.hijos, esUsuarioAdmin) }
        : enlace
    )
    // Una cabecera que se quedó sin hijos se despliega y no ofrece nada.
    .filter((enlace) => !enlace.hijos || enlace.hijos.length > 0);
}

async function salirYVolver(evento) {
  if (evento) evento.preventDefault();
  const resultado = await cerrarSesion();
  if (!resultado.ok) {
    if (typeof mostrarToast === "function") mostrarToast(resultado.mensaje, "error");
    return;
  }
  window.location.href = "/";
}

window.addEventListener("taudux:operation-error", () => {
  queueMicrotask(() => {
    if (typeof mostrarToast !== "function") return;
    const reporteVisible = document.querySelector(
      '[role="alert"]:not([hidden]), .courses__startup-status--error:not([hidden]), .courses__data-status--error:not([hidden])'
    );
    if (!reporteVisible) {
      mostrarToast("No se pudo completar la operación. Intenta nuevamente.", "error");
    }
  });
});

function actualizarEstadoVisualNavbar() {
  const navbar = document.getElementById("navbar");
  if (!navbar) return;

  const desplazado = window.scrollY > 60;
  navbar.classList.toggle("navbar--scrolled", desplazado);

  /*
    Misión/Visión/Valores no acompañan al hero: recién aparecen cuando el hero
    terminó de salir de pantalla, o sea cuando la segunda sección toca el tope.
    Se mide el borde inferior real del hero en cada frame en vez de comparar
    contra un umbral fijo en píxeles, para que el corte siga siendo exacto si
    el hero cambia de alto (rotar el teléfono, fuentes que cargan tarde).
    Sin hero —cualquier página que no sea el landing— la clase nunca se activa.
  */
  const hero = document.querySelector(".hero");
  const heroFueraDePantalla = Boolean(hero) && hero.getBoundingClientRect().bottom <= 0;
  navbar.classList.toggle("navbar--pasado-hero", heroFueraDePantalla);
}

/* Cache para no repetir querySelectorAll en cada evento de scroll. */
let seccionesConId = [];
let enlacesDeAncla = [];

function cachearElementosDeScroll() {
  seccionesConId = document.querySelectorAll("section[id]");
  enlacesDeAncla = document.querySelectorAll('.navbar__link[href^="#"]');
}

function actualizarEnlaceActivo() {
  if (!seccionesConId.length && !enlacesDeAncla.length) cachearElementosDeScroll();
  const secciones = seccionesConId;
  const enlaces = enlacesDeAncla;
  let seccionActual = "";

  secciones.forEach((seccion) => {
    if (window.scrollY >= seccion.offsetTop - 150) {
      seccionActual = seccion.id;
    }
  });

  enlaces.forEach((enlace) => {
    enlace.classList.toggle(
      "navbar__link--active",
      enlace.getAttribute("href") === `#${seccionActual}`
    );
  });
}

/*
  Cada desplegable registra acá su función de cierre. Al abrir uno se cierran
  los demás: en ≤760px los dos toggles conviven en una barra de 6.5rem y dos
  paneles abiertos a la vez se pisarían.
*/
const cerradoresDeDesplegables = [];

function crearDesplegable({ clase, idLista, etiqueta }) {
  const menu = document.createElement("div");
  menu.className = `nav-menu nav-menu--${clase}`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `nav-menu__toggle nav-menu__toggle--${clase}`;
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", idLista);
  toggle.setAttribute("aria-label", etiqueta);

  const lista = document.createElement("div");
  lista.className = "nav-menu__list floating-menu";
  lista.id = idLista;

  menu.appendChild(toggle);
  menu.appendChild(lista);

  return { menu, toggle, lista };
}

function conectarDesplegable({ menu, toggle, lista }) {
  function establecerMenuAbierto(abierto) {
    menu.classList.toggle("nav-menu--open", abierto);
    toggle.setAttribute("aria-expanded", String(abierto));
  }

  const cerrar = () => establecerMenuAbierto(false);
  cerradoresDeDesplegables.push(cerrar);

  toggle.addEventListener("click", (evento) => {
    evento.stopPropagation();
    const abriendo = !menu.classList.contains("nav-menu--open");
    if (abriendo) {
      cerradoresDeDesplegables.forEach((otroCerrar) => {
        if (otroCerrar !== cerrar) otroCerrar();
      });
    }
    establecerMenuAbierto(abriendo);
  });

  document.addEventListener("click", (evento) => {
    if (!menu.contains(evento.target)) cerrar();
  });

  menu.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && menu.classList.contains("nav-menu--open")) {
      cerrar();
      toggle.focus();
    }
  });

  /*
    Las anclas del landing no recargan la página, así que sin este cierre
    explícito el panel quedaría abierto tapando la sección recién saltada.
  */
  lista.addEventListener("click", (evento) => {
    if (evento.target.closest("a")) cerrar();
  });

  return cerrar;
}

function crearItemMenu({ texto, href, alHacerClick, destacado, habilitado = true, esHijo = false }) {
  if (!habilitado) {
    const item = document.createElement("span");
    item.className = "nav-menu__link nav-menu__link--disabled";
    if (esHijo) item.classList.add("nav-menu__link--child");
    item.setAttribute("aria-disabled", "true");
    item.textContent = texto;
    return item;
  }

  const enlace = document.createElement("a");
  enlace.href = href;
  enlace.className = "nav-menu__link floating-menu__link";
  if (destacado) enlace.classList.add("nav-menu__link--cta");
  if (esHijo) enlace.classList.add("nav-menu__link--child");
  enlace.textContent = texto;
  if (alHacerClick) enlace.addEventListener("click", alHacerClick);
  return enlace;
}

/*
  Combina el prefijo del contenedor padre (idLista del desplegable:
  "menuNavegacionLista" en mobile, "menuCuentaLista" en la cuenta de
  escritorio) con el texto normalizado del grupo, para que un mismo grupo
  ("Academy", "Tools") no choque de id entre ambos paneles: los dos conviven
  en el mismo documento y aria-controls exige unicidad.
*/
function idDePanelAcordeon(prefijoId, texto) {
  const slug = texto
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${prefijoId}-acordeon-${slug}`;
}

/*
  Grupo colapsable (Academy, Tools): a diferencia de crearItemMenu, el nodo
  que devuelve es un contenedor con hijos reales en el DOM, no una hoja
  aplanada. El toggle es un <button>, nunca un <a>: el listener de cierre
  global en conectarDesplegable cierra el panel entero cuando el click viene
  de un <a> (`evento.target.closest("a")`), y un botón no matchea ese
  selector, así que expandir el grupo no cierra el desplegable completo.

  `registroDeCierres` es un array local del panel que llama a esta función
  (uno por cada punto de render: panel mobile, grupo de cuenta), NO el
  `cerradoresDeDesplegables` global de arriba — ese resuelve la exclusión
  mutua entre los paneles "site" y "account"; este resuelve la exclusión
  mutua entre Academy y Tools dentro de un mismo panel.
*/
function crearAcordeonMenu({ texto, hijos }, { registroDeCierres, prefijoId }) {
  const contenedor = document.createElement("div");
  contenedor.className = "nav-menu__accordion";

  const idPanel = idDePanelAcordeon(prefijoId, texto);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-menu__link floating-menu__link nav-menu__accordion-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", idPanel);
  // Mismo <span> que crearItemMenu para los ítems con badge: el texto
  // suelto no se puede centrar con flex, necesita su propia caja (ver
  // .nav-menu__link-label en navbar.css).
  const etiqueta = document.createElement("span");
  etiqueta.className = "nav-menu__link-label";
  etiqueta.textContent = texto;
  toggle.appendChild(etiqueta);

  const panel = document.createElement("div");
  panel.className = "nav-menu__accordion-panel";
  panel.id = idPanel;

  const panelInterior = document.createElement("div");
  panelInterior.className = "nav-menu__accordion-panel-inner";
  hijos.forEach((hijo) => panelInterior.appendChild(crearItemMenu({ ...hijo, esHijo: true })));
  panel.appendChild(panelInterior);

  function establecerAbierto(abierto) {
    contenedor.classList.toggle("nav-menu__accordion--open", abierto);
    toggle.setAttribute("aria-expanded", String(abierto));
  }

  const cerrar = () => establecerAbierto(false);
  registroDeCierres.push(cerrar);

  // Arranca siempre cerrado; abrir este grupo cierra cualquier otro del
  // mismo registro (exclusión mutua, un solo grupo abierto a la vez).
  toggle.addEventListener("click", () => {
    const abriendo = !contenedor.classList.contains("nav-menu__accordion--open");
    if (abriendo) {
      registroDeCierres.forEach((otroCerrar) => {
        if (otroCerrar !== cerrar) otroCerrar();
      });
    }
    establecerAbierto(abriendo);
  });

  contenedor.appendChild(toggle);
  contenedor.appendChild(panel);
  return contenedor;
}

function enlaceDeSesion(session) {
  if (!session) {
    return { texto: "Acceder", href: RUTAS_AUTH.login, destacado: true };
  }
  return { texto: "Salir", href: "#", alHacerClick: salirYVolver };
}

async function nombreParaMenu(session, perfil) {
  if (!session) return null;
  const nombre = await nombreUsuario(session, perfil);
  return nombre || "Mi cuenta";
}

/*
  Las anclas salen del DOM, no de una constante: el markup de index.html sigue
  siendo la única fuente de esas secciones y no hay riesgo de que las dos copias
  se desincronicen. En páginas sin anclas devuelve [] y el panel arranca directo
  con los enlaces del sitio.
*/
function anclasDeLaPagina() {
  const anclas = document.querySelectorAll('.navbar__links .navbar__link[href^="#"]');
  return Array.from(anclas)
    .filter((ancla) => ancla.id !== "accessBtn")
    .map((ancla) => ({
      texto: ancla.textContent.trim(),
      href: ancla.getAttribute("href"),
    }));
}

function montarPanelNavegacion(lista, { anclas, enlaces }) {
  // `enlaces` llega con `hijos` tal cual está en ENLACES_NAVEGACION_BASE: el
  // dedupe y el render operan directo sobre ese array de nivel superior, sin
  // aplanar (ver crearAcordeonMenu).
  const textosDeAnclas = new Set(anclas.map((ancla) => ancla.texto.toLowerCase()));
  /*
    "Herramientas" puede existir a la vez como ancla del landing y como enlace
    del sitio. Si el ancla ya ocupa ese texto, el enlace se omite: dos entradas
    con el mismo nombre y distinto destino son indistinguibles.
  */
  const enlacesSinRepetir = enlaces.filter(
    (enlace) => !textosDeAnclas.has(enlace.texto.toLowerCase())
  );

  anclas.forEach((ancla) => lista.appendChild(crearItemMenu(ancla)));

  if (anclas.length && enlacesSinRepetir.length) {
    const divisor = document.createElement("hr");
    divisor.className = "nav-menu__divider";
    lista.appendChild(divisor);
  }

  // Registro propio de este panel: la exclusión mutua entre Academy y Tools
  // no se comparte con el grupo de cuenta (otro punto de render, ver
  // montarMenus) ni con cerradoresDeDesplegables (otro concern).
  const registroDeCierres = [];
  enlacesSinRepetir.forEach((enlace) => {
    if (enlace.hijos && enlace.hijos.length) {
      lista.appendChild(crearAcordeonMenu(enlace, { registroDeCierres, prefijoId: lista.id }));
    } else {
      lista.appendChild(crearItemMenu(enlace));
    }
  });
}

/*
  Shell síncrono: el botón se monta en DOMContentLoaded con su tamaño final para
  que el brand no salte cuando resuelve la sesión. El contenido de la lista lo
  completa montarMenus() después, con los datos de sesión ya resueltos.
*/
function montarNavegacionMovil() {
  const navbar = document.querySelector(".navbar");
  if (!navbar || !navbar.querySelector(".navbar__links")) return;

  const { menu, toggle, lista } = crearDesplegable({
    clase: "site",
    idLista: "menuNavegacionLista",
    etiqueta: "Menú de navegación",
  });
  toggle.textContent = "☰";

  navbar.prepend(menu);
  conectarDesplegable({ menu, toggle, lista });
}

async function montarMenus() {
  const boton = document.getElementById("accessBtn");
  if (!boton) return;

  // #accessBtn arranca oculto por CSS (navbar.css) para no parpadear el
  // "Acceder" plano mientras se resuelve la sesión. Si algo de acá adentro
  // falla antes del replaceWith, el finally lo revela como respaldo en vez
  // de dejarlo invisible para siempre.
  try {
    const session = await obtenerSesion();
    /*
      El perfil se resuelve una sola vez y de él salen las dos cosas que el menú
      necesita: el rol (para filtrar) y el nombre. obtenerPerfil() no cachea, así
      que pedirlo por separado costaría dos consultas en cada carga de página, y
      el navbar se monta en todas.
    */
    const perfil = session ? await obtenerPerfil(session) : null;
    const enlacesNavegacion = filtrarEnlacesPorRol(
      ENLACES_NAVEGACION_BASE,
      perfil?.rol === "admin"
    );

    const listaNavegacion = document.getElementById("menuNavegacionLista");
    if (listaNavegacion) {
      montarPanelNavegacion(listaNavegacion, {
        anclas: anclasDeLaPagina(),
        enlaces: enlacesNavegacion,
      });
    }

    const nombreCuenta = await nombreParaMenu(session, perfil);

    const { menu, toggle, lista } = crearDesplegable({
      clase: "account",
      idLista: "menuCuentaLista",
      etiqueta: nombreCuenta ? `Cuenta: ${nombreCuenta}` : "Cuenta",
    });
    toggle.classList.toggle("nav-menu__toggle--pulsing", !session);

    if (nombreCuenta) {
      const encabezado = document.createElement("div");
      encabezado.className = "nav-menu__header";
      encabezado.textContent = nombreCuenta;
      lista.appendChild(encabezado);
    }

    /*
      En mobile la navegación vive en la hamburguesa, así que este grupo se
      oculta por CSS. En desktop sigue siendo la única vía de navegación de las
      páginas sin fila de enlaces (cursos, transacciones, privacidad).
    */
    const grupoNavegacion = document.createElement("div");
    grupoNavegacion.className = "nav-menu__group nav-menu__group--nav";
    // Registro propio de este grupo: no comparte exclusión mutua con el
    // panel mobile (montarPanelNavegacion arma el suyo).
    const registroDeCierresCuenta = [];
    enlacesNavegacion.forEach((enlace) => {
      if (enlace.hijos && enlace.hijos.length) {
        grupoNavegacion.appendChild(
          crearAcordeonMenu(enlace, { registroDeCierres: registroDeCierresCuenta, prefijoId: lista.id })
        );
      } else {
        grupoNavegacion.appendChild(crearItemMenu(enlace));
      }
    });
    lista.appendChild(grupoNavegacion);

    const divisor = document.createElement("hr");
    divisor.className = "nav-menu__divider";
    lista.appendChild(divisor);
    lista.appendChild(crearItemMenu(enlaceDeSesion(session)));

    boton.replaceWith(menu);
    conectarDesplegable({ menu, toggle, lista });
  } finally {
    if (boton.isConnected) boton.style.visibility = "visible";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  montarNavegacionMovil();
  cachearElementosDeScroll();
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
  montarMenus();
});

/* Throttle con requestAnimationFrame: como mucho una actualización por frame,
   aunque lleguen varios eventos de scroll. */
let actualizacionPendiente = false;

window.addEventListener(
  "scroll",
  () => {
    if (actualizacionPendiente) return;
    actualizacionPendiente = true;
    requestAnimationFrame(() => {
      actualizarEstadoVisualNavbar();
      actualizarEnlaceActivo();
      actualizacionPendiente = false;
    });
  },
  { passive: true }
);
