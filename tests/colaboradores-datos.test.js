const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const {
  COLABORADORES,
  ETIQUETAS_ATRIBUTOS,
  COLUMNAS_ROSTER,
  DISPONIBILIDADES,
  slugDeColaborador,
  indicePorSlug,
  moverSeleccion,
  colegaSugerido,
  numeroDeFicha,
  etiquetaDeAtributo,
  enlacesDisponibles,
} = require(path.join(ROOT, "src/app/features/colaboradores/colaboradores.datos.js"));

/*
  El roster es UN arreglo de fichas completas. El prototipo lo traía partido en
  dos arreglos paralelos emparejados por índice (ROSTER y EXTRA): borrar o
  reordenar una persona en uno solo desfasaba a todas las demás sin que nada
  fallara. Acá cada ficha lleva todos sus campos.
*/
test("every collaborator card is complete and well-formed", () => {
  assert.ok(COLABORADORES.length > 0, "el roster no puede estar vacío");
  assert.equal(ETIQUETAS_ATRIBUTOS.length, 5);

  for (const ficha of COLABORADORES) {
    for (const campo of ["nombre", "corto", "rol", "clase", "bio", "ciudad", "anios", "esp", "stack", "disp"]) {
      assert.equal(typeof ficha[campo], "string", `${ficha.nombre}: falta ${campo}`);
      assert.notEqual(ficha[campo].trim(), "", `${ficha.nombre}: ${campo} vacío`);
    }
    assert.ok(Number.isInteger(ficha.proyectos) && ficha.proyectos >= 0, `${ficha.nombre}: proyectos`);
    assert.ok(DISPONIBILIDADES.includes(ficha.disp), `${ficha.nombre}: disponibilidad desconocida "${ficha.disp}"`);

    // Una barra por etiqueta, de 1 a 5: la interfaz pinta cinco segmentos.
    assert.equal(ficha.stats.length, ETIQUETAS_ATRIBUTOS.length, `${ficha.nombre}: un valor por atributo`);
    for (const valor of ficha.stats) {
      assert.ok(Number.isInteger(valor) && valor >= 1 && valor <= 5, `${ficha.nombre}: atributo fuera de 1-5`);
    }
  }
});

/*
  El perfil vive en el hash (#/valeria) para que el botón atrás del navegador
  vuelva al roster. El slug sale del nombre corto, sin acentos ni mayúsculas, y
  tiene que ser único: dos fichas con el mismo slug abrirían siempre la primera.
*/
test("slugs are url-safe, accent-free and unique, and resolve back to their card", () => {
  const slugs = COLABORADORES.map(slugDeColaborador);
  assert.equal(new Set(slugs).size, slugs.length, "slugs repetidos");
  for (const slug of slugs) assert.match(slug, /^[a-z0-9-]+$/);

  assert.equal(slugDeColaborador({ corto: "Sebastián" }), "sebastian");
  assert.equal(slugDeColaborador({ corto: "María José" }), "maria-jose");

  slugs.forEach((slug, indice) => assert.equal(indicePorSlug(slug), indice));
  assert.equal(indicePorSlug("no-existe"), -1);
  assert.equal(indicePorSlug(""), -1);
  assert.equal(indicePorSlug("VALERIA"), indicePorSlug("valeria"), "el hash puede llegar en mayúsculas");
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
