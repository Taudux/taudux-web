/*
  obtenerPerfil() de auth.service.js, ejecutado de verdad contra un cliente de
  Supabase falso. El resto de la suite lee esta función como TEXTO —qué
  columnas nombra, en qué orden— y eso alcanza para fijar un select, pero no
  para fijar una rama de recuperación: un grep de "42703" pasa igual si el
  único "42703" que queda está en un comentario. Acá se ejecuta.

  Lo que se protege: esta lectura la usan navbar, portal, Mi ficha y el
  roster, y las migraciones de este proyecto se aplican A MANO mientras el
  front despliega solo. Un front que llegue antes que la 0038 recibe 42703 por
  `es_colaborador`/`slug`; sin el reintento angosto, obtenerPerfil() devuelve
  null para todo usuario logueado en toda página.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const FUENTE = fs.readFileSync("src/app/core/auth/auth.service.js", "utf8");

const SESION = Object.freeze({ user: { id: "11111111-1111-4111-8111-111111111111" } });

const PERFIL_BASE = Object.freeze({
  nombre: "Valeria",
  apellidos: "Ortiz",
  telefono: "4420000000",
  rol: "usuario",
  avisos_curso_nuevo: true,
});
const COLUMNAS_0038 = Object.freeze({ es_colaborador: true, slug: "valeria-ortiz" });

/*
  Cliente falso: registra cada select y responde según lo que pidió. `sin0038`
  reproduce una base donde la migración todavía no se aplicó —PostgREST
  contesta 42703 a la columna que no existe—.
*/
function crearContexto({ sin0038 = false, errorFijo = null } = {}) {
  const selects = [];
  const errores = [];
  const contexto = {
    console: { error: (...args) => errores.push(args) },
    window: { location: {} },
    supabaseClient: {
      from() { return this; },
      select(columnas) {
        selects.push(columnas);
        this._columnas = columnas;
        return this;
      },
      eq() { return this; },
      async single() {
        if (errorFijo) return { data: null, error: errorFijo };
        const pideNuevas = this._columnas.includes("es_colaborador");
        if (pideNuevas && sin0038) {
          return {
            data: null,
            error: { code: "42703", message: 'column perfiles.es_colaborador does not exist' },
          };
        }
        return { data: pideNuevas ? { ...PERFIL_BASE, ...COLUMNAS_0038 } : { ...PERFIL_BASE }, error: null };
      },
    },
  };
  vm.createContext(contexto);
  vm.runInContext(FUENTE, contexto);
  return { contexto, selects, errores };
}

const llamar = (opciones) => {
  const arnes = crearContexto(opciones);
  arnes.contexto.__sesion = SESION;
  return { arnes, perfil: vm.runInContext("obtenerPerfil(__sesion)", arnes.contexto) };
};

test("with the 0038 applied it reads everything in a single query", async () => {
  const { arnes, perfil } = llamar();
  const datos = await perfil;

  assert.equal(arnes.selects.length, 1, "no puede haber consulta de más");
  assert.equal(datos.es_colaborador, true);
  assert.equal(datos.slug, "valeria-ortiz");
  assert.equal(datos.nombre, "Valeria");
  assert.deepEqual(arnes.errores, [], "el camino feliz no escribe en la consola");
});

/*
  EL TEST QUE FALTABA, y el que dos mutantes sobrevivieron hasta que se
  escribió: con la 0038 sin aplicar, el perfil TIENE que seguir llegando.
*/
test("a missing 0038 column falls back to the narrow read instead of losing the whole profile", async () => {
  const { arnes, perfil } = llamar({ sin0038: true });
  const datos = await perfil;

  assert.notEqual(datos, null, "obtenerPerfil no puede devolver null por dos columnas");
  assert.equal(datos.nombre, "Valeria");
  assert.equal(datos.rol, "usuario");
  assert.equal(datos.avisos_curso_nuevo, true, "el portal necesita esta columna");

  // Las dos ausentes llegan como null y no como undefined: quien las lee
  // pregunta `=== true`, y el roster ya sabe tratar una cuenta sin slug.
  assert.equal(datos.es_colaborador, null);
  assert.equal(datos.slug, null);

  assert.equal(arnes.selects.length, 2, "tiene que haber ancha y luego angosta");
  assert.equal(arnes.selects[0].includes("es_colaborador"), true);
  assert.equal(arnes.selects[1].includes("es_colaborador"), false, "la angosta no puede volver a pedirla");
  assert.equal(arnes.errores.length, 1, "la degradación se registra, no se esconde");
});

/*
  Y el reintento es SOLO para la columna ausente. Un fallo de red, de sesión o
  de RLS fallaría igual en la consulta angosta: reintentarlo es una consulta
  de más en cada carga de cada página, y encima puede devolver un perfil a
  medias donde correspondía no devolver ninguno.
*/
test("any other error is not retried", async () => {
  for (const error of [
    { code: "PGRST301", message: "JWT expired" },
    { code: "42501", message: "permission denied" },
    { code: undefined, message: "Failed to fetch" },
  ]) {
    const { arnes, perfil } = llamar({ errorFijo: error });
    assert.equal(await perfil, null, `${error.code}: tiene que devolver null`);
    assert.equal(arnes.selects.length, 1, `${error.code}: no puede reintentar`);
  }
});

test("no session means no query at all", async () => {
  for (const sesion of [null, undefined, {}, { user: {} }]) {
    const arnes = crearContexto();
    arnes.contexto.__sesion = sesion;
    assert.equal(await vm.runInContext("obtenerPerfil(__sesion)", arnes.contexto), null);
    assert.equal(arnes.selects.length, 0, JSON.stringify(sesion));
  }
});
