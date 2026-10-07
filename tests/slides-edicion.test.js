const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const leer = (ruta) => fs.readFileSync(path.join(ROOT, ruta), "utf8");

const LOGICA = leer("src/app/features/slides/slides.logica.js");
const SERVICIO = leer("src/app/core/slides/slides.service.js");
const JS = leer("src/app/features/slides/slides.js");
const HTML = leer("src/app/features/slides/index.html");
const CSS = leer("src/app/features/slides/slides.css");
const PUENTE = leer("src/content/slides/_subida/subida.js");
const MIGRACION = leer("supabase/migrations/0049_slides_edicion.sql");
const PRUEBA_SQL = leer("supabase/tests/0049_slides_edicion.test.sql");

const logica = require(path.join(ROOT, "src/app/features/slides/slides.logica.js"));

/*
  Editar y borrar presentaciones subidas (0049): el servicio corre en un
  contexto aislado con un supabaseClient falso que anota, EN ORDEN, cada cosa
  que toca (`orden`), porque lo que importa de varias operaciones es su
  secuencia: mover antes de actualizar, borrar la fila antes que los archivos.
  La página se prueba como las demás de Slides: sobre su fuente.
*/

const ADMIN = "11111111-1111-4111-8111-111111111111";
const AUTOR = "22222222-2222-4222-8222-222222222222";
const OTRO = "33333333-3333-4333-8333-333333333333";

const plano = (valor) => JSON.parse(JSON.stringify(valor));

function crearCliente({
  sesion,
  fallaUpdate = null,
  filasUpdate = null,
  filasDelete = [{ id: "x" }],
  fallaDelete = null,
  fallaMove = {},
  fallaUpload = {},
  fallaRemove = false,
  visibilidadResultante = "por_revisar",
  rpcs = {},
} = {}) {
  const orden = [];
  const registro = { orden, updates: [], uploads: [], moves: [], removes: [], deletes: [] };
  const cliente = {
    auth: { getSession: async () => ({ data: { session: sesion } }) },
    async rpc(nombre) {
      return rpcs[nombre] || { data: null, error: { message: "no existe" } };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "slides");
        return {
          async upload(ruta, archivo, opciones) {
            orden.push(`upload ${ruta}`);
            registro.uploads.push({ ruta, archivo, opciones });
            if (fallaUpload[ruta]) return { data: null, error: fallaUpload[ruta] };
            return { data: { path: ruta }, error: null };
          },
          async move(desde, hacia) {
            orden.push(`move ${desde} -> ${hacia}`);
            registro.moves.push([desde, hacia]);
            if (fallaMove[desde]) return { data: null, error: fallaMove[desde] };
            return { data: { message: "ok" }, error: null };
          },
          async remove(rutas) {
            orden.push(`remove ${rutas.join(",")}`);
            registro.removes.push(rutas);
            if (fallaRemove) throw new Error("sin red");
            return { data: [], error: null };
          },
        };
      },
    },
    from(tabla) {
      assert.equal(tabla, "slides_subidas");
      return {
        update(valores) {
          return {
            eq(columna, valor) {
              orden.push(`update ${Object.keys(valores).join(",")}`);
              registro.updates.push({ valores, columna, valor });
              return {
                select: async () => ({
                  data: fallaUpdate ? null : (filasUpdate || [{ id: valor, visibilidad: visibilidadResultante }]),
                  error: fallaUpdate,
                }),
              };
            },
          };
        },
        delete() {
          return {
            eq(columna, valor) {
              orden.push("delete fila");
              registro.deletes.push({ columna, valor });
              return { select: async () => ({ data: fallaDelete ? null : filasDelete, error: fallaDelete }) };
            },
          };
        },
      };
    },
  };
  return { cliente, registro };
}

function crearContexto({ cliente, admin }) {
  const contexto = {
    console: { warn() {}, error() {} },
    supabaseClient: cliente,
    esAdmin: async () => admin,
  };
  vm.createContext(contexto);
  vm.runInContext(LOGICA, contexto);
  vm.runInContext(SERVICIO, contexto);
  return contexto;
}

function armar({ admin, opciones = {} }) {
  const sesion = { user: { id: admin ? ADMIN : AUTOR } };
  const { cliente, registro } = crearCliente({
    sesion,
    rpcs: { es_autor_slides: { data: !admin, error: null } },
    ...opciones,
  });
  return { contexto: crearContexto({ cliente, admin }), registro };
}

const ARCHIVO = { name: "nuevo.html", size: 900, type: "text/html" };
const PORTADA = { size: 400, type: "image/webp" };

function datosDeEdicion(extra = {}) {
  return {
    id: "fila-1",
    slug: "qr-de-sesion",
    autorIdActual: AUTOR,
    archivoPathActual: `${AUTOR}/qr-de-sesion/index.html`,
    portadaPathActual: null,
    visibilidadActual: "por_revisar",
    versionActual: 3,
    titulo: "QR de sesión (v2)",
    descripcion: "Con cambios",
    categoria: "Eventos",
    categoriasExistentes: [],
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* entradaDeSubida: los campos nuevos del catálogo                     */
/* ------------------------------------------------------------------ */

test("el catálogo trae la versión del archivo, es_mio y autor_id de cada subida", async () => {
  const fila = {
    id: "a1", slug: "qr", titulo: "QR", categoria: "Eventos", visibilidad: "publico",
    total_laminas: 2, actualizado_en: "2026-10-06T18:00:00+00:00", autor: "Ana Uno",
    archivo_path: `${AUTOR}/qr/index.html`, portada_path: null,
    version_archivo: 4, es_mio: true, autor_id: AUTOR,
  };
  const sinCampos = { ...fila, id: "a2", slug: "qr-dos", archivo_path: `${AUTOR}/qr-dos/index.html` };
  delete sinCampos.version_archivo;
  delete sinCampos.es_mio;
  delete sinCampos.autor_id;

  const { cliente } = crearCliente({
    sesion: null,
    rpcs: { catalogo_slides_subidas: { data: [fila, sinCampos], error: null } },
  });
  const contexto = crearContexto({ cliente, admin: false });
  contexto.fetch = async (url) => ({
    ok: true,
    headers: { get: () => "application/json" },
    // Índice del repositorio vacío: el catálogo son sólo las subidas.
    json: async () => [],
  });
  const resultado = await contexto.cargarCatalogoDeSlides();

  assert.equal(resultado.ok, true);
  const [uno, dos] = resultado.catalogo;
  assert.equal(uno.version, 4);
  assert.equal(uno.es_mio, true);
  assert.equal(uno.autor_id, AUTOR);
  assert.equal(dos.version, 1, "sin versión (migración vieja) cuenta como 1");
  assert.equal(dos.es_mio, false);
  assert.equal(dos.autor_id, null);
});

/* ------------------------------------------------------------------ */
/* editarSlide                                                         */
/* ------------------------------------------------------------------ */

test("editarSlide de un autor no manda autor_id, visibilidad ni rutas, y no toca Storage sin archivos", async () => {
  const { contexto, registro } = armar({ admin: false });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    autorId: OTRO,
    visibilidad: "publico",
  }));

  assert.equal(resultado.ok, true);
  assert.equal(resultado.slug, "qr-de-sesion");
  assert.equal(resultado.visibilidad, "por_revisar");
  assert.deepEqual(plano(registro.updates[0].valores), {
    titulo: "QR de sesión (v2)",
    descripcion: "Con cambios",
    categoria: "Eventos",
    portada_path: null,
  });
  assert.equal(registro.updates[0].columna, "id");
  assert.equal(registro.updates[0].valor, "fila-1");
  assert.deepEqual(registro.orden, ["update titulo,descripcion,categoria,portada_path"]);
});

test("un autor que reemplaza el archivo de una presentación PÚBLICA la manda a revisión ANTES de subir", async () => {
  const { contexto, registro } = armar({ admin: false });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    visibilidadActual: "publico",
    archivo: ARCHIVO,
    totalLaminas: 5,
  }));

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(registro.orden), [
    "update visibilidad",
    `upload ${AUTOR}/qr-de-sesion/index.html`,
    "update titulo,descripcion,categoria,portada_path,total_laminas,version_archivo",
  ]);
  assert.deepEqual(plano(registro.updates[0].valores), { visibilidad: "por_revisar" });
});

test("reemplazar el archivo usa upsert, sube la versión y guarda las láminas nuevas", async () => {
  const { contexto, registro } = armar({ admin: true, opciones: { visibilidadResultante: "publico" } });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    archivo: ARCHIVO,
    totalLaminas: 7,
    autorId: AUTOR,
    visibilidad: "publico",
  }));

  assert.equal(resultado.ok, true);
  assert.equal(resultado.visibilidad, "publico");
  assert.equal(registro.uploads.length, 1);
  assert.equal(registro.uploads[0].ruta, `${AUTOR}/qr-de-sesion/index.html`);
  assert.equal(registro.uploads[0].opciones.upsert, true);
  assert.equal(registro.uploads[0].opciones.contentType, "text/html");
  assert.equal(registro.updates.length, 1, "un administrador no necesita el paso previo");
  assert.equal(registro.updates[0].valores.version_archivo, 4);
  assert.equal(registro.updates[0].valores.total_laminas, 7);
  assert.equal(registro.updates[0].valores.visibilidad, "publico");
  assert.equal("autor_id" in registro.updates[0].valores, false);
  assert.equal("archivo_path" in registro.updates[0].valores, false);
});

test("sin archivo nuevo no se sube nada ni se toca la versión", async () => {
  const { contexto, registro } = armar({ admin: true });

  await contexto.editarSlide(datosDeEdicion({ autorId: AUTOR, visibilidad: "admins" }));

  assert.equal(registro.uploads.length, 0);
  assert.equal("version_archivo" in registro.updates[0].valores, false);
  assert.equal("total_laminas" in registro.updates[0].valores, false);
});

test("reemplazar la portada la sube como WebP con upsert y guarda su ruta", async () => {
  const { contexto, registro } = armar({ admin: false });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    portadaPathActual: `${AUTOR}/qr-de-sesion/portada.webp`,
    portada: PORTADA,
  }));

  assert.equal(resultado.ok, true);
  assert.equal(registro.uploads[0].ruta, `${AUTOR}/qr-de-sesion/portada.webp`);
  assert.equal(registro.uploads[0].opciones.contentType, "image/webp");
  assert.equal(registro.uploads[0].opciones.upsert, true);
  assert.equal(registro.updates[0].valores.portada_path, `${AUTOR}/qr-de-sesion/portada.webp`);
  assert.equal(registro.removes.length, 0, "en la misma carpeta el upsert ya la reemplazó");
});

test("quitar la portada anula la ruta en la fila y SÓLO DESPUÉS borra el objeto", async () => {
  const portadaVieja = `${AUTOR}/qr-de-sesion/portada.webp`;
  const { contexto, registro } = armar({ admin: false });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    portadaPathActual: portadaVieja,
    quitarPortada: true,
  }));

  assert.equal(resultado.ok, true);
  assert.equal(registro.updates[0].valores.portada_path, null);
  assert.deepEqual(plano(registro.orden), [
    "update titulo,descripcion,categoria,portada_path",
    `remove ${portadaVieja}`,
  ]);
});

test("si la fila no se actualiza, la portada quitada NO se borra", async () => {
  const { contexto, registro } = armar({
    admin: false,
    opciones: { fallaUpdate: { code: "42501", message: "denegado" } },
  });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    portadaPathActual: `${AUTOR}/qr-de-sesion/portada.webp`,
    quitarPortada: true,
  }));

  assert.equal(resultado.ok, false);
  assert.equal(registro.removes.length, 0);
  assert.match(resultado.mensaje, /permiso/);
});

test("el administrador que cambia de autor MUEVE los archivos y luego actualiza la fila", async () => {
  const { contexto, registro } = armar({ admin: true });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    portadaPathActual: `${AUTOR}/qr-de-sesion/portada.webp`,
    autorId: OTRO,
    visibilidad: "admins",
  }));

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(registro.orden), [
    `move ${AUTOR}/qr-de-sesion/index.html -> ${OTRO}/qr-de-sesion/index.html`,
    `move ${AUTOR}/qr-de-sesion/portada.webp -> ${OTRO}/qr-de-sesion/portada.webp`,
    "update titulo,descripcion,categoria,portada_path,visibilidad,autor_id,archivo_path",
  ]);
  const valores = registro.updates[0].valores;
  assert.equal(valores.autor_id, OTRO);
  assert.equal(valores.archivo_path, `${OTRO}/qr-de-sesion/index.html`);
  assert.equal(valores.portada_path, `${OTRO}/qr-de-sesion/portada.webp`);
});

test("si la fila falla tras mover, los archivos vuelven a su carpeta", async () => {
  const { contexto, registro } = armar({
    admin: true,
    opciones: { fallaUpdate: { code: "P0001", message: "El autor de una presentación tiene que estar marcado" } },
  });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    portadaPathActual: `${AUTOR}/qr-de-sesion/portada.webp`,
    autorId: OTRO,
    visibilidad: "admins",
  }));

  assert.equal(resultado.ok, false);
  assert.match(resultado.mensaje, /autora/);
  assert.deepEqual(plano(registro.moves), [
    [`${AUTOR}/qr-de-sesion/index.html`, `${OTRO}/qr-de-sesion/index.html`],
    [`${AUTOR}/qr-de-sesion/portada.webp`, `${OTRO}/qr-de-sesion/portada.webp`],
    // Vuelven en orden inverso.
    [`${OTRO}/qr-de-sesion/portada.webp`, `${AUTOR}/qr-de-sesion/portada.webp`],
    [`${OTRO}/qr-de-sesion/index.html`, `${AUTOR}/qr-de-sesion/index.html`],
  ]);
});

test("si mover la portada falla, el HTML ya movido vuelve y no se actualiza la fila", async () => {
  const { contexto, registro } = armar({
    admin: true,
    opciones: { fallaMove: { [`${AUTOR}/qr-de-sesion/portada.webp`]: { message: "boom" } } },
  });

  const resultado = await contexto.editarSlide(datosDeEdicion({
    portadaPathActual: `${AUTOR}/qr-de-sesion/portada.webp`,
    autorId: OTRO,
    visibilidad: "admins",
  }));

  assert.equal(resultado.ok, false);
  assert.equal(registro.updates.length, 0);
  assert.deepEqual(plano(registro.moves.at(-1)), [
    `${OTRO}/qr-de-sesion/index.html`,
    `${AUTOR}/qr-de-sesion/index.html`,
  ]);
});

test("al cambiar de autor con portada nueva, la vieja se retira después de la fila", async () => {
  const { contexto, registro } = armar({ admin: true });

  await contexto.editarSlide(datosDeEdicion({
    portadaPathActual: `${AUTOR}/qr-de-sesion/portada.webp`,
    portada: PORTADA,
    autorId: OTRO,
    visibilidad: "admins",
  }));

  assert.deepEqual(plano(registro.orden), [
    `move ${AUTOR}/qr-de-sesion/index.html -> ${OTRO}/qr-de-sesion/index.html`,
    `upload ${OTRO}/qr-de-sesion/portada.webp`,
    "update titulo,descripcion,categoria,portada_path,visibilidad,autor_id,archivo_path",
    `remove ${AUTOR}/qr-de-sesion/portada.webp`,
  ]);
});

test("cero filas actualizadas es falta de permiso, y deshace lo subido", async () => {
  const { contexto, registro } = armar({ admin: false, opciones: { filasUpdate: [] } });

  const resultado = await contexto.editarSlide(datosDeEdicion({ portada: PORTADA }));

  assert.equal(resultado.ok, false);
  assert.equal(resultado.mensaje, "No se pudo guardar: no tienes permiso para editar esta presentación.");
  assert.deepEqual(plano(registro.removes), [[`${AUTOR}/qr-de-sesion/portada.webp`]],
    "la portada recién creada no se queda huérfana");
});

test("editarSlide valida en modo edición: archivo opcional y el slug propio no cuenta como ocupado", async () => {
  const { contexto, registro } = armar({ admin: false });

  const sinTitulo = await contexto.editarSlide(datosDeEdicion({ titulo: "  " }));
  assert.equal(sinTitulo.ok, false);
  assert.equal(registro.orden.length, 0, "no toca la red si no pasa la validación");

  const conArchivoSinLaminas = await contexto.editarSlide(datosDeEdicion({ archivo: ARCHIVO, totalLaminas: 0 }));
  assert.equal(conArchivoSinLaminas.ok, false);
  assert.match(conArchivoSinLaminas.mensaje, /láminas/);
});

test("sin sesión o sin ser autor ni administrador no edita nada", async () => {
  const sinSesion = crearCliente({ sesion: null, rpcs: { es_autor_slides: { data: false, error: null } } });
  const a = crearContexto({ cliente: sinSesion.cliente, admin: false });
  assert.equal((await a.editarSlide(datosDeEdicion())).ok, false);

  const normal = crearCliente({
    sesion: { user: { id: OTRO } },
    rpcs: { es_autor_slides: { data: false, error: null } },
  });
  const b = crearContexto({ cliente: normal.cliente, admin: false });
  assert.equal((await b.editarSlide(datosDeEdicion())).ok, false);
  assert.equal(normal.registro.orden.length, 0);
});

/* ------------------------------------------------------------------ */
/* borrarSlide                                                         */
/* ------------------------------------------------------------------ */

test("borrarSlide borra la fila ANTES que los archivos", async () => {
  const { contexto, registro } = armar({ admin: false });

  const resultado = await contexto.borrarSlide({
    id: "fila-1",
    archivoPath: `${AUTOR}/qr/index.html`,
    portadaPath: `${AUTOR}/qr/portada.webp`,
  });

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(registro.orden), [
    "delete fila",
    `remove ${AUTOR}/qr/index.html,${AUTOR}/qr/portada.webp`,
  ]);
});

test("borrarSlide sin portada sólo retira el HTML", async () => {
  const { contexto, registro } = armar({ admin: true });
  await contexto.borrarSlide({ id: "fila-1", archivoPath: `${AUTOR}/qr/index.html`, portadaPath: "" });
  assert.deepEqual(plano(registro.removes), [[`${AUTOR}/qr/index.html`]]);
});

test("borrarSlide con cero filas borradas avisa de permiso y no toca los archivos", async () => {
  const { contexto, registro } = armar({ admin: false, opciones: { filasDelete: [] } });

  const resultado = await contexto.borrarSlide({ id: "fila-1", archivoPath: `${AUTOR}/qr/index.html` });

  assert.equal(resultado.ok, false);
  assert.match(resultado.mensaje, /permiso/);
  assert.equal(registro.removes.length, 0);
});

test("borrarSlide: si los archivos no se pueden retirar, la presentación ya está borrada", async () => {
  const { contexto } = armar({ admin: false, opciones: { fallaRemove: true } });

  const resultado = await contexto.borrarSlide({ id: "fila-1", archivoPath: `${AUTOR}/qr/index.html` });

  assert.equal(resultado.ok, true);
});

test("borrarSlide con error de la base no retira nada", async () => {
  const { contexto, registro } = armar({
    admin: false,
    opciones: { fallaDelete: { code: "42501", message: "denegado" } },
  });

  const resultado = await contexto.borrarSlide({ id: "fila-1", archivoPath: `${AUTOR}/qr/index.html` });

  assert.equal(resultado.ok, false);
  assert.equal(registro.removes.length, 0);
});

/* ------------------------------------------------------------------ */
/* validarSubida en modo edición                                       */
/* ------------------------------------------------------------------ */

const BASE = { titulo: "Título nuevo", descripcion: "", categoria: "Datos" };

test("validarSubida en edición no exige archivo y conserva el slug propio aunque cambie el título", () => {
  const resultado = logica.validarSubida(BASE, { modo: "edicion", slugPropio: "qr-de-sesion" });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.valores.slug, "qr-de-sesion");
  assert.equal(resultado.errores.archivo, undefined);
});

test("validarSubida en edición no cuenta ningún slug como ocupado", () => {
  const edicion = logica.validarSubida(BASE, {
    modo: "edicion", slugPropio: "qr-de-sesion", slugsOcupados: ["titulo-nuevo"],
  });
  assert.equal(edicion.ok, true);
});

test("validarSubida en edición sigue validando lo que sí se manda", () => {
  const malArchivo = logica.validarSubida(
    { ...BASE, archivo: { name: "malo.txt", size: 10 } },
    { modo: "edicion", slugPropio: "x" }
  );
  assert.match(malArchivo.errores.archivo, /\.html/);

  const malaPortada = logica.validarSubida(
    { ...BASE, portada: { type: "image/gif", size: 10 } },
    { modo: "edicion", slugPropio: "x" }
  );
  assert.match(malaPortada.errores.portada, /JPG, PNG o WebP/);

  const sinTitulo = logica.validarSubida({ ...BASE, titulo: "" }, { modo: "edicion", slugPropio: "x" });
  assert.ok(sinTitulo.errores.titulo);
});

test("validarSubida en edición deja a un administrador conservar «por revisar»", () => {
  const admin = { modo: "edicion", slugPropio: "x", esAdmin: true };
  assert.equal(logica.validarSubida({ ...BASE, autorId: AUTOR, visibilidad: "por_revisar" }, admin).ok, true);
  assert.equal(logica.validarSubida({ ...BASE, autorId: "", visibilidad: "publico" }, admin).ok, false);
});

test("validarSubida en modo subida no cambia: archivo obligatorio, slug del título y sin «por revisar»", () => {
  const subida = logica.validarSubida({ ...BASE, slugsOcupados: [] }, {});
  assert.match(subida.errores.archivo, /Elige el archivo/);
  assert.equal(subida.valores.slug, "titulo-nuevo");

  const ocupado = logica.validarSubida(
    { ...BASE, archivo: { name: "a.html", size: 5 } },
    { slugsOcupados: ["titulo-nuevo"] }
  );
  assert.match(ocupado.errores.titulo, /Ya existe/);

  const admin = logica.validarSubida(
    { ...BASE, archivo: { name: "a.html", size: 5 }, autorId: AUTOR, visibilidad: "por_revisar" },
    { esAdmin: true }
  );
  assert.ok(admin.errores.visibilidad);
});

/* ------------------------------------------------------------------ */
/* La página: lápiz y formulario de edición                            */
/* ------------------------------------------------------------------ */

test("el lápiz sólo sale en lo subido, para el administrador o para su autor", () => {
  assert.match(
    JS,
    /hayEdicion && presentacion\.origen === "subida" && \(permisos\.admin \|\| presentacion\.es_mio\)/
  );
  assert.match(JS, /celda\.append\(crearBotonEditar\(presentacion\)\)/);
});

test("el lápiz es un botón HERMANO de la tarjeta, con nombre accesible y un ícono SVG oculto al lector", () => {
  const cuerpo = JS.slice(JS.indexOf("function crearBotonEditar"), JS.indexOf("// La portada: la imagen si hay"));
  assert.match(cuerpo, /editar\.type = "button"/);
  assert.match(cuerpo, /editar\.className = "slides__editar"/);
  assert.match(cuerpo, /`Editar \$\{presentacion\.titulo\}`/);
  assert.match(cuerpo, /createElementNS\(ns, "svg"\)/);
  assert.match(cuerpo, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(cuerpo, /abrirFormulario\(presentacion\)/);
  // No va dentro de la tarjeta: `boton.append(...editar...)` no existe.
  assert.doesNotMatch(JS, /boton\.append\(crearBotonEditar/);
});

test("el botón de subir abre el formulario SIN presentación (modo subida)", () => {
  assert.match(JS, /el\.subir\.addEventListener\("click", \(\) => abrirFormulario\(\)\)/);
});

test("el formulario en modo edición usa los textos acordados", () => {
  assert.match(JS, /"Editar presentación" : "Subir presentación"/);
  assert.match(JS, /edicionActual \? "Guardar cambios" : "Subir"/);
  assert.match(JS, /Déjalo vacío para conservar el archivo actual\./);
  assert.match(JS, /form\.archivo\.required = !editando/);
  assert.match(JS, /"Guardando…" : "Subiendo…"/);
});

test("editar prellena título, descripción, categoría, autor y visibilidad, y el autor se preselecciona", () => {
  assert.match(JS, /form\.titulo\.value = presentacion\.titulo/);
  assert.match(JS, /form\.descripcion\.value = presentacion\.descripcion/);
  assert.match(JS, /form\.categoria\.value = presentacion\.categoria/);
  assert.match(JS, /form\.autor\.value = presentacion\.autor_id/);
  assert.match(JS, /cargarAutores\(editando \? presentacion : null\)/);
  assert.match(JS, /const seleccionado = \(actual && actual\.autor_id\) \|\| form\.autor\.value/);
});

test("«Quitar portada» sólo existe si la presentación tiene portada", () => {
  assert.match(JS, /form\.quitarPortadaCampo\.hidden = !\(editando && presentacion\.portada_path\)/);
  assert.match(HTML, /id="slidesFormQuitarPortadaCampo"[^>]*\shidden/);
  assert.match(HTML, /<span>Quitar portada<\/span>/);
  assert.match(JS, /quitarPortada: form\.quitarPortada\.checked/);
});

test("el aviso de que vuelve a revisión sólo se ve para quien no es administrador y con lo público", () => {
  assert.match(JS, /form\.avisoRevision\.hidden = !\(editando && !permisos\.admin && presentacion\.visibilidad === "publico"\)/);
  assert.match(HTML, /id="slidesFormAvisoRevision"[^>]*\shidden[^>]*>Al guardar, volverá a revisión y dejará de verse en público hasta que un administrador la publique\./);
});

test("un autor no manda autor ni visibilidad al editar", () => {
  assert.match(JS, /autorId: permisos\.admin \? form\.autor\.value : undefined/);
  assert.match(JS, /visibilidad: permisos\.admin && visibilidad \? visibilidad\.value : undefined/);
});

test("borrar pide confirmación DENTRO del diálogo, nunca con window.confirm", () => {
  assert.doesNotMatch(JS, /\bconfirm\(/);
  assert.match(HTML, /id="slidesFormBorrarZona"[^>]*\shidden/);
  assert.match(HTML, />Borrar presentación<\/button>/);
  assert.match(HTML, /id="slidesFormBorrarConfirmar"[^>]*\shidden/);
  assert.match(HTML, /¿Seguro\? Esto no se puede deshacer\./);
  assert.match(HTML, />Sí, borrar<\/button>/);
  assert.match(HTML, />Cancelar<\/button>\s*<\/div>\s*<\/div>\s*<\/div>/);
  // El botón de borrar sólo muestra el paso de confirmar; borrar es el «Sí».
  assert.match(JS, /form\.borrar\.addEventListener\("click", pedirConfirmacionDeBorrado\)/);
  assert.match(JS, /form\.borrarSi\.addEventListener\("click", borrarPresentacion\)/);
  assert.match(JS, /form\.borrarNo\.addEventListener\("click", cancelarBorrado\)/);
});

test("al abrir el formulario se reinicia todo, también el paso de confirmar el borrado", () => {
  const cuerpo = JS.slice(JS.indexOf("async function abrirFormulario"), JS.indexOf("function textoDeEnviar"));
  assert.match(cuerpo, /quitarOpcionPorRevisar\(\)/);
  assert.match(cuerpo, /form\.formulario\.reset\(\)/);
  assert.match(cuerpo, /form\.borrarZona\.hidden = !editando/);
  assert.match(cuerpo, /cancelarBorrado\(\)/);
  assert.match(cuerpo, /form\.archivo\.required = !editando/);
});

test("los avisos tras guardar y borrar son los acordados, y luego se recarga el catálogo", () => {
  assert.match(JS, /"Cambios guardados\."/);
  assert.match(JS, /"Cambios guardados\. Un administrador la revisará antes de publicarla\."/);
  assert.match(JS, /mostrarToast\("Presentación borrada\.", "success"\)/);
  const borrado = JS.slice(JS.indexOf("async function borrarPresentacion"), JS.indexOf("function alternarOcupado"));
  assert.match(borrado, /await borrarSlide\(\{/);
  assert.match(borrado, /await cargarCatalogo\(\)/);
});

test("enviar en modo edición llama a editarSlide con lo que el servicio necesita", () => {
  for (const campo of [
    "id: edicion.id", "slug: edicion.slug", "autorIdActual: edicion.autor_id",
    "archivoPathActual: edicion.archivo_path", "portadaPathActual: edicion.portada_path",
    "visibilidadActual: edicion.visibilidad", "versionActual: edicion.version",
  ]) {
    assert.ok(JS.includes(campo), `falta ${campo}`);
  }
  assert.match(JS, /modo: "edicion", slugPropio: edicion\.slug/);
});

test("el HTML trae los ids nuevos del formulario y el título del diálogo sigue siendo el de subir", () => {
  for (const id of [
    "slidesFormQuitarPortada", "slidesFormAvisoRevision", "slidesFormBorrar", "slidesFormBorrarSi",
    "slidesFormBorrarNo",
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"`), `falta ${id}`);
  }
  assert.match(HTML, /id="slidesDialogoTitulo">Subir presentación</);
});

test("el CSS pone el lápiz sobre la esquina de la portada, redondo, con foco visible y sin animar si se pide", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.slides__celda \{[^}]*position: relative;/);
  const lapiz = css.match(/\.slides__editar \{[^}]*\}/)[0];
  assert.match(lapiz, /position: absolute;/);
  assert.match(lapiz, /inset-block-start: 0\.5rem;/);
  assert.match(lapiz, /inset-inline-end: 0\.5rem;/);
  assert.match(lapiz, /border-radius: var\(--radius-pill\);/);
  assert.match(lapiz, /color: var\(--color-accent\);/);
  assert.match(css, /\.slides__editar:hover \{/);
  assert.match(css, /\.slides__editar:focus-visible \{[^}]*outline: var\(--focus-ring\);/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[\s\S]*\.slides__editar,[\s\S]*transition: none;/);
});

/* ------------------------------------------------------------------ */
/* El puente: la versión va en la URL de descarga                      */
/* ------------------------------------------------------------------ */

test("el puente descarga con ?v=<versión> para saltarse la caché de una hora", () => {
  assert.match(PUENTE, /download\(`\$\{fila\.archivo_path\}\?v=\$\{fila\.version_archivo \|\| 1\}`\)/);
  assert.match(PUENTE, /max-age=3600/);
});

/* ------------------------------------------------------------------ */
/* La migración 0049                                                   */
/* ------------------------------------------------------------------ */

test("las migraciones siguen contiguas y la 0049 es la siguiente a la 0048", () => {
  const numeros = fs.readdirSync(path.join(ROOT, "supabase/migrations"))
    .map((nombre) => nombre.match(/^(\d{4})_/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  numeros.forEach((numero, posicion) => assert.equal(numero, posicion + 1, `hueco antes de ${numero}`));
  assert.ok(numeros.includes(49));
});

test("0049 agrega version_archivo positiva y recrea el catálogo con es_mio y autor_id acotado", () => {
  assert.match(MIGRACION, /add column if not exists version_archivo integer not null default 1/);
  assert.match(MIGRACION, /check \(version_archivo > 0\)/);
  assert.match(MIGRACION, /drop function if exists public\.catalogo_slides_subidas\(\);/);
  assert.match(MIGRACION, /version_archivo integer,\s*es_mio boolean,\s*autor_id uuid/);
  assert.match(MIGRACION, /case when public\.es_admin\(\) or s\.autor_id = auth\.uid\(\)\s*then s\.autor_id end as autor_id/);
  assert.match(MIGRACION, /revoke all on function public\.catalogo_slides_subidas\(\) from public, anon, authenticated;/);
  assert.match(MIGRACION, /grant execute on function public\.catalogo_slides_subidas\(\) to anon, authenticated;/);
});

test("0049: el trigger fuerza por_revisar al que no es admin, impide cambiar de autor y mueve actualizado_en", () => {
  assert.match(MIGRACION, /create or replace function public\.slides_subidas_validar\(\)/);
  assert.match(MIGRACION, /not public\.es_admin\(\)/);
  assert.match(MIGRACION, /new\.visibilidad := 'por_revisar'/);
  assert.match(MIGRACION, /Sólo un administrador puede cambiar el autor/);
  assert.match(MIGRACION, /new\.version_archivo is distinct from old\.version_archivo/);
  assert.match(MIGRACION, /new\.portada_path is distinct from old\.portada_path/);
  // Lo de 0048 se conserva.
  assert.match(MIGRACION, /El slug de una presentación no cambia/);
  assert.match(MIGRACION, /es_autor_slides/);
});

test("0049: el autor edita y borra lo suyo, y reemplaza sus archivos sin tocar lo público", () => {
  assert.match(MIGRACION, /create policy slides_subidas_update_autor[\s\S]*using \(autor_id = auth\.uid\(\) and public\.es_autor_slides\(\)\)[\s\S]*with check \(autor_id = auth\.uid\(\) and visibilidad = 'por_revisar'\)/);
  assert.match(MIGRACION, /create policy slides_subidas_delete_autor[\s\S]*using \(autor_id = auth\.uid\(\)\)/);
  assert.match(MIGRACION, /drop policy if exists slides_subidas_update_autor/);
  assert.match(MIGRACION, /drop policy if exists slides_subidas_delete_autor/);
  const objetos = MIGRACION.slice(MIGRACION.indexOf("create policy slides_objetos_update_autor"));
  assert.match(objetos, /on storage\.objects for update to authenticated/);
  assert.match(objetos, /public\.es_autor_slides\(\)/);
  assert.match(objetos, /split_part\(name, '\/', 1\) = auth\.uid\(\)::text/);
  assert.match(objetos, /\(index\\\.html\|portada\\\.webp\)/);
  assert.match(objetos, /not public\.slides_ruta_publica\(name\)/);
});

test("el script SQL de 0049 se niega a correr fuera de su base y encadena 0048 y 0049", () => {
  assert.match(PRUEBA_SQL, /current_database\(\) <> 'taudux_slides_edicion_0049_test'/);
  assert.match(PRUEBA_SQL, /\\ir \.\.\/migrations\/0048_slides_subidas\.sql/);
  assert.match(PRUEBA_SQL, /\\ir \.\.\/migrations\/0049_slides_edicion\.sql/);
  assert.match(PRUEBA_SQL, /ok: 0049_slides_edicion/);
});

test("el formulario scrollea con la misma barra que el sitio", () => {
  const css = leer("src/app/features/slides/slides.css");
  const pulgar = css.match(/\.slides__dialogo::-webkit-scrollbar-thumb \{([^}]*)\}/);
  assert.ok(pulgar, "falta la barra del formulario");
  assert.match(pulgar[1], /linear-gradient\(to bottom, var\(--color-accent-dark\), var\(--color-accent\)\)/);
  assert.match(css, /\.slides__dialogo::-webkit-scrollbar-track \{ background: #0b0d10; \}/);
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\) \{\s*\.slides__dialogo \{\s*scrollbar-width: thin;\s*scrollbar-color: var\(--color-accent-dark\) #0b0d10;/);
});

test("la descripción crece con su texto en vez de scrollear", () => {
  const css = leer("src/app/features/slides/slides.css");
  const regla = css.match(/#slidesFormDescripcion \{([^}]*)\}/);
  assert.ok(regla, "falta la regla de la descripción");
  assert.match(regla[1], /field-sizing: content;/);
  assert.match(regla[1], /resize: none;/);
  assert.match(regla[1], /overflow: hidden;/);
  // Respaldo sin field-sizing: al escribir y al abrir el formulario.
  assert.match(JS, /form\.descripcion\.addEventListener\("input", ajustarAltoDeDescripcion\)/);
  assert.match(JS, /form\.dialogo\.showModal\(\);\s*\/\/[^\n]*\n\s*ajustarAltoDeDescripcion\(\);/);
});
