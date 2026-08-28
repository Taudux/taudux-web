/*
  Vista "Base de datos" del entorno de SQL: crear tablas, cambiarles la estructura
  y editar sus filas a mano, sin escribir una línea de SQL.

  POR QUÉ ES UNA VISTA APARTE. Manipular el esquema y consultarlo son dos modos de
  trabajo distintos, y mezclarlos en una sola pantalla obliga a que todo conviva:
  el editor se encoge, el diseñador queda espachurrado y ninguna de las dos cosas
  se hace cómoda. Separadas, cada una ocupa la pantalla entera cuando le toca.

  Toda la generación de SQL vive en practica.datos.js, que es puro y está probado.
  Acá solo hay DOM y llamadas.

  Se apoya en ctid para identificar filas: las tablas del diseñador no llevan
  clave primaria —obligar a modelar un id antes de poder practicar sería absurdo—
  y ctid es el identificador físico que Postgres le da a cada tupla. Ver el
  comentario de sentenciaActualizarCelda.
*/

const FILAS_EDITABLES_MAXIMAS = 200;

const SQL_LISTAR_TABLAS_BASE = `
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;`;

/*
  Un bloque DO en vez de listar y borrar desde JavaScript: así "vaciar" es una
  sola operación, y a media lista un error no puede dejar la base en un estado
  que nadie pidió.
*/
const SQL_VACIAR_BASE_COMPLETA = `
do $$
declare fila record;
begin
  for fila in (select tablename from pg_tables where schemaname = 'public') loop
    execute format('drop table if exists %I cascade', fila.tablename);
  end loop;
end
$$;`;

function montarVistaBaseDeDatos({ ejecutarSql, escribirEnEditor }) {
  const raiz = document.getElementById("practicaBase");
  if (!raiz) return null;

  const listaTablas = document.getElementById("practicaBaseTablas");
  const detalle = document.getElementById("practicaBaseDetalle");
  const estado = document.getElementById("practicaBaseEstado");

  let tablaActiva = null;
  let columnasActivas = [];

  function anunciar(texto, tono = "info") {
    estado.textContent = texto;
    estado.className = `practica__base-estado practica__base-estado--${tono}`;
    estado.hidden = !texto;
  }

  function boton(texto, clase, alHacerClick, titulo) {
    const elemento = document.createElement("button");
    elemento.type = "button";
    elemento.className = clase;
    elemento.textContent = texto;
    if (titulo) elemento.title = titulo;
    elemento.addEventListener("click", alHacerClick);
    return elemento;
  }

  /*
    Estilo propio en vez de la clase `.field` compartida: esa hoja está calibrada
    para formularios de auth (padding de 1rem) y acá los campos van en grillas
    densas, donde ese alto convierte cualquier tabla en un muro.
  */
  function campoTexto(valor, etiqueta) {
    const entrada = document.createElement("input");
    entrada.type = "text";
    entrada.className = "practica__entrada";
    entrada.value = valor;
    entrada.autocomplete = "off";
    entrada.setAttribute("aria-label", etiqueta);
    return entrada;
  }

  function selectorDeTipo(seleccionado) {
    const selector = document.createElement("select");
    selector.className = "practica__entrada practica__entrada--selector";
    selector.setAttribute("aria-label", "Tipo de dato");

    for (const tipo of TIPOS_COLUMNA_SQL) {
      const opcion = document.createElement("option");
      opcion.value = tipo.id;
      opcion.textContent = tipo.etiqueta;
      if (tipo.id === seleccionado) opcion.selected = true;
      selector.appendChild(opcion);
    }
    return selector;
  }

  /* --- Lectura del estado real de la base -------------------------- */

  async function correr(sql, mensajeExito) {
    if (!sql) return false;

    const resultado = await ejecutarSql(sql);
    if (!resultado) return false;

    if (!resultado.ok) {
      anunciar(resultado.error || "No se pudo completar la operación.", "error");
      return false;
    }

    if (mensajeExito) anunciar(mensajeExito, "exito");
    return true;
  }

  async function consultar(sql) {
    const resultado = await ejecutarSql(sql);
    if (!resultado || !resultado.ok) return null;
    return resultado.tablas[0] || null;
  }

  async function refrescarTablas() {
    const tabla = await consultar(SQL_LISTAR_TABLAS_BASE);
    const nombres = tabla ? tabla.filas.map(([nombre]) => nombre) : [];

    listaTablas.replaceChildren();

    if (nombres.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "practica__base-vacio";
      vacio.textContent = "La base está vacía. Crea tu primera tabla.";
      listaTablas.appendChild(vacio);
      tablaActiva = null;
      await pintarDetalle();
      return;
    }

    // Si la tabla abierta desapareció (la borró el alumno desde SQL), se cae a la primera.
    if (!nombres.includes(tablaActiva)) tablaActiva = nombres[0];

    for (const nombre of nombres) {
      const chip = boton(
        nombre,
        `practica__base-tabla${nombre === tablaActiva ? " practica__base-tabla--activa" : ""}`,
        async () => {
          tablaActiva = nombre;
          await refrescarTablas();
        },
      );
      chip.setAttribute("aria-pressed", nombre === tablaActiva ? "true" : "false");
      listaTablas.appendChild(chip);
    }

    await pintarDetalle();
  }

  async function leerColumnas(nombreTabla) {
    const tabla = await consultar(`
      select column_name, data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = '${nombreTabla}'
      order by ordinal_position;`);

    if (!tabla) return [];
    return tabla.filas.map(([nombre, tipo]) => ({ nombre, tipo }));
  }

  /* --- Estructura --------------------------------------------------- */

  function seccion(titulo) {
    const elemento = document.createElement("section");
    elemento.className = "practica__base-seccion";

    const encabezado = document.createElement("h3");
    encabezado.className = "practica__base-subtitulo";
    encabezado.textContent = titulo;
    elemento.appendChild(encabezado);

    return elemento;
  }

  function pintarEstructura(contenedor) {
    const bloque = seccion(`Estructura de "${tablaActiva}"`);

    const grilla = document.createElement("div");
    grilla.className = "practica__base-columnas";

    for (const columna of columnasActivas) {
      const fila = document.createElement("div");
      fila.className = "practica__base-columna practica__base-columna--fija";

      const nombre = document.createElement("code");
      nombre.textContent = columna.nombre;

      const tipo = document.createElement("span");
      tipo.className = "practica__tipo-columna";
      tipo.textContent = columna.tipo;

      const quitar = boton("✕", "practica__quitar-columna", async () => {
        /*
          Eliminar una columna borra sus datos y no hay deshacer: se confirma.
          Es la única acción del diseñador que destruye información sin que el
          alumno pueda reconstruirla desde la pantalla.
        */
        if (!window.confirm(`¿Eliminar la columna "${columna.nombre}" y todos sus datos?`)) return;
        if (await correr(sentenciaEliminarColumna(tablaActiva, columna.nombre), "Columna eliminada.")) {
          await refrescarTablas();
        }
      }, `Eliminar la columna ${columna.nombre}`);

      fila.append(nombre, tipo, quitar);
      grilla.appendChild(fila);
    }

    bloque.appendChild(grilla);

    const alta = document.createElement("form");
    alta.className = "practica__base-alta";

    const nombreNuevo = campoTexto("", "Nombre de la columna nueva");
    nombreNuevo.placeholder = "nombre de la columna";
    const tipoNuevo = selectorDeTipo("text");

    /*
      Es un <form> para que Enter en el campo también agregue la columna. Y por
      eso el botón tiene que ser type="submit": el helper `boton` los crea como
      type="button", que dentro de un formulario no dispara nada.
    */
    const enviar = boton("Agregar columna", "button button--outline", () => {});
    enviar.type = "submit";

    alta.append(nombreNuevo, tipoNuevo, enviar);
    alta.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (!nombreNuevo.value.trim()) {
        anunciar("Ponle un nombre a la columna.", "aviso");
        return;
      }
      const sql = sentenciaAgregarColumna(tablaActiva, {
        nombre: nombreNuevo.value,
        tipo: tipoNuevo.value,
      });
      if (await correr(sql, "Columna agregada.")) {
        nombreNuevo.value = "";
        await refrescarTablas();
      }
    });

    bloque.appendChild(alta);
    contenedor.appendChild(bloque);
  }

  /* --- Filas --------------------------------------------------------- */

  async function pintarFilas(contenedor) {
    const bloque = seccion("Filas");

    const datos = await consultar(
      `select ctid, * from "${tablaActiva}" limit ${FILAS_EDITABLES_MAXIMAS};`,
    );

    if (!datos || columnasActivas.length === 0) {
      contenedor.appendChild(bloque);
      return;
    }

    const marco = document.createElement("div");
    marco.className = "practica__tabla-scroll";

    const tabla = document.createElement("table");
    tabla.className = "practica__tabla practica__tabla--editable";

    const encabezado = document.createElement("tr");
    for (const columna of columnasActivas) {
      const celda = document.createElement("th");
      celda.scope = "col";
      celda.textContent = columna.nombre;
      encabezado.appendChild(celda);
    }
    encabezado.appendChild(document.createElement("th"));

    const cabecera = document.createElement("thead");
    cabecera.appendChild(encabezado);

    const cuerpo = document.createElement("tbody");
    for (const fila of datos.filas) {
      // La primera columna del select es el ctid; el resto va en el orden del esquema.
      const ctid = fila[0];
      const elementoFila = document.createElement("tr");

      columnasActivas.forEach((columna, indice) => {
        const celda = document.createElement("td");
        const valor = fila[indice + 1];

        const entrada = campoTexto(valor === "NULL" ? "" : valor, `${columna.nombre} de la fila`);
        entrada.className = "practica__celda";
        entrada.placeholder = "NULL";

        /*
          Se guarda al salir del campo y solo si cambió: escribir en cada tecla
          dispararía un UPDATE por letra.
        */
        entrada.addEventListener("change", async () => {
          const sql = sentenciaActualizarCelda(
            tablaActiva, ctid, columna.nombre, entrada.value, columna.tipo,
          );
          if (!sql) {
            anunciar("No se pudo identificar la fila; recarga la tabla.", "error");
            return;
          }
          if (await correr(sql, "Celda actualizada.")) await refrescarTablas();
        });

        celda.appendChild(entrada);
        elementoFila.appendChild(celda);
      });

      const acciones = document.createElement("td");
      acciones.appendChild(
        boton("✕", "practica__quitar-columna", async () => {
          if (await correr(sentenciaEliminarFila(tablaActiva, ctid), "Fila eliminada.")) {
            await refrescarTablas();
          }
        }, "Eliminar esta fila"),
      );
      elementoFila.appendChild(acciones);

      cuerpo.appendChild(elementoFila);
    }

    tabla.append(cabecera, cuerpo);
    marco.appendChild(tabla);
    bloque.appendChild(marco);

    if (datos.truncada || datos.totalFilas >= FILAS_EDITABLES_MAXIMAS) {
      const aviso = document.createElement("p");
      aviso.className = "practica__tabla-pie";
      aviso.textContent = `Se editan las primeras ${FILAS_EDITABLES_MAXIMAS} filas. El resto sigue ahí y se consulta desde SQL.`;
      bloque.appendChild(aviso);
    }

    bloque.appendChild(
      boton("Agregar fila vacía", "button button--outline", async () => {
        const sql = sentenciaInsertarFila(
          tablaActiva,
          columnasActivas,
          columnasActivas.map(() => ""),
        );
        if (await correr(sql, "Fila agregada.")) await refrescarTablas();
      }),
    );

    contenedor.appendChild(bloque);
  }

  /* --- Cargar datos en lote ------------------------------------------ */

  function pintarCarga(contenedor) {
    const bloque = seccion("Cargar datos en lote");

    const explicacion = document.createElement("p");
    explicacion.className = "practica__base-nota";
    explicacion.textContent =
      "Importa un CSV, arrástralo aquí, o pega directamente lo que tengas copiado de Excel.";
    bloque.appendChild(explicacion);

    // Etiqueta distinta de la del creador manual: dos campos con el mismo nombre
    // accesible en la misma pantalla son indistinguibles para un lector.
    const nombre = campoTexto("datos", "Nombre de la tabla importada");

    const pegado = document.createElement("textarea");
    pegado.className = "practica__entrada practica__entrada--area";
    pegado.rows = 6;
    pegado.spellcheck = false;
    pegado.placeholder = "producto,region,monto\nConsultoria,Norte,15000";
    pegado.setAttribute("aria-label", "Datos para pegar");

    const previa = document.createElement("div");

    /* --- Importar un archivo ---------------------------------------- */

    async function cargarArchivo(archivo) {
      if (!archivo) return;

      /*
        .xlsx no se lee acá: es un ZIP de XML y parsearlo exigiría una librería de
        cientos de kilobytes. Copiar y pegar desde Excel ya funciona —el pegado
        llega separado por tabuladores y el análisis lo detecta— así que el rodeo
        no vale su precio.
      */
      if (/\.(xlsx|xls)$/i.test(archivo.name)) {
        anunciar(
          "Los archivos de Excel no se leen directo. Guarda como CSV, o copia las celdas y pégalas aquí abajo.",
          "aviso",
        );
        return;
      }

      try {
        const bytes = new Uint8Array(await archivo.arrayBuffer());
        pegado.value = decodificarTextoImportado(bytes);
        // El nombre del archivo es el mejor candidato a nombre de la tabla.
        nombre.value = archivo.name.replace(/\.[^.]+$/, "");
        refrescarPrevia();
        anunciar(`"${archivo.name}" cargado. Revisa la vista previa y crea la tabla.`, "exito");
      } catch (error) {
        anunciar("No se pudo leer el archivo.", "error");
      }
    }

    const selectorArchivo = document.createElement("input");
    selectorArchivo.type = "file";
    selectorArchivo.accept = ".csv,.tsv,.txt,text/csv,text/plain";
    selectorArchivo.hidden = true;
    selectorArchivo.addEventListener("change", () => {
      cargarArchivo(selectorArchivo.files[0]);
      // Permite volver a elegir el mismo archivo después de corregirlo.
      selectorArchivo.value = "";
    });

    /*
      Soltar el archivo sobre el área de pegado es el gesto natural, así que se
      acepta además del botón. Sin preventDefault el navegador abandona la página
      para abrir el archivo, que es justo lo contrario de lo que se busca.
    */
    for (const evento of ["dragover", "dragenter"]) {
      pegado.addEventListener(evento, (suceso) => {
        suceso.preventDefault();
        pegado.classList.add("practica__entrada--soltar");
      });
    }
    for (const evento of ["dragleave", "drop"]) {
      pegado.addEventListener(evento, () => pegado.classList.remove("practica__entrada--soltar"));
    }
    pegado.addEventListener("drop", (suceso) => {
      suceso.preventDefault();
      cargarArchivo(suceso.dataTransfer?.files?.[0]);
    });

    function refrescarPrevia() {
      const analizada = analizarTablaPegada(pegado.value);
      previa.replaceChildren();
      if (analizada.error || analizada.columnas.length === 0) return;

      const resumen = document.createElement("p");
      resumen.className = "practica__tabla-pie";
      resumen.textContent = `${analizada.filas.length} filas · ${analizada.columnas
        .map((columna) => `${columna.nombre} (${columna.tipo})`)
        .join(", ")}`;
      previa.appendChild(resumen);
    }

    pegado.addEventListener("input", refrescarPrevia);

    const acciones = document.createElement("div");
    acciones.className = "practica__base-acciones";

    acciones.append(
      boton("Importar CSV", "button button--outline", () => selectorArchivo.click()),
      boton("Crear tabla con estos datos", "button button--glow", async () => {
        const analizada = analizarTablaPegada(pegado.value);
        if (analizada.error) {
          anunciar(analizada.error, "aviso");
          return;
        }
        const sql = construirSentenciasTabla({
          nombre: nombre.value,
          columnas: analizada.columnas,
          filas: analizada.filas,
        });
        if (await correr(sql, `Tabla creada con ${analizada.filas.length} filas.`)) {
          tablaActiva = normalizarNombreIdentificador(nombre.value, "datos");
          pegado.value = "";
          refrescarPrevia();
          await refrescarTablas();
        }
      }),
      boton("Ver el SQL", "button button--outline", () => {
        const analizada = analizarTablaPegada(pegado.value);
        if (analizada.error) {
          anunciar(analizada.error, "aviso");
          return;
        }
        escribirEnEditor(
          construirSentenciasTabla({
            nombre: nombre.value,
            columnas: analizada.columnas,
            filas: analizada.filas,
          }),
        );
        anunciar("El SQL quedó en el editor, en la vista SQL.", "info");
      }),
    );

    const campoNombre = document.createElement("div");
    campoNombre.className = "practica__campo practica__campo--corto";
    const etiquetaNombre = document.createElement("label");
    etiquetaNombre.textContent = "Nombre de la tabla";
    campoNombre.append(etiquetaNombre, nombre);

    bloque.append(campoNombre, pegado, previa, acciones, selectorArchivo);
    contenedor.appendChild(bloque);
  }

  /* --- Armado del detalle -------------------------------------------- */

  async function pintarDetalle() {
    detalle.replaceChildren();

    if (!tablaActiva) {
      pintarCreacion(detalle);
      pintarCarga(detalle);
      return;
    }

    columnasActivas = await leerColumnas(tablaActiva);

    const barra = document.createElement("div");
    barra.className = "practica__base-acciones";
    barra.append(
      boton("Consultar en SQL", "button button--outline", () => {
        escribirEnEditor(`select *\nfrom "${tablaActiva}"\nlimit 50;`);
        anunciar("La consulta quedó lista en la vista SQL.", "info");
      }),
      boton("Eliminar la tabla", "button button--outline", async () => {
        if (!window.confirm(`¿Eliminar la tabla "${tablaActiva}" con todos sus datos?`)) return;
        if (await correr(sentenciaEliminarTabla(tablaActiva), "Tabla eliminada.")) {
          tablaActiva = null;
          await refrescarTablas();
        }
      }),
    );
    detalle.appendChild(barra);

    pintarEstructura(detalle);
    await pintarFilas(detalle);
    pintarCreacion(detalle);
    pintarCarga(detalle);
  }

  function pintarCreacion(contenedor) {
    const bloque = seccion("Crear una tabla nueva");

    const nombre = campoTexto("", "Nombre de la tabla que vas a crear");
    nombre.placeholder = "nombre de la tabla";

    const columnas = document.createElement("div");
    columnas.className = "practica__base-columnas";

    function agregarFilaDeColumna(valor = "", tipo = "text") {
      const fila = document.createElement("div");
      fila.className = "practica__base-columna";

      const entrada = campoTexto(valor, "Nombre de la columna");
      entrada.placeholder = "columna";
      const selector = selectorDeTipo(tipo);

      fila.append(entrada, selector, boton("✕", "practica__quitar-columna", () => {
        if (columnas.children.length <= 1) {
          anunciar("La tabla necesita al menos una columna.", "aviso");
          return;
        }
        fila.remove();
      }, "Quitar esta columna"));

      columnas.appendChild(fila);
    }

    agregarFilaDeColumna("nombre", "text");
    agregarFilaDeColumna("cantidad", "integer");

    const acciones = document.createElement("div");
    acciones.className = "practica__base-acciones";
    acciones.append(
      boton("Agregar columna", "button button--outline", () => agregarFilaDeColumna()),
      boton("Crear la tabla", "button button--glow", async () => {
        if (!nombre.value.trim()) {
          anunciar("Ponle un nombre a la tabla.", "aviso");
          return;
        }
        const definidas = Array.from(columnas.children).map((fila) => ({
          nombre: fila.querySelector("input").value,
          tipo: fila.querySelector("select").value,
        }));
        const sql = sentenciaCrearTablaVacia({ nombre: nombre.value, columnas: definidas });
        if (await correr(sql, "Tabla creada.")) {
          tablaActiva = normalizarNombreIdentificador(nombre.value, "tabla");
          nombre.value = "";
          await refrescarTablas();
        }
      }),
    );

    const campoNombre = document.createElement("div");
    campoNombre.className = "practica__campo practica__campo--corto";
    const etiqueta = document.createElement("label");
    etiqueta.textContent = "Nombre de la tabla";
    campoNombre.append(etiqueta, nombre);

    bloque.append(campoNombre, columnas, acciones);
    contenedor.appendChild(bloque);
  }

  document.getElementById("practicaBaseVaciar").addEventListener("click", async () => {
    if (!window.confirm("¿Eliminar TODAS las tablas y sus datos?")) return;
    if (await correr(SQL_VACIAR_BASE_COMPLETA, "Base vaciada.")) {
      tablaActiva = null;
      await refrescarTablas();
    }
  });

  return {
    /*
      Se llama al entrar a la vista, no una sola vez al cargar: el alumno pudo
      haber creado o borrado tablas desde el editor de SQL mientras tanto, y la
      pantalla tiene que reflejar la base real, no la que había al abrir.
    */
    refrescar: refrescarTablas,
  };
}
