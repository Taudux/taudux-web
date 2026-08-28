/* El panel de administración del extractor.
 *
 * Por qué existe este test. La página del proyecto original **asumía que quien
 * llegaba era administrador**: no verificaba nada, porque allá vivía detrás de
 * un servidor que ya lo había comprobado. Servida por Vercel, esa suposición
 * deja de valer — cualquiera puede pedir la URL.
 *
 * Lo que se blinda acá es que use el mismo arranque que las otras pantallas de
 * administración del sitio (`crearArranqueAdmin`), que exige sesión y rol antes
 * de revelar nada. La RLS sigue siendo el gate real de escritura; esto es la
 * puerta de UX, y una puerta que falta no se nota hasta que alguien entra.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const PAGINA = "src/app/features/transactions/admin.html";
const SCRIPT = "src/app/features/transactions/admin.js";
const HOJA = "src/app/features/transactions/admin.css";

/*
  Los asertos de ausencia miran el markup y las reglas, no la prosa.

  Este repo documenta POR QUÉ algo se fue, y ese comentario tiene que nombrar
  justamente lo que ya no está: `#panelInterno`, `api-cliente.js`, "dar acceso
  ilimitado". Leyendo el archivo entero, explicar bien una eliminación la haría
  fallar — el incentivo exacto que no queremos crear.
*/
const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the extractor admin page stays out of search engines", () => {
  // Mismo criterio que las dos páginas de Tools y las de auth: no listarla no
  // le pide a nadie que la ignore; el noindex sí.
  assert.match(
    read(PAGINA),
    /<meta\s+name="robots"\s+content="noindex">/,
    "la página de administración debe llevar noindex"
  );
});

test("it hides its content behind the site's admin gate", () => {
  const html = read(PAGINA);

  // Los tres ids que `crearArranqueAdmin` necesita para funcionar: sin ellos
  // el arranque falla y —peor— podría dejar el contenido visible.
  ["adminStartup", "adminContent", "adminStartupError"].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  });

  // El contenido nace oculto: se revela recién cuando el rol se confirmó.
  assert.match(
    html,
    /id="adminContent"[^>]*\shidden/,
    "#adminContent debe empezar oculto"
  );

  assert.match(
    html,
    /admin-startup\.js/,
    "debe cargar el arranque compartido en vez de uno propio"
  );
});

test("it asks the shared gate for admin, not just for a session", () => {
  const js = read(SCRIPT);

  // `asegurarAdmin` es lo que distingue "hay sesión" de "es administrador".
  // Quedarse en la sesión dejaría el panel abierto a cualquier persona con
  // cuenta, que es justamente lo que este panel no puede permitir.
  assert.match(js, /crearArranqueAdmin\(/, "debe usar el arranque compartido");
  assert.match(js, /asegurarAdmin\(/, "debe exigir rol admin, no sólo sesión");
});

test("it sends unauthorised visitors back to the extractor, not to courses", () => {
  // `crearArranqueAdmin` manda al catálogo de cursos por defecto, que es de
  // donde vinieron las tres pantallas para las que se escribió. Caer ahí desde
  // la administración del extractor no le explica nada a nadie.
  assert.match(
    read(SCRIPT),
    /rutaRechazo:\s*"\/app\/features\/transactions\//,
    "debe devolver a la herramienta, no al catálogo de cursos"
  );
});

test("it lists the site's real users, not only the in-memory ones", () => {
  const js = read(SCRIPT);

  // Sin esto el panel sólo muestra quién usó la herramienta desde el último
  // reinicio del contenedor — que con escala a cero es casi nadie.
  assert.match(js, /from\("perfiles"\)/, "debe leer los perfiles de Supabase");
  assert.match(js, /"id, nombre, apellidos, rol/, "debe traer el rol real");

  // El correo vive en auth.users y este sitio nunca lo entrega al navegador.
  // Se mira la CONSULTA y no el archivo entero: la primera versión de este
  // test buscaba "email" en todo el texto y saltaba con el comentario que
  // explica, justamente, que los correos no se leen.
  const consulta = js.match(/\.from\("perfiles"\)[\s\S]{0,200}/)?.[0] ?? "";
  assert.doesNotMatch(
    consulta,
    /email|correo/i,
    "la consulta no debe pedir correos: no se exponen al cliente"
  );
});

test("each row shows the email from /api/admin/perfiles, not the raw uuid", () => {
  const js = read(SCRIPT);

  /*
    Ninguna CELDA debe pintar el uuid: el correo viene de /api/admin/perfiles,
    no de `p.id`.

    El aserto miraba el archivo entero (`${escapar(p.id)}` en cualquier lado) y
    eso dejó de servir cuando la tabla se volvió editable: los listeners van por
    delegación y necesitan el uuid en el markup para saber a quién guardar. Lo
    que se prohíbe es mostrarlo; llevarlo en `data-uid` es justamente lo que
    permite no mostrarlo, así que se pide.
  */
  assert.doesNotMatch(
    js,
    /<td[^>]*>\s*\$\{escapar\(p\.id\)\}/,
    "ninguna celda debe pintar el uuid crudo"
  );
  assert.match(
    js,
    /data-uid="\$\{escapar\(p\.id\)\}"/,
    "la fila debe llevar el uid para que la delegación sepa a quién guarda"
  );

  // La celda de correo sigue existiendo, ahora como <td>.
  assert.match(js, /admin__meta/, "la celda de correo debe seguir en el markup");
});

test("name and email share one 'Usuario' cell instead of two columns", () => {
  /*
    Nombre y correo identifican a la MISMA persona: separarlos en dos columnas
    los presentaba como dos datos independientes y le cobraba a la tabla un
    ancho que necesitan las columnas editables. Apilados en una celda se leen
    como lo que son —quién es esta fila—, y el `min-inline-size` de la tabla
    baja, así que el scroll horizontal aparece más tarde en pantallas chicas.

    Es el apilado que la lista tenía ANTES de volverse tabla (`.admin__quien`
    con el nombre arriba y el meta abajo); lo que cambia es que ahora convive
    con columnas de formulario.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /<th[^>]*>\s*Usuario/,
    "el encabezado de la primera columna debe ser Usuario"
  );

  ["Nombre", "Correo"].forEach((viejo) => {
    assert.doesNotMatch(
      js,
      new RegExp(`<th[^>]*>\\s*${viejo}\\s*<`),
      `"${viejo}" dejó de ser una columna propia`
    );
  });

  // Y el nombre y el correo quedan dentro de la MISMA celda, apilados.
  assert.match(
    js,
    /<td[^>]*admin__quien[\s\S]{0,300}admin__usuario[\s\S]{0,300}admin__meta/,
    "nombre y correo van en una sola celda, uno debajo del otro"
  );
});

test("the plan column gives way to the two limits that can actually be edited", () => {
  /*
    Con un solo plan asignable —los de pago siguen apagados en el catálogo— la
    columna Plan repetía "free" en todas las filas: un dato cierto que no
    informa de nada y ocupa el lugar del que sí se puede cambiar. Los dos
    números que el administrador gobierna son el cupo mensual y cuántos PDF
    por envío, y hasta ahora no se veían.
  */
  const js = read(SCRIPT);

  ["Cupo mensual", "PDF por envío", "Con límite"].forEach((titulo) => {
    assert.match(
      js,
      new RegExp(`<th[^>]*>\\s*${titulo}`),
      `falta el encabezado "${titulo}"`
    );
  });

  assert.doesNotMatch(
    js,
    /<th[^>]*>\s*Plan/,
    "la columna Plan repetía el mismo valor en todas las filas"
  );

  // Su formateador se va con ella: código muerto que aún nombra el plan como
  // si la tabla lo mostrara.
  assert.doesNotMatch(js, /formatearPlan/, "sobra formatearPlan()");
});

test("saving a row writes it through PUT /api/admin/acceso/<uid>", () => {
  /*
    La tabla dejó de ser sólo lectura. El alta que se borró el 2026-08-20
    escribía contra una identidad rota (`user:<correo>` cuando en producción es
    `user:<uuid>`, hallazgo F30); ésta escribe contra el uuid y por el endpoint
    que lo espera, que además resuelve la herencia del plan en el servidor.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /apiFetch\(\s*`\/api\/admin\/acceso\//,
    "debe guardar contra /api/admin/acceso/<uid>"
  );
  assert.match(js, /method:\s*"PUT"/, "el endpoint escribe con PUT");
  assert.match(
    js,
    /"Content-Type":\s*"application\/json"/,
    "el cuerpo va en JSON: sin la cabecera Flask no lo parsea"
  );

  // El endpoint no acepta `plan` y no hay que inventárselo: encender un nivel
  // de pago es otra decisión, tomada en otro lado.
  const cuerpo = js.match(/JSON\.stringify\([\s\S]{0,200}/)?.[0] ?? "";
  assert.doesNotMatch(cuerpo, /\bplan\b/, "el payload no lleva plan");
});

test("a row without its own limits shows no ceiling, not the plan's number", () => {
  /*
    El techo mensual es OPT-IN desde el 2026-08-21: con la bandera apagada el
    servidor devuelve `limite: null` —sin techo—, no el número del plan.

    Antes esta celda pintaba un input vacío con el 3 heredado asomando en el
    `placeholder`. Eso hoy sería una pantalla que miente en la dirección más
    cara: haría creer que hay un tope de 3 al mes donde no hay ninguno. El ∞
    ya existía para `ilimitado`; lo que cambia es que ahora también lo gana la
    fila sin personalizar.
  */
  const js = read(SCRIPT);

  // Lo que se fija es el TÉRMINO que manda: sin la bandera, la celda es un ∞,
  // sin importar qué más se le sume a esa condición. La primera versión de
  // este test copiaba la expresión entera (`datos.ilimitado || !personalizado`)
  // y se puso roja al sumarle el `lote` — sin que lo que probaba cambiara.
  assert.match(
    js,
    /\|\|\s*!personalizado/,
    "sin la bandera encendida la celda tiene que ser un ∞, no un input"
  );

  // Y que el ∞ del acceso ilimitado siga existiendo como caso propio: son dos
  // estados distintos —"nadie le puso techo" y "tiene un permiso especial"— y
  // sólo el primero se arregla marcando la casilla de al lado.
  assert.match(
    js,
    /datos\.ilimitado/,
    "el acceso ilimitado sigue siendo un camino aparte al ∞"
  );
});

test("neither limit shows a number while the row has none of its own", () => {
  /*
    Los DOS son opt-in, no sólo el mensual. Una fila sin la bandera no tiene
    tope por envío tampoco, así que su celda es el mismo "∞" de texto plano y
    no un input deshabilitado con un número heredado asomando.

    Que las dos celdas salgan de la MISMA función es lo que este test cuida:
    si cada columna armara su markup, la próxima vez que una de las dos cambie
    de estado la otra se queda atrás — que es exactamente cómo el `lote` llegó
    tarde a este cambio.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /function\s+controlSinTope|controlLimite\s*\(/,
    "las dos celdas comparten el constructor del control"
  );
  // Ningún `${bloqueo}`: ya no queda un numérico que nazca deshabilitado,
  // porque sin bandera no hay input que deshabilitar en ninguna de las dos.
  assert.equal(
    (js.match(/\$\{bloqueo\}/g) || []).length,
    0,
    "sin la bandera no queda ningún input que bloquear: los dos son ∞"
  );
});

test("turning the flag on seeds the row from the plan, not from what applies", () => {
  /*
    Al encender la bandera hay que ofrecer un punto de partida, y ya no puede
    ser "lo que rige hoy": lo que rige es SIN TECHO, y `null` no se puede
    tipear en un `<input type="number">`.

    La semilla sale de `defecto`, que `/api/admin/perfiles` manda con los dos
    números del plan (3 y 2). Es el único lugar donde siguen escritos.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /defecto/,
    "el panel tiene que leer la semilla que manda /api/admin/perfiles"
  );
  assert.doesNotMatch(
    js,
    /\[\["limite",\s*efectivo\.limite\]/,
    "prellenar con lo efectivo dejaría el campo vacío: hoy lo efectivo es null"
  );
});

test("it announces the result of every save with a toast", () => {
  /*
    Sin aviso, un guardado fallido se ve igual que uno exitoso: la fila queda
    como estaba. El toast es el único lugar donde se lee el `mensaje` que manda
    el endpoint —en español y explicando el rechazo—, así que se reusa en vez
    de escribir una segunda copia de esos textos acá.
  */
  const js = read(SCRIPT);

  assert.match(js, /mostrarToast\([^)]*"error"\)/, "el fallo debe avisar");
  assert.match(js, /mostrarToast\([^)]*"success"\)/, "el éxito debe avisar");
});

test("the page loads the shared field styles now that it has inputs again", () => {
  /*
    `field.css` se había quitado cuando el único formulario de la página era el
    alta de accesos borrada. La tabla editable trae inputs de vuelta, y sin esa
    hoja quedan con el estilo por defecto del navegador: fondo blanco sobre un
    panel oscuro.
  */
  assert.match(
    sinComentariosHtml(read(PAGINA)),
    /shared\/field\/field\.css/,
    "los campos de la tabla necesitan la hoja compartida"
  );
});

test("the copy stops promising a role column that no longer exists", () => {
  /*
    La columna Rol se quitó el 2026-08-21, y dos frases se quedaron hablando de
    ella: la bajada de la cabecera ("…y el rol de cada una") y `.admin__ayuda`
    ("…su rol, correo y consumo"). El rol ya no se puede LEER en la tabla: sólo
    se insinúa con la franja de acento de las filas de administración.

    Esta pantalla perdió cuatro secciones por mostrar datos que no eran ciertos;
    prometer una columna que no está es la misma clase de defecto, más barata
    de cometer. Se mira el markup sin comentarios: el de arriba explica el
    cambio y nombra justo lo que ya no está.
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.doesNotMatch(
    html,
    /\brol\b/i,
    "el copy visible no debe prometer un rol que la tabla ya no muestra"
  );
});

test("it reveals the content after the gate approves", () => {
  /*
    `asegurarAdmin` COMPRUEBA; `revelar` MUESTRA. Llamar sólo al primero deja
    la pantalla con el loader girando para siempre, con el rol verificado y sin
    un solo error en consola — el modo de falla más caro de diagnosticar,
    porque todo "funciona" salvo lo que se ve.

    Las tres pantallas de administración de cursos llaman `revelar()`; ésta lo
    había omitido (2026-08-19).
  */
  assert.match(
    read(SCRIPT),
    /arranque\.revelar\(\)/,
    "debe destapar el contenido tras aprobar el gate"
  );
});

test("it starts even if DOMContentLoaded already fired", () => {
  /*
    El script va al final del <body>: cuando corre, el DOM ya está parseado y
    ese evento probablemente ya pasó. Esperarlo a secas significa no arrancar
    nunca — y el modo de falla es cruel, porque **nada falla**: no hay error en
    consola, la página carga entera, y el loader gira para siempre.

    Pasó el 2026-08-19. Se pide el guard por `readyState`, que funciona tanto si
    el DOM ya está listo como si el script se moviera al <head>.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /document\.readyState/,
    "debe comprobar readyState en vez de confiar en DOMContentLoaded"
  );

  // Y que efectivamente llame a iniciar() por fuera del listener.
  assert.match(
    js,
    /}\s*else\s*{\s*iniciar\(\);/,
    "con el DOM ya listo debe arrancar de inmediato"
  );
});

test("the panel reads what Supabase cannot give it from /api/admin/perfiles", () => {
  /*
    El correo y el consumo del mes no viven en `perfiles` (RLS + Supabase
    anon): el correo está en `auth.users`, fuera del alcance del cliente, y el
    consumo es estado en memoria de Cloud Run. `GET /api/admin/perfiles` es la
    única puerta admin-only que entrega ambos, así que el panel vuelve a
    llamar a `apiFetch`.

    Este test cubre la lectura; la escritura —`PUT /api/admin/acceso/<uid>`,
    la otra ruta que este panel usa— la cubre el suyo, más arriba.
  */
  assert.match(
    read(SCRIPT),
    /apiFetch\(\s*["']\/api\/admin\/perfiles["']/,
    "debe pedir el correo y el consumo a /api/admin/perfiles"
  );
  assert.match(
    sinComentariosHtml(read(PAGINA)),
    /api-cliente\.js/,
    "con apiFetch de vuelta, la página debe cargar su cliente"
  );
});

test("it keeps the profile list and nothing else", () => {
  const html = sinComentariosHtml(read(PAGINA));

  // Lo que se conserva: la única lista que dice la verdad, porque la lee de la
  // base de datos y no de la memoria de un contenedor.
  ["totalPerfiles", "listaPerfiles"].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  });

  /*
    Lo que se fue, y por qué se fue (2026-08-20):

      · "Dar acceso ilimitado" no otorgaba nada: indexaba por `user:<correo>`
        cuando la identidad en producción es `user:<uuid>` (hallazgo F30).
      · El consumo del mes leía el estado en memoria de UNA instancia de Cloud
        Run: con `--max-instances 3` cada administrador veía otra cosa, y un
        reinicio lo borraba (hallazgo F25).
      · Los paneles internos volcaban el JSON crudo de esas mismas fuentes.

    Dos pantallas que mostraban datos falsos son peores que dos pantallas que
    no están.
  */
  [
    "adminCorreo",
    "adminMotivo",
    "btnDarAcceso",
    "adminError",
    "adminMes",
    "listaUsuarios",
    "btnTelemetria",
    "btnDonaciones",
    "panelInterno",
  ].forEach((id) => {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `#${id} debía irse`);
  });

  assert.doesNotMatch(
    html,
    /admin__aviso/,
    "el aviso de accesos temporales no tiene accesos que advertir"
  );

  // Incluye la bajada de la cabecera: la página no puede seguir prometiendo
  // algo que ya no reparte.
  assert.doesNotMatch(
    html,
    /acceso ilimitado/i,
    "el copy visible no debe ofrecer el alta que se eliminó"
  );
});

test("its script drops the code that only fed the removed sections", () => {
  const js = read(SCRIPT);

  // `\b` corta antes de `cargarUsuariosDelSitio`: la D es carácter de palabra,
  // así que el nombre largo no matchea el corto.
  ["cargarUsuarios", "cambiarAcceso", "verPanelInterno"].forEach((nombre) => {
    assert.doesNotMatch(js, new RegExp(`\\b${nombre}\\b`), `sobra ${nombre}()`);
  });

  assert.match(js, /cargarUsuariosDelSitio\(/, "debe seguir listando los perfiles");
});

test("its stylesheet pays for the top offset that cursos.css never delivered", () => {
  /*
    `admin.html` reusa el markup y las clases de las pantallas de cursos pero no
    su hoja. El padding que despega el contenido del navbar fijo está en
    `.courses__main` de `cursos.css`, y acá no llega por partida doble: la
    página no carga esa hoja, y su `<main>` lleva `.courses`, no
    `.courses__main`.

    El contenido SIEMPRE arrancó debajo de la barra. No se notaba porque lo
    primero era el aviso de accesos temporales, que nadie extrañaba tapado; al
    quedar "Usuarios del sitio" en cabeza (2026-08-20) el título apareció
    cortado. El defecto es viejo, el borrado sólo lo destapó.

    Lo que se fija acá es de QUIÉN es el offset, no cuánto mide: esta hoja
    tiene que declararlo porque ninguna otra lo hace en esta página. El valor
    lo fija `--espacio-bajo-navbar` en `styles.css`, y su derivación la
    protege `ui-consolidation.test.js`. Este test decía `8rem` literal, que
    era el mismo número escrito dos veces: al mudarlo al token compartido el
    literal quedó viejo y contradecía al otro test.
  */
  assert.match(
    sinComentariosCss(read(HOJA)),
    /\.courses\s*\{[^}]*padding-block-start:\s*var\(--espacio-bajo-navbar\)/,
    "admin.css debe dar el offset superior: nadie más lo hace en esta página"
  );

  // Y no se arregla trayendo `cursos.css` entero: son las reglas del catálogo,
  // que esta pantalla no usa, por una sola declaración que le falta.
  assert.doesNotMatch(
    sinComentariosHtml(read(PAGINA)),
    /courses\/cursos\.css/,
    "no debe cargar la hoja del catálogo para conseguir un padding"
  );
});

test("the scroll box can actually clip what it scrolls", () => {
  /*
    `.admin__lista` promete recortar la tabla con `overflow-x: auto`, y no podía
    cumplirlo: **`overflow` sólo recorta lo que cae dentro de su cadena de
    bloques contenedores.**

    Dentro del `<th>` del botón vive un `<span class="u-visually-hidden">Guardar
    cambios</span>`, que es `position: absolute` (`src/styles.css:201`). Sin un
    ancestro posicionado, su bloque contenedor terminaba siendo la `<section>`,
    fuera del contenedor con scroll — así que no se recortaba: se plantaba en el
    extremo derecho de una tabla de 832px y estiraba el DOCUMENTO entero.

    Medido en una ventana de 485px: 276px de scroll horizontal en toda la
    página, arrastrados por un elemento de 1px que nadie ve. Con
    `position: relative` acá, el desborde cae a cero y la tabla sigue
    scrolleando por dentro.

    Este test existe porque un `position: relative` sin `top`/`left` se lee como
    sobrante, y el próximo que limpie la hoja lo borra con toda la razón
    aparente.
  */
  const css = sinComentariosCss(read(HOJA));

  assert.match(
    css,
    /\.admin__lista\s*\{[^}]*overflow-x:\s*auto/,
    "el contenedor recorta la tabla ancha"
  );
  assert.match(
    css,
    /\.admin__lista\s*\{[^}]*position:\s*relative/,
    "y es bloque contenedor, o no puede recortar lo que está posicionado"
  );
});

test("its stylesheet keeps only the rules the profile list still uses", () => {
  const css = sinComentariosCss(read(HOJA));

  // Sin markup que las invoque: el formulario de alta, su error, el interruptor
  // de acceso, el aviso y el visor de JSON.
  [".admin__aviso", ".admin__alta", ".admin__error", ".admin__switch", "#panelInterno"]
    .forEach((selector) => {
      assert.ok(!css.includes(selector), `${selector} ya no tiene markup que lo use`);
    });

  // Y las que sí: con éstas se dibuja cada fila de la lista de perfiles, así
  // que borrarlas de paso dejaría la única sección viva sin estilos.
  // `.admin__plan` se fue con su columna (2026-08-21); los cuatro últimos son
  // los controles que la reemplazaron. Ojo con `.admin__switch`: aquel nombre
  // era del alta de accesos borrada y sigue prohibido arriba — reusarlo para el
  // interruptor nuevo mezclaría dos historias que terminaron distinto.
  [
    ".admin__lista",
    ".admin__fila",
    ".admin__tabla",
    ".admin__quien",
    ".admin__usuario",
    ".admin__meta",
    ".admin__vacio",
    ".admin__mes",
    ".admin__ayuda",
    ".admin__numero",
    ".admin__toggle",
    ".admin__guardar",
    ".admin__consumo",
  ].forEach((selector) => {
    assert.ok(css.includes(selector), `${selector} sigue en uso: no se borra`);
  });
});

/* ---------------------------------------------------------------------------
 * "Distribución Geográfica" — las filas por estado.
 *
 * El dato que manda sobre este diseño: medido contra la base GeoIP real, cerca
 * de la mitad de las IPs no baja de país. "Sin ubicación" no es un caso borde
 * que se pueda esconder — es una porción grande del total, y un panel que
 * mostrara sólo los estados conocidos afirmaría menos uso del que hubo.
 * ------------------------------------------------------------------------ */

test("the panel has a section for where the tool is used from", () => {
  const pagina = read(PAGINA);

  assert.match(
    pagina,
    /id="listaRegiones"/,
    "falta el contenedor donde se pintan las barras"
  );
  assert.match(
    pagina,
    /<div[^>]*id="listaRegiones"[^>]*aria-live="polite"/,
    "se llena por red después de cargar: sin aria-live, quien usa lector de " +
      "pantalla no se entera de que aparecieron datos"
  );
  assert.match(
    pagina,
    /Distribución Geográfica/,
    "y la sección se llama por lo que muestra"
  );
});

test("the bars are proportional, not a fixed width", () => {
  /*
    Una barra que no sale de un porcentaje sobre el máximo no es un gráfico:
    es una decoración que miente sobre la proporción. Y el porcentaje se
    calcula en JS porque el máximo depende de los datos del mes.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /width:\s*\$\{[^}]*\}%/,
    "el ancho de la barra tiene que venir de un porcentaje calculado"
  );
});

test("rows with no known state are shown apart, never hidden", () => {
  /*
    Los dos errores posibles son opuestos y los dos mienten: descartar esas
    filas hace ver menos uso del real, y mezclarlas con los estados inventa
    uno que no existe. Van visibles y separadas.

    El nombre de la clave lo pone el SERVIDOR (`SIN_UBICACION` en app.py) para
    que los dos lados cuenten lo mismo; acá se verifica que el front la
    reconozca y le dé su propio tratamiento.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /sin_ubicacion/,
    "el front tiene que reconocer la clave que manda el servidor"
  );
  assert.match(
    js,
    /admin__barra--sin-ubicar/,
    "y distinguirla visualmente de los estados reales"
  );
  assert.match(
    js,
    /Sin ubicación/,
    "con una etiqueta legible, no la clave cruda"
  );
});

test("each state shows its municipalities grouped underneath", () => {
  /*
    Estado y municipio resuelven SIEMPRE juntos (medido: 6 de 10 con las dos,
    4 sin ninguna, nunca una sin la otra), así que todo estado a la vista
    tiene detalle debajo.

    Desde el rediseño de 2026-08-27 ese detalle vive detrás de un chevron y no
    a la vista: con una fila por estado, mostrar todos los municipios siempre
    haría la lista ilegible en cuanto haya más de un puñado de estados. La
    jerarquía sigue leyéndose — es lo que las columnas apiladas habían perdido.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /admin__municipio/,
    "el nivel municipio necesita su propia clase para poder distinguirse"
  );
  assert.match(
    js,
    /admin__barra--municipio/,
    "y su propia barra: la jerarquía se lee por el estilo, no por un rótulo"
  );
});

test("a state's total is summed from its municipalities, never sent apart", () => {
  /*
    Dos números para lo mismo pueden discrepar, y ésa es la clase de bug que
    no falla: sólo miente. El servidor manda `{estado: {municipio: n}}` y el
    total sale de sumar ese dict.

    Si mañana alguien agrega un campo `total` al agregado para "ahorrarse la
    suma", este test lo obliga a justificarlo acá.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /Object\.values\([^)]*\)\s*\.reduce/,
    "el total del estado se calcula sumando sus municipios"
  );

  // Y lo mismo vale para CADA serie: un `{anon, cuenta}` de estado calculado
  // aparte del de sus municipios son, otra vez, dos números para lo mismo.
  assert.match(
    js,
    /acc\.anon \+|anon: acc\.anon/,
    "las dos series del estado también se suman de sus municipios"
  );
});

test("the unlocated row stays apart and has no breakdown", () => {
  /*
    No tiene municipios que mostrar: es justamente el grupo de las filas cuya
    IP no bajó de país. Un bloque de detalle vacío debajo sería peor que nada,
    y con el color de acento se leería como el estado que más usa la
    herramienta — cerca de la mitad de las IPs cae ahí.
  */
  const js = read(SCRIPT);

  assert.match(js, /sin_ubicacion/, "reconoce la clave que manda el servidor");
  assert.match(js, /admin__barra--sin-ubicar/, "y la distingue visualmente");
  assert.match(js, /Sin ubicación/, "con etiqueta legible, no la clave cruda");
});

/*
  Un trozo de `admin.js` delimitado por sus propios rótulos `// --- Título ---`.

  Existe porque varios asertos de acá abajo sólo valen DENTRO de una sección:
  que la actividad lea el nombre del mapa de perfiles no significa nada si el
  match lo aporta la tabla de límites, que también lo lee. Buscando en el
  archivo entero, un test verde no probaría lo que dice probar.
*/
const seccion = (js, titulo) => {
  const inicio = js.indexOf(`// --- ${titulo}`);
  assert.notEqual(inicio, -1, `falta la sección "${titulo}" en admin.js`);
  const resto = js.slice(inicio + `// --- ${titulo}`.length);
  const fin = resto.indexOf("// --- ");
  return fin === -1 ? resto : resto.slice(0, fin);
};

test("the panel offers a visible switch to leave admins out", () => {
  /*
    El filtro tenía que ser VISIBLE, no una exclusión silenciosa del servidor:
    un panel que descarta filas sin decirlo es un panel que miente, y quien lo
    mira no tiene forma de saber cuántas se fueron.
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.match(html, /id="filtroAdmins"/, "falta el interruptor del filtro");
  assert.match(
    html,
    /id="filtroAdmins"[\s\S]{0,120}?aria-checked="true"/,
    "nace encendido: la lectura por defecto es la que no cuenta a quien prueba"
  );
  assert.match(
    html,
    /Excluir a los administradores/,
    "la etiqueta dice qué hace, no cómo se llama el campo"
  );
});

test("an empty filtered map still offers the filter — {} is data, not absence", () => {
  /*
    **`{} || null` da `null` en JavaScript**, y ése era el bug.

    Si en un mes TODAS las extracciones fueron de administración, el servidor
    manda `por_region_sin_admins: {}` — un dato legítimo que significa "sin
    administración no hubo nada". Con `||`, el panel lo tomaba como "el
    servidor no calcula el filtro", escondía la casilla, y mostraba el mapa
    completo: exactamente el mes en que el filtro más importa.

    Distinguir "no vino el campo" de "vino vacío" exige mirar la ausencia, no
    la veracidad.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.doesNotMatch(
    js,
    /cuerpo\.por_region_sin_admins\s*\|\|/,
    "`|| null` convierte un mapa vacío en 'no calculado' y esconde la casilla"
  );
  assert.match(
    js,
    /por_region_sin_admins\s*\)|por_region_sin_admins"\s*\)|undefined|hasOwnProperty|in cuerpo/,
    "la ausencia del campo debe distinguirse de un mapa vacío"
  );
});

test("the filter is only offered when the server actually computed it", () => {
  /*
    Hoy Cloud Run manda un solo agregado. Ofrecer la casilla igual sería
    prometer un filtro que nadie calcula: se marcaría, no cambiaría nada, y
    quien mire creería que está viendo el mapa sin administradores.
  */
  const html = sinComentariosHtml(read(PAGINA));
  assert.match(
    html,
    /id="filtroAdminsCaja"[^>]*\shidden/,
    "la casilla nace oculta y sólo se revela con el agregado filtrado"
  );

  const js = seccion(read(SCRIPT), "Distribución geográfica");
  assert.match(
    js,
    /por_region_sin_admins/,
    "debe leer el agregado filtrado que manda el servidor"
  );
  assert.match(
    js,
    /ofrecerFiltroAdmins/,
    "la revelación es explícita, no un efecto colateral del pintado"
  );
});

test("toggling the admin filter costs no extra request", () => {
  /*
    Los dos agregados vienen del MISMO viaje, así que alternar es elegir cuál
    de los dos ya está en memoria. Un `apiFetch` acá volvería a pedir la tabla
    entera de perfiles para redibujar unas barras que ya se tienen.

    Se cuentan las llamadas porque es el aserto que no se puede satisfacer sin
    cumplir: hay exactamente dos —leer perfiles y guardar una fila— y el filtro
    no puede sumar una tercera.
  */
  const js = read(SCRIPT);
  const llamadas = (js.match(/apiFetch\(/g) || []).length;

  assert.equal(
    llamadas,
    2,
    "sólo GET /api/admin/perfiles y PUT /api/admin/acceso: el filtro no viaja"
  );
});

test("the panel no longer says WHO used it and WHEN", () => {
  /*
    "Quién lo usa y cuánto" se retiró el 2026-08-28, a pedido de Jorge:
    *"pero aún veo quién lo hace y cuándo, no debería"*.

    Mostraba, por persona, nombre + correo + estado + una franja de 24 horas
    con la hora de cada extracción. Esa franja por cuenta es un PERFIL DE USO, y
    el aviso de privacidad del sitio dice textualmente que no se crean perfiles
    — además de no mencionar el extractor ni una sola vez.

    Lo que la sección aportaba de operativo ya vivía en otro lado:

      · cuántas hizo cada cuenta → la tabla "Usuarios del sitio", donde sirve
        para ajustar los límites;
      · desde dónde → "Distribución Geográfica", en agregado.

    Lo único propio era el horario por persona, y es justamente lo que no
    debía verse. Se fue entera y sin reemplazo.
  */
  const html = sinComentariosHtml(read(PAGINA));
  const js = read(SCRIPT);
  const css = sinComentariosCss(read(HOJA));

  ["seccionActividad", "listaActividad", "mesActividad"].forEach((id) => {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `#${id} se fue`);
  });

  assert.doesNotMatch(js, /function pintarActividad/,
    "y su pintor con ella");
  assert.doesNotMatch(js, /function tarjetaActividad/,
    "y las tarjetas que identificaban a cada cuenta");
  assert.doesNotMatch(css, /admin__actividad/,
    "y sus reglas: una hoja que viste markup que no existe es deuda muerta");
});

test("the panel's copy claims 'sin sesión', never 'sin cuenta' (F47)", () => {
  /*
    El panel cuenta extracciones sin token — incluidas las de cuentas reales
    que no iniciaron sesión. "No tiene cuenta" mentiría sobre esas filas;
    specs/authentication/spec.md define el actor como Anónimo (sin Sesión), no
    como "sin Cuenta".
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.doesNotMatch(
    html,
    /no tiene cuenta/i,
    "la copia no debe volver a prometer algo que sólo describe a una parte de la fila"
  );
  assert.match(
    html,
    /sesión iniciada/i,
    "la copia debe hablar de sesión, que es lo que el sistema de verdad sabe"
  );
});

/* --------------------------------------------------------------------------
   Distribución Geográfica (2026-08-27): UNA sola vista.

   Hasta hoy la sección tenía dos. `#listaRegiones` llevaba las barras por
   estado, el filtro de administración y "Sin ubicación"; `#graficoMunicipios`
   llevaba las columnas apiladas, que aportaban la partición en dos series. Se
   excluían a mano con `hidden`.

   Y esa duplicación MENTÍA en producción. Medido en Chrome el 2026-08-27, con
   "Excluir a los administradores" MARCADA la pantalla decía 58 extracciones
   cuando las reales sin administración eran 7. El filtro funcionaba perfecto
   —alternaba 58 ↔ 7 sin un error en consola— sobre el contenedor que la otra
   vista dejaba oculto.

   Un bug que no falla: sólo miente. Ninguna suite lo atrapó, ningún log lo
   registró. Una vista sola no puede volver a desincronizarse.
   -------------------------------------------------------------------------- */

test("the geographic section is one view, not two", () => {
  const html = sinComentariosHtml(read(PAGINA));

  assert.match(html, /id="listaRegiones"/,
    "el contenedor único sigue siendo éste");
  assert.doesNotMatch(
    html,
    /id="graficoMunicipios"/,
    "la segunda vista se retira: dos contenedores para el mismo dato es lo " +
      "que dejó al filtro pintando donde nadie mira"
  );
});

test("the admin filter repaints what is ON SCREEN, not a hidden container", () => {
  /*
    El defecto que originó este rediseño, blindado. `repintarRegiones` tiene
    que alimentar al MISMO pintor que está a la vista.
  */
  const js = read(SCRIPT);

  assert.doesNotMatch(
    js,
    /pintarMunicipios/,
    "el segundo pintor se va con su contenedor"
  );
  assert.match(
    js,
    /function repintarRegiones\(\)[\s\S]{0,600}?pintarRegiones\(/,
    "el repintado del filtro llama al único pintor que existe"
  );
});

test("the section reads the two-series aggregate, and survives without it", () => {
  /*
    Cloud Run puede estar sirviendo una versión anterior. Sin `por_municipio`
    no hay series que pintar, pero los totales de `por_region` sí están: la
    sección degrada a barras de un color en vez de quedarse vacía.
  */
  const js = read(SCRIPT);

  assert.match(js, /cuerpo\.por_municipio/,
    "debe leer el agregado de dos series de la respuesta");

  const dentro = seccion(js, "Distribución geográfica");
  assert.match(dentro, /haySeries/,
    "y distinguir explícitamente el caso en que no lo tiene");
});

test("admin rows are subtracted from the session series, never from anonymous", () => {
  /*
    El servidor NO manda `por_municipio_sin_admins`, y no hace falta: las filas
    de administración son lo que sobra al restar el mapa filtrado del completo,
    y TODAS tienen sesión —un admin siempre tiene `user_id`, verificado en
    app.py:2846 y 2870—, así que salen del lado "con sesión".

    Restarlas del lado anónimo inventaría anónimos negativos.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(
    js,
    /Math\.max\(0,[\s\S]{0,80}?cuenta/,
    "la resta va contra la serie con sesión, y nunca baja de cero"
  );
  assert.doesNotMatch(
    js,
    /anon\s*-\s*deAdmins/,
    "el conteo anónimo no se toca: ningún admin cae de ese lado"
  );
});

test("each row is split into two series, and the legend names them", () => {
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  // Las dos series con nombre, no "serie 1" y "serie 2".
  assert.match(js, /Sin sesión/, "una serie es quien no inició sesión");
  assert.match(
    js,
    /Con sesión/,
    "y la otra quien sí — 'Con cuenta' contradecía la regla F47 que el propio " +
      "repo escribe en app.py: alguien registrado que no se logueó cae del " +
      "lado anónimo, y la etiqueta lo negaba"
  );
  assert.match(js, /leyenda/i, "y una leyenda que las distinga por color");
});

test("choosing a series shows THAT series, not both", () => {
  /*
    Las pestañas reordenaban y nada más. Contra los datos reales —2 estados—
    ordenar no movía una sola fila: tocar "Con sesión" no cambiaba nada en
    pantalla, y un control inerte es lo que esta pantalla tiene escrito tres
    veces que no se hace.

    Ahora la pestaña elige QUÉ SE MIDE, y todo la sigue: la barra, el número de
    la fila, la escala del ancho, el orden y la insignia.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(js, /vistaRegiones\.medida/, "la pestaña elige la medida");
  assert.match(
    js,
    /fila\[medida\] \/ maximo/,
    "el ancho sale de la medida activa, no siempre del total"
  );
  assert.match(
    js,
    /\.sort\([^)]*\) => b\[medida\] - a\[medida\]\)/,
    "y el orden también, sin una segunda variable que pueda discrepar"
  );
  assert.match(
    js,
    /soloUna/,
    "y hay un caso explícito para 'se está mirando una sola serie'"
  );
});

test("a row with zero in the active series disappears", () => {
  /*
    Medido en producción: Corregidora tiene `0·1` — ninguna extracción con
    sesión. Bajo "Con sesión" tiene que irse, no quedarse con una barra vacía
    ocupando lugar y sugiriendo un uso que no hubo.

    Es la misma regla de "nada en cero" que el código ya aplica a los
    municipios; lo nuevo es que ahora depende de la medida activa.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(
    js,
    /f\[medida\] > 0/,
    "las filas se filtran por la medida activa, no por el total"
  );

  /*
    Y sus MUNICIPIOS también. Encontrado mirando la pantalla: los estados se
    filtraban bien y Corregidora seguía apareciendo con un `0` adentro de
    Querétaro, porque el detalle venía filtrado por el total desde
    `filasDeRegiones` y nadie lo revisaba al pintar.
  */
  assert.match(
    js,
    /municipios[\s\S]{0,120}?m\[medida\] > 0/,
    "el detalle de cada estado también se filtra por la medida activa"
  );
});

test("the pair column shows up only when both series do", () => {
  /*
    Con una sola serie a la vista, el par sería el mismo número dos veces: a la
    izquierda como par y a la derecha como total.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(
    js,
    /soloUna[\s\S]{0,120}?admin__par-cuenta|admin__par-cuenta[\s\S]{0,200}?soloUna/,
    "el par depende de estar mirando las dos series"
  );

  const css = sinComentariosCss(read(HOJA));
  assert.match(
    css,
    /--una-serie[\s\S]{0,200}?grid-template-columns/,
    "y la grilla pierde esa columna en vez de dejarla vacía"
  );
});

test("the legend marks the series that is NOT being shown", () => {
  /*
    Una leyenda que afirma las dos series mientras la pantalla muestra una sola
    miente en dos de los tres modos.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");
  assert.match(js, /apagad/i, "la serie que no se muestra se marca como tal");

  const css = sinComentariosCss(read(HOJA));
  assert.match(
    css,
    /apagad[\s\S]{0,160}?opacity|apagad[\s\S]{0,160}?text-decoration/,
    "y se distingue por algo más que el texto"
  );
});

test("the badge and the footer do not repeat the same number", () => {
  /*
    Decían "7 EJECUCIONES" arriba y "7 extracciones" abajo: el mismo dato dos
    veces y con dos palabras distintas, que es peor que repetirlo — invita a
    creer que miden cosas diferentes.

    Queda la insignia. El pie conserva sólo lo que ella no dice.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  /*
    Se cuenta, no se prohíbe: este aserto distinguía el pie de la insignia POR
    LA PALABRA —una decía "extracciones" y la otra "ejecuciones"— y dejó de
    servir en cuanto las dos dijeron lo mismo, que era justamente el arreglo.

    El invariante de verdad es que el total se enuncie UNA sola vez.
  */
  const veces = (js.match(/\$\{total\} \$\{total === 1 \? "extracci/g) || []).length;
  assert.equal(veces, 1, "el total se dice una sola vez en toda la sección");

  assert.match(
    js,
    /insignia\.textContent[\s\S]{0,140}?\$\{total\}/,
    "y esa vez es la insignia del encabezado, no el pie"
  );
  assert.match(js, /sin ubicar/, "el pie conserva lo que la insignia no cuenta");
});

test("a series with no use says so, and leaves the tabs reachable", () => {
  /*
    Defecto introducido al hacer que las pestañas filtren, y encontrado MIRANDO:
    con un mes de una sola extracción con sesión, tocar "Sin sesión" dejaba la
    sección con la leyenda, una lista vacía y un aviso de "0 registradas". La
    guarda de vacío miraba `filas` —que sí tenía datos— y no `conDato`, que es
    lo que la medida activa deja.

    Y hay una trampa peor detrás: `vaciar()` esconde los controles. Si esta
    rama la usara, las pestañas desaparecerían y NO HABRÍA CÓMO VOLVER a Total.
    Una serie sin uso no es "no hay datos": las otras dos siguen teniendo.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(js, /!conDato\.length/,
    "hay un caso propio para 'esta serie no tuvo uso'");
  assert.match(js, /Ninguna extracción/,
    "y lo dice, en vez de dejar la lista en blanco");
  assert.match(
    js,
    /!conDato\.length[\s\S]{0,500}?ofrecerControles\(0, haySeries\)/,
    "y las pestañas se quedan, o el usuario queda encerrado en esa serie"
  );
});

test("the panel counts 'extracciones', with one word and not two", () => {
  /*
    La insignia decía "7 EJECUCIONES" mientras el resto de la pantalla dice
    extracciones: las tarjetas de actividad, el aviso de muestra, los mensajes
    de vacío, el párrafo de "Cuándo se usa" y hasta el nombre de la tabla del
    servidor (`extractor_uso`).

    La palabra llegó del mockup y quedó siendo la única de su clase. Es la mitad
    que faltaba del mismo defecto: en la pasada anterior se quitó el número
    duplicado del pie y la palabra equivocada se quedó arriba.

    EL ASERTO VA ACOTADO A LA LÍNEA DE LA INSIGNIA, no al archivo entero, porque
    el comentario que documenta esta corrección cita la palabra vieja. Un
    `doesNotMatch` global castigaría explicar bien el arreglo — el incentivo
    exacto contra el que advierte el encabezado de este archivo.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /insignia\.textContent[\s\S]{0,140}?extracci/,
    "la insignia cuenta extracciones, la misma palabra que el resto del panel"
  );
  assert.doesNotMatch(
    js,
    /insignia\.textContent[\s\S]{0,140}?ejecuci/,
    "dos palabras para lo mismo invitan a creer que miden cosas distintas"
  );
});

test("municipalities are revealed by an accessible control", () => {
  /*
    Un div que se abre sin `aria-expanded` es invisible para quien navega con
    lector de pantalla, y un `<div>` con onclick no se alcanza con el teclado.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(js, /aria-expanded/, "el control dice si está abierto o cerrado");
  assert.match(js, /<button/, "y es un botón: se alcanza con el teclado");
});

test("the two counts sit in their own column, each in its series' colour", () => {
  /*
    El par exacto vivía en un segundo renglón bajo el nombre y duplicaba el
    alto de CADA fila para repetir, en números, lo que la barra ya dice en
    proporción. En su propia columna la fila baja a un renglón.

    Y coloreado importa más de lo que parece: el par enseña por sí solo cuál
    color es cuál, así que la leyenda deja de ser un requisito para entender la
    barra y pasa a ser respaldo. Un gráfico que no se puede leer sin mirar
    arriba y volver es un gráfico que se lee mal.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(js, /admin__par-cuenta/, "el número con sesión lleva su clase");
  assert.match(js, /admin__par-anon/, "y el anónimo la suya");
  assert.doesNotMatch(
    js,
    /admin__region-detalle/,
    "y ya no cuelga de un segundo renglón bajo el nombre"
  );

  const css = sinComentariosCss(read(HOJA));
  assert.match(
    css,
    /\.admin__par-cuenta\s*\{[^}]*--serie-con-sesion/,
    "cada número toma el color de SU serie, no uno decorativo"
  );
  assert.match(
    css,
    /\.admin__par-anon\s*\{[^}]*--serie-sin-sesion/,
    "y el otro el de la suya, o el par no enseñaría nada"
  );
});

test("the hidden attribute wins over any display this sheet declares", () => {
  /*
    LA MISMA TRAMPA, TRES VECES. Por eso se arregla de raíz y no caso por caso.

    El `display: none` del atributo `hidden` lo pone la hoja del navegador, con
    la especificidad más baja que existe. CUALQUIER `display` de autor le gana,
    y esta hoja declara varios porque los necesita para maquetar.

    Las tres apariciones, todas encontradas MIRANDO la pantalla y ninguna por
    un test:

      · `.admin__municipios` (`display: grid`) — la lista de municipios nacía
        ABIERTA con el chevron diciendo que estaba cerrada.
      · `.admin__insignia` (`display: inline-block`) — con `hidden` puesto se
        veía igual, como una pastilla cian vacía de 13px al lado del mes.
      · y la misma insignia en Distribución Geográfica, que hereda la regla.

    Una regla global cierra la clase entera de bug. `!important` acá no es
    pereza: es la forma estándar de devolverle al atributo la prioridad que la
    hoja del navegador no puede defender.
  */
  const css = sinComentariosCss(read(HOJA));

  assert.match(
    css,
    /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    "el atributo `hidden` tiene que ganarle a los `display` de esta hoja"
  );
});

test("the controls stay hidden while there is nothing to control", () => {
  /*
    Hoy hay 2 estados. Ofrecer "ordenar", "buscar" y "ver los N restantes"
    sobre dos filas es prometer una herramienta que no hace nada — que es
    exactamente el error que la casilla de administración venía cometiendo.
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.match(html, /id="ordenRegiones"[^>]*\shidden/,
    "las pestañas nacen ocultas");
  assert.match(html, /id="buscarRegion"[^>]*\shidden/,
    "el buscador nace oculto");

  const js = seccion(read(SCRIPT), "Distribución geográfica");
  assert.match(js, /CORTE_ESTADOS/,
    "y el corte de la lista es una constante con nombre, no un número suelto");
});

test("the two series speak one language of colour across the panel", () => {
  /*
    Dos colores —cian con sesión, ámbar sin sesión— en vez de dos intensidades
    del mismo cian. Medido en pantalla el 2026-08-27: en la leyenda real los
    dos matices no se distinguían.

    Y si la sección cambia de paleta pero la serie temporal no, la misma
    pantalla queda hablando dos idiomas de color.
  */
  const css = sinComentariosCss(read(HOJA));

  assert.match(css, /--serie-con-sesion/, "la serie con sesión tiene token propio");
  assert.match(css, /--serie-sin-sesion/, "y la serie sin sesión también");
  assert.match(
    css,
    /\.admin__serie-linea--anon\s*\{[^}]*--serie-sin-sesion/,
    "la serie temporal adopta el mismo token que la sección geográfica"
  );
});

test("bar widths are computed on the MAXIMUM, never on the total", () => {
  /*
    Heredado del mapa que reemplaza, y por la misma razón medida: con muchos
    municipios, los porcentajes sobre el total dan columnas de dos píxeles que
    no se comparan entre sí. Sobre el máximo, la mayor llena el alto y el
    resto se lee contra ella.
  */
  /*
    Hay DOS divisiones en juego y sólo una sería un error:

      · la ALTURA de la columna → sobre el máximo. Dividirla por el total de
        todas achataría las chicas hasta lo ilegible.
      · la PROPORCIÓN dentro de la columna (cuánto es anónimo, cuánto cuenta)
        → sobre el total DE ESA columna, que es lo correcto: las dos partes
        tienen que sumar el 100% de su propia barra.

    El primer aserto prohibía "dividir por total" a secas y castigaba la
    segunda, que está bien. Ahora se piden las dos por separado.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(
    js,
    /const maximo = Math\.max\(/,
    "la escala de ancho sale del máximo de las filas"
  );
  assert.match(
    js,
    /\/ maximo\) \* 100/,
    "y el ancho se calcula contra ese máximo, no contra la suma de todas"
  );
  assert.match(
    js,
    /\/ fila\.total\) \* 100/,
    "la proporción interna sí va sobre el total de su propia fila"
  );
});

test("'Sin ubicación' stays visible, apart, and out of the ranking", () => {
  /*
    Cerca de la mitad de las IPs no baja de país (medido contra la base GeoIP
    real). Descartarlas haría ver menos uso del que hubo; mezclarlas con los
    municipios inventaría uno que no existe.

    Y desde que la lista se corta en 5, hay un tercer error posible: dejarla
    competir por el ranking empujaría fuera a un estado real. Va aparte, al
    final, y no entra ni en el orden ni en el corte.
  */
  const js = seccion(read(SCRIPT), "Distribución geográfica");

  assert.match(js, /sin_ubicacion/, "reconoce la clave del servidor");
  assert.match(js, /Sin ubicación/, "con etiqueta legible");
  assert.match(
    js,
    /!== SIN_UBICACION/,
    "y queda fuera del orden y del corte, no compitiendo con los estados reales"
  );

  /*
    Encontrado MIRANDO la pantalla: su fila no lleva chevron, así que el nombre
    caía en la columna de 0.9rem reservada para él y la fila se apilaba en tres
    renglones. Es la única fila de la lista con esa forma, y por eso es la
    única que ningún otro test cubre.
  */
  const css = sinComentariosCss(read(HOJA));
  assert.match(
    css,
    /\.admin__region--plana .admin__region-nombre\s*\{[^}]*grid-column:\s*2/,
    "sin chevron, su nombre tiene que saltar a la columna de los nombres"
  );
});

test("the panel has a time series, and it is NOT the hour histogram", () => {
  /*
    Son dos gráficos distintos y responden preguntas distintas:

      · La franja de 24 horas (en las tarjetas) → ¿a qué HORA se usa?
        Su eje es fijo: siempre las mismas 24 celdas.
      · Esta serie → ¿el uso SUBE o BAJA? Su eje CRECE con el tiempo.

    Se fija por test porque la confusión ya ocurrió al planificar.
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.match(html, /id="seccionSerie"/, "falta la sección de la serie");
  assert.match(html, /id="graficoSerie"/, "falta su contenedor");
  assert.match(
    html,
    /id="seccionSerie"[^>]*\shidden/,
    "nace oculta hasta que el servidor mande por_dia"
  );
});

test("days with no use keep their slot on the axis", () => {
  /*
    Saltarse los días vacíos convertiría una semana muerta en una línea que
    sigue subiendo — exactamente la mentira que un gráfico de tendencia puede
    contar sin que nadie lo note.

    Mismo criterio que las 24 horas de la franja: la POSICIÓN en el eje es el
    dato.
  */
  const js = read(SCRIPT);
  const serie = seccion(js, "Cuándo se usa");

  assert.match(js, /cuerpo\.por_dia/, "debe leer el agregado de días");
  assert.match(serie, /<polyline/i,
    "se dibuja con SVG inline, sin librería");

  /*
    El aserto que fija la propiedad: el rango se recorre día por día con un
    cursor, en vez de iterar sólo las claves que el servidor mandó. El servidor
    manda únicamente los días CON extracciones; sin este relleno, una semana
    muerta desaparecería del eje y la línea seguiría subiendo.
  */
  assert.match(serie, /setUTCDate\(/,
    "el eje se rellena día a día, no salteando los vacíos");
  assert.match(serie, /porDia\[clave\] \|\| \{\}/,
    "un día sin datos vale 0, no se omite");
});

test("neither new section pulls in a chart library", () => {
  /*
    No es preferencia: el CSP desplegado el 2026-08-23 sólo admite scripts de
    `cdn.jsdelivr.net` y `googletagmanager.com`. Una librería exigiría tocar
    `vercel.json` y volver a desplegar — y no hace falta: una columna es un
    rectángulo con altura en porcentaje, y una línea es un `<polyline>`.
  */
  assert.doesNotMatch(
    read(PAGINA),
    /chart\.js|apexcharts|d3(?:\.min)?\.js|highcharts|echarts|plotly/i,
    "ninguna librería de gráficos entra por estas secciones"
  );
});

test("the panel warns when the sample is too small to read a trend", () => {
  /*
    Medido el 2026-08-25: 7 extracciones sin contar administración, y la tabla
    se escribe desde el 21. Un gráfico sobre eso sugiere una tendencia que no
    existe.

    La nota no es cosmética: es la misma regla que ya le costó cuatro secciones
    a esta pantalla — una pantalla que muestra datos falsos es peor que una
    pantalla que no está.
  */
  const js = read(SCRIPT);

  assert.match(js, /MUESTRA_MINIMA/, "debe haber un umbral con nombre");
  assert.match(
    js,
    /pocos datos|muestra pequeña|todavía hay pocas/i,
    "y una nota legible cuando no se alcanza"
  );
});

/* ---------------------------------------------------------------------------
 * El filtro de administración sube a control GLOBAL (2026-08-27).
 *
 * Vivía dentro de Distribución Geográfica y sólo limpiaba esa sección. Las
 * otras dos seguían contando las pruebas de administración mientras el control
 * decía "excluir" — la misma clase de mentira que costó el bug 58 ↔ 7.
 *
 * Tres de las cuatro secciones lo honran. La cuarta —"Usuarios del sitio"— NO,
 * y es deliberado: los gráficos MIDEN uso, la tabla ADMINISTRA cuentas. Ocultar
 * filas ahí te esconde tu propia fila y con ella el botón de editar tus
 * límites.
 * ------------------------------------------------------------------------ */

test("the admin filter is a page-level control, not a section one", () => {
  const html = sinComentariosHtml(read(PAGINA));
  const contenido = html.slice(html.indexOf('id="adminContent"'));

  const posControl = contenido.indexOf('id="filtroAdminsCaja"');
  const posPrimeraSeccion = contenido.indexOf('<section class="panel');

  assert.notEqual(posControl, -1, "el control tiene que existir");
  assert.ok(
    posControl < posPrimeraSeccion,
    "va ARRIBA de todo lo que afecta, no dentro de una sección: un control " +
      "que gobierna tres secciones no puede vivir dentro de una de ellas"
  );
});

test("the switch announces itself as a switch, and reaches the keyboard", () => {
  /*
    No hay ni un `role="switch"` en el resto del repo, así que esto se
    construye: los cinco checkboxes del sitio son nativos con `accent-color`.

    Se hace con `<button>` y no con un checkbox disfrazado para no necesitar
    `appearance: none` —que el repo no usa en ningún lado— y para que un lector
    de pantalla lo anuncie como interruptor y no como casilla.
  */
  const html = sinComentariosHtml(read(PAGINA));
  const boton = html.match(/<button[^>]*id="filtroAdmins"[\s\S]*?>/)?.[0] ?? "";

  assert.notEqual(boton, "", "el interruptor tiene que ser un <button>");
  assert.match(boton, /role="switch"/, "y anunciarse como interruptor");
  assert.match(
    boton,
    /aria-checked="true"/,
    "encendido de arranque: excluir administración es el estado por defecto"
  );

  assert.doesNotMatch(
    html,
    /id="filtroAdmins"[^>]*type="checkbox"/,
    "la casilla vieja se retira: dos controles para lo mismo se desincronizan"
  );

  const css = sinComentariosCss(read(HOJA));
  assert.match(
    css,
    /\.admin__interruptor/,
    "y NO se llama `.admin__switch`: ese nombre era el interruptor del alta " +
      "de accesos borrada por no otorgar nada (F30), y un test afirma su ausencia"
  );
});

test("one single place decides whether admins are being excluded", () => {
  /*
    El estado se leía del DOM dentro de `filasDeRegiones`. Con tres consumidores,
    tres lecturas sueltas es como se desincronizan las secciones — que es
    exactamente el bug que este rediseño vino a cerrar.
  */
  const js = read(SCRIPT);
  const lecturas = (js.match(/getAttribute\("aria-checked"\)/g) || []).length;

  assert.equal(
    lecturas,
    1,
    "un solo lector del interruptor; el resto pregunta por `excluyendoAdmins()`"
  );
});

test("flipping it repaints both charts, not one", () => {
  /*
    Eran tres hasta que "Quién lo usa y cuánto" se retiró el 2026-08-28. El
    aserto se ajusta al alcance real: si mañana vuelve a haber una sección que
    el interruptor deba gobernar y no se agrega acá, este test no la reclamará
    — por eso también se revisa la línea de alcance que el control declara.
  */
  const js = read(SCRIPT);
  const cuerpo = js.match(/function repintarTodo\(\)[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.notEqual(cuerpo, "", "falta el repintado global");
  assert.match(cuerpo, /pintarRegiones\(/, "la geográfica");
  assert.match(cuerpo, /pintarSerie\(/, "y la serie temporal");
  assert.doesNotMatch(cuerpo, /pintarActividad\(/,
    "la sección de actividad ya no existe");

  const html = sinComentariosHtml(read(PAGINA));
  assert.match(html, /Afecta a los dos gráficos/i,
    "y el control declara el alcance que de verdad tiene");
});

test("the accounts table is NOT filtered — it is a registry, not a measurement", () => {
  /*
    Filtrarla escondería tu propia fila y con ella el botón de editar tus
    límites, y nada en pantalla diría por qué desapareció.
  */
  const js = read(SCRIPT);
  const armado = js.match(/const orden = \[\.\.\.perfiles\][\s\S]{0,400}/)?.[0] ?? "";

  assert.notEqual(armado, "", "falta el armado de la tabla");
  assert.doesNotMatch(
    armado,
    /excluyendoAdmins/,
    "la tabla lista a todos, esté el interruptor donde esté"
  );
});

test("the time series says so when it could NOT honour the filter", () => {
  /*
    `por_dia` colapsa el rol en `anon`/`cuenta` y NO es derivable: `actividad`
    guarda la HORA del mes, no la fecha, así que restar daría el total correcto
    pero habría que inventar cómo repartirlo entre días.

    Hasta que el servidor mande `por_dia_sin_admins`, la sección lo DICE. Un
    control que promete y una sección que no cumple, en silencio, es el bug que
    este trabajo vino a cerrar.
  */
  const js = read(SCRIPT);
  assert.match(js, /por_dia_sin_admins/, "consume el agregado filtrado");

  const serie = seccion(js, "Cuándo se usa");
  assert.match(
    serie,
    /admin__nota-sin-filtrar/,
    "y cuando no vino, avisa en vez de callarse"
  );
  assert.match(
    serie,
    /cuenta las pruebas de administración/i,
    "con una frase que se entienda, no un icono"
  );
});

test("the control states what it governs and what it leaves alone", () => {
  /*
    Gobierna tres secciones de cuatro. Eso no se adivina mirando: sin la línea
    de alcance, quien lo encienda esperaría que la tabla también cambie.
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.match(html, /La tabla de cuentas no cambia/i,
    "el control dice a qué NO afecta, que es lo que nadie deduce");
});

/* ---------------------------------------------------------------------------
 * "Permanencia y tiempo de uso" (2026-08-28): el histograma de cuánto dura
 * cada visita.
 *
 * Es la única sección que NO puede honrar el interruptor de administración, y
 * por una razón de diseño y no por un descuido: `extractor_visita` no guarda
 * `user_id` ni `sesion_anon`, así que no hay a quién excluir. Lo dice en
 * pantalla, igual que la serie temporal declara lo suyo.
 * ------------------------------------------------------------------------ */

test("the permanence section has three states, not two", () => {
  /*
    **Cero visitas no es lo mismo que no poder medirlas**, y sin esa distinción
    los dos se ven idénticos: una sección que no está.

      · el campo no viene   -> oculta   (este servidor no mide)
      · el campo en cero    -> VISIBLE y vacía, diciéndolo
      · el campo con datos  -> el histograma

    Importa después del deploy: sin el estado del medio no habría forma de
    saber si la sección está vacía porque algo falló o porque nadie ha entrado
    todavía — y con 8 extracciones al mes, eso puede ser un buen rato.

    Es el mismo criterio con el que `por_region_sin_admins` trata `{}` como un
    dato y la ausencia como otra cosa.
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.match(html, /id="seccionPermanencia"[^>]*\shidden/,
    "nace oculta: sin el campo, el servidor no mide");
  assert.match(html, /id="graficoPermanencia"/, "y tiene su contenedor");

  const js = seccion(read(SCRIPT), "Permanencia y tiempo de uso");

  assert.match(js, /!datos/,
    "sin el campo se oculta");
  assert.match(
    js,
    /datos\.total\s*===\s*0|!datos\.total/,
    "pero con el campo en cero NO se oculta: se distingue el caso"
  );
  assert.match(
    js,
    /todavía no|aún no/i,
    "y se dice en pantalla que todavía no hubo visitas"
  );

  assert.match(read(SCRIPT), /cuerpo\.permanencia/,
    "lee el agregado de la respuesta");
});

test("the buckets are fixed and ordered, and an empty one keeps its slot", () => {
  /*
    En un histograma la POSICIÓN es el dato. Saltarse un tramo sin visitas
    convierte una distribución con dos picos en una campana — la misma razón
    por la que la franja horaria siempre tiene 24 celdas y la serie temporal
    rellena los días muertos.
  */
  const js = seccion(read(SCRIPT), "Permanencia y tiempo de uso");

  assert.match(js, /TRAMOS_PERMANENCIA/,
    "los tramos son una constante con nombre, no un objeto que llega y se pinta");
  assert.match(
    js,
    /TRAMOS_PERMANENCIA\.map/,
    "y se recorre la constante, no las claves del payload: así un tramo que el " +
      "servidor no mandó igual ocupa su lugar"
  );
});

test("the average is read as time, not as a raw second count", () => {
  /*
    `258` no le dice nada a nadie; `4m 18s` sí. Es la misma diferencia que
    justifica que la ubicación se muestre como "Querétaro" y no como un par de
    coordenadas.
  */
  const js = seccion(read(SCRIPT), "Permanencia y tiempo de uso");

  assert.match(js, /promedio_s/, "lee el promedio en segundos");
  assert.match(
    js,
    /Math\.floor\([^)]*\/ 60\)/,
    "y lo parte en minutos"
  );
  assert.match(js, /%\s*60/, "y segundos");
});

test("column heights come from the MAXIMUM, never from the total", () => {
  /*
    Heredado de las dos formas que ya lo hacían, y por la misma razón medida:
    sobre el total, con seis tramos todas las columnas quedan de dos píxeles y
    dejan de compararse entre sí.
  */
  const js = seccion(read(SCRIPT), "Permanencia y tiempo de uso");

  assert.match(js, /Math\.max\(/, "la escala sale del máximo de los tramos");
  assert.match(js, /\/ maximo\) \* 100/, "y la altura se calcula contra él");
});

test("the section declares the two things it cannot promise", () => {
  /*
    Las dos son limitaciones reales y ninguna se adivina mirando el gráfico.
    Un número presentado como exacto cuando no lo es es la clase de mentira que
    este panel ya pagó una vez.
  */
  /*
    Los espacios se normalizan y las etiquetas se quitan ANTES de buscar. El
    ajuste de línea del HTML parte las frases —"no afecta a esta ⏎ sección"— y
    un `<strong>` en el medio las parte otra vez. Sin esto, el aserto falla
    contra una página que sí dice lo que se le pide.
  */
  const prosa = sinComentariosHtml(read(PAGINA))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  assert.match(
    prosa,
    /interruptor de administradores no afecta a esta sección/i,
    "que el filtro de administración no la toca, y por qué"
  );
  assert.match(
    prosa,
    /los tiempos son un piso/i,
    "y que los tiempos son un piso, no una medida exacta"
  );
});
