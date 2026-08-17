/*
  Panel "Tus datos" del sandbox de SQL: pegar una tabla desde Excel o generarla, y
  crearla en la base para poder consultarla. Toda la lógica de convertir datos en
  SQL vive en practica.datos.js (puro y probado); acá solo hay DOM.

  Se expone configurarPanelDeDatos(dependencias) para no acoplarse al runtime:
  practica.js le pasa cómo ejecutar SQL y cómo escribir en el editor.

  Decisión de diseño: "Ver SQL" escribe el CREATE/INSERT generado en el editor en
  vez de esconderlo. El alumno vino a aprender SQL — mostrarle el que se escribió
  por él es parte del ejercicio, no un detalle de implementación.
*/

const COLUMNAS_SINTETICAS_INICIALES = [
  { nombre: "cliente", generador: "nombre" },
  { nombre: "region", generador: "categoria" },
  { nombre: "monto", generador: "decimal" },
];

const FILAS_VISTA_PREVIA = 5;

/*
  Borra todas las tablas del esquema público en una sola sentencia. Se hace con un
  bloque DO y no listando desde JavaScript para que "vaciar" sea atómico: a media
  lista, un error dejaría la base en un estado que el alumno no pidió.
*/
const SQL_VACIAR_BASE = `
do $$
declare fila record;
begin
  for fila in (select tablename from pg_tables where schemaname = 'public') loop
    execute format('drop table if exists %I cascade', fila.tablename);
  end loop;
end
$$;`;

const SQL_LISTAR_TABLAS = `
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;`;

function configurarPanelDeDatos({ ejecutarSql, escribirEnEditor }) {
  const panel = document.getElementById("practicaDatos");
  const nombreTabla = document.getElementById("practicaTablaNombre");
  const areaPegado = document.getElementById("practicaPegado");
  const contenedorColumnas = document.getElementById("practicaColumnasSinteticas");
  const cantidadFilas = document.getElementById("practicaFilasSinteticas");
  const vistaPrevia = document.getElementById("practicaVistaPrevia");
  const estado = document.getElementById("practicaDatosEstado");
  const tablasActuales = document.getElementById("practicaTablasActuales");
  const bloquePegar = document.getElementById("practicaModoPegar");
  const bloqueGenerar = document.getElementById("practicaModoGenerar");

  let modo = "pegar";
  let semilla = 1;

  function anunciar(texto, tono = "info") {
    estado.textContent = texto;
    estado.className = `practica__datos-estado practica__datos-estado--${tono}`;
    estado.hidden = !texto;
  }

  /* --- Columnas del generador ------------------------------------- */

  function crearFilaDeColumna(columna) {
    const fila = document.createElement("div");
    fila.className = "practica__columna-sintetica";

    const nombre = document.createElement("input");
    nombre.className = "field";
    nombre.type = "text";
    nombre.value = columna.nombre;
    nombre.setAttribute("aria-label", "Nombre de la columna");

    const tipo = document.createElement("select");
    tipo.className = "field";
    tipo.setAttribute("aria-label", "Tipo de dato");
    for (const generador of GENERADORES_SINTETICOS) {
      const opcion = document.createElement("option");
      opcion.value = generador.id;
      opcion.textContent = generador.etiqueta;
      if (generador.id === columna.generador) opcion.selected = true;
      tipo.appendChild(opcion);
    }

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "practica__quitar-columna";
    quitar.textContent = "✕";
    quitar.setAttribute("aria-label", `Quitar la columna ${columna.nombre}`);
    quitar.addEventListener("click", () => {
      // Una tabla sin columnas no existe: siempre queda al menos una.
      if (contenedorColumnas.children.length <= 1) {
        anunciar("La tabla necesita al menos una columna.", "aviso");
        return;
      }
      fila.remove();
      refrescarVistaPrevia();
    });

    nombre.addEventListener("input", refrescarVistaPrevia);
    tipo.addEventListener("change", refrescarVistaPrevia);

    fila.append(nombre, tipo, quitar);
    return fila;
  }

  function leerColumnasSinteticas() {
    return Array.from(contenedorColumnas.children).map((fila, indice) => ({
      nombre: fila.querySelector("input").value || `columna_${indice + 1}`,
      generador: fila.querySelector("select").value,
    }));
  }

  /* --- Vista previa ----------------------------------------------- */

  function obtenerTablaActual() {
    if (modo === "pegar") return analizarTablaPegada(areaPegado.value);

    return generarDatosSinteticos({
      columnas: leerColumnasSinteticas(),
      filas: Number(cantidadFilas.value),
      semilla,
    });
  }

  function pintarVistaPrevia(tabla) {
    vistaPrevia.replaceChildren();
    if (!tabla || tabla.columnas.length === 0) return;

    const contenedor = document.createElement("div");
    contenedor.className = "practica__tabla-scroll";

    const elemento = document.createElement("table");
    elemento.className = "practica__tabla";

    const encabezado = document.createElement("tr");
    for (const columna of tabla.columnas) {
      const celda = document.createElement("th");
      celda.scope = "col";

      const nombre = document.createElement("span");
      nombre.textContent = columna.nombre;

      // El tipo inferido se muestra: es la información que le permite al alumno
      // entender por qué sum() funciona en una columna y no en otra.
      const tipo = document.createElement("span");
      tipo.className = "practica__tipo-columna";
      tipo.textContent = columna.tipo;

      celda.append(nombre, tipo);
      encabezado.appendChild(celda);
    }

    const cuerpo = document.createElement("tbody");
    for (const fila of tabla.filas.slice(0, FILAS_VISTA_PREVIA)) {
      const elementoFila = document.createElement("tr");
      for (const valor of fila) {
        const celda = document.createElement("td");
        celda.textContent = valor === "" ? "NULL" : valor;
        elementoFila.appendChild(celda);
      }
      cuerpo.appendChild(elementoFila);
    }

    const cabecera = document.createElement("thead");
    cabecera.appendChild(encabezado);
    elemento.append(cabecera, cuerpo);
    contenedor.appendChild(elemento);
    vistaPrevia.appendChild(contenedor);

    const pie = document.createElement("p");
    pie.className = "practica__tabla-pie";
    pie.textContent =
      tabla.filas.length > FILAS_VISTA_PREVIA
        ? `Vista previa de ${FILAS_VISTA_PREVIA} de ${tabla.filas.length} filas.`
        : `${tabla.filas.length} ${tabla.filas.length === 1 ? "fila" : "filas"}.`;
    vistaPrevia.appendChild(pie);
  }

  function refrescarVistaPrevia() {
    const tabla = obtenerTablaActual();

    if (tabla.error) {
      vistaPrevia.replaceChildren();
      // Pegar nada todavía no es un error que valga la pena gritar.
      anunciar(areaPegado.value.trim() === "" ? "" : tabla.error, "aviso");
      return;
    }

    anunciar("");
    pintarVistaPrevia(tabla);
  }

  /* --- Acciones ---------------------------------------------------- */

  async function listarTablas() {
    const resultado = await ejecutarSql(SQL_LISTAR_TABLAS);
    if (!resultado || !resultado.ok) return;

    const nombres = (resultado.tablas[0]?.filas || []).map(([nombre]) => nombre);
    tablasActuales.replaceChildren();

    if (nombres.length === 0) {
      tablasActuales.textContent = "La base está vacía.";
      return;
    }

    const etiqueta = document.createElement("span");
    etiqueta.textContent = "Tablas en la base: ";
    tablasActuales.appendChild(etiqueta);

    for (const nombre of nombres) {
      const chip = document.createElement("code");
      chip.className = "practica__chip-tabla";
      chip.textContent = nombre;
      tablasActuales.appendChild(chip);
    }
  }

  function construirSqlActual() {
    const tabla = obtenerTablaActual();
    if (tabla.error) {
      anunciar(tabla.error, "error");
      return null;
    }
    return construirSentenciasTabla({
      nombre: nombreTabla.value,
      columnas: tabla.columnas,
      filas: tabla.filas,
    });
  }

  async function crearTabla() {
    const sql = construirSqlActual();
    if (!sql) return;

    anunciar("Creando la tabla…");
    const resultado = await ejecutarSql(sql);

    if (!resultado) return;
    if (!resultado.ok) {
      anunciar(resultado.error || "No se pudo crear la tabla.", "error");
      return;
    }

    const filas = obtenerTablaActual().filas.length;
    anunciar(
      `Tabla "${normalizarNombreIdentificador(nombreTabla.value, "datos")}" creada con ${filas} ${filas === 1 ? "fila" : "filas"}. Ya puedes consultarla.`,
      "exito",
    );
    await listarTablas();
  }

  async function vaciarBase() {
    anunciar("Vaciando la base…");
    const resultado = await ejecutarSql(SQL_VACIAR_BASE);

    if (!resultado) return;
    anunciar(resultado.ok ? "Base vaciada." : resultado.error || "No se pudo vaciar.", resultado.ok ? "exito" : "error");
    await listarTablas();
  }

  function verSql() {
    const sql = construirSqlActual();
    if (!sql) return;
    escribirEnEditor(sql);
    anunciar("El SQL de carga está en el editor. Ejecútalo para crear la tabla.", "info");
  }

  function cambiarModo(nuevoModo) {
    modo = nuevoModo;
    bloquePegar.hidden = nuevoModo !== "pegar";
    bloqueGenerar.hidden = nuevoModo !== "generar";

    for (const boton of panel.querySelectorAll("[data-modo]")) {
      const activo = boton.dataset.modo === nuevoModo;
      boton.classList.toggle("practica__modo--activo", activo);
      boton.setAttribute("aria-selected", activo ? "true" : "false");
    }

    refrescarVistaPrevia();
  }

  /* --- Montaje ----------------------------------------------------- */

  for (const columna of COLUMNAS_SINTETICAS_INICIALES) {
    contenedorColumnas.appendChild(crearFilaDeColumna(columna));
  }

  document.getElementById("practicaAgregarColumna").addEventListener("click", () => {
    contenedorColumnas.appendChild(
      crearFilaDeColumna({ nombre: `columna_${contenedorColumnas.children.length + 1}`, generador: "entero" }),
    );
    refrescarVistaPrevia();
  });

  document.getElementById("practicaCrearTabla").addEventListener("click", crearTabla);
  document.getElementById("practicaVerSql").addEventListener("click", verSql);
  document.getElementById("practicaVaciarBase").addEventListener("click", vaciarBase);
  document.getElementById("practicaRegenerar").addEventListener("click", () => {
    // Otra semilla = otro conjunto de datos con la misma forma.
    semilla += 1;
    refrescarVistaPrevia();
  });

  areaPegado.addEventListener("input", refrescarVistaPrevia);
  cantidadFilas.addEventListener("input", refrescarVistaPrevia);
  for (const boton of panel.querySelectorAll("[data-modo]")) {
    boton.addEventListener("click", () => cambiarModo(boton.dataset.modo));
  }

  cambiarModo("pegar");

  return {
    mostrar(visible) {
      panel.hidden = !visible;
      if (visible) refrescarVistaPrevia();
    },
    listarTablas,
  };
}
