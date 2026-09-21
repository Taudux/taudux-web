/*
  Núcleo puro de "Mi ficha": normalización y validación del formulario con el
  que cada colaborador edita su ficha pública. Las reglas son las de los CHECK
  de `fichas_colaborador` (0039, 0040 y 0041): lo que el formulario deja
  pasar, la base lo acepta, y lo que la base rechazaría, el formulario lo
  avisa campo por campo antes de enviarlo.

  Los límites y las expresiones de los enlaces se leen de la 0039; las
  modalidades de trabajo, de la 0040; los topes de las TRES listas de
  etiquetas y el largo de cada etiqueta, de la 0041 (ahí se partió el stack original en herramientas,
  habilidades e idiomas, y el CHECK por elemento se movió con él). Todo se
  compara contra el SQL: una copia sin vigilancia se desfasa en silencio.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const leer = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

const {
  CAMPOS_MI_FICHA,
  MODALIDADES_TRABAJO_MI_FICHA,
  LIMITES_MI_FICHA,
  PATRONES_ENLACE_MI_FICHA,
  errorDeElementoEtiquetaMiFicha,
  normalizarMiFicha,
  validarMiFicha,
  valoresFormularioMiFicha,
  nombreVisibleMiFicha,
  rutaPerfilPublicoMiFicha,
} = require("../src/app/features/colaboradores/mi-ficha/mi-ficha.logica.js");
const {
  MODALIDADES_TRABAJO,
  enlacesDisponibles,
} = require("../src/app/features/colaboradores/colaboradores.datos.js");

const SQL = leer("supabase/migrations/0039_fichas_colaborador.sql");
const SQL_0040 = leer("supabase/migrations/0040_modalidad_trabajo_colaborador.sql");
const SQL_0041 = leer("supabase/migrations/0041_etiquetas_empresa.sql");

// Año fijo: la validación recibe el año en curso como argumento, así que los
// casos no cambian con el reloj.
const ANIO = 2026;

// Los caracteres de formato bidireccional que la 0039 rechaza aparte (son Cf,
// no Cc: `[[:cntrl:]]` no los cubre y `btrim` no los quita).
const BIDI = ["‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"];

/*
  Los tres campos que son listas de etiquetas, en el orden de la ficha. Las
  tres comparten toda la maquinaria (normalización, veredicto por elemento y
  veredicto de la lista entera): lo único que cambia es el mínimo
  —herramientas exige 1, habilidades e idiomas admiten 0— y los textos de sus
  mensajes. Los casos que valen para las tres se parametrizan sobre esta
  lista: con una sola instancia, la parametrización por campo se podía romper
  sin que ningún test lo notara.
*/
const LISTAS_DE_ETIQUETAS = Object.freeze(["herramientas", "habilidades", "idiomas"]);
const LISTAS_OPCIONALES = Object.freeze(["habilidades", "idiomas"]);

// Una ficha de formulario válida, tal como la entregan los inputs (todo texto).
function valoresValidos(cambios = {}) {
  return {
    puesto: "Desarrolladora backend",
    sector: "Bases de datos",
    ubicacion: "Querétaro, México",
    herramientas: ["PostgreSQL", "Python", "GCP"],
    habilidades: ["Modelado de datos", "ETL"],
    idiomas: ["Español", "Inglés"],
    empresa: "Taudux",
    empresa_enlace: "https://taudux.com",
    modalidad_trabajo: "Híbrido",
    anio_inicio: "2018",
    bio: "Diseño esquemas y migraciones.\nMe gusta que los datos cuadren.",
    linkedin: "",
    github: "",
    correo: "",
    ...cambios,
  };
}

// Los errores de una validación, como { campo: mensaje }.
function erroresDe(valores, anio = ANIO) {
  const resultado = validarMiFicha(valores, anio);
  if (resultado.ok) return {};
  return Object.fromEntries(resultado.errores.map(({ campo, mensaje }) => [campo, mensaje]));
}

function assertValido(valores, mensaje) {
  const resultado = validarMiFicha(valores, ANIO);
  assert.equal(resultado.ok, true, `${mensaje}: ${JSON.stringify(resultado.errores)}`);
  return resultado.ficha;
}

function assertSoloErrorEn(valores, campo, mensaje) {
  const errores = erroresDe(valores);
  assert.deepEqual(Object.keys(errores), [campo], `${mensaje}: ${JSON.stringify(errores)}`);
  return errores[campo];
}

/* ---------- Forma de la ficha ---------- */

/*
  El servicio (ficha.service.js) escribe exactamente estas columnas. Su lista
  vive en un script de navegador sin exports: se corre en un vm y se lee el
  binding global.
*/
test("the card keys are exactly the columns the service writes, in the same order", () => {
  const contexto = vm.createContext({ console: { error() {} } });
  vm.runInContext(leer("src/app/core/colaboradores/ficha.service.js"), contexto);
  const columnas = [...vm.runInContext("COLUMNAS_MI_FICHA", contexto)];

  assert.deepEqual([...CAMPOS_MI_FICHA], columnas);
  assert.deepEqual([...CAMPOS_MI_FICHA], [
    "puesto", "sector", "ubicacion", "herramientas", "habilidades", "idiomas",
    "empresa", "empresa_enlace", "modalidad_trabajo", "anio_inicio", "bio",
    "linkedin", "github", "correo",
  ]);
});

test("normalizing always returns exactly the fourteen card keys", () => {
  for (const valores of [valoresValidos(), {}, undefined, null]) {
    assert.deepEqual(Object.keys(normalizarMiFicha(valores)), [...CAMPOS_MI_FICHA]);
  }
});

test("normalizing trims texts, trims each tool item and drops the empty ones, parses the year and turns empty links into null", () => {
  const ficha = normalizarMiFicha({
    puesto: "  Desarrolladora backend ",
    sector: "\tBases de datos\n",
    ubicacion: " Querétaro ",
    herramientas: [" PostgreSQL ", "Python", "", "  ", " GCP "],
    habilidades: [" ETL ", "", " Modelado de datos"],
    idiomas: ["  Español  ", "   "],
    empresa: "  Taudux  ",
    empresa_enlace: "   ",
    modalidad_trabajo: "Híbrido",
    anio_inicio: " 2018 ",
    bio: "\n\n  Primera línea.\nSegunda línea.  \n",
    linkedin: "  https://www.linkedin.com/in/ana  ",
    github: "   ",
    correo: "",
  });

  assert.deepEqual(ficha, {
    puesto: "Desarrolladora backend",
    sector: "Bases de datos",
    ubicacion: "Querétaro",
    herramientas: ["PostgreSQL", "Python", "GCP"],
    habilidades: ["ETL", "Modelado de datos"],
    idiomas: ["Español"],
    empresa: "Taudux",
    empresa_enlace: null,
    modalidad_trabajo: "Híbrido",
    anio_inicio: 2018,
    bio: "Primera línea.\nSegunda línea.",
    linkedin: "https://www.linkedin.com/in/ana",
    github: null,
    correo: null,
  });
});

test("normalizing a tools list that is not an array, or that has non-text items, gives an empty or trimmed array", () => {
  for (const herramientas of ["PostgreSQL, Python", null, undefined, 7, {}]) {
    assert.deepEqual(normalizarMiFicha(valoresValidos({ herramientas })).herramientas, [], JSON.stringify(herramientas));
  }
  // Lo que no es texto se descarta como si fuera un elemento vacío.
  assert.deepEqual(normalizarMiFicha(valoresValidos({ herramientas: ["Python", 7, null, "  ", "GCP"] })).herramientas, ["Python", "GCP"]);
});

test("normalizing an empty form gives empty texts, an empty tools list, no year and null links", () => {
  assert.deepEqual(normalizarMiFicha({}), {
    puesto: "",
    sector: "",
    ubicacion: "",
    herramientas: [],
    habilidades: [],
    idiomas: [],
    empresa: null,
    empresa_enlace: null,
    modalidad_trabajo: "",
    anio_inicio: null,
    bio: "",
    linkedin: null,
    github: null,
    correo: null,
  });
});

test("a valid form validates into the normalized card", () => {
  const ficha = assertValido(valoresValidos({ puesto: "  Desarrolladora backend  " }), "la ficha de base es válida");
  assert.deepEqual(ficha, normalizarMiFicha(valoresValidos()));
  assert.equal(ficha.puesto, "Desarrolladora backend");
});

/* ---------- Textos cortos: puesto, sector, ubicación ---------- */

const TEXTOS_CORTOS = [
  { campo: "puesto", min: 2, max: 60 },
  { campo: "sector", min: 2, max: 80 },
  { campo: "ubicacion", min: 2, max: 80 },
];

for (const { campo, min, max } of TEXTOS_CORTOS) {
  test(`${campo}: required, between ${min} and ${max} characters after trimming`, () => {
    assertSoloErrorEn(valoresValidos({ [campo]: "" }), campo, "vacío");
    assertSoloErrorEn(valoresValidos({ [campo]: "     " }), campo, "sólo espacios");
    assertSoloErrorEn(valoresValidos({ [campo]: "a".repeat(min - 1) }), campo, "uno menos que el mínimo");
    assertSoloErrorEn(valoresValidos({ [campo]: "a".repeat(max + 1) }), campo, "uno más que el máximo");

    assertValido(valoresValidos({ [campo]: "a".repeat(min) }), "el mínimo exacto");
    assertValido(valoresValidos({ [campo]: "a".repeat(max) }), "el máximo exacto");
    // Los espacios de los bordes se recortan antes de medir.
    assertValido(valoresValidos({ [campo]: `  ${"a".repeat(max)}  ` }), "el máximo con espacios alrededor");
    assert.equal(assertValido(valoresValidos({ [campo]: "  ab  " }), "recorte")[campo], "ab");
  });

  test(`${campo}: the length counts characters the way the database does, not UTF-16 units`, () => {
    // char_length cuenta puntos de código: un emoji es 1, no 2.
    assertValido(valoresValidos({ [campo]: "😀".repeat(max) }), "el máximo en emojis");
    assertSoloErrorEn(valoresValidos({ [campo]: "😀".repeat(max + 1) }), campo, "uno más en emojis");
  });

  test(`${campo}: rejects control characters and every bidirectional format character`, () => {
    for (const control of ["\u0000", "\u0007", "\t", "\n", "\r", "\u007f", "\u0085"]) {
      assertSoloErrorEn(valoresValidos({ [campo]: `ab${control}cd` }), campo, `control U+${control.codePointAt(0).toString(16)}`);
    }
    for (const bidi of BIDI) {
      assertSoloErrorEn(valoresValidos({ [campo]: `ab${bidi}cd` }), campo, `bidi U+${bidi.codePointAt(0).toString(16)}`);
    }
  });
}

/* ---------- Herramientas ---------- */

test("tools: from 1 to 12 items", () => {
  assertSoloErrorEn(valoresValidos({ herramientas: [] }), "herramientas", "vacío");
  assertSoloErrorEn(valoresValidos({ herramientas: ["", "  "] }), "herramientas", "sólo blancos");

  const doce = Array.from({ length: 12 }, (_, i) => `T${i}`);
  assert.equal(assertValido(valoresValidos({ herramientas: doce }), "doce").herramientas.length, 12);
  assertValido(valoresValidos({ herramientas: ["Python"] }), "uno");

  const trece = Array.from({ length: 13 }, (_, i) => `T${i}`);
  assertSoloErrorEn(valoresValidos({ herramientas: trece }), "herramientas", "trece");
});

test("tools: each item from 1 to 40 characters, with the same character rules", () => {
  assertValido(valoresValidos({ herramientas: ["Python", "a".repeat(40)] }), "un elemento de 40");
  assertValido(valoresValidos({ herramientas: ["Python", "😀".repeat(40)] }), "40 emojis cuentan como 40");
  assertSoloErrorEn(valoresValidos({ herramientas: ["Python", "a".repeat(41)] }), "herramientas", "un elemento de 41");

  for (const control of ["\u0000", "\t", "\n", "\u007f"]) {
    assertSoloErrorEn(valoresValidos({ herramientas: ["Python", `Po${control}stgres`] }), "herramientas", "control");
  }
  for (const bidi of BIDI) {
    assertSoloErrorEn(valoresValidos({ herramientas: ["Python", `Postgres${bidi}`] }), "herramientas", `bidi U+${bidi.codePointAt(0).toString(16)}`);
  }
});

/*
  Cuando las dos faltas conviven en las mismas herramientas gana la de
  caracteres, esté donde esté el elemento que la comete. Eso es lo que separa
  revisar los doce elementos de cortar en el primero que falla: con el corte,
  el mensaje dependería del orden en que se escribieron las tecnologías.
*/
test("tools: the character fault wins over the length one, whatever the order", () => {
  const largo = "a".repeat(41);
  const conControl = "Po\u0000stgres";

  const porCaracteres = assertSoloErrorEn(valoresValidos({ herramientas: [conControl] }), "herramientas", "sólo caracteres");
  const porLargo = assertSoloErrorEn(valoresValidos({ herramientas: [largo] }), "herramientas", "sólo largo");
  assert.notEqual(porCaracteres, porLargo, "los dos motivos tienen que decir cosas distintas");

  for (const orden of [[largo, conControl], [conControl, largo]]) {
    const mensaje = assertSoloErrorEn(valoresValidos({ herramientas: orden }), "herramientas", orden.join(" + "));
    assert.equal(mensaje, porCaracteres, "gana caracteres sin importar el orden");
  }
});

/*
  El veredicto de una sola tecnología, que es lo que consulta el editor de
  etiquetas para decidir si la deja entrar. Los mismos dos motivos que las
  herramientas enteras, y ningún otro: el mínimo de un carácter no es asunto
  suyo.
*/
test("a single technology is judged by the same two rules as the whole tools list", () => {
  assert.equal(errorDeElementoEtiquetaMiFicha("herramientas", "PostgreSQL"), null);
  assert.equal(errorDeElementoEtiquetaMiFicha("herramientas", "a".repeat(40)), null);
  assert.equal(errorDeElementoEtiquetaMiFicha("herramientas", "😀".repeat(40)), null, "40 emojis cuentan como 40");
  assert.equal(errorDeElementoEtiquetaMiFicha("herramientas", ""), null, "lo vacío lo descarta quien arma la lista");

  const porLargo = errorDeElementoEtiquetaMiFicha("herramientas", "a".repeat(41));
  const porCaracteres = errorDeElementoEtiquetaMiFicha("herramientas", "Po\u0000stgres");
  assert.ok(porLargo, "41 caracteres tiene que dar mensaje");
  assert.ok(porCaracteres, "un carácter de control tiene que dar mensaje");
  assert.notEqual(porLargo, porCaracteres);

  // En un elemento que comete las dos, manda el de caracteres: es el mismo
  // orden con el que errorDeListaDeEtiquetasMiFicha resuelve la lista completa.
  assert.equal(errorDeElementoEtiquetaMiFicha("herramientas", "Po\u0000stgres".padEnd(41, "a")), porCaracteres);
});

/* ---------- Modalidad de trabajo ---------- */

test("the work modality values are the same list here, on the public page and in the 0040 CHECK", () => {
  const check = SQL_0040.match(/fichas_colaborador_modalidad_trabajo_valida\s+check\s*\(\s*modalidad_trabajo\s+in\s*\(([^)]*)\)/);
  assert.ok(check, "no se encontró el CHECK de modalidad_trabajo en la 0040");
  const deLaBase = [...check[1].matchAll(/'([^']*)'/g)].map(([, valor]) => valor);

  assert.deepEqual([...MODALIDADES_TRABAJO_MI_FICHA], deLaBase);
  assert.deepEqual([...MODALIDADES_TRABAJO_MI_FICHA], [...MODALIDADES_TRABAJO]);
  assert.deepEqual([...MODALIDADES_TRABAJO_MI_FICHA], ["Presencial", "Híbrido", "Remoto"]);
});

// "Híbrido" tiene que estar en NFC (í = U+00ED): en NFD (i + U+0301) se ve
// idéntico pero la base lo rechaza con 23514 (ver la 0040).
test("every work modality value here is in NFC", () => {
  for (const valor of MODALIDADES_TRABAJO_MI_FICHA) {
    assert.equal(valor, valor.normalize("NFC"), `"${valor}" no está en NFC`);
  }
});

test("work modality: one of the three values, exactly", () => {
  for (const modalidad_trabajo of MODALIDADES_TRABAJO_MI_FICHA) {
    assert.equal(assertValido(valoresValidos({ modalidad_trabajo }), modalidad_trabajo).modalidad_trabajo, modalidad_trabajo);
  }
  for (const modalidad_trabajo of ["", "remoto", "Ocupado", "Semipresencial", undefined]) {
    assertSoloErrorEn(valoresValidos({ modalidad_trabajo }), "modalidad_trabajo", String(modalidad_trabajo));
  }
});

/* ---------- Año de inicio ---------- */

test("start year: an integer from 1950 to the current year passed in", () => {
  assert.equal(assertValido(valoresValidos({ anio_inicio: "1950" }), "1950").anio_inicio, 1950);
  assert.equal(assertValido(valoresValidos({ anio_inicio: String(ANIO) }), "el año en curso").anio_inicio, ANIO);
  assert.equal(assertValido(valoresValidos({ anio_inicio: " 2018 " }), "con espacios").anio_inicio, 2018);

  assertSoloErrorEn(valoresValidos({ anio_inicio: "1949" }), "anio_inicio", "antes de 1950");
  assertSoloErrorEn(valoresValidos({ anio_inicio: String(ANIO + 1) }), "anio_inicio", "el año que viene");
  // El tope es el año que se le pasa, no el del reloj.
  assert.equal(validarMiFicha(valoresValidos({ anio_inicio: "2030" }), 2030).ok, true);
  assert.equal(validarMiFicha(valoresValidos({ anio_inicio: "2030" }), 2029).ok, false);
});

test("start year: empty or not a whole number is an error", () => {
  const vacio = assertSoloErrorEn(valoresValidos({ anio_inicio: "" }), "anio_inicio", "vacío");
  for (const texto of ["abc", "2018.5", "20 18", "-2018", "+2018", "2e3", "0x7E2"]) {
    const mensaje = assertSoloErrorEn(valoresValidos({ anio_inicio: texto }), "anio_inicio", texto);
    assert.notEqual(mensaje, vacio, "vacío y mal escrito dicen cosas distintas");
  }
});

test("start year: never above the database limit, whatever the current year", () => {
  assert.equal(validarMiFicha(valoresValidos({ anio_inicio: "2100" }), 2101).ok, true);
  assert.equal(validarMiFicha(valoresValidos({ anio_inicio: "2101" }), 2101).ok, false);
});

/* ---------- Bio ---------- */

test("bio: required, from 10 to 240 characters after trimming", () => {
  assertSoloErrorEn(valoresValidos({ bio: "" }), "bio", "vacía");
  assertSoloErrorEn(valoresValidos({ bio: "a".repeat(9) }), "bio", "nueve");
  assertSoloErrorEn(valoresValidos({ bio: "a".repeat(241) }), "bio", "241");
  assertSoloErrorEn(valoresValidos({ bio: "😀".repeat(241) }), "bio", "241 emojis");
  assertValido(valoresValidos({ bio: "a".repeat(10) }), "diez");
  assertValido(valoresValidos({ bio: "a".repeat(240) }), "240");
  // char_length cuenta puntos de código: 240 emojis pasan porque para la base
  // son 240 caracteres, aunque .length (UTF-16) diría 480.
  assertValido(valoresValidos({ bio: "😀".repeat(240) }), "240 emojis");
  // Nueve letras con espacios alrededor siguen siendo nueve.
  assertSoloErrorEn(valoresValidos({ bio: "   aaaaaaaaa   " }), "bio", "nueve con espacios");
});

test("bio: line breaks are kept in the middle and trimmed off the edges", () => {
  const ficha = assertValido(valoresValidos({ bio: "\n \nPrimera línea.\n\nTercera línea.\n \n" }), "saltos");
  assert.equal(ficha.bio, "Primera línea.\n\nTercera línea.");
  assert.ok(!/^[\s]|[\s]$/.test(ficha.bio), "la base exige bio = btrim(bio, E' \\n')");
});

test("bio: rejects every other control character and every bidirectional character", () => {
  for (const control of ["\r", "\t", "\u0000", "\u000b", "\u000c", "\u007f", "\u0085"]) {
    assertSoloErrorEn(valoresValidos({ bio: `Primera línea.${control}Segunda.` }), "bio", `control U+${control.codePointAt(0).toString(16)}`);
  }
  // Un \r\n pegado desde otro sistema también lleva un \r: la base lo rechaza.
  assertSoloErrorEn(valoresValidos({ bio: "Primera línea.\r\nSegunda." }), "bio", "CRLF");
  for (const bidi of BIDI) {
    assertSoloErrorEn(valoresValidos({ bio: `Primera línea.${bidi} Segunda.` }), "bio", `bidi U+${bidi.codePointAt(0).toString(16)}`);
  }
});

/* ---------- Enlaces ---------- */

test("links are optional: empty or blank becomes null and is valid", () => {
  const ficha = assertValido(valoresValidos({ linkedin: "", github: "   ", correo: undefined }), "sin enlaces");
  assert.equal(ficha.linkedin, null);
  assert.equal(ficha.github, null);
  assert.equal(ficha.correo, null);
});

/*
  Los mismos casos que la página pública (colaboradores-datos.test.js), y el
  veredicto tiene que coincidir con enlacesDisponibles(): lo que el formulario
  guarda, la página lo pinta; lo que el formulario rechaza, la página tampoco
  lo pintaría.
*/
const CASOS_DE_ENLACE = {
  linkedin: {
    aceptados: [
      "https://linkedin.com/in/ana",
      "https://www.linkedin.com/in/ana",
      "https://mx.linkedin.com/in/ana",
    ],
    rechazados: [
      "#",
      "javascript:alert(1)",
      "http://inseguro.example",
      "https://linkedin.com.evil.com/x",
      "https://evil.com/linkedin.com",
      "https://evil-linkedin.com/in/ana",
      "https://linkedin.com@evil.com/in/ana",
      "http://linkedin.com/in/ana",
      "https://linkedin.com/",
      "https://linkedin.com/in/ana con espacio",
      "https://LinkedIn.com/in/ana",
      "https://github.com/ana",
    ],
  },
  github: {
    aceptados: ["https://github.com/ana", "https://www.github.com/ana"],
    rechazados: [
      "javascript:alert(1)",
      "http://github.com/x",
      "https://github.com.evil.com/x",
      "https://evil.com/github.com",
      "https://gist.github.com/ana",
      "https://github.com/",
      "https://www.linkedin.com/in/ana",
    ],
  },
  correo: {
    aceptados: ["ana@taudux.com", "nombre.apellido+filtro@sub.taudux.com"],
    rechazados: [
      "victima@example.com?bcc=atacante%40evil.com",
      "victima@example.com&cc=otro@evil.com",
      "victima@example.com#x",
      "a%40b@example.com",
      "sin-arroba.com",
      "ana@taudux",
      "ana @taudux.com",
      "mailto:ana@taudux.com",
    ],
  },
};

for (const [campo, { aceptados, rechazados }] of Object.entries(CASOS_DE_ENLACE)) {
  test(`${campo}: accepts and rejects exactly what the database and the public page do`, () => {
    const pintaLaPagina = (valor) => enlacesDisponibles({ [campo]: valor }).some((enlace) => enlace.tipo === campo);

    for (const valor of aceptados) {
      assert.equal(assertValido(valoresValidos({ [campo]: valor }), valor)[campo], valor);
      assert.equal(pintaLaPagina(valor), true, `la página debería pintar ${valor}`);
    }
    for (const valor of rechazados) {
      assertSoloErrorEn(valoresValidos({ [campo]: valor }), campo, valor);
      assert.equal(pintaLaPagina(valor), false, `la página no debería pintar ${valor}`);
    }
  });
}

test("links: a surrounding blank is trimmed before checking, as the public page does", () => {
  const ficha = assertValido(valoresValidos({ github: "  https://github.com/ana  ", correo: " ana@taudux.com " }), "con espacios");
  assert.equal(ficha.github, "https://github.com/ana");
  assert.equal(ficha.correo, "ana@taudux.com");
});

test("links: length limits of 200, 200 and 254 characters", () => {
  const linkedin = (largo) => `https://www.linkedin.com/in/${"a".repeat(largo - "https://www.linkedin.com/in/".length)}`;
  const github = (largo) => `https://github.com/${"a".repeat(largo - "https://github.com/".length)}`;
  const correo = (largo) => `${"a".repeat(largo - "@taudux.com".length)}@taudux.com`;

  assert.equal(linkedin(200).length, 200, "premisa");
  assertValido(valoresValidos({ linkedin: linkedin(200) }), "linkedin de 200");
  assertSoloErrorEn(valoresValidos({ linkedin: linkedin(201) }), "linkedin", "linkedin de 201");
  assertValido(valoresValidos({ github: github(200) }), "github de 200");
  assertSoloErrorEn(valoresValidos({ github: github(201) }), "github", "github de 201");
  assertValido(valoresValidos({ correo: correo(254) }), "correo de 254");
  assertSoloErrorEn(valoresValidos({ correo: correo(255) }), "correo", "correo de 255");
});

/* ---------- Las reglas están repartidas entre la 0039, la 0040 y la 0041 ---------- */

/*
  La verdad de cada límite vive en una migración distinta: puesto, sector,
  ubicación y los enlaces siguen en la 0039; la bio bajó a 240 en la 0040; y
  herramientas y el largo de cada etiqueta se movieron a la 0041, que es
  donde vive hoy `etiquetas_colaborador_validas()` (la 0039 y su
  `stack_colaborador_valido()` ya no existen tras aplicarla). Cada assert
  dice en su mensaje qué migración leyó, para que un futuro desfase señale de
  entrada dónde mirar.
*/
test("the length limits are the ones each CHECK declares today: 0039 for most fields, 0040 for bio, 0041 for tools and tags", () => {
  const entre = (expresion, fuente, nombreFuente) => {
    const encontrado = fuente.match(new RegExp(`${expresion}\\s+between\\s+(\\d+)\\s+and\\s+(\\d+)`));
    assert.ok(encontrado, `no se encontró "${expresion} between" en la ${nombreFuente}`);
    return { min: Number(encontrado[1]), max: Number(encontrado[2]) };
  };
  const hasta = (columna) => {
    const encontrado = SQL.match(new RegExp(`char_length\\(${columna}\\)\\s*<=\\s*(\\d+)`));
    assert.ok(encontrado, `no se encontró el largo máximo de ${columna} en la 0039`);
    return Number(encontrado[1]);
  };

  assert.deepEqual(LIMITES_MI_FICHA.puesto, entre("char_length\\(rol\\)", SQL, "0039"));
  assert.deepEqual(LIMITES_MI_FICHA.sector, entre("char_length\\(especialidad\\)", SQL, "0039"));
  assert.deepEqual(LIMITES_MI_FICHA.ubicacion, entre("char_length\\(ubicacion\\)", SQL, "0039"));
  assert.deepEqual(LIMITES_MI_FICHA.bio, entre("char_length\\(bio\\)", SQL_0040, "0040"));
  /*
    Las tres listas, cada una contra SU cardinality. Si alguien copiara el
    rango de herramientas a habilidades, el mínimo dejaría de ser 0 y una
    ficha sin habilidades sería inválida en el front y válida en la base.
  */
  for (const campo of LISTAS_DE_ETIQUETAS) {
    assert.deepEqual(LIMITES_MI_FICHA[campo], entre(`cardinality\\(${campo}\\)`, SQL_0041, "0041"), campo);
  }
  assert.equal(LIMITES_MI_FICHA.herramientas.min, 1, "herramientas es obligatoria");
  for (const campo of LISTAS_OPCIONALES) {
    assert.equal(LIMITES_MI_FICHA[campo].min, 0, `${campo} es opcional`);
  }
  assert.deepEqual(LIMITES_MI_FICHA.etiqueta, entre("char_length\\(elemento\\)", SQL_0041, "0041"));
  assert.deepEqual(LIMITES_MI_FICHA.anio_inicio, entre("anio_inicio", SQL, "0039"));
  assert.equal(LIMITES_MI_FICHA.linkedin, hasta("linkedin"));
  assert.equal(LIMITES_MI_FICHA.github, hasta("github"));
  assert.equal(LIMITES_MI_FICHA.correo, hasta("correo"));
});

/*
  Las expresiones de los CHECK, traducidas: la clase POSIX `[:space:]` de
  Postgres es `\s` en JavaScript. La traducción es un replaceAll y no un
  replace: con un string, replace sustituye UNA ocurrencia, y la expresión del
  enlace de empresa tiene DOS clases de no-espacio (una con caracteres extra
  adentro). Con el replace de antes, el segundo `[:space:]` quedaba sin
  traducir y el assert fallaba por algo que estaba bien.
*/
test("the link patterns are the ones each CHECK declares, without the i flag", () => {
  const deLaBase = (campo, fuente, nombreFuente) => {
    const encontrado = fuente.match(new RegExp(`${campo} ~ '([^']+)'`));
    assert.ok(encontrado, `no se encontró la expresión de ${campo} en la ${nombreFuente}`);
    return encontrado[1].replaceAll("[:space:]", "\\s");
  };

  // En el `source` de JS la barra va escapada; en el SQL, no.
  const comoSql = (patron) => patron.source.replace(/\\\//g, "/");

  for (const campo of ["linkedin", "github", "correo"]) {
    const patron = PATRONES_ENLACE_MI_FICHA[campo];
    assert.equal(comoSql(patron), deLaBase(campo, SQL, "0039"), campo);
    assert.equal(patron.flags, "", `${campo}: el ~ de la base distingue mayúsculas`);
  }

  const empresaEnlace = PATRONES_ENLACE_MI_FICHA.empresa_enlace;
  assert.equal(comoSql(empresaEnlace), deLaBase("empresa_enlace", SQL_0041, "0041"));
  assert.equal(empresaEnlace.flags, "", "empresa_enlace: el ~ de la base distingue mayúsculas");
});

/*
  Lo que el enlace de la empresa tiene que rechazar, y por qué: este texto
  sale de datos y termina en un href del perfil público.
*/
test("the company link only accepts https with a dotted authority", () => {
  const patron = PATRONES_ENLACE_MI_FICHA.empresa_enlace;
  for (const bueno of [
    "https://taudux.com",
    "https://www.taudux.com/nosotros",
    "https://taudux.com/equipo?de=perfil#ancla",
  ]) {
    assert.equal(patron.test(bueno), true, bueno);
  }
  for (const malo of [
    "javascript:alert(1)",          // la razón de que haya lista blanca
    "http://taudux.com",            // sin cifrar
    "//taudux.com",                 // sin esquema
    "https://intranet",             // sin punto: no es un destino público
    "https://taudux .com",          // con espacio
    "HTTPS://TAUDUX.COM",           // el ~ de la base distingue mayúsculas
    "data:text/html,<script>",
  ]) {
    assert.equal(patron.test(malo), false, malo);
  }
});

/*
  La asimetría del CHECK fichas_colaborador_empresa_enlace_con_nombre: un
  nombre sin enlace es un estado útil (se muestra como texto plano), pero un
  enlace sin nombre quedaría guardado e invisible para siempre, porque sin
  nombre la fila del perfil no aparece.
*/
test("the company link needs a company name, but not the other way round", () => {
  assert.equal(erroresDe(valoresValidos({ empresa: "Taudux", empresa_enlace: "" })).empresa_enlace, undefined);
  assert.equal(erroresDe(valoresValidos({ empresa: "", empresa_enlace: "" })).empresa_enlace, undefined);

  assert.equal(
    erroresDe(valoresValidos({ empresa: "", empresa_enlace: "https://taudux.com" })).empresa_enlace,
    "Escribe el nombre de la empresa para poder enlazarla.",
  );
  // El cruzado gana al formato: de nada sirve decir "el enlace está mal" de un
  // enlace que igual no se podría pintar.
  assert.equal(
    erroresDe(valoresValidos({ empresa: "   ", empresa_enlace: "javascript:alert(1)" })).empresa_enlace,
    "Escribe el nombre de la empresa para poder enlazarla.",
  );
});

test("the company name is optional, but when present it follows the 0041 rules", () => {
  assert.equal(erroresDe(valoresValidos({ empresa: "" })).empresa, undefined, "vacía es válida");
  assert.equal(erroresDe(valoresValidos({ empresa: "   " })).empresa, undefined, "en blanco también");

  assert.equal(
    erroresDe(valoresValidos({ empresa: "T" })).empresa,
    "El nombre de la empresa debe tener entre 2 y 80 caracteres.",
  );
  assert.equal(
    erroresDe(valoresValidos({ empresa: "T".repeat(81) })).empresa,
    "El nombre de la empresa debe tener entre 2 y 80 caracteres.",
  );
  for (const bidi of BIDI) {
    assert.equal(
      erroresDe(valoresValidos({ empresa: `Taudux${bidi}` })).empresa,
      "El nombre de la empresa tiene caracteres no permitidos.",
      JSON.stringify(bidi),
    );
  }
});

/*
  Las dos columnas nuevas son nullable: la ausencia se escribe null y NUNCA
  "", que es lo que el CHECK de la 0041 rechaza (char_length 0 no entra en el
  rango, pero un CHECK con null da `unknown` y pasa).
*/
test("an absent company is normalized to null, never to an empty string", () => {
  for (const vacio of ["", "   ", undefined, null]) {
    const ficha = normalizarMiFicha(valoresValidos({ empresa: vacio, empresa_enlace: vacio }));
    assert.equal(ficha.empresa, null, JSON.stringify(vacio));
    assert.equal(ficha.empresa_enlace, null, JSON.stringify(vacio));
  }
});

/* ---------- Todo junto ---------- */

test("an empty form reports every required field at once, in form order, and no link", () => {
  const resultado = validarMiFicha({}, ANIO);
  assert.equal(resultado.ok, false);
  assert.deepEqual(
    resultado.errores.map(({ campo }) => campo),
    ["puesto", "sector", "ubicacion", "herramientas", "modalidad_trabajo", "anio_inicio", "bio"],
  );
  for (const { mensaje } of resultado.errores) {
    assert.equal(typeof mensaje, "string");
    assert.ok(mensaje.length > 0);
  }
});

test("errors follow the card order and each field reports only one message", () => {
  const resultado = validarMiFicha(valoresValidos({ correo: "no", puesto: "", bio: "corta", github: "http://github.com/x" }), ANIO);
  assert.deepEqual(resultado.errores.map(({ campo }) => campo), ["puesto", "bio", "github", "correo"]);
});

test("error messages speak in tuteo, never voseo", () => {
  const { errores } = validarMiFicha({
    puesto: "a", sector: "", ubicacion: "\u202e", herramientas: [], modalidad_trabajo: "x",
    // Vacías no fallarían: son opcionales. El motivo tiene que salir del
    // contenido, no de la cantidad.
    habilidades: ["‮"], idiomas: ["‮"],
    // Ídem: opcionales, así que el motivo sale del contenido. El enlace falla
    // por formato y no por el cruzado, porque acá sí hay nombre de empresa.
    empresa: "‮", empresa_enlace: "x",
    anio_inicio: "abc", bio: "", linkedin: "x", github: "x", correo: "x",
  }, ANIO);
  assert.equal(errores.length, CAMPOS_MI_FICHA.length, "premisa: todos los campos fallan");
  // Por palabras y no con \b: el \b de JS no reconoce la í final como letra.
  const palabras = errores.map(({ mensaje }) => mensaje).join(" ").toLowerCase().split(/[^\p{L}]+/u);
  for (const voseo of ["escribí", "elegí", "usá", "revisá", "poné", "quitá", "podés", "tenés", "sacá"]) {
    assert.ok(!palabras.includes(voseo), `un mensaje dice "${voseo}"`);
  }
});

/* ---------- Del perfil y la ficha guardada al formulario ---------- */

test("a saved card becomes form values: texts as is, tools as a copied array, year as text, null links empty", () => {
  const guardadas = {
    herramientas: ["PostgreSQL", "Python", "GCP"],
    habilidades: ["Modelado de datos", "ETL"],
    idiomas: ["Español"],
  };
  const valores = valoresFormularioMiFicha({
    puesto: "Desarrolladora backend",
    sector: "Bases de datos",
    ubicacion: "Querétaro",
    herramientas: guardadas.herramientas,
    habilidades: guardadas.habilidades,
    idiomas: guardadas.idiomas,
    empresa: "Taudux",
    empresa_enlace: null,
    modalidad_trabajo: "Remoto",
    anio_inicio: 2018,
    bio: "Primera.\nSegunda.",
    linkedin: "https://www.linkedin.com/in/ana",
    github: null,
    correo: null,
  });

  assert.deepEqual(valores, {
    puesto: "Desarrolladora backend",
    sector: "Bases de datos",
    ubicacion: "Querétaro",
    herramientas: ["PostgreSQL", "Python", "GCP"],
    habilidades: ["Modelado de datos", "ETL"],
    idiomas: ["Español"],
    empresa: "Taudux",
    // Un enlace ausente llega como null y el formulario lo muestra vacío.
    empresa_enlace: "",
    modalidad_trabajo: "Remoto",
    anio_inicio: "2018",
    bio: "Primera.\nSegunda.",
    linkedin: "https://www.linkedin.com/in/ana",
    github: "",
    correo: "",
  });
  // Una COPIA, y cada lista la suya: el editor de etiquetas muta el arreglo
  // del formulario, y eso no tiene que tocar la ficha guardada.
  for (const campo of LISTAS_DE_ETIQUETAS) {
    assert.notEqual(valores[campo], guardadas[campo], `${campo} tiene que ser una copia`);
    assert.deepEqual(valores[campo], guardadas[campo], `${campo} tiene que traer lo mismo`);
  }
});

test("no card yet (null) becomes an empty form", () => {
  const vacio = Object.fromEntries(
    CAMPOS_MI_FICHA.map((campo) => [campo, LISTAS_DE_ETIQUETAS.includes(campo) ? [] : ""]),
  );
  assert.deepEqual(valoresFormularioMiFicha(null), vacio);
  assert.deepEqual(valoresFormularioMiFicha(undefined), vacio);
  // Un valor fuera de la lista no marca ninguna opción.
  assert.equal(valoresFormularioMiFicha({ modalidad_trabajo: "Ocupado" }).modalidad_trabajo, "");
});

test("a saved card goes through the form and back unchanged", () => {
  const guardada = normalizarMiFicha(valoresValidos({ linkedin: "https://mx.linkedin.com/in/ana" }));
  const ida = valoresFormularioMiFicha(guardada);
  assert.deepEqual(validarMiFicha(ida, ANIO), { ok: true, ficha: guardada });
});

test("the visible name joins name and surname, skipping what is missing", () => {
  assert.equal(nombreVisibleMiFicha({ nombre: " Valeria ", apellidos: "Ortiz Luna " }), "Valeria Ortiz Luna");
  assert.equal(nombreVisibleMiFicha({ nombre: "Valeria", apellidos: null }), "Valeria");
  assert.equal(nombreVisibleMiFicha({ nombre: "", apellidos: "Ortiz" }), "Ortiz");
  assert.equal(nombreVisibleMiFicha({}), "");
  assert.equal(nombreVisibleMiFicha(null), "");
});

test("the public profile route is the roster hash route, only for a well-formed slug", () => {
  assert.equal(rutaPerfilPublicoMiFicha("valeria"), "/app/features/colaboradores/#/valeria");
  assert.equal(rutaPerfilPublicoMiFicha("valeria-ortiz-2"), "/app/features/colaboradores/#/valeria-ortiz-2");
  // El mismo formato que el CHECK perfiles_slug_formato de la 0038.
  for (const slug of ["", null, undefined, "Valeria", "valeria ortiz", "-valeria", "valeria-", "../x", "a/b", "#/x"]) {
    assert.equal(rutaPerfilPublicoMiFicha(slug), null, String(slug));
  }
});
