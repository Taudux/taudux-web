/*
  Catálogo de lenguajes del playground y resolución de cuál está activo según el
  hash de la URL. Sin DOM y sin efectos, así que Node puede requerirlo en los
  tests igual que portal.secciones.js.

  Este archivo es la única fuente de verdad de qué runtime se descarga para cada
  lenguaje. Los workers no conocen ninguna URL: la reciben en el mensaje de carga
  desde el hilo principal, que la lee de acá. Así, subir de versión un intérprete
  es tocar una línea de este archivo y nada más.

  Las versiones están PINEADAS a propósito, nunca `@latest`. Estos runtimes pesan
  decenas de MB y publican cambios que rompen: con `@latest`, el CDN podría tumbar
  la página en producción un martes sin que nadie del equipo hubiera tocado el
  repo. Hay un test que falla si alguna URL vuelve a quedar flotante.
*/

/*
  Notas de por qué cada runtime es el que es:

  - Python: Pyodide es CPython de verdad compilado a WebAssembly, no un subconjunto.
    Trae numpy/pandas/matplotlib precompilados, que es justo lo que se enseña acá.
  - SQL: PGlite es Postgres real. Se eligió sobre SQLite y DuckDB para que el
    dialecto que practica el alumno sea el mismo que corre en el Supabase de Taudux.
  - R: webR es la única implementación de R en el navegador; no hay alternativa que
    comparar.
*/
const LENGUAJES_PRACTICA = [
  {
    id: "python",
    etiqueta: "Python",
    version: "3.14",
    descripcion: "CPython compilado a WebAssembly, con numpy, pandas y matplotlib.",
    modoEditor: "ace/mode/python",
    /*
      Script .py, nunca .ipynb: la práctica apunta a lo fundacional, y un notebook
      es un JSON con celdas y metadatos que además no se puede volver a abrir acá.
    */
    archivo: "practica.py",
    runtime: {
      url: "https://cdn.jsdelivr.net/pyodide/v314.0.4/full/pyodide.mjs",
      // Pyodide descarga la biblioteca estándar y los paquetes relativos a esta
      // carpeta, así que apunta al mismo release que la URL de arriba.
      indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.4/full/",
    },
    ejemplo: `# Python de verdad, corriendo dentro de tu navegador.
# Ejecuta con el boton "Ejecutar" o con Ctrl + Enter.

ventas = {"Consultoria": 15000, "Capacitacion": 8500, "Soporte": 3200}

total = sum(ventas.values())
for producto, monto in sorted(ventas.items(), key=lambda par: -par[1]):
    print(f"{producto:<15} {monto:>8,}  ({monto / total:.1%})")

print(f"\\nTotal: {total:,}")
`,
  },
  {
    id: "sql",
    etiqueta: "SQL",
    version: "PostgreSQL",
    descripcion: "Postgres real en WebAssembly: el mismo dialecto que usamos en producción.",
    modoEditor: "ace/mode/pgsql",
    archivo: "consulta.sql",
    runtime: {
      url: "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.5/dist/index.js",
    },
    ejemplo: `-- Postgres de verdad, corriendo dentro de tu navegador.
-- La base vive solo en esta pestana: puedes romper lo que quieras.

-- El drop hace que puedas volver a ejecutar todo esto las veces que quieras:
-- la base recuerda las tablas entre una corrida y la siguiente.
drop table if exists ventas;

create table ventas (
  id       serial primary key,
  producto text           not null,
  region   text           not null,
  monto    numeric(10, 2) not null
);

insert into ventas (producto, region, monto) values
  ('Consultoria',  'Norte',  15000.00),
  ('Consultoria',  'Sur',     9800.00),
  ('Capacitacion', 'Norte',   8500.50),
  ('Soporte',      'Sur',     3200.00);

select
  region,
  count(*)   as operaciones,
  sum(monto) as ingresos
from ventas
group by region
order by ingresos desc;
`,
  },
  {
    id: "r",
    etiqueta: "R",
    version: "4.6.0",
    descripcion: "R compilado a WebAssembly por el proyecto webR.",
    modoEditor: "ace/mode/r",
    // .R con mayúscula: es la convención de R para scripts.
    archivo: "practica.R",
    runtime: {
      url: "https://webr.r-wasm.org/v0.6.0/webr.mjs",
    },
    ejemplo: `# R de verdad, corriendo dentro de tu navegador.

ventas <- data.frame(
  producto = c("Consultoria", "Consultoria", "Capacitacion", "Soporte"),
  region   = c("Norte", "Sur", "Norte", "Sur"),
  monto    = c(15000, 9800, 8500.5, 3200)
)

print(summary(ventas$monto))
print(aggregate(monto ~ region, data = ventas, FUN = sum))
`,
  },
];

/*
  El trim va ANTES de recortar el "#": con el orden inverso, un hash con espacios
  al inicio conserva el numeral y no matchea ningún lenguaje.
*/
function normalizarIdLenguaje(hash) {
  if (typeof hash !== "string") return "";
  return hash.trim().replace(/^#/, "").trim().toLowerCase();
}

/*
  Nunca devuelve undefined, misma regla que resolverSeccionActiva en el portal: un
  hash basura (`#<script>`) no matchea ningún id y cae al primer lenguaje, en vez
  de dejar el playground sin editor y sin explicación.
*/
function resolverLenguajeActivo(hash, lenguajes = LENGUAJES_PRACTICA) {
  const disponibles = Array.isArray(lenguajes) && lenguajes.length > 0 ? lenguajes : LENGUAJES_PRACTICA;
  const candidato = normalizarIdLenguaje(hash);
  const encontrado = disponibles.find((lenguaje) => lenguaje.id === candidato);
  return encontrado || disponibles[0];
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    LENGUAJES_PRACTICA,
    normalizarIdLenguaje,
    resolverLenguajeActivo,
  });
}
