const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const EXTRACTOR = "src/app/features/transactions/extractor.js";

/*
  El sello es la promesa central del producto: dice si lo extraído cuadra con
  los totales que imprime el banco. Por eso lo que NO puede decir importa tanto
  como lo que dice.

  El 2026-08-20 se descubrió que podía mostrar "✓ cuadra al centavo" sobre una
  tabla vacía: cuando el extractor no reconoce una plantilla no encuentra ni las
  filas ni los totales, y el cotejo compara 0 contra 0. El backend ya lo corta
  (core/validacion.py devuelve motivo="sin_movimientos"), pero de nada sirve si
  el front no lo distingue.

  Estos tests fijan esa distinción y, sobre todo, EL ORDEN: el motivo llega con
  `cuadra: false`, así que si la rama genérica de `false` se evalúa primero, el
  mensaje específico no se ve nunca. Es una regresión de una línea al reordenar.
*/

test("the seal has a branch for an unreadable statement", () => {
  assert.match(
    read(EXTRACTOR),
    /v\.motivo\s*===\s*["']sin_movimientos["']/,
    "el sello debe contemplar el caso de un PDF del que no se leyó ningún movimiento"
  );
});

test("the unreadable branch is checked before the generic verdicts", () => {
  const fuente = read(EXTRACTOR);
  const motivo = fuente.indexOf('v.motivo === "sin_movimientos"');
  const cuadraTrue = fuente.indexOf("v.cuadra === true");
  const cuadraFalse = fuente.indexOf("v.cuadra === false");

  assert.ok(motivo !== -1, "no se encontró la rama del motivo");
  assert.ok(cuadraTrue !== -1 && cuadraFalse !== -1, "no se encontraron las ramas de cuadra");
  assert.ok(
    motivo < cuadraTrue && motivo < cuadraFalse,
    "la rama del motivo debe ir PRIMERO: el backend manda cuadra=false junto al " +
    "motivo, así que evaluarla después la vuelve inalcanzable"
  );
});

test("an unreadable statement never gets the green seal", () => {
  const fuente = read(EXTRACTOR);
  // El bloque del sello, desde su comentario hasta pintarAlerta.
  const desde = fuente.indexOf("Sello de verificación");
  const hasta = fuente.indexOf("pintarAlerta", desde);
  assert.ok(desde !== -1 && hasta > desde, "no se localizó el bloque del sello");
  const bloque = fuente.slice(desde, hasta);

  const ramaMotivo = bloque.slice(
    bloque.indexOf('v.motivo === "sin_movimientos"'),
    bloque.indexOf("v.cuadra === true")
  );
  assert.ok(
    !/sello--ok/.test(ramaMotivo),
    "la rama del motivo no puede usar la clase del sello verde"
  );
  assert.match(
    ramaMotivo, /sello--alerta/,
    "la rama del motivo debe pintar la alerta"
  );
});
