/*
  Comportamiento del editor de etiquetas del stack de "Mi ficha": buscar en el
  catálogo, agregar, quitar y reordenar. Sin DOM y sin fetch, como el resto de
  los archivos .logica.js del proyecto.

  Depende de mi-ficha.logica.js (LIMITES_MI_FICHA y errorDeElementoStackMiFicha)
  y debe cargarse después de él, igual que notas.grafo.js depende de
  notas.arbol.js. Va aparte porque son dos responsabilidades: allá se valida la
  ficha completa contra los CHECK de la 0039 antes de enviarla, acá se decide
  qué pasa cuando alguien teclea. Los nombres globales llevan "Stack" o
  "Tecnologia": la página carga varios scripts clásicos en el mismo ámbito.

  El catálogo NO es una lista blanca. Sólo alimenta las sugerencias: cualquier
  texto que pase errorDeElementoStackMiFicha entra, esté o no en él.
*/

// Cuántas sugerencias se muestran a la vez. El catálogo tiene ~175 entradas y
// "a" coincide con media lista: sin tope, el desplegable taparía la página.
const MAXIMO_SUGERENCIAS_STACK = 8;

/*
  La clave con la que se compara y se busca: sin acentos, en minúsculas y con
  los espacios colapsados. Es lo que hace que "postgresql", "PostgreSQL" y
  "  PostgreSQL  " sean la misma tecnología, tanto para no repetirla como para
  encontrarla mientras se escribe.
*/
function normalizarClaveTecnologia(texto) {
  if (typeof texto !== "string") return "";
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Agrega al final. Devuelve { ok: true, stack } con un arreglo NUEVO, o
  { ok: false, motivo, stack } con el mismo de entrada: quien llama pinta el
  motivo y no tiene que adivinar si algo cambió.

  Motivos: "vacio" (no se escribió nada), "muchas" (ya hay doce), "duplicado"
  (con el `indice` de la que ya está, para poder señalarla) y los dos que
  decide mi-ficha.logica.js por elemento, "caracteres" y "largo".
*/
function agregarTecnologiaAlStack(stack, textoCrudo) {
  const actual = Array.isArray(stack) ? stack : [];
  const texto = typeof textoCrudo === "string" ? textoCrudo.trim() : "";

  if (texto === "") return { ok: false, motivo: "vacio", stack: actual };
  if (actual.length >= LIMITES_MI_FICHA.stack.max) {
    return { ok: false, motivo: "muchas", stack: actual };
  }

  // El mismo veredicto por elemento que corre al enviar la ficha: lo que el
  // editor deja entrar es exactamente lo que la base va a aceptar.
  const error = errorDeElementoStackMiFicha(texto);
  if (error !== null) {
    return {
      ok: false,
      motivo: error === MENSAJES_MI_FICHA.stack.largo ? "largo" : "caracteres",
      stack: actual,
    };
  }

  const clave = normalizarClaveTecnologia(texto);
  const indice = actual.findIndex((elemento) => normalizarClaveTecnologia(elemento) === clave);
  if (indice !== -1) return { ok: false, motivo: "duplicado", indice, stack: actual };

  return { ok: true, stack: [...actual, texto] };
}

/*
  Quita la de esa posición. Un índice que no apunta a ninguna devuelve el
  mismo arreglo —no una copia—, así quien llama puede comparar por identidad
  para saber si hace falta repintar.
*/
function quitarTecnologiaDelStack(stack, indice) {
  const actual = Array.isArray(stack) ? stack : [];
  if (!Number.isInteger(indice) || indice < 0 || indice >= actual.length) return actual;
  return actual.filter((_, posicion) => posicion !== indice);
}

/*
  Mueve una etiqueta de `origen` a `destino`. El destino se acota a los bordes
  en vez de rebotar o dar la vuelta, mismo criterio que moverSeleccion() en el
  roster: quien arrastra hasta el borde espera que se quede ahí. Un origen
  inválido o un movimiento que no mueve devuelven el mismo arreglo.
*/
function moverTecnologiaEnStack(stack, origen, destino) {
  const actual = Array.isArray(stack) ? stack : [];
  if (!Number.isInteger(origen) || origen < 0 || origen >= actual.length) return actual;
  if (!Number.isInteger(destino)) return actual;

  const acotado = Math.min(Math.max(destino, 0), actual.length - 1);
  if (acotado === origen) return actual;

  const movido = [...actual];
  const [tecnologia] = movido.splice(origen, 1);
  movido.splice(acotado, 0, tecnologia);
  return movido;
}

/*
  Las sugerencias para lo que se lleva escrito. Por substring y no por
  prefijo, para que "gres" encuentre "PostgreSQL"; la consecuencia asumida es
  que una abreviatura que no es parte del nombre no funciona ("js" no
  encuentra "JavaScript").

  Las que empiezan por la consulta van primero —es lo que se espera al teclear
  "post"— y dentro de cada grupo se respeta el orden del catálogo. Lo que ya
  está en el stack no se ofrece: elegirlo sólo daría el aviso de duplicado.
*/
function sugerenciasDeTecnologia(catalogo, consulta, yaElegidas = [], limite = MAXIMO_SUGERENCIAS_STACK) {
  const lista = Array.isArray(catalogo) ? catalogo : [];
  const clave = normalizarClaveTecnologia(consulta);
  if (clave === "") return [];

  const excluidas = new Set(
    (Array.isArray(yaElegidas) ? yaElegidas : []).map(normalizarClaveTecnologia),
  );

  const empiezan = [];
  const contienen = [];
  for (const tecnologia of lista) {
    if (typeof tecnologia !== "string") continue;
    const suya = normalizarClaveTecnologia(tecnologia);
    if (suya === "" || excluidas.has(suya)) continue;
    if (suya.startsWith(clave)) empiezan.push(tecnologia);
    else if (suya.includes(clave)) contienen.push(tecnologia);
  }

  return [...empiezan, ...contienen].slice(0, Math.max(limite, 0));
}

/*
  Cuál de los centros queda más cerca del puntero. Toma números, no nodos: el
  cableado mide las etiquetas con getBoundingClientRect() y esta función sólo
  hace la aritmética, igual que calculateCrop()/clampPan() en el recortador de
  portadas. Así la decisión del arrastre se prueba sin navegador.

  Se compara la distancia AL CUADRADO: la raíz no cambia cuál es la menor y
  sobra calcularla en cada frame. Con empate gana el primero, que es el que ya
  estaba a la izquierda y evita que dos etiquetas parpadeen entre sí.
*/
function indiceMasCercano(centros, punto) {
  const lista = Array.isArray(centros) ? centros : [];
  if (lista.length === 0) return -1;
  if (!punto || typeof punto.x !== "number" || typeof punto.y !== "number") return -1;

  let elegido = -1;
  let menor = Infinity;
  for (let i = 0; i < lista.length; i += 1) {
    const centro = lista[i];
    if (!centro || typeof centro.x !== "number" || typeof centro.y !== "number") continue;
    const dx = centro.x - punto.x;
    const dy = centro.y - punto.y;
    const distancia = dx * dx + dy * dy;
    if (distancia < menor) {
      menor = distancia;
      elegido = i;
    }
  }
  return elegido;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    MAXIMO_SUGERENCIAS_STACK,
    normalizarClaveTecnologia,
    agregarTecnologiaAlStack,
    quitarTecnologiaDelStack,
    moverTecnologiaEnStack,
    sugerenciasDeTecnologia,
    indiceMasCercano,
  });
}
