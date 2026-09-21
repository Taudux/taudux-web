const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const DATOS = require(path.join(ROOT, "src/app/features/colaboradores/colaboradores.datos.js"));
const {
  COLUMNAS_ROSTER,
  MODALIDADES_TRABAJO,
  tienePerfil,
  experienciaDesde,
  indicePorSlug,
  moverSeleccion,
  numeroDeFicha,
  enlacesDisponibles,
} = DATOS;
const { COLABORADORES_MUESTRA: MUESTRA } = require("./fixtures/colaboradores.muestra.js");

// Mismo formato que el check `perfiles_slug_formato` de la migración 0038.
const FORMATO_DE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/*
  La lista sale de la base (listarColaboradores): el archivo de datos de la
  página es sólo lógica. Las doce personas inventadas del prototipo viven en
  tests/fixtures y nunca deben volver a viajar a producción.
*/
test("the page data module ships no sample people and no slug generator of its own", () => {
  assert.equal(DATOS.COLABORADORES, undefined, "las fichas de muestra no van en el código de la página");
  assert.equal(DATOS.slugDeColaborador, undefined, "el slug lo genera la base, no el front");
});

/*
  Cada ficha de muestra lleva la ficha de perfil completa: es lo que usan los
  tests de la vista de perfil. El prototipo traía los campos en dos arreglos
  paralelos emparejados por índice; acá cada persona lleva todo lo suyo.
*/
test("every sample person carries the full profile the profile view paints", () => {
  assert.ok(MUESTRA.length > 0, "la muestra no puede estar vacía");
  for (const persona of MUESTRA) {
    assert.equal(tienePerfil(persona), true, `${persona.nombre}: ficha incompleta`);
  }
});

/*
  La página retiró los atributos 1–5, la clase, el colega sugerido y los
  proyectos (2026-09-19). Ni la lógica los ofrece ni la ficha de perfil los
  exige: una persona que no los tenga abre su perfil igual.
*/
test("the retired attributes, class, colleague and projects are gone from the roster logic", () => {
  assert.equal(DATOS.ETIQUETAS_ATRIBUTOS, undefined, "sin atributos no hay etiquetas");
  assert.equal(DATOS.etiquetaDeAtributo, undefined, "sin atributos no hay valor n/5");
  assert.equal(DATOS.colegaSugerido, undefined, "\"Suele trabajar con\" ya no existe");

  for (const persona of MUESTRA) {
    for (const campo of ["clase", "stats", "proyectos"]) {
      assert.equal(campo in persona, false, `${persona.nombre} todavía trae ${campo}`);
    }
  }
});

test("a profile no longer depends on class, attributes or project count", () => {
  const base = MUESTRA[0];
  // Aunque lleguen, vacíos o fuera de rango, ya no deciden si hay perfil.
  assert.equal(tienePerfil({ ...base, clase: "", stats: [], proyectos: -1 }), true);
});

// Dos personas con el mismo slug abrirían siempre la primera.
test("sample slugs are unique and follow the database slug format", () => {
  const slugs = MUESTRA.map((persona) => persona.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs repetidos");
  for (const slug of slugs) assert.match(slug, FORMATO_DE_SLUG);
});

/*
  La muestra ejercita cada modalidad de trabajo, y está congelada hasta las
  herramientas: un test que la retoque sin clonarla lanza en vez de ensuciar
  al siguiente.
*/
test("the sample covers every work modality value and is frozen all the way down", () => {
  assert.deepEqual(new Set(MUESTRA.map((persona) => persona.modalidad_trabajo)), new Set(MODALIDADES_TRABAJO));

  assert.ok(Object.isFrozen(MUESTRA));
  for (const persona of MUESTRA) {
    assert.ok(Object.isFrozen(persona), `${persona.nombre}: la ficha no está congelada`);
    assert.ok(Object.isFrozen(persona.herramientas), `${persona.nombre}: las herramientas no están congeladas`);
  }
});

// Un enlace de la muestra que la página descartara dejaría a los tests de
// píldoras probando menos de lo que parece.
test("every link in the sample is one the page offers, and only some people have links", () => {
  let conEnlaces = 0;
  for (const persona of MUESTRA) {
    const cargados = ["linkedin", "github", "correo"].filter((tipo) => persona[tipo] !== null);
    const ofrecidos = enlacesDisponibles(persona).map((enlace) => enlace.tipo);
    assert.deepEqual(ofrecidos, cargados, `${persona.nombre}: un enlace de la muestra se descarta`);
    if (cargados.length > 0) conEnlaces += 1;
  }
  assert.ok(conEnlaces > 0, "alguien de la muestra tiene que tener enlaces");
  assert.ok(conEnlaces < MUESTRA.length, "y alguien tiene que no tener ninguno");
});

/*
  El front y la base no pueden desfasarse: una modalidad que la 0040 acepte y
  el front no conozca dejaría a esa persona sin perfil, y una que el front
  acepte y la base no, sería código muerto.
*/
test("the work modality values are exactly the ones the 0040 CHECK allows, in the same order", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/0040_modalidad_trabajo_colaborador.sql"), "utf8");
  const check = sql.match(/fichas_colaborador_modalidad_trabajo_valida\s+check\s*\(\s*modalidad_trabajo\s+in\s*\(([^)]*)\)/);
  assert.ok(check, "no se encontró el CHECK de modalidad_trabajo en la 0040");

  const valoresDeLaBase = [...check[1].matchAll(/'([^']*)'/g)].map(([, valor]) => valor);
  assert.deepEqual([...MODALIDADES_TRABAJO], valoresDeLaBase);
  assert.deepEqual([...MODALIDADES_TRABAJO], ["Presencial", "Híbrido", "Remoto"]);
});

// "Híbrido" tiene que estar en NFC (í = U+00ED): en NFD (i + U+0301) se ve
// idéntico pero la base lo rechaza con 23514 (ver la 0040).
test("every work modality value is in NFC", () => {
  for (const valor of MODALIDADES_TRABAJO) {
    assert.equal(valor, valor.normalize("NFC"), `"${valor}" no está en NFC`);
  }
});

/*
  Quien todavía no llenó su ficha llega del servicio con todos los campos de
  ficha en null (el RPC hace left join). Sale en el roster, pero no tiene
  perfil que abrir.
*/
test("a public record without a card yet has no profile", () => {
  assert.equal(tienePerfil({ nombre: "Samael Flores", corto: "Samael", slug: "samael" }), false);
  assert.equal(tienePerfil({
    nombre: "Samael Flores",
    corto: "Samael",
    slug: "samael",
    puesto: null,
    sector: null,
    ubicacion: null,
    herramientas: null,
    modalidad_trabajo: null,
    anio_inicio: null,
    bio: null,
    linkedin: null,
    github: null,
    correo: null,
  }), false);
  assert.equal(tienePerfil(null), false);
  assert.equal(tienePerfil(undefined), false);
});

/*
  La base garantiza que una ficha guardada está completa, pero tienePerfil()
  no se fía: cada campo que la vista pinta SIN saber ocultarlo es obligatorio,
  o quedaría un hueco en blanco en la ficha técnica.
  Ése es el corte, y no "obligatorio en la base": los campos cuya celda se
  oculta sola —empresa, habilidades, idiomas y, desde la 0042, sector— quedan
  fuera a propósito. Exigirlos no evitaría ningún hueco y costaría el perfil
  entero.
*/
test("a single missing, blank or unknown field is enough to have no profile", () => {
  const base = MUESTRA[0];
  assert.equal(tienePerfil({ ...base }), true, "premisa: la base sí tiene ficha");

  for (const campo of ["nombre", "corto", "puesto", "ubicacion", "bio"]) {
    for (const valor of [undefined, null, "", "   ", 7]) {
      assert.equal(tienePerfil({ ...base, [campo]: valor }), false, `${campo} = ${JSON.stringify(valor)}`);
    }
  }

  // Las herramientas son un arreglo con al menos un texto, y ninguno en blanco.
  for (const herramientas of [undefined, null, [], ["   "], ["Python", ""], ["Python", null], [7], "PostgreSQL · Python"]) {
    assert.equal(tienePerfil({ ...base, herramientas }), false, `herramientas = ${JSON.stringify(herramientas)}`);
  }

  /*
    Habilidades e idiomas NO cuentan, y es deliberado: son opcionales en la
    0041 (`between 0 and 12`) y si decidieran "tiene ficha", quien no las
    llenó se quedaría sin perfil abrible. Su celda se oculta, el perfil abre.
  */
  for (const campo of ["habilidades", "idiomas"]) {
    for (const valor of [undefined, null, [], ["   "], [7], "Español"]) {
      assert.equal(tienePerfil({ ...base, [campo]: valor }), true, `${campo} = ${JSON.stringify(valor)}`);
    }
  }

  // La empresa y su enlace, igual: opcionales en la 0041 y fuera de
  // tienePerfil(). Sin nombre, el perfil abre y su celda no aparece.
  //
  // Y el sector desde la 0042, que lo volvió opcional. Es el único de los
  // tres que ANTES contaba: si volviera a contar, quien borre su sector
  // desaparecería del roster entero en vez de perder una fila.
  for (const campo of ["empresa", "empresa_enlace", "sector"]) {
    for (const valor of [undefined, null, "", "   ", 7]) {
      assert.equal(tienePerfil({ ...base, [campo]: valor }), true, `${campo} = ${JSON.stringify(valor)}`);
    }
  }

  for (const modalidad_trabajo of [undefined, null, "", "Ocupado", "remoto", " Remoto"]) {
    assert.equal(tienePerfil({ ...base, modalidad_trabajo }), false, `modalidad_trabajo = ${JSON.stringify(modalidad_trabajo)}`);
  }

  // Un año entero, no un texto ni una fracción: de él sale la experiencia.
  for (const anio_inicio of [undefined, null, "2018", 2018.5, Number.NaN, Infinity]) {
    assert.equal(tienePerfil({ ...base, anio_inicio }), false, `anio_inicio = ${String(anio_inicio)}`);
  }
});

test("each work modality value is a valid one for a profile", () => {
  for (const modalidad_trabajo of MODALIDADES_TRABAJO) {
    assert.equal(tienePerfil({ ...MUESTRA[0], modalidad_trabajo }), true, modalidad_trabajo);
  }
});

/*
  Los campos del prototipo se renombraron a los de la base (0039/0040/0041):
  ciudad → ubicacion, esp → sector, disp → modalidad_trabajo, anios →
  anio_inicio (un año, no un texto) y las herramientas pasaron de texto a
  arreglo. Una ficha con la forma vieja ya no abre perfil, y la muestra no la
  conserva.
*/
test("a card in the old prototype shape has no profile, and the sample no longer uses it", () => {
  const { sector, ubicacion, modalidad_trabajo, anio_inicio, herramientas, ...resto } = MUESTRA[0];
  const vieja = {
    ...resto,
    esp: sector,
    ciudad: ubicacion,
    disp: modalidad_trabajo,
    anios: "8 años",
    stack: herramientas.join(" · "),
  };
  assert.equal(tienePerfil(vieja), false);
  assert.equal(anio_inicio, 2018, "premisa: la muestra trae el año, no el texto");

  for (const persona of MUESTRA) {
    for (const viejo of ["ciudad", "esp", "disp", "anios"]) {
      assert.equal(viejo in persona, false, `${persona.nombre} todavía trae ${viejo}`);
    }
  }
});

/*
  La experiencia se calcula al pintar, a partir del año de inicio: la base
  guarda un año y no un texto que envejezca. El año actual entra como
  argumento para que el cálculo sea puro y el test no dependa del reloj.
*/
test("experience reads in whole years from the start year and a given current year", () => {
  assert.equal(experienciaDesde(2018, 2026), "8 años");
  assert.equal(experienciaDesde(2024, 2026), "2 años");
  assert.equal(experienciaDesde(2025, 2026), "1 año");
  assert.equal(experienciaDesde(2026, 2026), "Menos de un año");
  assert.equal(experienciaDesde(1950, 2026), "76 años");
  // Un año de inicio en el futuro no da una experiencia negativa.
  assert.equal(experienciaDesde(2030, 2026), "Menos de un año");
});

/*
  El perfil vive en el hash (#/valeria) para que el botón atrás del navegador
  vuelva al roster. El slug es el de la base: se busca tal cual en la lista
  cargada, sin volver a derivarlo del nombre.
*/
test("a profile slug resolves to its position in the loaded list", () => {
  MUESTRA.forEach((persona, indice) => assert.equal(indicePorSlug(MUESTRA, persona.slug), indice));
  assert.equal(indicePorSlug(MUESTRA, "no-existe"), -1);
  assert.equal(indicePorSlug(MUESTRA, ""), -1);
  assert.equal(indicePorSlug(MUESTRA, "VALERIA"), 0, "el hash puede llegar en mayúsculas");

  // Una persona sin ficha de perfil también se encuentra: el slug es de la cuenta.
  assert.equal(indicePorSlug([{ nombre: "Samael", corto: "Samael", slug: "samael" }], "samael"), 0);
  assert.equal(
    indicePorSlug([{ nombre: "Sebastián Lara", corto: "Sebastián", slug: "sebas-lara" }], "sebastian"),
    -1,
    "el slug es el de la base, no uno derivado del nombre",
  );

  assert.equal(indicePorSlug([], "valeria"), -1);
  assert.equal(indicePorSlug(undefined, "valeria"), -1, "sin lista cargada no hay a quién abrir");
});

/*
  Navegación con flechas sobre una grilla de COLUMNAS_ROSTER columnas. No da la
  vuelta: en el borde se queda donde está, que es lo que espera quien navega una
  grilla con el teclado (y evita saltar de la primera fila a la última).
*/
test("arrow keys move the selection across the grid and stop at its edges", () => {
  const total = 12;
  assert.equal(COLUMNAS_ROSTER, 4);

  assert.equal(moverSeleccion(null, "ArrowRight", total), 0, "sin selección, cualquier flecha entra por la primera ficha");
  assert.equal(moverSeleccion(null, "ArrowUp", total), 0);

  assert.equal(moverSeleccion(0, "ArrowRight", total), 1);
  assert.equal(moverSeleccion(1, "ArrowLeft", total), 0);
  assert.equal(moverSeleccion(0, "ArrowDown", total), 4);
  assert.equal(moverSeleccion(5, "ArrowUp", total), 1);

  assert.equal(moverSeleccion(0, "ArrowLeft", total), 0, "borde izquierdo");
  assert.equal(moverSeleccion(11, "ArrowRight", total), 11, "borde derecho");
  assert.equal(moverSeleccion(2, "ArrowUp", total), 2, "primera fila");
  assert.equal(moverSeleccion(9, "ArrowDown", total), 9, "última fila");

  // Última fila incompleta: bajar desde una columna sin ficha debajo no se sale.
  assert.equal(moverSeleccion(3, "ArrowDown", 6), 3);
  assert.equal(moverSeleccion(1, "ArrowDown", 6), 5);

  assert.equal(moverSeleccion(4, "Enter", total), 4, "una tecla que no es flecha no mueve nada");

  // Izquierda/derecha no cruzan de fila. Sin esta guarda, 4 → 3 y 7 → 8 caen
  // dentro del rango y pasarían por válidos: es el borde que el tope de
  // `total` no cubre.
  assert.equal(moverSeleccion(4, "ArrowLeft", total), 4, "del inicio de una fila no se salta al final de la anterior");
  assert.equal(moverSeleccion(7, "ArrowRight", total), 7, "del final de una fila no se salta al inicio de la siguiente");
});

/*
  indicePorSlug() devuelve -1 cuando el hash no corresponde a nadie, y lo natural
  es pasarle ese valor a moverSeleccion(). Un índice que no apunta a ninguna
  ficha se trata como "sin selección": si no, -1 se quedaba clavado con ↑ y ←, y
  con ↓ saltaba a la ficha 3 sin motivo.
*/
test("an index that points at no card counts as no selection", () => {
  for (const tecla of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert.equal(moverSeleccion(-1, tecla, 12), 0, `-1 con ${tecla}`);
    assert.equal(moverSeleccion(99, tecla, 12), 0, `99 con ${tecla}`);
    assert.equal(moverSeleccion(2.5, tecla, 12), 0, `2.5 con ${tecla}`);
  }
  assert.equal(moverSeleccion(-1, "Enter", 12), -1, "sin flecha no se toca nada, tampoco un índice inválido");
  assert.equal(moverSeleccion(null, "ArrowDown", 0), null, "con el roster vacío no hay a dónde entrar");
});

test("card numbers are zero-padded", () => {
  assert.equal(numeroDeFicha(0), "01");
  assert.equal(numeroDeFicha(11), "12");
});

/*
  En el prototipo todos los enlaces eran "#". Un enlace muerto es peor que
  ninguno: acá sólo se ofrecen los que tienen destino real, en orden fijo.
*/
test("only links with a real destination are offered", () => {
  assert.deepEqual(enlacesDisponibles({}), []);
  assert.deepEqual(enlacesDisponibles({ linkedin: "#", github: "", correo: "   " }), []);

  const enlaces = enlacesDisponibles({
    correo: "ana@taudux.com",
    linkedin: "https://www.linkedin.com/in/ana",
  });
  assert.deepEqual(enlaces, [
    { tipo: "linkedin", texto: "LinkedIn", href: "https://www.linkedin.com/in/ana" },
    { tipo: "correo", texto: "Correo", href: "mailto:ana@taudux.com" },
  ]);

  // Sólo https y correos: un `javascript:` en los datos no llega al href.
  assert.deepEqual(enlacesDisponibles({ github: "javascript:alert(1)", linkedin: "http://inseguro.example" }), []);

  // Un mailto acepta cabeceras tras el `?`. Una dirección que las traiga
  // pondría en copia oculta a un tercero cuando el visitante haga clic, así
  // que el correo sólo admite los caracteres de una dirección, no de una URL.
  for (const correo of [
    "victima@example.com?bcc=atacante%40evil.com",
    "victima@example.com&cc=otro@evil.com",
    "victima@example.com#x",
    "a%40b@example.com",
  ]) {
    assert.deepEqual(enlacesDisponibles({ correo }), [], `debe rechazar ${correo}`);
  }
  assert.equal(enlacesDisponibles({ correo: "nombre.apellido+filtro@sub.taudux.com" }).length, 1);
});

/*
  La píldora dice "LinkedIn" o "GitHub": el destino tiene que ser ese sitio,
  no cualquier https. Es la misma expresión que el CHECK de la 0039, así que
  una ficha guardada siempre pasa y lo que la base no aceptaría, el front
  tampoco lo pinta.
*/
test("a LinkedIn or GitHub link must point at that site, the same rule as the 0039 CHECK", () => {
  const tipos = (ficha) => enlacesDisponibles(ficha).map((enlace) => enlace.tipo);

  for (const linkedin of [
    "https://linkedin.com/in/ana",
    "https://www.linkedin.com/in/ana",
    "https://mx.linkedin.com/in/ana",
  ]) {
    assert.deepEqual(tipos({ linkedin }), ["linkedin"], `debe aceptar ${linkedin}`);
  }
  for (const linkedin of [
    "https://linkedin.com.evil.com/x",
    "https://evil.com/linkedin.com",
    "https://evil-linkedin.com/in/ana",
    "https://linkedin.com@evil.com/in/ana",
    "http://linkedin.com/in/ana",
    "https://linkedin.com/",
    "https://linkedin.com/in/ana con espacio",
    // Igual que el `~` de la base, distingue mayúsculas.
    "https://LinkedIn.com/in/ana",
    // Otro sitio válido, pero en el campo equivocado.
    "https://github.com/ana",
  ]) {
    assert.deepEqual(tipos({ linkedin }), [], `debe rechazar ${linkedin}`);
  }

  for (const github of ["https://github.com/ana", "https://www.github.com/ana"]) {
    assert.deepEqual(tipos({ github }), ["github"], `debe aceptar ${github}`);
  }
  for (const github of [
    "http://github.com/x",
    "https://github.com.evil.com/x",
    "https://evil.com/github.com",
    "https://gist.github.com/ana",
    "https://github.com/",
    "https://www.linkedin.com/in/ana",
  ]) {
    assert.deepEqual(tipos({ github }), [], `debe rechazar ${github}`);
  }
});
