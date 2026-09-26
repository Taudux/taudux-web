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
  // Nombres de las tablas de la base, para avisar antes de pisar una.
  let nombresTablas = [];
  /*
    Lote abierto y todavía sin importar. Vive acá y no dentro del panel de carga
    porque ese panel se redibuja entero cada vez que se refresca la lista de
    tablas: guardado adentro, el lote se perdería al cambiar de tabla.
  */
  let pendientes = [];

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
    nombresTablas = nombres;

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
      "Abre archivos CSV o de Excel (puedes elegir varios), arrástralos aquí, o pega directamente lo que tengas copiado.";
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

    /* --- Importar archivos ------------------------------------------- */

    const ES_EXCEL = /\.(xlsx|xls)$/i;

    /*
      Excel es un ZIP de XML y leerlo exige una librería de cerca de 1 MB. Por eso
      se pide recién cuando llega el primer Excel: quien importa CSV, o no importa
      nada, no la descarga nunca. Se aloja en el sitio y no se pide al CDN porque
      la versión de npm (0.18.5) quedó congelada con un fallo conocido al leer
      archivos manipulados; la corregida sólo la publica su autor.
    */
    let cargaLectorExcel = null;
    function lectorExcel() {
      cargaLectorExcel ??= new Promise((resolver, rechazar) => {
        const script = document.createElement("script");
        script.src = "/assets/vendor/xlsx-0.20.3.full.min.js";
        script.onload = () => resolver(window.XLSX);
        script.onerror = () => {
          // Sin memorizar el fallo: un corte de red no debe dejar Excel roto para siempre.
          cargaLectorExcel = null;
          rechazar(new Error("No se pudo cargar el lector de Excel."));
        };
        document.head.appendChild(script);
      });
      return cargaLectorExcel;
    }

    /*
      Todo archivo se reduce a "piezas" de texto separado por comas, una por tabla:
      un CSV es una pieza y un libro de Excel, una por hoja con datos. Desde ahí el
      camino es el mismo para los dos (tipos, nombres, vista previa).
    */
    async function leerPiezas(archivo) {
      const bytes = new Uint8Array(await archivo.arrayBuffer());

      if (!ES_EXCEL.test(archivo.name)) {
        return [{
          origen: archivo.name,
          tabla: nombreTablaDesdeArchivo(archivo.name),
          texto: decodificarTextoImportado(bytes),
        }];
      }

      const XLSX = await lectorExcel();
      // Las fechas de Excel son números por dentro; así salen como 2026-01-31 y
      // entran como fecha, no como 46053.
      const libro = XLSX.read(bytes, { cellDates: true, dateNF: "yyyy-mm-dd" });
      const hojas = libro.SheetNames.map((nombreHoja) => ({
        nombreHoja,
        // rawNumbers: 15000 y no "15,000.00", que entraría como texto.
        texto: XLSX.utils.sheet_to_csv(libro.Sheets[nombreHoja], {
          blankrows: false,
          rawNumbers: true,
        }).trim(),
      })).filter((hoja) => hoja.texto !== "");

      if (hojas.length === 0) throw new Error("El libro no tiene hojas con datos.");

      return hojas.map((hoja) => ({
        origen: hojas.length === 1 ? archivo.name : `${archivo.name} › ${hoja.nombreHoja}`,
        tabla: nombreTablaDesdeHoja(archivo.name, hoja.nombreHoja, hojas.length),
        texto: hoja.texto,
      }));
    }

    /*
      Una sola pieza sigue el camino de siempre: va al área de pegado y se revisa
      la vista previa antes de importar. Varias piezas (varios archivos, o un libro
      de varias hojas) son varias tablas: se arma la lista "Por importar", con los
      nombres que chocan marcados, y nada se crea hasta confirmar.
    */
    async function cargarArchivos(lista) {
      const archivos = Array.from(lista ?? []);
      if (archivos.length === 0) return;

      const fallidas = [];
      // Los motivos vienen como oraciones; entre paréntesis sobra su punto final.
      const fallo = (origen, motivo) => fallidas.push(`${origen} (${motivo.replace(/\.$/, "")})`);

      if (archivos.some((archivo) => ES_EXCEL.test(archivo.name))) {
        anunciar("Leyendo el Excel…", "info");
      }

      const piezas = [];
      for (const archivo of archivos) {
        try {
          piezas.push(...(await leerPiezas(archivo)));
        } catch (error) {
          fallo(archivo.name, error?.message || "No se pudo leer");
        }
      }

      if (piezas.length === 1 && fallidas.length === 0) {
        const [pieza] = piezas;
        pegado.value = pieza.texto;
        nombre.value = pieza.tabla;
        refrescarPrevia();
        actualizarAvisoNombre();
        anunciar(`"${pieza.origen}" cargado. Revisa la vista previa e importa la tabla.`, "exito");
        return;
      }

      const validas = [];
      for (const pieza of piezas) {
        const analizada = analizarTablaPegada(pieza.texto);
        if (analizada.error) fallo(pieza.origen, analizada.error);
        else validas.push({ ...pieza, analizada });
      }

      const marcas = marcarRepetidas(validas.map((pieza) => pieza.tabla), nombresTablas);
      pendientes = validas.map((pieza, indice) => ({ ...pieza, ...marcas[indice], nombre: pieza.tabla }));
      pintarPendientes();

      const partes = [];
      if (pendientes.length > 0) {
        const conflictos = pendientes.filter((item) => item.conflicto).length;
        partes.push(
          `${pendientes.length} ${pendientes.length === 1 ? "tabla lista" : "tablas listas"} para importar` +
            (conflictos > 0 ? `, ${conflictos} con un nombre que ya existe o se repite` : "") +
            ". Revísalas abajo y aprieta Importar tablas.",
        );
      }
      if (fallidas.length > 0) partes.push(`No se pudieron leer: ${fallidas.join("; ")}.`);
      anunciar(
        partes.join(" "),
        fallidas.length === 0 ? "info" : pendientes.length > 0 ? "aviso" : "error",
      );
      if (pendientes.length > 0) listaPendientes.scrollIntoView({ block: "nearest" });
    }

    /* --- Lote por importar ------------------------------------------- */

    const listaPendientes = document.createElement("div");

    const MOTIVO_CONFLICTO = {
      existe: "Ya existe en la base",
      repetida: "Se repite en lo que abriste",
    };

    // Nombres ya tomados por la base o por otra tabla del lote, sin contar ésta.
    function nombresOcupados(excepto) {
      return [
        ...nombresTablas,
        ...pendientes
          .filter((item) => item !== excepto && item.accion !== "no-importar")
          .map((item) => normalizarNombreIdentificador(item.nombre, "datos")),
      ];
    }

    function selectorDeAccion(item) {
      const selector = document.createElement("select");
      selector.className = "practica__entrada practica__entrada--selector";
      selector.setAttribute("aria-label", `Qué hacer con ${item.origen}`);

      // "Importar" sobre una tabla que ya existe la pisa: se dice con su nombre.
      const principal = nombresTablas.includes(item.tabla)
        ? ["reemplazar", "Reemplazar"]
        : ["importar", "Importar"];
      for (const [valor, texto] of [principal, ["renombrar", "Cambiar nombre"], ["no-importar", "No importar"]]) {
        const opcion = document.createElement("option");
        opcion.value = valor;
        opcion.textContent = texto;
        opcion.selected = valor === item.accion;
        selector.appendChild(opcion);
      }

      selector.addEventListener("change", () => {
        item.accion = selector.value;
        item.nombre =
          item.accion === "renombrar" ? nombreLibre(item.tabla, nombresOcupados(item)) : item.tabla;
        pintarPendientes();
      });
      return selector;
    }

    function pintarPendientes() {
      listaPendientes.replaceChildren();
      if (pendientes.length === 0) return;

      const bloque = document.createElement("div");
      bloque.className = "practica__pendientes";

      const titulo = document.createElement("h4");
      titulo.className = "practica__base-subtitulo";
      titulo.textContent = `Por importar (${pendientes.length})`;
      bloque.appendChild(titulo);

      for (const item of pendientes) {
        const fila = document.createElement("div");
        fila.className = `practica__pendiente${item.conflicto ? " practica__pendiente--conflicto" : ""}`;

        const cabeza = document.createElement("div");
        cabeza.className = "practica__pendiente-cabeza";
        if (item.accion === "renombrar") {
          const campo = campoTexto(item.nombre, `Nuevo nombre para ${item.origen}`);
          campo.addEventListener("input", () => {
            item.nombre = campo.value;
          });
          cabeza.appendChild(campo);
        } else {
          const nombreTabla = document.createElement("code");
          nombreTabla.textContent = item.tabla;
          cabeza.appendChild(nombreTabla);
        }
        const origen = document.createElement("span");
        origen.className = "practica__pendiente-origen";
        origen.textContent = item.origen;
        cabeza.appendChild(origen);

        const filas = item.analizada.filas.length;
        const resumen = document.createElement("p");
        resumen.className = "practica__tabla-pie";
        resumen.textContent = `${filas} ${filas === 1 ? "fila" : "filas"} · ${item.analizada.columnas
          .map((columna) => `${columna.nombre} (${columna.tipo})`)
          .join(", ")}`;

        const controles = document.createElement("div");
        controles.className = "practica__pendiente-controles";
        if (item.conflicto) {
          const marca = document.createElement("span");
          marca.className = "practica__pendiente-marca";
          marca.textContent = `⚠ ${MOTIVO_CONFLICTO[item.conflicto]}`;
          controles.appendChild(marca);
        }
        const quitar = boton(
          "✕",
          "button button--outline practica__pendiente-quitar",
          () => {
            pendientes = pendientes.filter((otro) => otro !== item);
            pintarPendientes();
          },
          `Quitar ${item.origen} de la lista`,
        );
        quitar.setAttribute("aria-label", `Quitar ${item.origen} de la lista`);
        controles.append(selectorDeAccion(item), quitar);

        fila.append(cabeza, resumen, controles);
        bloque.appendChild(fila);
      }

      const acciones = document.createElement("div");
      acciones.className = "practica__base-acciones";
      acciones.append(
        boton("Importar tablas", "button button--glow", importarPendientes),
        boton("Cancelar", "button button--outline", () => {
          pendientes = [];
          pintarPendientes();
          anunciar("", "info");
        }),
      );
      bloque.appendChild(acciones);
      listaPendientes.appendChild(bloque);
    }

    async function importarPendientes() {
      const plan = pendientes.map((item) => ({
        ...item,
        nombre: item.accion === "renombrar" ? item.nombre : item.tabla,
      }));

      const errores = validarPlanImportacion(plan, nombresTablas);
      if (errores.length > 0) {
        anunciar(errores.join(" "), "aviso");
        return;
      }

      const aImportar = plan.filter((item) => item.accion !== "no-importar");
      if (aImportar.length === 0) {
        anunciar("No hay tablas marcadas para importar.", "aviso");
        return;
      }

      const importadas = [];
      const fallidas = [];
      let primeraImportada = null;

      for (const item of aImportar) {
        const tabla = normalizarNombreIdentificador(item.nombre, "datos");
        const resultado = await ejecutarSql(
          construirSentenciasTabla({
            nombre: tabla,
            columnas: item.analizada.columnas,
            filas: item.analizada.filas,
          }),
        );
        if (resultado?.ok) {
          const filas = item.analizada.filas.length;
          const reemplazo = item.accion === "reemplazar" ? ", reemplazada" : "";
          importadas.push(`${tabla} (${filas} ${filas === 1 ? "fila" : "filas"}${reemplazo})`);
          primeraImportada ??= tabla;
        } else {
          const motivo = (resultado?.error || "no se pudo crear").replace(/\.$/, "");
          fallidas.push(`${item.origen} (${motivo})`);
        }
      }

      pendientes = [];
      pintarPendientes();
      if (primeraImportada) {
        tablaActiva = primeraImportada;
        await refrescarTablas();
      }

      const partes = [];
      if (importadas.length > 0) {
        const cuantas =
          importadas.length === 1 ? "1 tabla importada" : `${importadas.length} tablas importadas`;
        partes.push(`${cuantas}: ${importadas.join(", ")}.`);
      }
      const omitidas = plan.length - aImportar.length;
      if (omitidas > 0) partes.push(`${omitidas} sin importar, como elegiste.`);
      if (fallidas.length > 0) partes.push(`No se pudieron crear: ${fallidas.join("; ")}.`);
      anunciar(
        partes.join(" "),
        fallidas.length === 0 ? "exito" : importadas.length === 0 ? "error" : "aviso",
      );
    }

    /* --- Una sola tabla: avisar antes de pisar ------------------------ */

    const avisoNombre = document.createElement("p");
    avisoNombre.className = "practica__pendiente-marca";
    avisoNombre.hidden = true;
    let botonImportar = null;

    function actualizarAvisoNombre() {
      const existe = nombresTablas.includes(normalizarNombreIdentificador(nombre.value, "datos"));
      avisoNombre.hidden = !existe;
      avisoNombre.textContent = existe
        ? "⚠ Ya existe una tabla con este nombre: al importar se reemplaza. Cámbiale el nombre para conservarla."
        : "";
      if (botonImportar) botonImportar.textContent = existe ? "Reemplazar tabla" : "Importar tabla";
    }

    nombre.addEventListener("input", actualizarAvisoNombre);

    const selectorArchivo = document.createElement("input");
    selectorArchivo.type = "file";
    selectorArchivo.accept = ".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain";
    selectorArchivo.multiple = true;
    selectorArchivo.hidden = true;
    selectorArchivo.addEventListener("change", () => {
      cargarArchivos(selectorArchivo.files);
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
      cargarArchivos(suceso.dataTransfer?.files);
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
      boton("Abrir CSV o Excel", "button button--outline", () => selectorArchivo.click()),
      (botonImportar = boton("Importar tabla", "button button--glow", async () => {
        const analizada = analizarTablaPegada(pegado.value);
        if (analizada.error) {
          anunciar(analizada.error, "aviso");
          return;
        }
        const tabla = normalizarNombreIdentificador(nombre.value, "datos");
        const reemplaza = nombresTablas.includes(tabla);
        const sql = construirSentenciasTabla({
          nombre: nombre.value,
          columnas: analizada.columnas,
          filas: analizada.filas,
        });
        const filas = analizada.filas.length;
        const hecho = `Tabla ${reemplaza ? "reemplazada" : "importada"} con ${filas} ${filas === 1 ? "fila" : "filas"}.`;
        if (await correr(sql, hecho)) {
          tablaActiva = tabla;
          pegado.value = "";
          refrescarPrevia();
          await refrescarTablas();
        }
      })),
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

    actualizarAvisoNombre();
    pintarPendientes();
    bloque.append(campoNombre, avisoNombre, pegado, previa, acciones, listaPendientes, selectorArchivo);
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
