/* La descarga del Excel y del CSV, del lado del navegador (hallazgo F29).
 *
 * Por qué existe este test. La descarga era la ÚNICA llamada de `extractor.js`
 * que no pasaba por `apiFetch`: se disparaba con `location.href` contra una
 * ruta relativa. Eso rompe dos cosas a la vez, y ninguna se ve en el simulador
 * —donde un mismo Flask sirve la página y la API—:
 *
 *   1. **La URL apunta al sitio, no al servicio.** Navegar a
 *      `/api/descargar/xlsx` desde taudux.com pega contra Vercel, que no proxea
 *      `/api`. Medido: 404.
 *   2. **Una navegación no lleva cabeceras.** Aunque la URL fuera la correcta,
 *      `location.href` no puede mandar `Authorization: Bearer`, así que el
 *      servidor no sabría quién pide el archivo.
 *
 * De ahí que la descarga tenga que ser `fetch` + Blob: es la única forma de
 * mandar el token. Y con Blob aparece el tercer requisito, el nombre del
 * archivo — que ya no lo pone el navegador, lo pone este código leyendo
 * `Content-Disposition`.
 *
 * Los asertos miran el código, no la prosa: los comentarios de este repo
 * explican POR QUÉ algo se fue, y nombrar `location.href` al explicarlo no debe
 * hacer pasar (ni fallar) un test.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const SCRIPT = "src/app/features/transactions/extractor.js";
const CLIENTE = "src/app/features/transactions/api-cliente.js";
const PAGINA = "src/app/features/transactions/index.html";
const ESTILOS = "src/app/features/transactions/extractor.css";

// Los comentarios de bloque y de línea se sacan antes de mirar el código. Sin
// esto, explicar bien la eliminación de `location.href` la resucitaría a ojos
// del test — el incentivo exacto que no queremos crear.
const sinComentariosJs = (js) => js
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

const codigo = () => sinComentariosJs(read(SCRIPT));

test("the download never navigates the page away", () => {
  // `location.href` no puede llevar `Authorization`, y en el sitio real apunta
  // a taudux.com, donde no hay API. Era el corazón del fallo.
  assert.doesNotMatch(
    codigo(),
    /location\.href/,
    "la descarga no puede dispararse navegando: no lleva el token"
  );
});

test("the download goes through the shared client, so it carries the token", () => {
  const js = codigo();

  // Los dos botones tienen que terminar en la misma función, y esa función en
  // `apiFetch` — que es quien pone `Authorization: Bearer` y el host de la API.
  assert.match(js, /el\("btnExcel"\)\.addEventListener\("click",\s*\(\)\s*=>\s*descargar\("xlsx"\)\)/,
               "el botón de Excel debe llamar a descargar()");
  assert.match(js, /el\("btnCsv"\)\.addEventListener\("click",\s*\(\)\s*=>\s*descargar\("csv"\)\)/,
               "el botón de CSV debe llamar a descargar()");

  const cuerpo = js.slice(js.indexOf("async function descargar("));
  assert.notEqual(cuerpo, "", "debe existir una función descargar()");
  assert.match(cuerpo.slice(0, 3000), /apiFetch\(/,
               "la descarga debe pasar por apiFetch, como el resto de las llamadas");
});

test("the API host still comes from the shared constant, never from the page", () => {
  // Si `apiFetch` dejara de anteponer el host, la descarga volvería a pegar
  // contra Vercel sin que nadie se entere: el corte 2 renacería en otro archivo.
  assert.match(
    sinComentariosJs(read(CLIENTE)),
    /fetch\(`\$\{API\}\$\{ruta\}`/,
    "apiFetch debe anteponer la constante API a la ruta"
  );
});

test("it hands the file over as a blob and releases the object URL", () => {
  const js = codigo();

  // Sin `blob()` no hay archivo; sin `revokeObjectURL` el blob se queda en
  // memoria hasta recargar la página, y una tabla grande no es poca cosa.
  assert.match(js, /\.blob\(\)/, "debe leer la respuesta como Blob");
  assert.match(js, /URL\.createObjectURL\(/, "debe crear la URL del blob");
  assert.match(js, /URL\.revokeObjectURL\(/, "debe liberar la URL del blob");
  assert.match(js, /\.download\s*=/, "debe usar un <a download> sintético");
});

test("it takes the file name from Content-Disposition, with a fallback", () => {
  const js = codigo();

  // Con Blob el nombre ya no lo pone el navegador. El servidor lo manda en
  // `Content-Disposition` (`_nombre_archivo()` lo arma con banco y origen); si
  // esa cabecera no llegara, el archivo tiene que bajar con un nombre digno y
  // con su extensión, no como "descarga" sin más.
  assert.match(js, /Content-Disposition/i,
               "debe leer el nombre de la cabecera que lo trae");
  assert.match(js, /transacciones\.\$\{formato\}|transacciones_\$\{|`transacciones/,
               "debe tener un nombre de reserva si la cabecera no viene");
});

/*
  Este sí ejecuta código: saca los dos literales de expresión regular del propio
  archivo y los corre contra una cabecera REAL, capturada de la API con un
  estado de cuenta acentuado. Un aserto de texto no habría detectado el orden
  equivocado — que es exactamente el error fácil de cometer aquí.
*/
const literalRegex = (nombre) => {
  const encontrado = codigo().match(new RegExp(`const ${nombre} = (/.+?/[a-z]*);`));
  assert.notEqual(encontrado, null, `falta la expresión ${nombre}`);
  return new Function(`return ${encontrado[1]}`)();
};

// Medida contra el servicio el 2026-08-20 con "estado ñandú septiembre.pdf".
// Flask manda LAS DOS formas, y la degradada a ASCII va primero en la cadena.
const CABECERA_REAL =
  'attachment; filename="transacciones_bbva-bancomer_estado nandu septiembre_2026-08-20_1846.csv"; '
  + "filename*=UTF-8''transacciones_bbva-bancomer_estado%20%C3%B1and%C3%BA%20septiembre_2026-08-20_1846.csv";

test("the file name keeps its accents: filename* wins over the ASCII fallback", () => {
  const utf8 = CABECERA_REAL.match(literalRegex("NOMBRE_UTF8"));
  assert.notEqual(utf8, null, "debe encontrar la forma codificada");
  assert.match(decodeURIComponent(utf8[1]), /ñandú/,
               "la forma codificada es la que conserva los acentos");

  // Y la razón por la que el orden importa: la simple llega mutilada.
  const simple = CABECERA_REAL.match(literalRegex("NOMBRE_SIMPLE"));
  assert.notEqual(simple, null, "debe existir la forma de reserva");
  assert.match(simple[1], /estado nandu/,
               "la de reserva pierde el acento — por eso no puede ir primero");
  assert.doesNotMatch(simple[1], /"/, "no puede arrastrar las comillas al nombre");
});

test("it explains the failures the user can actually hit", () => {
  const js = codigo();

  // Los tres modos de fallo que hoy no se ven: el plan sin descargas (402), la
  // tabla que ya no está en el servidor (404) y la red caída. Antes, con
  // `location.href`, los tres se veían igual: no pasa nada.
  assert.match(js, /sin_descargas/, "debe distinguir el 402 del plan sin descargas");
  assert.match(js, /sin_datos/, "debe distinguir el 404 de la tabla que ya no está");
  assert.match(js, /catch\s*\(/, "un fallo de red no puede quedar en silencio");

  // El aviso va por toast y NO por `mostrarError`: esa función llama a
  // `ocultarTodo()`, que esconde la tabla recién extraída. Perder el resultado
  // por no poder bajarlo sería un castigo desproporcionado.
  assert.match(js, /mostrarToast\(/, "los fallos de descarga se avisan por toast");
  const cuerpo = js.slice(js.indexOf("async function descargar("), js.indexOf("async function descargar(") + 3000);
  assert.doesNotMatch(cuerpo, /mostrarError\(/,
                      "un fallo de descarga no puede borrar la tabla de la pantalla");
});

test("the page loads the toast the download depends on", () => {
  assert.match(
    read(PAGINA),
    /shared\/toast\/toast\.js/,
    "sin toast.js el aviso de fallo no existiría"
  );
});

test("the download buttons obey the server's flag and nothing else", () => {
  const js = codigo();
  const inicio = js.indexOf("function aplicarBloqueo(");
  assert.notEqual(inicio, -1, "debe existir aplicarBloqueo()");
  const cuerpo = js.slice(inicio, js.indexOf("\n}", inicio));

  // El front no conoce planes: recibe `puede.descargas` ya resuelto. Que el
  // plan `free` no deshabilite los botones se arregla en el SERVIDOR (donde
  // `free.descargas` pasó a `True`), no acá — y esto lo blinda: si la decisión
  // se tomara por nombre de plan, volvería a haber dos fuentes de verdad.
  const decision = cuerpo.match(/const puedeDescargar\s*=\s*(.+);/);
  assert.notEqual(decision, null, "el permiso de descarga debe resolverse en una sola línea");
  assert.match(decision[1], /^permisos\.descargas/,
               "el estado del botón sale de lo que dijo el servidor, no de un nombre de plan");
  assert.match(cuerpo, /el\(id\)\.disabled = !puedeDescargar/,
               "los dos botones siguen esa misma decisión");

  // Arranca cerrado a propósito: si la consulta de cuota falla, se ve de menos.
  assert.match(js, /let permisos = \{ paneles: \[\], descargas: false \}/,
               "sin respuesta del servidor, las descargas empiezan cerradas");
});

/* --------------------------------------------------------------------------
 * Sin cuenta no hay descarga (2026-08-21).
 *
 * El servidor pasó `anonimo.descargas` a `False` y `anonimo.limite` a `None`:
 * la cuota de 2 se midió en producción y no se hacía cumplir —cada petición
 * del navegador nacía con identidad nueva porque este archivo nunca llegó a
 * mandar `X-Sesion-Anon`— así que la frontera se movió a la descarga, que sí
 * es exigible desde el servidor.
 *
 * Lo que le toca al front son dos consecuencias, y NINGUNA es apagar los
 * botones: eso ya lo hace `aplicarBloqueo()` obedeciendo a `puede.descargas`,
 * y duplicarlo acá reintroduciría la segunda fuente de verdad que el test de
 * arriba existe para impedir.
 * ------------------------------------------------------------------------ */

test("the quota counter shows exactly when a ceiling exists", () => {
  /*
    La regla dejó de ser "ocultar al anónimo" el 2026-08-21: el anónimo AHORA
    tiene techo (1 al mes) y quien más necesita ver "te quedan N" es él. Y una
    cuenta sin límites propios no tiene techo (opt-in), así que a ella no hay
    N que mostrarle.

    Por eso el test fija la RELACIÓN y no un plan: el contador se oculta si y
    sólo si el servidor manda `limite: null`. Atarlo a "anonimo" volvería a
    romperse con el próximo vaivén del catálogo — como este mismo test, que
    fijaba lo contrario y quedó rojo por un cambio legítimo.
  */
  const js = codigo();
  const inicio = js.indexOf("function actualizarCuota(");
  assert.notEqual(inicio, -1, "debe existir actualizarCuota()");
  const cuerpo = js.slice(inicio, js.indexOf("\n}", inicio));

  assert.match(cuerpo, /cajaCuota/,
               "el contador tiene que poder ocultarse, no sólo cambiar de valor");
  assert.match(cuerpo, /hidden\s*=\s*cuota\.limite === null/,
               "sin techo no hay N; con techo, se muestra — sea de quien sea");
  assert.doesNotMatch(cuerpo, /hidden\s*=\s*cuota\.plan/,
                      "la visibilidad depende del techo, no del plan");
});

test("the page gives the quota counter a handle to hide it by", () => {
  const pagina = read(PAGINA);
  // Arranca oculto y lo revela el servidor: si `/api/cuota` falla o tarda, un
  // anónimo vería el parpadeo de "Te quedan — extracciones". Mismo criterio
  // que `let permisos = { descargas: false }`: de menos, nunca de más.
  assert.match(pagina, /<span class="cuota" id="cajaCuota" hidden>/,
               "sin id no se puede ocultar, y sin `hidden` se ve antes de saber");
  // `.cuota` declara `display: flex`, que le gana al `[hidden]` del navegador
  // por ser una regla de autor: sin la regla explícita, `hidden` no oculta.
  assert.match(read(ESTILOS), /\.cuota\[hidden\]/,
               "el atributo `hidden` necesita su regla o no hace nada");
});

test("the disabled download button tells whoever has no account what to do", () => {
  const js = codigo();
  const inicio = js.indexOf("function aplicarBloqueo(");
  const cuerpo = js.slice(inicio, js.indexOf("\n}", inicio));

  // "Tu plan no incluye descargas" no le dice nada a quien no eligió ningún
  // plan. El texto útil es el camino de salida, y es el ÚNICO lugar donde el
  // front mira el nombre del plan para las descargas: el permiso sigue
  // saliendo de `permisos.descargas` (test de arriba). Acá sólo se redacta.
  assert.match(cuerpo, /planActual === "anonimo"/,
               "el motivo del botón apagado depende de si hay cuenta o no");
  assert.match(cuerpo, /[Cc]rea una cuenta/,
               "al anónimo se le ofrece la salida, no un diagnóstico");
});

/* ---------------------------------------------------------------------------
 * La identidad de quien no tiene cuenta.
 *
 * Desde hoy el anónimo puede descargar. Eso reabre, para él, la cadena exacta
 * que F29 rompía para todos: la tabla se guarda bajo `_identidad()` al
 * extraer y se busca bajo `_identidad()` al descargar. Con cuenta esa
 * identidad sale del token y no se pierde; sin cuenta sale del header
 * `X-Sesion-Anon`, y si el navegador no lo manda el servidor genera un uuid
 * NUEVO en cada petición.
 *
 * El efecto de que falte no es "la cuota no se cuenta" —eso ya se sabía y por
 * eso `anonimo` no promete techo— sino algo peor ahora: **subir el PDF y
 * pulsar Descargar devuelve 404 `sin_datos`, con el botón encendido**. Un
 * botón que no hace nada es justo lo que costó F29.
 *
 * El servidor ya estaba entero (`_id_anonimo()` lee el header, `/api/extraer`
 * y `/api/cuota` devuelven `cuota.sesion_anon`); lo que faltaba era esta
 * mitad.
 * ------------------------------------------------------------------------ */

test("the anonymous id the server hands back gets stored", () => {
  /*
    `actualizarCuota()` es el único punto por el que pasa toda respuesta con
    `cuota`, así que es donde el id tiene que quedar guardado. Si se guardara
    en cada llamador, el primero que se olvidara rompería la descarga sin que
    nada fallara.
  */
  const js = codigo();

  assert.match(
    js,
    /sesion_anon/,
    "el front tiene que leer el id que le devuelve el servidor"
  );
});

test("every request carries the anonymous id, not just the one that got it", () => {
  /*
    Va en `apiFetch` y no en cada llamada por la misma razón que el token: es
    el embudo por el que pasan todas. Ponerlo en `descargar()` solamente
    dejaría a `/api/extraer` guardando bajo otra identidad, que es el mismo
    404 por el otro extremo.
  */
  const cliente = sinComentariosJs(read(CLIENTE));

  assert.match(
    cliente,
    /X-Sesion-Anon/,
    "el cliente compartido debe mandar el header en cada petición"
  );
});

test("reading the stored id never breaks the page", () => {
  /*
    `localStorage` LANZA —no devuelve null— cuando el navegador tiene las
    cookies de terceros bloqueadas o la pestaña es de incógnito con acceso a
    sitios restringido. Sin guarda, quien esté en ese modo no vería la página
    romperse a medias: `actualizarCuota()` corta antes de `aplicarBloqueo()`,
    y los paneles quedan velados para siempre.
  */
  const cliente = sinComentariosJs(read(CLIENTE));

  assert.match(
    cliente,
    /try\s*\{[\s\S]*localStorage[\s\S]*?\}\s*catch/,
    "todo acceso a localStorage va envuelto en try/catch"
  );
});

/*
  EL TÍTULO TIENE QUE SOBREVIVIR AL VELO, y para eso tiene que ser HIJO DIRECTO.

  `extractor.css` difumina el contenido de un panel bloqueado exceptuando el
  título, con un combinador de HIJO DIRECTO:

      .velado > :not(.detalle__titulo):not(.bloqueado__aviso) { filter: blur(7px) }

  Un título anidado en un wrapper no queda exento: se vela el wrapper entero y
  el título se va con él. Y **no se puede arreglar desde adentro** — un
  `filter` en un ancestro crea un contexto de render nuevo, así que ningún
  `filter: none` en el hijo lo revierte.

  Pasó con `#panelGraficas`, que tenía su `<h2>` dentro de `.grafica__cabecera`:
  quien llegaba sin cuenta veía una mancha de colores sin saber qué le estaban
  ofreciendo — lo contrario de lo que el propio comentario del CSS declara.
*/
const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

// Paneles que `aplicarBloqueo()` puede velar (TODOS_LOS_PANELES en extractor.js).
const PANELES_VELABLES = ["panelTabla", "resumen", "panelGraficas",
                          "panelMsi", "panelConceptos"];

test("every title inside a veilable panel is a DIRECT child, or the veil hides it", () => {
  const html = sinComentariosHtml(read(PAGINA));

  for (const id of PANELES_VELABLES) {
    const marca = html.indexOf(`id="${id}"`);
    assert.notEqual(marca, -1, `falta el panel ${id} en la página`);

    // Desde el `>` que cierra la etiqueta de apertura del panel.
    const abre = html.indexOf(">", marca);
    assert.notEqual(abre, -1, `la etiqueta de ${id} no cierra`);

    /* El cuerpo del panel, acotado a SU cierre.
       Sin acotar, un panel vacío —`#resumen` lo llena el JS— deja que la
       búsqueda del título se escape y encuentre el del panel siguiente: rojo
       contra código correcto, señalando al panel que no es. Ya pasó. */
    let profundidadPanel = 1;
    let fin = abre + 1;
    const etiquetas = /<div\b|<\/div>/g;
    etiquetas.lastIndex = fin;
    for (let m = etiquetas.exec(html); m && profundidadPanel > 0; m = etiquetas.exec(html)) {
      profundidadPanel += m[0] === "</div>" ? -1 : 1;
      fin = etiquetas.lastIndex;
    }
    const cuerpo = html.slice(abre, fin);

    const titulo = cuerpo.indexOf('class="detalle__titulo"');
    if (titulo === -1) continue;   // no todos los paneles tienen título

    const entre = cuerpo.slice(0, titulo);

    /* Si entre la apertura del panel y el título hay un `<div>` sin cerrar,
       el título está anidado y el velo lo alcanza. Se cuenta la profundidad
       en vez de buscar un wrapper concreto: mañana puede llamarse distinto. */
    const profundidad = (entre.match(/<div\b/g) || []).length
                      - (entre.match(/<\/div>/g) || []).length;

    assert.equal(profundidad, 0,
      `el título de ${id} está anidado ${profundidad} nivel(es) adentro: el `
      + "velo lo va a difuminar y no se puede deshacer desde el hijo");
  }
});

/*
  LAS RUTAS DE ASSETS TIENEN QUE EXISTIR, y esta suite no lo verificaba.

  `MARCA_URL` apuntaba a `/static/marca-taudux.png` — la convención de FLASK,
  correcta en el proyecto del que se portó este código, y falsa acá: la raíz
  web es `src/` y las imágenes viven en `src/assets/images/`. El archivo nunca
  viajó con ese nombre.

  Cada gráfica dibujaba entonces un `<image>` de SVG contra un 404. Nadie lo
  vio porque con `opacity: 0.13` una imagen rota se lee como una mancha del
  fondo, no como un error.

  Es el defecto típico de portar código entre proyectos con convenciones de
  rutas distintas: compila, corre, no tira un solo error en consola, y falla
  en silencio.
*/
test("the watermark URL points at a file that actually exists under src/", () => {
  // Sin comentarios: el racional de `marcaAgua()` nombra `logo-horizontal.png`
  // en prosa, y sobre el fuente crudo el aserto pasaría por la razón
  // equivocada aunque la constante siguiera rota.
  const js = sinComentariosJs(read(SCRIPT));

  const m = js.match(/const\s+MARCA_URL\s*=\s*"([^"]+)"/);
  assert.ok(m, "falta la constante MARCA_URL");

  const ruta = m[1];
  assert.ok(ruta.startsWith("/"),
    `MARCA_URL debe ser absoluta desde la raíz web, y es "${ruta}"`);

  // La raíz web es `src/` (vercel.json: outputDirectory).
  const enDisco = path.join(ROOT, "src", ruta.replace(/^\//, ""));
  assert.ok(fs.existsSync(enDisco),
    `MARCA_URL apunta a "${ruta}", que no existe en src/. `
    + "Un <image> de SVG contra un 404 no avisa: se ve como una mancha.");
});

/*
  LAS GRÁFICAS SE MIDEN CON LA SECCIÓN OCULTA.

  `pintarResultado()` llama a `ocultarTodo()` y recién al final revela
  `#resultado` con la clase `resultado--visible` — DESPUÉS de `limpiarFiltros()`,
  que dispara toda la cadena de pintado (aplicarFiltros → recalcular →
  pintarGraficas → dibujarPanel). `dibujarPanel` mide `contenedor.clientWidth`
  para fijar el `viewBox`: con la sección en `display:none` ese ancho da 0, cae
  al 720 de respaldo, y el CSS (`.grafica__lienzo svg { width: 100% }`) estira
  ese SVG angosto al ancho real (~1096px en escritorio): todo el texto y la
  marca de agua salen bastante más grandes de lo que deberían.
*/
test("the results section is revealed before the charts are painted", () => {
  const js = sinComentariosJs(read(SCRIPT));
  const m = js.match(/function pintarResultado\([\s\S]*?\n\}\n/);
  assert.ok(m, "falta pintarResultado() en el fuente");
  const cuerpo = m[0];

  const posVisible = cuerpo.indexOf("resultado--visible");
  const posIndicadores = cuerpo.indexOf("pintarIndicadores(");
  const posFiltros = cuerpo.indexOf("limpiarFiltros(");
  assert.ok(posVisible >= 0, "pintarResultado debe agregar la clase resultado--visible");
  assert.ok(posIndicadores >= 0, "pintarResultado debe llamar a pintarIndicadores()");
  assert.ok(posFiltros >= 0, "pintarResultado debe llamar a limpiarFiltros()");
  // La gráfica de meses sin intereses se pinta desde pintarIndicadores() y
  // mide igual (`lienzo.clientWidth || ... || 720`): el revelado va antes de
  // la PRIMERA gráfica, no sólo antes de las dos de abajo.
  assert.ok(posVisible < posIndicadores && posVisible < posFiltros,
    "pintarResultado pinta gráficas con la sección en display:none: clientWidth "
    + "da 0, cae en el 720 de respaldo y el SVG sale angosto o estirado");
});

/*
  LA MARCA DE AGUA VA CENTRADA EN EL SVG, NO EN LA ZONA DE DATOS, Y A UN SOLO
  TAMAÑO EN LOS DOS PANELES APILADOS.

  `marcaAgua()` centraba el logo en la zona de datos (`margen.izquierda` hacia
  la derecha), no en el SVG completo: con MARGEN asimétrico (62 a la izquierda,
  14 a la derecha) el logo queda corrido hacia la derecha del centro real. Y el
  tamaño salía de la altura de CADA panel por separado — el de flujos mide 190,
  el de saldo 160 — así que el mismo logo se veía a dos tamaños distintos en la
  misma tarjeta.
*/
test("the watermark shares one size across the compact panels and is centred on the whole SVG", () => {
  const js = sinComentariosJs(read(SCRIPT));

  const mUrl = js.match(/const MARCA_URL = .+?;/);
  const mAsp = js.match(/const MARCA_ASPECTO = .+?;/);
  const mMargen = js.match(/const MARGEN = \{[\s\S]*?\};/);
  const mFn = js.match(/function marcaAgua\([\s\S]*?\n\}\n/);
  assert.ok(mUrl, "falta la constante MARCA_URL");
  assert.ok(mAsp, "falta la constante MARCA_ASPECTO");
  assert.ok(mMargen, "falta la constante MARGEN");
  assert.ok(mFn, "falta la función marcaAgua()");

  // Los topes del sello (fracción de alto y ancho máximo) se suman si existen;
  // no se exigen acá para que el aserto que falle sea el de comportamiento.
  const topes = (js.match(/const MARCA_(?:ALTO|ANCHO_MAX) = .+?;/g) || []).join("\n");
  const { marcaAgua, MARGEN } = new Function(
    `${mUrl[0]}\n${mAsp[0]}\n${topes}\n${mMargen[0]}\n${mFn[0]}\nreturn { marcaAgua, MARGEN };`
  )();

  // El panel de flujos mide 190 de alto; el de saldo, 160 — el más chico de
  // los dos es la referencia que ambos deben compartir.
  const flujos = marcaAgua(1096, 190, MARGEN, 160);
  const saldo = marcaAgua(1096, 160, MARGEN, 160);

  const parse = (svg) => ({
    x: Number(svg.match(/\bx="([\d.]+)"/)[1]),
    width: Number(svg.match(/\bwidth="([\d.]+)"/)[1]),
    height: Number(svg.match(/\bheight="([\d.]+)"/)[1]),
  });
  const pf = parse(flujos);
  const ps = parse(saldo);

  assert.ok(Math.abs(pf.width - ps.width) < 0.05,
    "los dos paneles deben dibujar el logo con el mismo ancho");
  assert.ok(Math.abs(pf.height - ps.height) < 0.05,
    "los dos paneles deben dibujar el logo con el mismo alto");

  const centro = 1096 / 2;
  assert.ok(Math.abs((pf.x + pf.width / 2) - centro) < 0.1,
    "el logo del panel de flujos debe quedar centrado en el SVG completo");
  assert.ok(Math.abs((ps.x + ps.width / 2) - centro) < 0.1,
    "el logo del panel de saldo debe quedar centrado en el SVG completo");

  // Con 1096 de ancho manda el alto: la marca mide 0.82 del SVG de referencia,
  // no de su banda de datos. La caja asoma de la banda, pero el PNG trae aire
  // transparente arriba y abajo y la tinta queda dentro igual.
  assert.ok(Math.abs(pf.height - 160 * 0.82) < 0.05,
    `el alto compartido debe ser 0.82 del panel de referencia (131.2), y mide ${pf.height}`);

  // En el visor los paneles son más altos y anchos; sin un tope absoluto la
  // marca crecía con ellos hasta parecer un póster. Es un sello: 480 px máximo.
  const visor = parse(marcaAgua(1830, 285, MARGEN));
  assert.ok(Math.abs(visor.width - 480) < 0.05,
    `en un panel tipo visor el ancho debe clavarse en el tope de 480, y mide ${visor.width}`);
  assert.ok(Math.abs((visor.x + visor.width / 2) - 1830 / 2) < 0.1,
    "el logo del visor debe quedar centrado en el SVG completo");

  // En móvil manda el ancho (72 % de la zona de datos): ni la fracción ni el
  // tope lo tocan.
  const movil = parse(marcaAgua(285, 160, MARGEN, 160));
  const zonaAnchoMovil = 285 - MARGEN.izquierda - MARGEN.derecha;
  assert.ok(Math.abs(movil.width - zonaAnchoMovil * 0.72) < 0.05,
    `en móvil el ancho sigue siendo el 72 % de la zona de datos, y mide ${movil.width}`);
});

test("pintarGraficas hands both compact panels the same watermark reference height", () => {
  const js = sinComentariosJs(read(SCRIPT));
  const m = js.match(/function pintarGraficas\([\s\S]*?\n\}\n/);
  assert.ok(m, "falta pintarGraficas() en el fuente");

  const refs = m[0].match(/altoMarca:\s*([\w.]+)/g) || [];
  assert.equal(refs.length, 2,
    "los dos paneles apilados deben pasar altoMarca a dibujarPanel");
  assert.equal(refs[0], refs[1],
    "ambos paneles deben compartir la MISMA referencia de alto para la marca");
});

/*
  EL VISOR NECESITA UN TOPE DE ANCHO, y su ausencia se reportó desde otra
  pantalla: "no estaba centrado, estaba un poco grande".

  El visor es `position: fixed; inset: 0`, así que sin tope su contenido barre
  la pantalla de borde a borde. Medido: en un monitor de 3440px la gráfica se
  dibujaba a 3384, con 254px entre punto y punto.

  Y hay un agravante que sólo se ve al mirar el alto: `redibujarVisor()` lo
  calcula como una FRACCIÓN de la ventana (30% con saldo, 48% sin él), así que
  alto y ancho crecían juntos y la proporción quedaba clavada en ~5,8:1 en
  TODOS los monitores 16:9. La gráfica no se veía más grande: se veía igual de
  chata, sólo que más larga.

  Con el tope, cuanto más alta la pantalla más proporcionada queda.
*/
const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the expanded chart viewer caps its width instead of sweeping the screen", () => {
  const css = sinComentariosCss(read(ESTILOS));

  /* El tope va sobre los HIJOS del visor, no sobre `.visor`: el fondo tiene
     que seguir cubriendo la pantalla entera —es lo que lo hace un modal— y lo
     que se acota es su contenido.

     Y NO sobre el tooltip, que también es hijo directo: es una capa flotante
     que el JS posiciona junto al cursor. Con `.visor > *` heredaba
     `inline-size: 100%` y salía de 1600px de ancho, con los montos pegados al
     borde derecho de la pantalla.

     La exclusión va dentro de `:where()`, que no suma especificidad. Un
     `:not(.clase)` a secas subiría la regla a dos clases y le ganaría a
     `.brush`, que declara su propio ancho (~560px) más abajo con una sola
     clase y hasta hoy ganaba por orden: la barra de rango pasaría a medir
     1600px. Lo detectó la revisión del primer intento. */
  const marca = css.indexOf(".visor > :where(:not(.grafica__tooltip))");
  assert.notEqual(marca, -1,
    "falta el tope sobre los hijos del visor, excluido el tooltip flotante y "
    + "SIN subir la especificidad (`:where(:not(...))`): con `> *` el tooltip "
    + "mide 1600px; con `:not()` a secas la barra de rango mide 1600px");

  const abre = css.indexOf("{", marca);
  assert.notEqual(abre, -1, "la regla no abre");
  const cierra = css.indexOf("}", abre);
  assert.notEqual(cierra, -1, "la regla no cierra");

  const regla = css.slice(abre, cierra);

  assert.match(regla, /max-inline-size|max-width/,
    "debe declarar un tope de ancho");
  assert.match(regla, /margin-inline:\s*auto|margin:\s*0\s+auto/,
    "y centrarse: un tope sin centrado deja el contenido pegado a un borde");
});
