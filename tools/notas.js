#!/usr/bin/env node
/*
  Valida el área de notas. Sin dependencias: `node tools/notas.js`.

  QUÉ ES Y QUÉ NO ES
  Esta herramienta NO escribe nada. El manifiesto lo mantiene una persona a
  mano, a propósito: es el esqueleto del área —qué cuelga de qué, en qué orden y
  con qué profundidad— y esa es una decisión editorial, no algo que convenga
  deducir del sistema de archivos.

  Lo que sí hace es no dejar que un error de dedo llegue a producción. Sin esto,
  una coma de más, un slug mal escrito o un enlace a una nota renombrada no
  fallan al guardar: fallan cuando alguien busca la nota y no aparece, semanas
  después y sin ninguna pista de por qué.

  USO
    node tools/notas.js       revisa todo y explica cada problema
                              sale con 0 si está bien, con 1 si algo falla
*/

const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const DIRECTORIO_NOTAS = path.join(RAIZ, "src/content/notas");
const ARCHIVO_MANIFIESTO = path.join(DIRECTORIO_NOTAS, "manifiesto.json");

const {
  construirArbolDeNotas,
  extraerWikilinks,
  separarFrontmatter,
  validarManifiestoDeNotas,
} = require(path.join(RAIZ, "src/app/core/notas/notas.arbol.js"));

/*
  JSON.parse dice "Unexpected token } in JSON at position 1843", que obliga a
  contar caracteres a mano en un archivo de miles. Convertir esa posición en
  línea y columna es la diferencia entre "hay un error" y "está en la línea 47".
*/
function ubicarErrorDeJson(texto, error) {
  const posicion = Number(String(error.message).match(/position (\d+)/)?.[1]);
  if (!Number.isFinite(posicion)) return error.message;

  const previo = texto.slice(0, posicion);
  const linea = previo.split("\n").length;
  const columna = posicion - previo.lastIndexOf("\n");
  const textoLinea = texto.split("\n")[linea - 1] || "";

  return [
    `${error.message}`,
    `  línea ${linea}, columna ${columna}:`,
    `    ${textoLinea.trim()}`,
  ].join("\n");
}

function leerManifiesto(archivoManifiesto) {
  if (!fs.existsSync(archivoManifiesto)) {
    return { problemas: ["no existe src/content/notas/manifiesto.json"] };
  }

  const texto = fs.readFileSync(archivoManifiesto, "utf8");
  try {
    return { manifiesto: JSON.parse(texto) };
  } catch (error) {
    /*
      Un JSON roto es un error terminal: sin él no hay árbol que revisar, así que
      no tiene sentido seguir acumulando problemas derivados.
    */
    return { problemas: [`manifiesto.json no es JSON válido\n  ${ubicarErrorDeJson(texto, error)}`] };
  }
}

const rutaRelativa = (base, absoluta) =>
  path.relative(base, absoluta).split(path.sep).join("/");

/* Todos los .md publicables. Los que empiezan con _ son de servicio. */
function archivosDeNota(base, directorio = base) {
  return fs.readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const completa = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) return archivosDeNota(base, completa);
    if (!entrada.name.endsWith(".md") || entrada.name.startsWith("_")) return [];
    return [rutaRelativa(base, completa)];
  });
}

function diferencia(a, b) {
  return a.filter((elemento) => !b.includes(elemento));
}

/*
  Revisa el manifiesto contra los archivos. Devuelve la lista completa de
  problemas en vez de cortar en el primero: quien acaba de agregar cinco notas
  quiere verlos todos de una vez, no descubrirlos de uno en uno.
*/
function revisarNotas({ directorio = DIRECTORIO_NOTAS, archivoManifiesto } = {}) {
  const manifiestoEn = archivoManifiesto || path.join(directorio, "manifiesto.json");
  const { manifiesto, problemas: problemasDeLectura } = leerManifiesto(manifiestoEn);
  if (problemasDeLectura) return problemasDeLectura;

  /* Las reglas del modelo las impone el mismo validador que usa el sitio. */
  const problemas = [...validarManifiestoDeNotas(manifiesto).errores];

  const arbol = construirArbolDeNotas(manifiesto, { incluirBorradores: true });
  const notas = [...arbol.notasPorSlug.values()];
  const declarados = [];

  for (const nota of notas) {
    const absoluta = path.join(directorio, nota.archivo);
    declarados.push(nota.archivo);

    if (!fs.existsSync(absoluta)) {
      problemas.push(`${nota.slug}: el manifiesto apunta a «${nota.archivo}», que no existe`);
      continue;
    }

    const contenido = fs.readFileSync(absoluta, "utf8");
    const { cuerpo, tieneFrontmatter } = separarFrontmatter(contenido);

    if (tieneFrontmatter) {
      problemas.push(
        `${nota.slug}: el .md trae un bloque --- de metadatos; el título y el resumen viven en el manifiesto`
      );
    }
    if (!cuerpo.trim()) {
      problemas.push(`${nota.slug}: la nota está vacía`);
    }
    if (cuerpo.trim().startsWith("# ")) {
      problemas.push(`${nota.slug}: el .md no lleva «# título» — el título lo pone el manifiesto`);
    }

    /*
      El desajuste más probable de todos: se escribe un [[enlace]] en la nota y
      se olvida agregarlo a «relacionadas», así que el mapa nunca dibuja esa
      conexión. El mensaje dice exactamente qué agregar o quitar.
    */
    const enElCuerpo = extraerWikilinks(cuerpo);
    const declaradas = nota.relacionadas;
    const faltan = diferencia(enElCuerpo, declaradas);
    const sobran = diferencia(declaradas, enElCuerpo);

    if (faltan.length) {
      problemas.push(
        `${nota.slug}: el .md enlaza a ${faltan.map((s) => `[[${s}]]`).join(", ")} ` +
          `pero «relacionadas» no lo declara`
      );
    }
    if (sobran.length) {
      problemas.push(
        `${nota.slug}: «relacionadas» declara ${sobran.map((s) => `"${s}"`).join(", ")} ` +
          `pero el .md ya no lo enlaza`
      );
    }
  }

  /* Un .md sin entrada en el manifiesto es contenido escrito que nadie puede
     encontrar: no sale en el índice, ni en el mapa, ni en la búsqueda. */
  const huerfanos = diferencia(archivosDeNota(directorio), declarados);
  huerfanos.forEach((archivo) => {
    problemas.push(`${archivo}: el archivo existe pero el manifiesto no lo declara`);
  });

  const vistos = new Map();
  for (const nota of notas) {
    const previo = vistos.get(nota.archivo);
    if (previo) {
      problemas.push(`${nota.slug} y ${previo} apuntan al mismo archivo «${nota.archivo}»`);
    }
    vistos.set(nota.archivo, nota.slug);
  }

  return problemas;
}

function ejecutar() {
  const problemas = revisarNotas();

  if (!problemas.length) {
    console.log("Todo en orden.");
    return;
  }

  console.error(
    `\nSe ${problemas.length === 1 ? "encontró 1 problema" : `encontraron ${problemas.length} problemas`}:\n`
  );
  problemas.forEach((problema) => console.error(`  · ${problema}`));
  console.error("");
  process.exit(1);
}

if (require.main === module) ejecutar();

module.exports = Object.freeze({
  revisarNotas,
  ubicarErrorDeJson,
  DIRECTORIO_NOTAS,
  ARCHIVO_MANIFIESTO,
});
