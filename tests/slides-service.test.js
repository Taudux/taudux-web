const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const LOGICA = fs.readFileSync("src/app/features/slides/slides.logica.js", "utf8");
const SERVICIO = fs.readFileSync("src/app/core/slides/slides.service.js", "utf8");

/*
  El servicio corre en un contexto aislado, con la lógica pura cargada antes
  (como en la página: slides.logica.js va antes que el servicio), un `fetch`
  falso para los manifiestos del repositorio y un supabaseClient falso para
  las subidas. Cada prueba arma sólo lo que necesita.
*/

const ADMIN = "11111111-1111-4111-8111-111111111111";
const AUTOR = "22222222-2222-4222-8222-222222222222";

// Los objetos creados dentro de vm tienen otro Object.prototype: se copian a
// JSON plano para comparar con deepEqual estricto.
function plano(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function respuestaJson(cuerpo, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: () => "application/json" },
    json: async () => cuerpo,
  };
}

function crearFetch({ indice, manifiestos = {} }) {
  return async (url) => {
    if (url === "/content/slides/manifiesto.json") return respuestaJson(indice);
    const coincide = /^\/content\/slides\/([^/]+)\/manifiesto\.json$/.exec(url);
    if (coincide && manifiestos[coincide[1]]) return respuestaJson(manifiestos[coincide[1]]);
    return respuestaJson(null, false);
  };
}

const MANIFIESTO_SQL = {
  titulo: "Curso SQL",
  descripcion: "Bases de datos",
  archivo: "index.html",
  categoria: "Bases de datos",
  autor: "Equipo Taudux",
  actualizado: "2026-09-25",
  total_laminas: 112,
};

/*
  Un supabaseClient falso. `sesion` es la de auth.getSession(); `rpcs` mapea
  nombre -> { data, error }; `almacen` registra lo que pasa por Storage y
  `tabla` lo que pasa por `from('slides_subidas')`.
*/
function crearCliente({ sesion = null, rpcs = {}, fallaUpload = {}, errorInsert = null, updateData = [{ id: "x" }] } = {}) {
  const registro = { rpc: [], uploads: [], removes: [], inserts: [], updates: [], firmadas: [] };
  const cliente = {
    auth: { getSession: async () => ({ data: { session: sesion } }) },
    async rpc(nombre) {
      registro.rpc.push(nombre);
      const respuesta = rpcs[nombre];
      if (respuesta instanceof Error) throw respuesta;
      return respuesta || { data: null, error: { message: "no existe" } };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "slides");
        return {
          async upload(ruta, archivo, opciones) {
            registro.uploads.push({ ruta, archivo, opciones });
            if (fallaUpload[ruta]) return { data: null, error: fallaUpload[ruta] };
            return { data: { path: ruta }, error: null };
          },
          async remove(rutas) {
            registro.removes.push(rutas);
            return { data: [], error: null };
          },
          async createSignedUrls(rutas, segundos) {
            registro.firmadas.push({ rutas, segundos });
            return { data: rutas.map((path) => ({ path, signedUrl: `https://firmada.test/${path}`, error: null })), error: null };
          },
        };
      },
    },
    from(tabla) {
      assert.equal(tabla, "slides_subidas");
      return {
        async insert(fila) {
          registro.inserts.push(fila);
          return { error: errorInsert };
        },
        update(valores) {
          return {
            eq(columna, valor) {
              registro.updates.push({ valores, columna, valor });
              return { select: async () => ({ data: updateData, error: null }) };
            },
          };
        },
      };
    },
  };
  return { cliente, registro };
}

function crearHarness({ cliente, fetch, esAdmin = false, sinCliente = false } = {}) {
  const logs = [];
  const contexto = {
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    fetch,
  };
  if (!sinCliente) contexto.supabaseClient = cliente;
  contexto.esAdmin = async () => esAdmin;
  vm.createContext(contexto);
  vm.runInContext(LOGICA, contexto);
  vm.runInContext(SERVICIO, contexto);
  return { logs, contexto };
}

const SESION_ADMIN = { user: { id: ADMIN } };
const SESION_AUTOR = { user: { id: AUTOR } };

const FILA_SUBIDA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  slug: "qr-de-sesion",
  titulo: "QR de sesión",
  descripcion: "",
  categoria: "Eventos",
  visibilidad: "admins",
  total_laminas: 2,
  actualizado_en: "2026-10-06T18:00:00+00:00",
  autor: "Ana Uno",
  archivo_path: `${AUTOR}/qr-de-sesion/index.html`,
  portada_path: `${AUTOR}/qr-de-sesion/portada.webp`,
};

/* ------------------------------------------------------------------ */
/* Catálogo: el repositorio y las subidas, juntos                      */
/* ------------------------------------------------------------------ */

test("el catálogo junta las del repositorio con las subidas visibles", async () => {
  const { cliente } = crearCliente({ rpcs: { catalogo_slides_subidas: { data: [FILA_SUBIDA], error: null } } });
  const { contexto } = crearHarness({
    cliente,
    fetch: crearFetch({ indice: ["curso-sql"], manifiestos: { "curso-sql": MANIFIESTO_SQL } }),
  });

  const resultado = await contexto.cargarCatalogoDeSlides();

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(resultado.catalogo.map((i) => [i.slug, i.origen, i.visibilidad])), [
    ["curso-sql", "repo", "publico"],
    ["qr-de-sesion", "subida", "admins"],
  ]);

  const repo = resultado.catalogo[0];
  assert.equal(repo.categoria, "Bases de datos");
  assert.equal(repo.autor, "Equipo Taudux");
  assert.equal(repo.total_laminas, 112);
  assert.equal(repo.url, "/content/slides/curso-sql/index.html");
  assert.equal(repo.portada_url, "", "sin portada declarada no hay URL");

  const subida = resultado.catalogo[1];
  assert.equal(subida.url, "/content/slides/_subida/#qr-de-sesion");
  assert.equal(subida.autor, "Ana Uno");
  assert.equal(subida.actualizado, "2026-10-06T18:00:00+00:00");
  assert.equal(subida.archivo, "index.html", "pasa la misma validación que las del repositorio");
  assert.equal(subida.portada_path, FILA_SUBIDA.portada_path);
});

test("la portada del repositorio sale de su propia carpeta", async () => {
  const { cliente } = crearCliente();
  const { contexto } = crearHarness({
    cliente,
    fetch: crearFetch({
      indice: ["curso-sql"],
      manifiestos: { "curso-sql": { ...MANIFIESTO_SQL, portada: "portada.webp" } },
    }),
  });

  const { catalogo } = await contexto.cargarCatalogoDeSlides();
  assert.equal(catalogo[0].portada_url, "/content/slides/curso-sql/portada.webp");
});

test("si las subidas fallan, el catálogo del repositorio sigue en pie", async () => {
  for (const rpcs of [
    { catalogo_slides_subidas: { data: null, error: { message: "function does not exist" } } },
    { catalogo_slides_subidas: new Error("sin red") },
  ]) {
    const { cliente } = crearCliente({ rpcs });
    const { contexto, logs } = crearHarness({
      cliente,
      fetch: crearFetch({ indice: ["curso-sql"], manifiestos: { "curso-sql": MANIFIESTO_SQL } }),
    });

    const resultado = await contexto.cargarCatalogoDeSlides();
    assert.equal(resultado.ok, true);
    assert.deepEqual(plano(resultado.catalogo.map((i) => i.slug)), ["curso-sql"]);
    assert.ok(logs.length > 0, "el fallo se avisa en consola");
  }
});

test("sin cliente de Supabase el catálogo es sólo el del repositorio", async () => {
  const { contexto } = crearHarness({
    sinCliente: true,
    fetch: crearFetch({ indice: ["curso-sql"], manifiestos: { "curso-sql": MANIFIESTO_SQL } }),
  });

  const resultado = await contexto.cargarCatalogoDeSlides();
  assert.equal(resultado.ok, true);
  assert.equal(resultado.catalogo.length, 1);
});

test("una subida que repite el slug de una del repositorio se descarta", async () => {
  const { cliente } = crearCliente({
    rpcs: { catalogo_slides_subidas: { data: [{ ...FILA_SUBIDA, slug: "curso-sql" }], error: null } },
  });
  const { contexto } = crearHarness({
    cliente,
    fetch: crearFetch({ indice: ["curso-sql"], manifiestos: { "curso-sql": MANIFIESTO_SQL } }),
  });

  const { catalogo } = await contexto.cargarCatalogoDeSlides();
  assert.deepEqual(plano(catalogo.map((i) => i.origen)), ["repo"]);
});

test("un índice roto sigue siendo error de carga, aunque las subidas respondan", async () => {
  const { cliente } = crearCliente({ rpcs: { catalogo_slides_subidas: { data: [FILA_SUBIDA], error: null } } });
  const { contexto } = crearHarness({ cliente, fetch: crearFetch({ indice: { no: "arreglo" } }) });

  const resultado = await contexto.cargarCatalogoDeSlides();
  assert.equal(resultado.ok, false);
});

test("las subidas se piden en cada carga (cambian con la sesión) y el repositorio una sola vez", async () => {
  let pedidosAlIndice = 0;
  const { cliente, registro } = crearCliente({
    rpcs: { catalogo_slides_subidas: { data: [], error: null } },
  });
  const base = crearFetch({ indice: ["curso-sql"], manifiestos: { "curso-sql": MANIFIESTO_SQL } });
  const { contexto } = crearHarness({
    cliente,
    fetch: async (url) => {
      if (url === "/content/slides/manifiesto.json") pedidosAlIndice += 1;
      return base(url);
    },
  });

  await contexto.cargarCatalogoDeSlides();
  await contexto.cargarCatalogoDeSlides();

  assert.equal(pedidosAlIndice, 1);
  assert.equal(registro.rpc.filter((n) => n === "catalogo_slides_subidas").length, 2);
});

/* ------------------------------------------------------------------ */
/* Permisos                                                            */
/* ------------------------------------------------------------------ */

test("sin sesión nadie puede subir", async () => {
  const { cliente } = crearCliente({ sesion: null });
  const { contexto } = crearHarness({ cliente });

  const permisos = await contexto.cargarPermisosDeSlides();
  assert.deepEqual(plano(permisos), { ok: true, admin: false, autor: false, usuarioId: null });
});

test("un administrador y un autor se reconocen por separado", async () => {
  const admin = crearHarness({
    cliente: crearCliente({ sesion: SESION_ADMIN, rpcs: { es_autor_slides: { data: false, error: null } } }).cliente,
    esAdmin: true,
  });
  assert.deepEqual(plano(await admin.contexto.cargarPermisosDeSlides()), {
    ok: true, admin: true, autor: false, usuarioId: ADMIN,
  });

  const autor = crearHarness({
    cliente: crearCliente({ sesion: SESION_AUTOR, rpcs: { es_autor_slides: { data: true, error: null } } }).cliente,
    esAdmin: false,
  });
  assert.deepEqual(plano(await autor.contexto.cargarPermisosDeSlides()), {
    ok: true, admin: false, autor: true, usuarioId: AUTOR,
  });
});

test("si es_autor_slides falla (migración sin aplicar) se trata como no autor", async () => {
  const { cliente } = crearCliente({ sesion: SESION_AUTOR, rpcs: {} });
  const { contexto } = crearHarness({ cliente });

  const permisos = await contexto.cargarPermisosDeSlides();
  assert.equal(permisos.autor, false);
});

/* ------------------------------------------------------------------ */
/* Subir                                                               */
/* ------------------------------------------------------------------ */

const ARCHIVO = { name: "qr.html", size: 1234, type: "text/html" };
const PORTADA = { size: 500, type: "image/webp" };

function datosDeSubida(extra = {}) {
  return {
    titulo: "QR de sesión",
    descripcion: "Los QR del día",
    categoria: "Eventos",
    categoriasExistentes: [],
    archivo: ARCHIVO,
    portada: null,
    totalLaminas: 2,
    autorId: AUTOR,
    visibilidad: "admins",
    ...extra,
  };
}

function harnessDeSubida({ sesion, admin, opciones = {} }) {
  const { cliente, registro } = crearCliente({
    sesion,
    rpcs: { es_autor_slides: { data: !admin, error: null } },
    ...opciones,
  });
  const { contexto } = crearHarness({ cliente, esAdmin: admin });
  return { contexto, registro };
}

test("un administrador sube el HTML y la fila con el autor y la visibilidad que eligió", async () => {
  const { contexto, registro } = harnessDeSubida({ sesion: SESION_ADMIN, admin: true });

  const resultado = await contexto.subirSlide(datosDeSubida());

  assert.equal(resultado.ok, true);
  assert.equal(resultado.slug, "qr-de-sesion");
  assert.deepEqual(plano(registro.uploads.map((u) => u.ruta)), [`${AUTOR}/qr-de-sesion/index.html`]);
  assert.equal(registro.uploads[0].opciones.contentType, "text/html");
  assert.equal(registro.uploads[0].opciones.upsert, false, "no pisa un archivo existente");
  assert.deepEqual(plano(registro.inserts[0]), {
    slug: "qr-de-sesion",
    titulo: "QR de sesión",
    descripcion: "Los QR del día",
    categoria: "Eventos",
    visibilidad: "admins",
    autor_id: AUTOR,
    archivo_path: `${AUTOR}/qr-de-sesion/index.html`,
    portada_path: null,
    total_laminas: 2,
  });
});

test("un autor sube SIEMPRE a su nombre y por revisar, aunque mande otra cosa", async () => {
  const { contexto, registro } = harnessDeSubida({ sesion: SESION_AUTOR, admin: false });

  const resultado = await contexto.subirSlide(datosDeSubida({ autorId: ADMIN, visibilidad: "publico" }));

  assert.equal(resultado.ok, true);
  assert.equal(resultado.visibilidad, "por_revisar");
  assert.equal(registro.inserts[0].autor_id, AUTOR);
  assert.equal(registro.inserts[0].visibilidad, "por_revisar");
  assert.equal(registro.uploads[0].ruta, `${AUTOR}/qr-de-sesion/index.html`);
});

test("la portada se sube como WebP junto al HTML y su ruta va en la fila", async () => {
  const { contexto, registro } = harnessDeSubida({ sesion: SESION_ADMIN, admin: true });

  const resultado = await contexto.subirSlide(datosDeSubida({ portada: PORTADA }));

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(registro.uploads.map((u) => u.ruta)), [
    `${AUTOR}/qr-de-sesion/index.html`,
    `${AUTOR}/qr-de-sesion/portada.webp`,
  ]);
  assert.equal(registro.uploads[1].opciones.contentType, "image/webp");
  assert.equal(registro.inserts[0].portada_path, `${AUTOR}/qr-de-sesion/portada.webp`);
});

test("si el insert falla, se borran el HTML y la portada que ya se habían subido", async () => {
  const { contexto, registro } = harnessDeSubida({
    sesion: SESION_ADMIN,
    admin: true,
    opciones: { errorInsert: { code: "23505", message: "duplicate key" } },
  });

  const resultado = await contexto.subirSlide(datosDeSubida({ portada: PORTADA }));

  assert.equal(resultado.ok, false);
  assert.match(resultado.mensaje, /Ya existe una presentación con ese título/);
  assert.deepEqual(plano(registro.removes), [[
    `${AUTOR}/qr-de-sesion/index.html`,
    `${AUTOR}/qr-de-sesion/portada.webp`,
  ]]);
});

test("si falla la portada, se retira el HTML y no se inserta nada", async () => {
  const { contexto, registro } = harnessDeSubida({
    sesion: SESION_ADMIN,
    admin: true,
    opciones: { fallaUpload: { [`${AUTOR}/qr-de-sesion/portada.webp`]: { message: "boom", statusCode: "500" } } },
  });

  const resultado = await contexto.subirSlide(datosDeSubida({ portada: PORTADA }));

  assert.equal(resultado.ok, false);
  assert.equal(registro.inserts.length, 0);
  assert.deepEqual(plano(registro.removes), [[`${AUTOR}/qr-de-sesion/index.html`]]);
});

test("si el HTML ya existe en el bucket, avisa y no deja nada a medias", async () => {
  const { contexto, registro } = harnessDeSubida({
    sesion: SESION_ADMIN,
    admin: true,
    opciones: { fallaUpload: { [`${AUTOR}/qr-de-sesion/index.html`]: { message: "The resource already exists", statusCode: "409" } } },
  });

  const resultado = await contexto.subirSlide(datosDeSubida());

  assert.equal(resultado.ok, false);
  assert.match(resultado.mensaje, /Ya existe una presentación con ese título/);
  assert.equal(registro.inserts.length, 0);
  assert.equal(registro.removes.length, 0, "no borra un objeto que no subió él");
});

test("normaliza la categoría contra las existentes antes de guardarla", async () => {
  const { contexto, registro } = harnessDeSubida({ sesion: SESION_ADMIN, admin: true });

  await contexto.subirSlide(datosDeSubida({
    categoria: "  eventos ",
    categoriasExistentes: ["Charlas", "Eventos"],
  }));

  assert.equal(registro.inserts[0].categoria, "Eventos");
});

test("rechaza sin tocar la red lo que no pasa la validación", async () => {
  const { contexto, registro } = harnessDeSubida({ sesion: SESION_ADMIN, admin: true });

  const sinAutor = await contexto.subirSlide(datosDeSubida({ autorId: "" }));
  const sinLaminas = await contexto.subirSlide(datosDeSubida({ totalLaminas: 0 }));
  const sinCategoria = await contexto.subirSlide(datosDeSubida({ categoria: "  " }));

  for (const resultado of [sinAutor, sinLaminas, sinCategoria]) assert.equal(resultado.ok, false);
  assert.equal(registro.uploads.length, 0);
  assert.equal(registro.inserts.length, 0);
});

test("sin sesión o sin ser autor no sube nada", async () => {
  const sinSesion = harnessDeSubida({ sesion: null, admin: false });
  assert.equal((await sinSesion.contexto.subirSlide(datosDeSubida())).ok, false);
  assert.equal(sinSesion.registro.uploads.length, 0);

  // Con sesión pero ni administrador ni autor.
  const { cliente, registro } = crearCliente({
    sesion: SESION_AUTOR,
    rpcs: { es_autor_slides: { data: false, error: null } },
  });
  const { contexto } = crearHarness({ cliente, esAdmin: false });
  const resultado = await contexto.subirSlide(datosDeSubida());
  assert.equal(resultado.ok, false);
  assert.match(resultado.mensaje, /No tienes permiso/);
  assert.equal(registro.uploads.length, 0);
});

test("un fallo de RLS en el insert se explica y también deshace el HTML", async () => {
  const { contexto, registro } = harnessDeSubida({
    sesion: SESION_AUTOR,
    admin: false,
    opciones: { errorInsert: { code: "42501", message: "new row violates row-level security policy" } },
  });

  const resultado = await contexto.subirSlide(datosDeSubida());

  assert.equal(resultado.ok, false);
  assert.match(resultado.mensaje, /No tienes permiso/);
  assert.equal(registro.removes.length, 1);
});

/* ------------------------------------------------------------------ */
/* Publicar, autores, categorías y portadas                            */
/* ------------------------------------------------------------------ */

test("publicarSlide pasa la fila a público", async () => {
  const { cliente, registro } = crearCliente({ sesion: SESION_ADMIN });
  const { contexto } = crearHarness({ cliente });

  const resultado = await contexto.publicarSlide("abc");

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(registro.updates), [{ valores: { visibilidad: "publico" }, columna: "id", valor: "abc" }]);
});

test("publicarSlide avisa si la RLS no dejó tocar ninguna fila", async () => {
  const { cliente } = crearCliente({ sesion: SESION_AUTOR, updateData: [] });
  const { contexto } = crearHarness({ cliente });

  const resultado = await contexto.publicarSlide("abc");

  assert.equal(resultado.ok, false);
  assert.match(resultado.mensaje, /administrador/);
});

test("cargarAutoresDeSlides arma el nombre completo", async () => {
  const { cliente } = crearCliente({
    rpcs: { listar_autores_slides: { data: [{ id: AUTOR, nombre: "Ana", apellidos: "Uno" }, { id: ADMIN, nombre: "Beto", apellidos: null }], error: null } },
  });
  const { contexto } = crearHarness({ cliente });

  const resultado = await contexto.cargarAutoresDeSlides();

  assert.equal(resultado.ok, true);
  assert.deepEqual(plano(resultado.autores), [
    { id: AUTOR, nombre: "Ana Uno" },
    { id: ADMIN, nombre: "Beto" },
  ]);
});

test("cargarCategoriasDeSlides devuelve sólo los nombres", async () => {
  const { cliente } = crearCliente({
    rpcs: { categorias_slides: { data: [{ categoria: "Eventos" }, { categoria: "Datos" }], error: null } },
  });
  const { contexto } = crearHarness({ cliente });

  assert.deepEqual(plano(await contexto.cargarCategoriasDeSlides()), { ok: true, categorias: ["Eventos", "Datos"] });
});

test("firmarPortadasDeSlides pide todas las URLs en una sola llamada y sin repetir rutas", async () => {
  const { cliente, registro } = crearCliente();
  const { contexto } = crearHarness({ cliente });

  const urls = await contexto.firmarPortadasDeSlides([
    { portada_path: "a/x/portada.webp" },
    { portada_path: "a/x/portada.webp" },
    { portada_path: "" },
    { slug: "sin-portada" },
    { portada_path: "b/y/portada.webp" },
  ]);

  assert.equal(registro.firmadas.length, 1);
  assert.deepEqual(plano(registro.firmadas[0].rutas), ["a/x/portada.webp", "b/y/portada.webp"]);
  assert.equal(urls.get("a/x/portada.webp"), "https://firmada.test/a/x/portada.webp");
});

test("firmarPortadasDeSlides no llama a la red si no hay portadas subidas", async () => {
  const { cliente, registro } = crearCliente();
  const { contexto } = crearHarness({ cliente });

  const urls = await contexto.firmarPortadasDeSlides([{ slug: "a" }]);

  assert.equal(urls.size, 0);
  assert.equal(registro.firmadas.length, 0);
});
