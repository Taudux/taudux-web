#!/usr/bin/env node
/*
  Servidor local para revisar el sitio. Sin dependencias: se corre con
  `node tools/servidor.js` y queda en http://localhost:8181.

  SIRVE TODO src/, no una sola feature: notas, código, cursos y el resto salen del
  mismo proceso, porque el sitio es estático y todos son el mismo sitio. No hace
  falta un servidor por feature.

  El puerto por defecto NO es 5173 a propósito: ese es el default de Vite y el que
  suele quedar ocupado por otra ventana trabajando en paralelo. Dos servidores
  peleando por un puerto producen fallos que parecen errores del código —una
  página en blanco, un asset viejo— cuando en realidad es el puerto equivocado.
  Para usar otro: `node tools/servidor.js 5174`.

  POR QUÉ EXISTE
  `python -m http.server` alcanza para servir archivos, pero tiene dos trampas que
  cuestan sesiones enteras de depuración:

  1. NO MANDA Cache-Control. El navegador entonces aplica caché heurística: guarda
     el .css y el .js y los reutiliza SIN volver a preguntar. El síntoma es
     desconcertante — la página carga, el HTML es el nuevo, pero se ve rota y a
     medio estilar, porque las clases nuevas no existen en el CSS viejo que quedó
     cacheado, y el JS viejo revienta contra el HTML nuevo. Acá se manda
     `no-store`: en desarrollo, cada recarga trae lo que hay en disco.

  2. En Windows, los tipos MIME los saca del registro. Si algún programa dejó
     `.js` apuntando a `text/plain`, el navegador se niega a ejecutar los scripts
     y a aplicar las hojas de estilo, sin un error obvio. Acá la tabla es
     explícita y no depende de la máquina.

  Además emula el `cleanUrls` de vercel.json, así que las URLs sin extensión
  resuelven igual que en producción y no hay sorpresas al desplegar.
*/

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..", "src");
const PUERTO = Number(process.argv[2]) || 8181;

/*
  Tabla explícita, no `mimetypes` del sistema. Un .js servido como text/plain hace
  que el navegador se niegue a ejecutarlo, y los módulos worker son especialmente
  estrictos: el entorno de programación cargaría el editor pero "Ejecutar" no
  haría nada.
*/
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function esArchivo(ruta) {
  try {
    return fs.statSync(ruta).isFile();
  } catch {
    return false;
  }
}

/*
  Resuelve como Vercel con cleanUrls: primero el archivo tal cual, después con
  .html, y por último index.html si la ruta es una carpeta. Sin esto, /cursos
  funcionaría en producción y daría 404 en local.
*/
function resolverArchivo(rutaUrl) {
  const destino = path.join(RAIZ, rutaUrl);

  if (esArchivo(destino)) return destino;
  if (esArchivo(`${destino}.html`)) return `${destino}.html`;

  const indice = path.join(destino, "index.html");
  if (esArchivo(indice)) return indice;

  return null;
}

const servidor = http.createServer((peticion, respuesta) => {
  let rutaUrl;
  try {
    rutaUrl = decodeURIComponent(new URL(peticion.url, "http://localhost").pathname);
  } catch {
    respuesta.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    respuesta.end("URL inválida");
    return;
  }

  const destino = resolverArchivo(rutaUrl);

  /*
    Nunca servir fuera de src/: sin esta comprobación, una petición con ../../
    dejaría leer cualquier archivo de la máquina. Es un servidor de desarrollo,
    pero igual escucha en un puerto.
  */
  if (!destino || !path.resolve(destino).startsWith(RAIZ)) {
    respuesta.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    respuesta.end(`404 — no encontrado: ${rutaUrl}`);
    return;
  }

  respuesta.writeHead(200, {
    "content-type": TIPOS[path.extname(destino).toLowerCase()] || "application/octet-stream",
    // La razón de ser de este archivo: en desarrollo nunca se sirve algo viejo.
    "cache-control": "no-store, must-revalidate",
  });
  fs.createReadStream(destino).pipe(respuesta);
});

servidor.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `El puerto ${PUERTO} ya está ocupado. Cierra el otro servidor o usa otro puerto:\n` +
        `  node tools/servidor.js 5174`,
    );
    process.exit(1);
  }
  throw error;
});

servidor.listen(PUERTO, () => {
  console.log(`Sirviendo ${RAIZ}`);
  console.log(`  Inicio    http://localhost:${PUERTO}/`);
  console.log(`  Código    http://localhost:${PUERTO}/app/features/codigo/`);
  console.log(`  Notas     http://localhost:${PUERTO}/app/features/notas/`);
  console.log("Ctrl + C para detener.");
});
