const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const DATOS = require(path.join(ROOT, "src/app/features/colaboradores/colaboradores.datos.js"));
const {
  ETIQUETAS_ATRIBUTOS,
  COLUMNAS_ROSTER,
  tienePerfil,
  indicePorSlug,
  moverSeleccion,
  colegaSugerido,
  numeroDeFicha,
  etiquetaDeAtributo,
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
  assert.equal(ETIQUETAS_ATRIBUTOS.length, 5);
  for (const persona of MUESTRA) {
    assert.equal(tienePerfil(persona), true, `${persona.nombre}: ficha incompleta`);
  }
});

// Dos personas con el mismo slug abrirían siempre la primera.
test("sample slugs are unique and follow the database slug format", () => {
  const slugs = MUESTRA.map((persona) => persona.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs repetidos");
  for (const slug of slugs) assert.match(slug, FORMATO_DE_SLUG);
});

/*
  Hoy la base entrega sólo nombre, corto y slug: "Mi ficha" todavía no existe.
  Esa persona sale en el roster, pero no tiene perfil que abrir.
*/
test("a public record with only name and slug has no profile yet", () => {
  assert.equal(tienePerfil({ nombre: "Samael Flores", corto: "Samael", slug: "samael" }), false);
  assert.equal(tienePerfil(null), false);
  assert.equal(tienePerfil(undefined), false);
});

test("a single missing or out-of-range field is enough to have no profile", () => {
  const base = MUESTRA[0];
  assert.equal(tienePerfil(structuredClone(base)), true, "premisa: la base sí tiene ficha");

  const casos = {
    "sin rol": { rol: undefined },
    "rol en blanco": { rol: "   " },
    "bio vacía": { bio: "" },
    "sin atributos": { stats: undefined },
    "un atributo de menos": { stats: [5, 3, 4, 4] },
    "atributo en cero": { stats: [0, 3, 4, 4, 3] },
    "atributo sobre el máximo": { stats: [6, 3, 4, 4, 3] },
    "atributo no entero": { stats: [2.5, 3, 4, 4, 3] },
    "disponibilidad desconocida": { disp: "Ocupado" },
    "proyectos negativos": { proyectos: -1 },
    "proyectos como texto": { proyectos: "24" },
  };
  for (const [caso, cambios] of Object.entries(casos)) {
    assert.equal(tienePerfil({ ...structuredClone(base), ...cambios }), false, caso);
  }
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

test("the suggested colleague is the next card, wrapping at the end, and never oneself in a team of two or more", () => {
  assert.equal(colegaSugerido(0, 12), 1);
  assert.equal(colegaSugerido(11, 12), 0);
  assert.equal(colegaSugerido(0, 1), null, "con una sola persona no hay colega que sugerir");
});

test("card numbers are zero-padded and attribute labels read n/5", () => {
  assert.equal(numeroDeFicha(0), "01");
  assert.equal(numeroDeFicha(11), "12");
  assert.equal(etiquetaDeAtributo(4), "4/5");
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
