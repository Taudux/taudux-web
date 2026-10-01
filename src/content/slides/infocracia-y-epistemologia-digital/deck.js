const BLOCKS = [
  "Apertura", "Epistemología", "Fuentes del conocimiento", "Justificación", "Teorías de la verdad",
  "El giro colectivo", "Cómo fluye la información", "Epistemología de la virtud", "Injusticia epistémica",
  "Habermas", "Foucault", "Deleuze", "Han", "Posverdad", "Qué sigue", "Cierre"
];

const SLIDES = [
  // ════════ 0 · APERTURA
  { id: "portada", b: 0, lv: 3, t: "cover", core: true, ti: "Portada",
    h: "Infocracia y epistemología digital",
    sub: "Cómo el entorno digital transforma lo que creemos, lo que sabemos y lo que aceptamos como verdad",
    who: "René Samael Flores Ortega",
    org: "BLOQUE · Centro de Innovación y Tecnología del Municipio de Querétaro",
    img: "Multitud de espaldas mirando pantallas o un escenario; luz de pantallas en las caras.",
    note: "Se proyecta mientras entra la gente." },

  { id: "asistencia", b: 0, lv: 1, t: "qr", core: true, title: "Antes de empezar",
    items: [["Asistencia.jpeg", "Asistencia"], ["Herramientas digitales de BLOQUE.jpeg", "Herramientas digitales de BLOQUE"]],
    note: "Dar un minuto para que registren su asistencia; el segundo QR lleva a las herramientas digitales de BLOQUE." },

  { id: "pregunta", b: 0, lv: 1, t: "statement", core: true, title: "La pregunta de la sesión",
    text: "¿Cómo sabemos lo que creemos saber, cuando casi todo nos llega por una pantalla?",
    simple: ["Esta sesión no trata de tecnología, sino de **conocimiento**. La tecnología cambió; las preguntas son las mismas que la filosofía se hace desde Platón: qué es saber, por qué creemos lo que creemos y en quién confiamos.",
      "La primera mitad presenta esas herramientas. La segunda las usa para entender el presente: el poder de la información, la posverdad y lo que la evidencia dice de ella."],
    note: "Es la única pregunta de la sesión; todo lo demás son herramientas para responderla." },

  { id: "recorrido", b: 0, lv: 2, t: "table", core: false, title: "Recorrido de la sesión",
    cols: "70px 330px 1fr", k: 1, head: ["", "Bloque", "Qué veremos y para qué"],
    rows: [["1", "Epistemología", "Qué es conocer y qué es creer. El vocabulario básico de toda la sesión."],
      ["2", "Fuentes, justificación y verdad", "De dónde viene lo que sabemos, qué hace que una creencia esté bien fundada y qué entendemos por verdad."],
      ["3", "El conocimiento como proceso colectivo", "Cómo circula hoy la información; virtudes, vicios e injusticias del conocer."],
      ["4", "Habermas, Foucault y Deleuze", "Tres diagnósticos sobre el espacio público y el poder que preparan el presente."],
      ["5", "Han: psicopolítica e infocracia", "El régimen de la información: un poder que ya no prohíbe, sino que seduce e inunda."],
      ["6", "Posverdad", "Qué es, ejemplos, qué la explica y qué dice la evidencia."],
      ["7", "Qué sigue", "Lo que queda para la siguiente sesión."]],
    img: "Estantes de biblioteca o archivo, en blanco y negro.",
    note: "Treinta segundos. Advertir que la primera mitad es filosofía y la segunda su aplicación al presente." },

  // ════════ 1 · EPISTEMOLOGÍA
  { id: "sec-epistemologia", b: 1, lv: 3, t: "section", core: true, h: "Epistemología",
    what: "Qué es la epistemología, las cinco preguntas que la organizan, qué es el conocimiento y qué es una creencia.",
    why: "Sin este vocabulario no se puede discutir la desinformación con rigor: primero hay que saber qué significa «saber».",
    img: "Sala de lectura de una biblioteca antigua, o un estudiante frente a una mesa con libros." },

  { id: "epistemologia", b: 1, lv: 1, t: "concept", core: true, title: "¿Qué es la epistemología?",
    def: "La **epistemología** es la rama de la filosofía que estudia el conocimiento: qué es, cómo se obtiene, cómo se justifica y cuáles son sus límites.",
    cols: "1.25fr 0.8fr 1.25fr",
    boxes: [
      { l: "Explicación", p: ["No estudia un tema en particular —la física, la historia, la medicina—, sino lo que hace que cualquier saber cuente como saber.",
        "Su pregunta de fondo: ¿cuándo tenemos derecho a decir «**sé**», y no solo «**creo**»?"] },
      { l: "Origen del término", p: ["Del griego *epistēmē*, conocimiento fundado, y *logos*, estudio.", "También se le llama teoría del conocimiento o gnoseología."] },
      { l: "Ejemplos", items: [["Un diagnóstico", "La medicina estudia la infección; la epistemología pregunta qué hace que el diagnóstico sea conocimiento y no una corazonada."],
        ["Una noticia", "La economía estudia la inflación; la epistemología pregunta cómo sabes que la cifra es cierta y por qué confías en quien la publica."]] }],
    src: "Robert Audi, *Epistemology: A Contemporary Introduction*, Routledge, 2011",
    note: "La definición es la estándar de los manuales (Audi 2011, introducción). Detenerse en la pregunta «¿cuándo puedo decir sé y no solo creo?»: es el hilo de toda la sesión." },

  { id: "cinco-preguntas", b: 1, lv: 1, t: "list5", core: true, title: "Las cinco preguntas de la epistemología",
    lead: "Toda la disciplina cabe en cinco preguntas. Cada una reaparece en la sesión:",
    items: [["¿Qué es conocer?", "¿En qué se distingue *saber* algo de simplemente *creerlo* o de *acertar por suerte*?", "Conocimiento y creencia"],
      ["¿Cómo se justifica una creencia?", "¿Qué hace que una creencia esté bien fundada y no sea un capricho, un prejuicio o una corazonada?", "Justificación"],
      ["¿De dónde viene el conocimiento?", "¿Cuáles son sus fuentes legítimas y qué tan confiable es cada una?", "Fuentes del conocimiento"],
      ["¿Qué podemos saber y qué no?", "¿Hasta dónde llega el conocimiento humano? ¿Es posible la certeza? (Aquí vive el escepticismo.)", "Escepticismo; al final, con la posverdad"],
      ["¿Qué es la verdad?", "¿Es la correspondencia con los hechos, la coherencia entre creencias, lo que funciona, lo que acordamos?", "Teorías de la verdad"]],
    note: "Recorrer las cinco sin detenerse demasiado: cada una tiene su bloque. La columna de la derecha dice dónde se desarrolla." },

  { id: "conocimiento", b: 1, lv: 1, t: "concept", core: true, title: "¿Qué es el conocimiento?",
    def: "El **conocimiento** es un logro: tener por verdadero algo que efectivamente es verdad, y tenerlo así por razones adecuadas, no por azar.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Saber qué (proposicional)", p: ["Saber que algo es el caso.", "*Sé que Querétaro está en México.*", "Puede ser verdadero o falso y se transmite con palabras. **Es el tipo de conocimiento que está en juego con la desinformación** y el que estudia sobre todo la epistemología."] },
      { l: "Saber cómo (práctico)", p: ["Saber hacer algo.", "*Sé andar en bicicleta. Sé hablar español.*", "Se demuestra haciendo, no diciendo: puedes saber nadar sin poder explicar cómo (Gilbert Ryle, 1949)."] },
      { l: "Conocer por trato directo", p: ["Conocer a alguien o algo por familiaridad.", "*Conozco a mi vecina. Conozco Guanajuato.*", "El español lo marca con dos verbos: *saber* (que algo es así) y *conocer* (a alguien, un lugar) (Bertrand Russell, 1910)."] }],
    src: "Gilbert Ryle, *El concepto de lo mental*, 1949 · Bertrand Russell, «Knowledge by Acquaintance and Knowledge by Description», 1910",
    note: "La definición general es didáctica (conocimiento como «logro cognitivo»: creencia verdadera por buenas razones). Las tres formas son la clasificación estándar. Subrayar que de aquí en adelante hablamos de conocimiento proposicional: saber que algo es el caso." },

  { id: "platon", b: 1, lv: 1, t: "concept", core: true, title: "La definición clásica: creencia verdadera justificada",
    def: "Una persona **sabe** algo si y solo si: **1)** lo cree, **2)** es verdad, y **3)** tiene una justificación adecuada para creerlo.",
    defsrc: "Platón, *Teeteto*, 201c–d: el conocimiento como «opinión verdadera acompañada de razón» (*logos*).",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "1 · Creencia", p: ["Si no lo crees, no lo sabes.", "*Nadie sabe que lloverá si está convencido de que no lloverá.*"] },
      { l: "2 · Verdad", p: ["Si es falso, no lo sabes, aunque lo creas con total firmeza.", "*Se puede estar seguro y estar equivocado.*"] },
      { l: "3 · Justificación", p: ["Si aciertas por suerte, no lo sabes.", "*Quien adivina el número de la lotería no sabía cuál iba a salir.*"] }],
    foot: "Platón, en el *Menón* (97e–98a), compara las opiniones verdaderas con las estatuas de Dédalo: se escapan si no se las ata. El razonamiento es lo que las ata y las convierte en conocimiento.",
    src: "Platón, *Teeteto* y *Menón* (Gredos). En el *Teeteto* la definición se examina sin darse por cerrada; la tradición la adoptó como estándar.",
    note: "Las tres condiciones con un ejemplo cada una. La imagen de las estatuas de Dédalo (Menón 97d–98a) explica por qué importa la justificación: la verdad sin razones no se sostiene. La frase del pie es paráfrasis, no cita." },

  { id: "gettier", b: 1, lv: 2, t: "concept", core: true, title: "Contraejemplo: acertar por suerte",
    dl: "El problema de Gettier",
    def: "En 1963, Edmund Gettier mostró en un artículo de tres páginas que las tres condiciones no bastan: se puede tener una creencia **verdadera y justificada** que, aun así, no es conocimiento, porque es verdadera **por suerte**.",
    cols: "1fr 1fr",
    boxes: [
      { l: "El reloj detenido (Russell, 1948)", p: "Miras un reloj que siempre ha funcionado; marca las 3:00. Crees que son las 3:00, y lo son. Pero el reloj está detenido desde hace horas y, por casualidad, marca la hora correcta. Tu creencia es verdadera y justificada, pero no *sabías* la hora." },
      { l: "Ejemplo actual (hipotético)", p: "Un mensaje falso dice que mañana no habrá clases por un paro. Lo crees porque llega de un grupo en el que confías. Al día siguiente no hay clases, pero por otra razón: una fuga de gas. Acertaste, tenías razones, y no sabías." },
      { l: "Lo que enseña", span: 2, dark: true, p: "No basta con tener razón: hay que tenerla por las razones correctas. Compartir un dato verdadero porque «me sonó bien» no es saber, y el mismo método, la próxima vez, llevará a un error." }],
    src: "Gettier, «Is Justified True Belief Knowledge?», *Analysis*, 23(6), 1963 · Russell, *El conocimiento humano*, 1948",
    img: "Reloj de pared o de estación detenido, en blanco y negro.",
    note: "El ejemplo del reloj es de Bertrand Russell (Human Knowledge, 1948) y anticipa a Gettier. El segundo ejemplo es hipotético y se presenta como tal. La discusión filosófica sobre qué condición falta sigue abierta desde 1963; para la sesión basta la lección del recuadro negro." },

  { id: "creencia", b: 1, lv: 1, t: "concept", core: true, title: "¿Qué es una creencia?",
    def: "Una **creencia** es el estado mental de tener algo por verdadero.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Qué implica", p: ["Creer no exige estar pensando en ello: crees que 2 + 2 = 4 aunque ahora pienses en otra cosa.", "Tampoco exige razones: se puede creer sin evidencia, o contra ella."] },
      { l: "Tiene grados", p: ["No se cree todo con la misma fuerza: hay creencias firmes, probables y dudosas.", "*«70 % de probabilidad de lluvia»* expresa un grado de creencia, no un sí o un no."] },
      { l: "Por qué importa", dark: true, p: ["Todo lo que sabes lo crees, pero no todo lo que crees lo sabes.", "**La desinformación opera en esa distancia**: entre lo que creemos y lo que tenemos razones para creer."] }],
    note: "La definición es breve a propósito; la lámina siguiente la desarrolla con ejemplos y contraejemplos." },

  { id: "creencia-distinciones", b: 1, lv: 2, t: "table", core: true, title: "Creer, saber, opinar, tener fe, suponer",
    lead: "Palabras que en la conversación cotidiana se usan como sinónimos, pero que nombran cosas distintas:",
    cols: "190px 1fr 1fr", head: ["Actitud", "Qué es", "Ejemplo"], e: 2,
    rows: [["Saber", "Creencia verdadera y justificada.", "Sé que el agua hierve a 100 °C al nivel del mar."],
      ["Creer sin saber", "Creencia que puede resultar verdadera, pero hoy no está justificada.", "Creo que mañana lloverá."],
      ["Opinar", "Creencia sobre algo discutible, que se reconoce como tal.", "Creo que esta película es mejor que la anterior."],
      ["Tener fe", "Creencia que no se apoya en la evidencia ni la exige.", "Tengo fe en que todo saldrá bien."],
      ["Suponer (aceptar)", "Tratar algo como verdadero para razonar o actuar, sin necesariamente creerlo.", "El juez: «supongamos que es inocente». La científica: «supongamos que la hipótesis es cierta»."]],
    foot: "Contraejemplo frecuente: **la certeza no es saber.** Se puede estar completamente seguro de algo falso; la firmeza mide la creencia, no la verdad.",
    src: "Distinción entre creer y aceptar: L. Jonathan Cohen, *An Essay on Belief and Acceptance*, 1992",
    img: "Personas conversando en una plaza o café, en blanco y negro.",
    note: "Pedir al público un ejemplo propio de cada fila. Subrayar la fila de «suponer»: aceptar algo para razonar (como la presunción de inocencia) no es creerlo." },

  { id: "creencia-responsabilidad", b: 1, lv: 2, t: "two", core: true, title: "¿Somos responsables de lo que creemos?",
    lead: "Una discusión clásica, útil para el presente: ¿se puede creer mal, igual que se puede actuar mal?",
    two: [
      { h: "W. K. Clifford · «La ética de la creencia» (1877)", p: ["«Es incorrecto, siempre, en todas partes y para cualquiera, creer algo con base en evidencia insuficiente.»",
        "Su ejemplo: un armador acalla sus dudas y cree que su barco viejo está en buen estado; el barco se hunde. Para Clifford es culpable, y lo sería aunque el barco hubiera llegado: no tenía derecho a creer con esa evidencia."], qi: 0 },
      { h: "William James · «La voluntad de creer» (1896)", p: ["Hay decisiones que no pueden esperar a tener toda la evidencia.",
        "Cuando la opción es viva, forzosa y trascendental —y la evidencia no alcanza para decidir—, creer sin prueba completa puede ser legítimo. Exigir siempre evidencia completa también tiene costos."] }],
    boxes: [{ l: "Contraejemplo y límite", p: "No podemos creer a voluntad: intenta creer ahora mismo que estás en la Luna. Pero sí decidimos qué buscamos, a quién escuchamos y qué dejamos de verificar. **Ahí está la responsabilidad**, y ahí actúa el entorno digital: no nos obliga a creer; organiza qué evidencia vemos y cuál no." }],
    src: "Clifford, «The Ethics of Belief», *Contemporary Review*, 1877 · James, «The Will to Believe», 1896 · Bernard Williams, «Deciding to Believe», 1970",
    img: "Barco viejo en un puerto, en blanco y negro.",
    note: "La frase de Clifford es traducción propia del original: «It is wrong always, everywhere, and for anyone, to believe anything upon insufficient evidence». La imposibilidad de creer a voluntad es el argumento de Bernard Williams (1970)." },

  { id: "escepticismo", b: 1, lv: 1, t: "concept", core: true, title: "¿Qué podemos saber? El escepticismo",
    def: "El **escepticismo** es la postura que pone en duda que podamos conocer, o que exige razones antes de aceptar algo como conocimiento.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Escepticismo local", p: ["Duda de una afirmación concreta, con razones: *¿de dónde salió esta cifra?*", "Es sano: es el método de la ciencia, del periodismo y de los tribunales."] },
      { l: "Escepticismo global", dark: true, p: ["Duda de todo por principio: *nada se puede saber; todos mienten*.", "Parece más crítico, pero es una rendición: si nada puede saberse, cualquier creencia vale lo mismo y gana quien grita más fuerte."] },
      { l: "La duda de Descartes", p: ["En las *Meditaciones* (1641), Descartes duda de todo a propósito, como método.", "No es una pose: es una prueba de resistencia para ver qué creencias sobreviven al examen."] }],
    foot: "Retomaremos esta distinción al final: el entorno digital fabrica escépticos globales.",
    note: "Distinguir con claridad local y global. El global es la puerta de entrada del conspiracionismo y del dividendo del mentiroso. Esta lámina prepara la frase final sobre la desconfianza." },

  { id: "presion", b: 1, lv: 2, t: "table", core: false, title: "Cada condición del conocimiento, bajo presión",
    lead: "Las tres condiciones de la definición clásica están bajo presión en el entorno digital. La sesión recorre las tres:",
    cols: "240px 1fr", head: ["Condición", "Qué le pasa en el entorno digital"], lg: true,
    rows: [["Creencia", "Se cree por pertenencia, no por razones: afirmar algo sirve para decir de qué lado estás."],
      ["Verdad", "Los hechos se vuelven negables: si todo puede ser falso, todo se puede negar."],
      ["Justificación", "«Lo vi en un video» sustituye a la evidencia; las veces que se repite algo sustituyen a las razones."]],
    img: "Pantalla de celular iluminando una cara en la oscuridad.",
    note: "Lámina puente: es una promesa de lo que viene, no hay que profundizar." },
];

SLIDES.push(
  // ════════ 2 · FUENTES DEL CONOCIMIENTO
  { id: "sec-fuentes", b: 2, lv: 3, t: "section", core: true, h: "Fuentes del conocimiento",
    what: "Las cinco fuentes clásicas del conocimiento y, sobre todo, el testimonio: saber algo porque otra persona nos lo dijo.",
    why: "Casi todo lo que sabemos llega por testimonio, y el entorno digital es, antes que nada, un cambio en cómo nos llega.",
    img: "Manos hojeando un periódico, o una persona mirando por una ventana." },

  { id: "fuente", b: 2, lv: 1, t: "concept", core: false, title: "¿Qué es una fuente de conocimiento?",
    def: "Una **fuente de conocimiento** es una vía por la que una creencia llega a estar justificada: ver, recordar, sentir, razonar o escuchar a otro.",
    cols: "1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Aquí «fuente» no significa «de dónde saqué el dato», como en el periodismo, sino la **capacidad o el camino** que produce la creencia.", "La epistemología reconoce cinco fuentes clásicas: percepción, memoria, introspección, razón y testimonio."] },
      { l: "Por qué importa", p: ["Cada fuente tiene su forma de acertar y su forma de fallar.", "Saber **cómo falla cada una** es la base de cualquier defensa contra la desinformación: no se trata de desconfiar de todo, sino de saber dónde suele estar el error."] }],
    src: "Robert Audi, *Epistemology*, 2011, primera parte",
    note: "Audi organiza su manual exactamente con estas cinco fuentes: percepción, memoria, conciencia (introspección), razón y testimonio." },

  { id: "cinco-fuentes", b: 2, lv: 1, t: "table", core: true, title: "Las cinco fuentes del conocimiento",
    cols: "200px 330px 1fr", head: ["Fuente", "Definición corta", "Definición completa, ejemplo y cómo falla"], kb: false,
    rows: [["Percepción", "Lo que captan los sentidos.", "Justificación directa sobre el entorno inmediato: *veo que llueve*. Falla por ilusión, por condiciones adversas y, hoy, por imágenes y audios sintéticos."],
      ["Memoria", "Lo que conservamos de lo ya conocido.", "No genera conocimiento nuevo: lo preserva. *Recuerdo dónde dejé las llaves.* Falla por reconstrucción: recordamos lo que encaja, no siempre lo que pasó."],
      ["Introspección", "El acceso a los propios estados mentales.", "Saber que uno siente dolor, duda o miedo. Es fiable para estados simples y poco fiable para los motivos: a menudo no sabemos por qué creemos lo que creemos."],
      ["Razón", "Lo que se obtiene pensando: inferencia y cálculo.", "Deducción, cálculo, intuición lógica: *si A es mayor que B y B mayor que C, A es mayor que C*. Es la fuente de las verdades necesarias. Falla por sesgo y por razonar hacia la conclusión que ya queríamos."],
      ["Testimonio", "Lo que otros nos comunican.", "La fuente de casi todo lo que sabemos de historia, ciencia y geografía. Falla cuando confiamos en quien no lo merece, o desconfiamos de quien sí."]],
    src: "Robert Audi, *Epistemology*, 2011 · C. A. J. Coady, *Testimony: A Philosophical Study*, 1992",
    note: "Recorrer las cinco en dos minutos y detenerse en la última: la lámina siguiente la desarrolla." },

  { id: "testimonio", b: 2, lv: 1, t: "concept", core: true, title: "El testimonio",
    def: "El **testimonio** es la fuente por la que sabemos algo porque otra persona nos lo comunica: de palabra, por escrito o a través de un medio.",
    cols: "1.1fr 1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Cuando crees algo porque te lo dijeron, tu justificación depende de la de quien te lo dijo: **heredas sus razones, y también sus errores**.", "Durante siglos se vio como fuente de segunda; C. A. J. Coady (1992) mostró que es la base de casi todo lo que sabemos."] },
      { l: "Ejemplos", items: [["Tu fecha de nacimiento", "La sabes por un acta y por tu familia; no la recuerdas."], ["Que la Tierra gira alrededor del Sol", "Casi nadie lo ha comprobado por sí mismo."], ["La noticia de hoy", "La sabes porque un medio te la contó."]] },
      { l: "¿Cuándo creerle a otro?", items: [["David Hume (1748)", "Solo si tienes razones independientes para confiar en esa fuente: su historial, su honestidad."], ["Thomas Reid (1764)", "Por defecto confiamos, salvo que haya razones para dudar. Sin esa confianza no podríamos aprender nada."]] }],
    src: "Coady, *Testimony*, 1992 · Hume, *Investigación sobre el entendimiento humano*, sec. X, 1748 · Reid, *Investigación sobre la mente humana*, 1764",
    note: "El debate Hume–Reid se conoce como reduccionismo frente a antirreduccionismo. La confianza por defecto de Reid es la que el entorno digital explota: por eso esta lámina prepara la siguiente." },

  { id: "testimonio-digital", b: 2, lv: 1, t: "statement", core: true, title: "El testimonio en la era digital",
    text: "Casi todo lo que sabes, lo sabes por testimonio.",
    simple: ["El entorno digital no cambió *cuánto* dependemos de otros. Cambió **cómo nos llega** el testimonio: quién habla, con qué señales de credibilidad y filtrado por qué.",
      "El problema no es depender, que es la condición normal del conocimiento. El problema es que **se rompieron las señales que nos decían de quién depender**."],
    sl: "Por qué es la base de esta sesión",
    note: "Esta es la base de la plática. Todo lo que sigue desarrolla esta lámina." },

  { id: "problema", b: 2, lv: 2, t: "table", core: false, title: "El problema, en tres frases",
    cols: "360px 1fr", head: ["Qué pasa", "Explicación"], kb: true, lg: true,
    rows: [["1 · Dependemos de testimonio mediado por plataformas", "Casi todo lo que sabemos del mundo llega a través de plataformas que deciden qué vemos, en qué orden y junto a qué."],
      ["2 · Las señales de credibilidad se rompieron", "Lo que antes indicaba seriedad —una imprenta, una redacción, una firma— hoy se imita en minutos. Una página falsa se ve igual que una real."],
      ["3 · Aparecen intermediarios que no son personas", "Sistemas de recomendación y, desde 2023, asistentes de inteligencia artificial que responden sin mostrar sus fuentes."]],
    img: "Centro de datos, cables o antenas.",
    note: "Los puntos 1 y 2 se tratan en esta sesión; el 3 queda para «Qué sigue»." },

  // ════════ 3 · JUSTIFICACIÓN
  { id: "sec-justificacion", b: 3, lv: 3, t: "section", core: true, h: "Justificación",
    what: "Qué es la justificación y las dos grandes respuestas sobre qué cuenta como una buena razón: el internismo y el externismo.",
    why: "Es la condición del conocimiento que más se erosiona en el entorno digital: creemos cosas verdaderas y falsas sin saber por qué.",
    img: "Tribunal antiguo, o una balanza." },

  { id: "justificacion", b: 3, lv: 1, t: "concept", core: true, title: "¿Qué es la justificación?",
    def: "La **justificación** es aquello que hace que una creencia esté bien fundada —razones, evidencia o un proceso confiable— y no sea un capricho, un prejuicio o una corazonada.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Justificar no es demostrar con certeza absoluta: es tener **razones adecuadas y proporcionales** a lo que se afirma.", "Una afirmación extraordinaria exige más evidencia que una cotidiana."] },
      { l: "Dos consecuencias", items: [["Justificada pero falsa", "El pronóstico del tiempo bien hecho que falla."], ["Verdadera pero no justificada", "Quien adivina y acierta."]] },
      { l: "La pregunta abierta", dark: true, p: ["¿Qué cuenta como una buena razón?", "Hay dos grandes respuestas: el **internismo** y el **externismo**."] }],
    src: "Robert Audi, *Epistemology*, 2011 · George Pappas, «Internalist vs. Externalist Conceptions of Epistemic Justification», *Stanford Encyclopedia of Philosophy*",
    note: "Es la segunda condición de Platón y la que más importa en la sesión." },

  { id: "internismo", b: 3, lv: 1, t: "concept", core: true, title: "Internismo",
    def: "Para el **internismo**, una creencia está justificada si la persona tiene acceso a sus razones y puede dar cuenta de ellas.",
    cols: "1fr 1.15fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Lo que justifica está «dentro»: la evidencia de la que eres consciente y tu capacidad de explicarla.", "Representante: Laurence BonJour (1985).", "La pregunta que lo resume: **¿por qué crees eso?**"] },
      { l: "Ejemplos", items: [["El médico", "Explica cada paso del diagnóstico: síntomas, prueba, resultado. Está justificado aunque se equivoque."], ["El vidente de BonJour", "Alguien tiene un poder de clarividencia que funciona, pero ninguna evidencia de tenerlo, y acierta. Para el internismo no está justificado: solo acierta."]] },
      { l: "Dificultad", p: ["Exige demasiado: los niños y los animales saben cosas sin poder dar razones.", "Y casi nadie puede justificar por sí mismo lo que sabe por testimonio."] }],
    src: "BonJour, «Externalist Theories of Empirical Knowledge», 1980; *The Structure of Empirical Knowledge*, 1985",
    note: "Aplicación: el internismo está detrás de la exigencia de dar razones. «¿De dónde lo sacaste?» no es hostilidad: es epistemología." },

  { id: "externismo", b: 3, lv: 1, t: "concept", core: true, title: "Externismo",
    def: "Para el **externismo**, una creencia está justificada si proviene de un proceso confiable, aunque la persona no pueda explicarlo.",
    cols: "1fr 1.15fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Lo que justifica está «fuera»: la fiabilidad del proceso que produjo la creencia.", "Representante: Alvin Goldman (1979), con el *fiabilismo*.", "La pregunta que lo resume: **¿de dónde salió, y esa fuente suele acertar?**"] },
      { l: "Ejemplos", items: [["El sexador de pollos", "Distingue el sexo de un pollito recién nacido con gran precisión, sin saber explicar cómo. El proceso es confiable."], ["El termómetro", "Confías en él sin saber cómo funciona, porque es un instrumento fiable."]] },
      { l: "Dificultad", p: ["No avisa desde dentro cuándo desconfiar: una fuente que acertó muchas veces puede dejar de ser fiable sin que lo notes."] }],
    src: "Alvin Goldman, «What Is Justified Belief?», 1979",
    note: "Aplicación: el externismo es la base de evaluar fuentes por su historial. No puedes verificar el contenido, pero puedes saber si la fuente suele acertar." },

  { id: "dos-preguntas", b: 3, lv: 1, t: "two", core: false, title: "Las dos preguntas, juntas",
    two: [
      { h: "Internismo", big: "¿Por qué crees eso?", p: "Sirve contra el **propio prejuicio**: obliga a revisar las razones que uno tiene." },
      { h: "Externismo", big: "¿De dónde lo sacaste, y esa fuente suele acertar?", p: "Sirve contra la **fuente dudosa**: obliga a revisar el historial de quien informa." }],
    foot: "No hay que elegir bando: en la vida cotidiana las dos preguntas se usan juntas. Reaparecen al final como método.",
    note: "Cierre del bloque." },

  // ════════ 4 · TEORÍAS DE LA VERDAD
  { id: "sec-verdad", b: 4, lv: 3, t: "section", core: true, h: "¿Qué es la verdad?",
    what: "Qué es la verdad, qué tipos de verdad existen y las tres grandes teorías: correspondencia, coherencia y pragmatismo.",
    why: "La posverdad no ataca todas las verdades por igual: ataca las verdades de hecho. Hay que saber distinguirlas.",
    img: "Periódico antiguo con un titular grande, o un muro con consignas." },

  { id: "verdad", b: 4, lv: 1, t: "concept", core: true, title: "¿Qué es la verdad?",
    def: "La **verdad** es una propiedad de lo que afirmamos o creemos: la de ser correcto respecto de aquello de lo que habla.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Las cosas no son verdaderas ni falsas: *la nieve* no es verdadera; *«la nieve es blanca»* sí lo es.", "Verdadero o falso es lo que **decimos o creemos** sobre las cosas."] },
      { l: "La fórmula de Tarski (1933)", p: ["«La nieve es blanca» es verdadera **si y solo si** la nieve es blanca.", "Parece obvio. Toda la discusión está en qué significa ese «si y solo si»: de eso tratan las teorías de la verdad."] },
      { l: "Por qué importa", dark: true, p: ["Sin un concepto de verdad no se puede hablar de mentira, de error, de verificación ni de posverdad."] }],
    src: "Alfred Tarski, «El concepto de verdad en los lenguajes formalizados», 1933",
    note: "La definición es deliberadamente neutral entre teorías: «ser correcto respecto de aquello de lo que se habla»." },

  { id: "tipos-verdad", b: 4, lv: 1, t: "table", core: true, title: "Tipos de verdades",
    lead: "Hannah Arendt distingue entre **verdades de razón** y **verdades de hecho**. La diferencia es central para entender la posverdad.",
    cols: "250px 1fr 1fr", head: ["Tipo", "Qué son", "Ejemplo"], e: 2,
    rows: [["Verdades de razón (lógicas y matemáticas)", "Necesarias: no pueden ser de otro modo. Se demuestran pensando y, si se olvidan, se pueden redescubrir.", "2 + 2 = 4. Si todos los humanos son mortales y Sócrates es humano, Sócrates es mortal."],
      ["Verdades de hecho (fácticas o factuales)", "Contingentes: pudieron ser de otro modo. No se deducen: se atestiguan, con testigos, documentos y registros.", "Alemania invadió Bélgica en agosto de 1914. La elección presidencial de México se celebró el 2 de junio de 2024."],
      ["Verdades empíricas o científicas", "Verdades de hecho generales, obtenidas por observación y experimento. Son revisables: la ciencia las corrige.", "El agua hierve a 100 °C al nivel del mar."],
      ["Juicios de valor", "No son verdaderos ni falsos en el mismo sentido: son posturas que se argumentan.", "Esta ley es justa."]],
    foot: "La posverdad no ataca a las matemáticas. Ataca a las **verdades de hecho**, porque son las únicas que se pueden negar: basta con desacreditar a los testigos.",
    src: "Hannah Arendt, «Verdad y política», 1967, en *Entre el pasado y el futuro*",
    note: "«Fácticas» y «factuales» son sinónimos: relativas a hechos. El ejemplo de Bélgica es el que usa la propia Arendt. Sus tres ideas sobre la fragilidad de los hechos vuelven en el bloque de posverdad." },

  { id: "correspondencia", b: 4, lv: 1, t: "concept", core: true, title: "Teoría de la correspondencia",
    def: "Una afirmación es verdadera si **describe cómo son las cosas**.",
    quote: "Decir de lo que es que no es, o de lo que no es que es, es falso; decir de lo que es que es, y de lo que no es que no es, es verdadero.",
    qsrc: "Aristóteles, *Metafísica*, IV, 1011b25",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Es la teoría del sentido común y la que usan los verificadores de hechos: se compara lo que se dice con el mundo.", "Alfred Tarski la formalizó en 1933."] },
      { l: "Ejemplos", items: [["", "«En Querétaro llovió ayer» es verdadera si llovió."], ["", "«La elección la ganó X» es verdadera si las actas lo registran."]] },
      { l: "Dificultad", p: ["¿Cómo accedemos a los hechos sin pasar por nuestra percepción y nuestro lenguaje?", "Para el pasado solo hay testimonio y registros: justo lo que Arendt dice que es frágil."] }],
    note: "Es la teoría que el público ya usa sin nombrarla. Postura de la sesión: para las verdades de hecho, es irrenunciable." },

  { id: "coherencia", b: 4, lv: 1, t: "concept", core: true, title: "Teoría de la coherencia",
    def: "Una afirmación es verdadera si **encaja sin contradicción** con el conjunto de lo que ya aceptamos.",
    cols: "1.1fr 1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Una creencia se sostiene por su lugar en la red de todo lo que sabemos: **la verdad como red, no como espejo**.", "La imagen clásica es el barco de Otto Neurath (1932): reparamos nuestras creencias en alta mar, tabla por tabla, sin poder llevarlas a un dique seco."] },
      { l: "Ejemplos", items: [["", "El detective acepta la hipótesis que explica todas las pistas sin dejar cabos sueltos."], ["", "El historiador acepta un documento porque encaja con el resto del archivo."]] },
      { l: "Dificultad", p: ["Una novela es coherente y es falsa.", "Una teoría conspirativa suele ser **más coherente que la realidad**: la realidad tiene cabos sueltos y la conspiración los explica todos."] }],
    src: "F. H. Bradley · Brand Blanshard, *The Nature of Thought*, 1939 · Otto Neurath, «Proposiciones protocolares», 1932",
    note: "Lo del barco de Neurath es paráfrasis, no cita. Observar que una cámara de eco es un sistema de creencias muy coherente y muy falso." },

  { id: "pragmatismo", b: 4, lv: 1, t: "concept", core: true, title: "Teoría pragmatista",
    def: "Una afirmación es verdadera si **funciona**: si permite predecir, actuar y resolver problemas.",
    quote: "Lo verdadero, para decirlo brevemente, es solo lo conveniente en el modo de nuestro pensar.",
    qsrc: "William James, *Pragmatismo*, 1907, lección VI",
    cols: "1.1fr 1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Charles S. Peirce la entendió como la opinión a la que llegaría toda investigación llevada hasta el final; William James, como lo que funciona en la experiencia."] },
      { l: "Ejemplos", items: [["", "La física de Newton permite lanzar satélites, aunque la relatividad la corrija."], ["", "Un mapa es verdadero si te lleva a donde quieres ir."]] },
      { l: "Dificultad", p: ["Hay falsedades muy útiles: una superstición que tranquiliza, una mentira que gana una elección.", "Hay que preguntar: **¿funciona para quién, y para qué?**"] }],
    src: "Peirce, «Cómo esclarecer nuestras ideas», 1878 · James, *Pragmatismo*, 1907 · John Dewey",
    note: "La cita de James es traducción propia del original («The true, to put it very briefly, is only the expedient in the way of our thinking») [cotejar] con la edición en español que se use." },

  { id: "tres-teorias", b: 4, lv: 2, t: "table", core: false, title: "Las tres teorías, frente a frente",
    cols: "200px 1fr 1fr 1fr", head: ["Teoría", "Qué es verdad", "Cómo se comprueba", "Dificultad"],
    rows: [["Correspondencia", "Lo que coincide con los hechos.", "Comparando con el mundo: observación, registros.", "¿Cómo accedemos a los hechos sin percepción ni lenguaje?"],
      ["Coherencia", "Lo que encaja con lo que ya sabemos.", "Revisando que no contradiga el resto.", "Las ficciones y las conspiraciones también son coherentes."],
      ["Pragmatismo", "Lo que funciona.", "Poniéndolo a prueba en la práctica.", "Hay falsedades muy útiles."]],
    foot: "En la práctica se combinan: verificamos (correspondencia), exigimos plausibilidad (coherencia) y valoramos la capacidad de predecir (pragmatismo).",
    img: "Mesa de trabajo con mapas, instrumentos o documentos.",
    note: "Ninguna teoría resuelve sola el problema." },

  { id: "fuentes-verdad", b: 4, lv: 2, t: "table", core: false, title: "Fuentes de verdad: ¿quién dice qué es verdad?",
    lead: "Una cosa es qué es la verdad; otra, a quién o a qué acudimos para saberla. Cada fuente tiene un modo de fallar:",
    cols: "210px 1fr 1fr", head: ["Fuente", "Cuándo sirve", "Cuándo falla"],
    rows: [["Tradición", "Para lo que cambia poco: costumbres, oficios.", "Ante lo nuevo: repite lo que ya no es cierto."],
      ["Autoridad", "Es eficiente: no tenemos que verificarlo todo.", "Cuando tiene intereses o se equivoca."],
      ["Consenso", "Es un buen indicador de lo probable.", "Cuando es rebaño: muchos repitiendo a uno."],
      ["Evidencia", "Es la mejor fuente.", "Requiere saber evaluarla."],
      ["Experiencia propia", "Es convincente y directa.", "Es limitada y sesgada: «a mí me funcionó»."]],
    foot: "El entorno digital debilita a la autoridad y al consenso —todo se cuestiona— y sobrevalora la experiencia propia: «haz tu propia investigación».",
    img: "Asamblea o mesa de discusión.",
    note: "Distinguir «teoría de la verdad» (qué es que algo sea verdad) de «fuente de verdad» (a qué acudimos para saberlo)." },

  { id: "postura", b: 4, lv: 1, t: "statement", core: false, title: "Postura mínima",
    text: "Para las verdades de hecho, la correspondencia es irrenunciable.",
    simple: "Quién ganó una elección, cuántas personas murieron, qué dijo alguien: eso no es opinión, ni coherencia, ni utilidad. Sin esta postura mínima, la palabra «posverdad» no significa nada.",
    sl: "Por qué la sostenemos",
    note: "Es el ancla de la segunda mitad." },

  // ════════ 5 · EL GIRO COLECTIVO
  { id: "giro", b: 5, lv: 1, t: "quote", core: true, title: "El conocimiento como proceso colectivo", para: true,
    text: "El conocimiento deja de estudiarse como asunto de un individuo aislado frente al mundo, y pasa a estudiarse como proceso colectivo.",
    qsrc: "Paráfrasis del giro de la epistemología social · Alvin Goldman, *Knowledge in a Social World*, 1999",
    simple: ["Hasta aquí vimos a una persona frente al mundo. La **epistemología social** estudia otra cosa: cómo circula el conocimiento entre personas e instituciones, cómo se distribuye la confianza y cómo funcionan los expertos, el desacuerdo y el rumor.",
      "El problema digital es, casi por definición, un problema de epistemología social."],
    sl: "Qué significa",
    note: "La frase no es cita textual: resume el cambio de programa que Goldman consolidó en 1999. Definición textual de la Stanford Encyclopedia of Philosophy (Goldman y O'Connor): «Social epistemology is the study of the social dimensions of knowledge or information»." },
);

SLIDES.push(
  // ════════ 6 · CÓMO FLUYE LA INFORMACIÓN
  { id: "sec-flujo", b: 6, lv: 3, t: "section", core: true, h: "Cómo fluye la información",
    what: "Cómo circula la información, cómo se distribuye la confianza y qué papel tienen los expertos, las instituciones y los rumores.",
    why: "Es el paso del conocimiento individual al colectivo, y es ahí donde se ve dónde se rompe.",
    img: "Sala de redacción antigua con teletipos, o una central telefónica." },

  { id: "circulacion", b: 6, lv: 2, t: "stats", core: true, title: "Circulación: lo falso viaja más lejos",
    h: "El estudio más citado del campo: lo falso se difunde más lejos y más rápido que lo verdadero. Y lo mueven personas, no robots.",
    stats: [["70 %", "más probabilidad de que una noticia falsa sea compartida"], ["6 ×", "más tiempo tarda la verdad en llegar a 1 500 personas"], ["126 000", "cascadas de noticias analizadas en Twitter, 2006–2017"]],
    cols: "1fr 1fr",
    boxes: [
      { l: "Por qué", p: "La explicación propuesta es la **novedad**: lo falso sorprende más y provoca más reacción emocional. Los robots aceleraban lo verdadero y lo falso por igual; la diferencia la hacían las personas." },
      { l: "Matiz", p: "Comparando cascadas del mismo tamaño, las diferencias de forma desaparecen. Lo que se mantiene es que lo falso alcanza a más gente (Juul y Ugander, 2021)." }],
    src: "Vosoughi, Roy y Aral, «The spread of true and false news online», *Science*, 359, 2018 · Juul y Ugander, *PNAS*, 2021",
    img: "Multitud en movimiento, estación de tren o calle concurrida.",
    note: "Cifras verificadas contra la cobertura del MIT. El dato desactiva el chivo expiatorio fácil («son los bots»)." },

  { id: "confianza", b: 6, lv: 2, t: "stats", core: true, title: "Distribución y confianza",
    h: "En México, la mayoría se informa por redes y una minoría confía en las noticias:",
    stats: [["36 %", "confía en las noticias la mayor parte del tiempo"], ["63 %", "se informa por redes sociales"], ["7 %", "usa asistentes de IA cada semana para informarse"]],
    cols: "1.2fr 1fr",
    boxes: [
      { l: "Confianza y confiabilidad", p: ["**Confianza** es una actitud de quien cree. **Confiabilidad** es una propiedad de quien informa: ser honesto, competente y fiable.", "Onora O'Neill (2002): el objetivo no es más confianza, sino **confianza bien colocada**."] },
      { l: "Por qué importa", dark: true, p: "Desconfiar de todo es tan disfuncional como creerlo todo. La pregunta útil no es «¿en quién confío?», sino «¿quién da señales verificables de ser confiable?»." }],
    src: "Reuters Institute, *Digital News Report 2025*, México · Onora O'Neill, *A Question of Trust*, BBC Reith Lectures, 2002",
    img: "Familia frente al televisor en los años sesenta, o un puesto de periódicos.",
    note: "Otras cifras del informe para México: 80 % se informa en línea; Facebook es la primera plataforma para noticias y TikTok la que más crece (+6 puntos)." },

  { id: "expertos", b: 6, lv: 2, t: "cards", core: false, title: "Expertos: ¿a quién creerle?",
    lead: "Si dos expertos discrepan y yo no lo soy, ¿cómo decido a quién creer sin volverme experto? Alvin Goldman (2001) propone cinco señales que cualquiera puede revisar:",
    ncol: 3,
    items: [["1 · Cómo argumenta", "¿Responde a las objeciones o las esquiva?"], ["2 · Qué dice su campo", "¿Qué opina la mayoría de los especialistas?"], ["3 · Quién lo avala", "Credenciales, instituciones, colegas."],
      ["4 · Qué intereses tiene", "¿Quién paga? ¿Qué gana con que le crea?"], ["5 · Qué historial tiene", "¿Ha acertado antes en lo que se puede comprobar?"],
      ["La idea clave", "No puedes evaluar el contenido técnico, pero **sí puedes evaluar a quien lo afirma**."]],
    hl: 5,
    foot: "Elizabeth Anderson (2011) lo resume en tres preguntas para cualquier ciudadano: ¿es competente en ese tema?, ¿es honesto?, ¿responde a las críticas de sus pares?",
    src: "Goldman, «Experts: Which Ones Should You Trust?», 2001 · Anderson, «Democracy, Public Policy, and Lay Assessments of Scientific Testimony», *Episteme*, 2011",
    img: "Conferencia académica o laboratorio.",
    note: "Esta es la versión seria de «haz tu propia investigación»: investigar la fuente, no el contenido técnico. Es exactamente lo que hacen los verificadores profesionales." },

  { id: "instituciones", b: 6, lv: 2, t: "concept", core: false, title: "Instituciones: los testigos de los hechos",
    def: "Las **instituciones de registro** —redacciones, archivos, institutos de estadística, tribunales— son las que atestiguan y conservan las verdades de hecho.",
    cols: "1fr 1fr",
    boxes: [
      { l: "Explicación", p: "Para Arendt, una verdad de hecho depende de testigos y registros. Sin instituciones que registren, no hay forma de verificar qué pasó: la correspondencia se queda sin materia." },
      { l: "Qué está pasando", p: "Cuando el periodismo local quiebra, o la violencia crea zonas donde nadie informa, **desaparece la posibilidad de verificar**. México está entre los países más peligrosos del mundo para ejercer el periodismo." }],
    src: "Hannah Arendt, «Verdad y política», 1967 · Reporteros sin Fronteras, Clasificación Mundial de la Libertad de Prensa",
    img: "Archivo con cajas y expedientes, o una rotativa.",
    note: "Enlazar con Habermas: en 2022 advierte que las plataformas destruyen la base económica del periodismo." },

  { id: "rumores", b: 6, lv: 2, t: "concept", core: true, title: "Rumores: testimonio sin fuente",
    def: "Un **rumor** es una afirmación que circula de persona en persona sin una fuente verificable, sostenida por la confianza en quien la reenvía.",
    cols: "1fr 1.3fr",
    boxes: [
      { l: "Explicación", p: "En México circula sobre todo por WhatsApp: un canal cerrado, cifrado, sin moderación posible y con la **autoridad prestada del vínculo** familiar o vecinal. Se cree al mensaje porque se cree a quien lo manda." },
      { l: "Caso: Acatlán de Osorio, Puebla (29 de agosto de 2018)", dark: true, p: "Dos hombres, Ricardo y Alberto Flores, fueron linchados por una multitud tras rumores difundidos en WhatsApp y Facebook sobre supuestos «robachicos». La policía confirmó que no había ningún niño desaparecido." }],
    src: "BBC News, «Burned to death because of a rumour on WhatsApp», noviembre de 2018",
    img: "Plaza de un pueblo o un mercado, sin referencia al hecho.",
    note: "Tratar el caso con sobriedad y sin imágenes del hecho. Es desinformación involuntaria con consecuencias mortales, sin carga partidista." },

  // ════════ 7 · EPISTEMOLOGÍA DE LA VIRTUD
  { id: "virtud", b: 7, lv: 1, t: "concept", core: true, title: "Epistemología de la virtud",
    def: "La **epistemología de la virtud** estudia el conocimiento a partir del carácter de quien conoce: sus buenos hábitos intelectuales (virtudes) y sus defectos (vicios).",
    cols: "1fr 1fr",
    boxes: [
      { l: "Explicación", p: ["Desplaza la pregunta de «¿qué hace justificada a una creencia?» a «¿**cómo es una buena conocedora**?».", "Conocer bien no depende solo de seguir reglas, sino de hábitos que se cultivan (Linda Zagzebski, 1996)."] },
      { l: "Aplicación cívica", p: ["Óscar Pérez de la Fuente (2024): frente a la desinformación no basta con regular contenidos; hay que mirar a los agentes —ciudadanos, periodistas—.", "La democracia necesita **ciudadanos epistémicamente virtuosos**, y la educación tiene un papel legítimo en formarlos."] }],
    src: "Linda Zagzebski, *Virtues of the Mind*, 1996 · Óscar Pérez de la Fuente, *Desinformación y virtudes epistémicas*, Dykinson, 2024",
    note: "Pérez de la Fuente propone un «perfeccionismo epistémico moderado»: el Estado y la educación pueden promover virtudes intelectuales respetando el pluralismo." },

  { id: "virtudes", b: 7, lv: 2, t: "cards", core: true, title: "Virtudes epistémicas",
    ncol: 3,
    items: [["Humildad intelectual", "Reconocer los límites de lo que uno sabe.", "Decir «no sé» o «me equivoqué»."],
      ["Curiosidad", "Querer saber más allá de lo que confirma lo que ya se piensa.", "Leer al que opina distinto."],
      ["Apertura", "Considerar en serio lo que contradice, sin rendirse de inmediato.", "Escuchar el argumento completo antes de responder."],
      ["Rigor", "Exigir evidencia proporcional a la afirmación.", "Buscar la fuente original antes de compartir."],
      ["Valentía intelectual", "Sostener lo que indica la evidencia, aunque incomode al propio grupo.", "Corregir en público un dato falso de los «nuestros»."],
      ["Veracidad", "No afirmar lo que no se cree; no callar lo que se sabe.", "No compartir lo que no se ha comprobado."]],
    foot: "No son rasgos de personalidad: son prácticas que se entrenan. Pérez de la Fuente destaca tres: humildad intelectual, veracidad y valentía intelectual.",
    src: "Zagzebski, 1996 · Pérez de la Fuente, 2024",
    img: "Persona leyendo con atención, o un aula.",
    note: "En cursiva, un ejemplo de cada virtud en la práctica." },

  { id: "vicios", b: 7, lv: 2, t: "cards", core: true, title: "Vicios epistémicos",
    ncol: 3, hl: 4,
    items: [["Dogmatismo", "Inmunidad a la evidencia: ninguna prueba cambia la opinión.", "«Digan lo que digan, sé que es así»."],
      ["Credulidad", "Aceptar sin razones suficientes.", "Creer una cadena porque la mandó un familiar."],
      ["Arrogancia intelectual", "Sobreestimar el propio juicio y despreciar el ajeno.", "«No necesito expertos: ya investigué»."],
      ["Negligencia", "No verificar lo que se podía verificar.", "Compartir sin abrir el enlace."],
      ["Indiferencia a la verdad", "No es mentir: es que no importe si lo que se dice es verdad. Quassim Cassam la llama *despreocupación epistémica*.", "Es el vicio que define la posverdad."]],
    foot: "El último vicio conecta este bloque con el final de la sesión: la posverdad no es un exceso de mentiras, sino un ambiente de indiferencia.",
    src: "Quassim Cassam, *Vices of the Mind*, 2019",
    img: "Muro de carteles superpuestos.",
    note: "Cassam acuña «epistemic insouciance»: despreocupación o indiferencia epistémica. La lámina siguiente la desarrolla con Frankfurt." },

  { id: "charlatan", b: 7, lv: 1, t: "concept", core: true, title: "El charlatán: la indiferencia a la verdad",
    def: "Para Harry Frankfurt, el **charlatán** (*bullshitter*) es quien habla sin que le importe si lo que dice es verdadero o falso: solo le importa el efecto que produce.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Mentiroso y charlatán", p: ["El **mentiroso** respeta la verdad a su manera: necesita conocerla para ocultarla.", "Al **charlatán** le es indiferente: puede decir cosas verdaderas por accidente."] },
      { l: "Por qué es más grave", p: ["La mentira ataca una verdad concreta; la charlatanería erosiona el interés mismo por la verdad.", "Abunda cuando la vida pública obliga a opinar de todo."] },
      { l: "Ley de Brandolini (2013)", q: "La energía necesaria para refutar un disparate es un orden de magnitud mayor que la necesaria para producirlo.", qs: "Alberto Brandolini · trad. propia", p: "Como al charlatán no le importa la verdad, produce a costo cero; quien refuta tiene que investigar y documentar." }],
    src: "Harry G. Frankfurt, *On Bullshit*, 1986/2005 (*Sobre la charlatanería*) · Alberto Brandolini, 2013",
    note: "Casi todo lo que satura las redes no es mentira deliberada: es contenido producido sin relación con la verdad. Por eso la verificación siempre llega tarde y cansada." },

  // ════════ 8 · INJUSTICIA EPISTÉMICA
  { id: "injusticia", b: 8, lv: 1, t: "concept", core: true, title: "Injusticia epistémica",
    def: "La **injusticia epistémica** es el daño que se hace a alguien específicamente en su condición de conocedor: cuando no se le cree o no se le entiende por razones injustas.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Testimonial", p: "Se le cree menos de lo debido **por quién es**: el prejuicio descuenta credibilidad antes de escuchar." },
      { l: "Hermenéutica", p: "No existen todavía **las palabras** para nombrar su experiencia, y sin ellas no puede entenderla ni denunciarla." },
      { l: "Por qué entra en esta sesión", dark: true, p: "Todo discurso sobre «criterio» y «fuentes confiables» puede degenerar en «no escuches a quien no tiene credenciales». Fricker obliga a preguntar a quién se le cree, a quién no, y por qué." }],
    src: "Miranda Fricker, *Epistemic Injustice*, 2007 (*Injusticia epistémica*, Herder, 2017)",
    note: "Fricker, p. 1 (trad. propia) [cotejar] con Herder: la injusticia testimonial «ocurre cuando un prejuicio lleva al oyente a dar a la palabra del hablante un nivel de credibilidad menor del debido»; la hermenéutica «ocurre en una etapa anterior, cuando una laguna en los recursos interpretativos colectivos pone a alguien en desventaja injusta para dar sentido a sus experiencias sociales»." },

  { id: "testimonial", b: 8, lv: 2, t: "concept", core: false, title: "Injusticia testimonial",
    def: "Ocurre cuando un prejuicio lleva a quien escucha a dar a la palabra de alguien **menos credibilidad de la que merece**.",
    cols: "1fr 1fr",
    boxes: [
      { l: "Ejemplos", items: [["El ejemplo de Fricker", "En *Matar a un ruiseñor*, el jurado no cree a Tom Robinson porque es negro."], ["En lo cotidiano", "La mujer a la que no se le cree; el joven al que se descarta; el acento que resta autoridad; la comunidad indígena cuyo testimonio se desestima."]] },
      { l: "El daño", p: ["Es doble: a la persona, a quien se le niega su condición de conocedora; y a todos, porque **se pierde un conocimiento que solo ella tenía**."] }],
    src: "Miranda Fricker, *Epistemic Injustice*, 2007, cap. 1",
    img: "Audiencia en un tribunal, o una sala de espera.",
    note: "El daño colectivo es el argumento epistémico, no solo moral: la sociedad sabe menos." },

  { id: "hermeneutica", b: 8, lv: 2, t: "concept", core: false, title: "Injusticia hermenéutica",
    def: "Ocurre cuando una **laguna en los conceptos colectivos** deja a alguien sin palabras para dar sentido a lo que vive.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "El ejemplo de Fricker", p: "Carmita Wood, 1975: sufría acoso de su jefe, pero el término «acoso sexual» no existía. Sin concepto no podía nombrarlo ni denunciarlo; el término surgió ese mismo año." },
      { l: "En lo digital", p: "Durante años no hubo palabras para *cámara de eco* o *dividendo del mentiroso*; la experiencia se vivía como culpa individual." },
      { l: "La otra cara", dark: true, p: "Las plataformas también han permitido que voces sin credibilidad institucional sean escuchadas. #MeToo repara una injusticia hermenéutica a gran escala." }],
    src: "Miranda Fricker, *Epistemic Injustice*, 2007, cap. 7",
    img: "Manifestación con pancartas.",
    note: "Esta lámina matiza el pesimismo del resto: el mismo entorno que degrada el criterio también da voz." },

  // ════════ 9 · HABERMAS
  { id: "habermas", b: 9, lv: 3, t: "bio", core: true, ti: "Jürgen Habermas", name: "Jürgen Habermas", meta: "Düsseldorf, Alemania, 1929",
    role: "Filósofo y sociólogo alemán, figura central de la segunda generación de la Escuela de Frankfurt. Sostiene que la razón se realiza en la comunicación: en el diálogo donde gana el mejor argumento.",
    works: [["Historia y crítica de la opinión pública (1962)", "cómo nació y cómo decayó la esfera pública moderna."],
      ["Teoría de la acción comunicativa (1981)", "su obra mayor: la comunicación orientada al entendimiento como base de la sociedad."],
      ["Un nuevo cambio estructural de la esfera pública y la política deliberativa (2022)", "su diagnóstico de la esfera pública en la era de las plataformas."]],
    why: "Es el autor que mejor explica qué es el espacio público y qué se pierde cuando se fragmenta.",
    img: "Café o salón del siglo XVIII, o Frankfurt de posguerra.",
    note: "Formado con Adorno y Horkheimer, se separa de su pesimismo: cree que la razón puede realizarse en la comunicación entre personas. Volvió a su primer tema a los 93 años para hablar de lo digital." },

  { id: "esfera", b: 9, lv: 1, t: "concept", core: true, title: "La esfera pública",
    def: "La **esfera pública** es el espacio donde personas privadas discuten asuntos de interés común usando argumentos, no rangos ni títulos.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Origen", p: "Habermas la describe en los cafés, salones y periódicos de Europa en los siglos XVII y XVIII: ahí la opinión pública **se formaba discutiendo**." },
      { l: "Dos condiciones", items: [["1", "Que todos tengan acceso a los mismos hechos."], ["2", "Que se distinga lo público de lo privado."]] },
      { l: "Advertencia", p: "Es un tipo ideal —el propio Habermas lo admite—, pero es el patrón con el que se mide todo lo demás." }],
    src: "Habermas, *Historia y crítica de la opinión pública*, 1962",
    note: "Las dos condiciones son las que el entorno digital erosiona: hechos compartidos y distinción público/privado." },

  { id: "decadencia", b: 9, lv: 2, t: "concept", core: false, title: "La decadencia: la prensa de masas",
    dl: "La tesis de 1962",
    def: "Con la prensa de masas, la publicidad y la industria cultural, la esfera pública deja de ser donde se **forma** opinión y pasa a ser donde se **consume** opinión ya fabricada.",
    cols: "1fr 1fr",
    boxes: [
      { l: "Qué cambia", p: "Los medios pasan de foro a negocio; el público, de interlocutor a audiencia; la publicidad sustituye al argumento; la política se vuelve escenificación. Habermas lo llama **refeudalización** de la esfera pública." },
      { l: "Por qué importa hoy", p: "El diagnóstico es de 1962 y describe la era de la televisión. Se aplica a las plataformas, con una diferencia que el propio Habermas señala en 2022: **ahora el público también emite**." }],
    src: "Habermas, *Historia y crítica de la opinión pública*, 1962",
    img: "Kiosco de periódicos o imprenta rotativa.",
    note: "Segunda mitad del libro de 1962." },

  { id: "habermas-1", b: 9, lv: 1, t: "quote", core: true, title: "Habermas, 2022 · 1. Todos pueden ser autores",
    text: "…el carácter de plataforma de los nuevos medios crea un espacio de comunicación en el que lectores, oyentes y espectadores pueden asumir espontáneamente el papel de autores.",
    qsrc: "Habermas, *Un nuevo cambio estructural de la esfera pública y la política deliberativa*, Trotta, 2025, p. 13",
    simple: "Antes, para publicar había que pasar por una redacción que filtraba con criterios profesionales. Hoy cualquiera publica: se gana voz, pero **desaparece el filtro** que separaba lo comprobado de lo que no.",
    note: "Cita textual tomada del avance de lectura publicado por el CSIC [cotejar] en el ejemplar." },

  { id: "habermas-2", b: 9, lv: 1, t: "quote", core: false, title: "Habermas, 2022 · 2. El periodismo pierde su base",
    text: "…esto amenaza con privar de su base económica a las empresas editoras de periódicos tradicionales y a los periodistas como grupo profesional responsable.",
    qsrc: "Habermas, *Un nuevo cambio estructural de la esfera pública y la política deliberativa*, Trotta, 2025, p. 14",
    simple: "La publicidad, que pagaba el periodismo, se fue a las plataformas. Sin dinero no hay redacciones; sin redacciones no hay quien registre y verifique los hechos: **los testigos de Arendt desaparecen**.",
    note: "Cita textual del avance del CSIC [cotejar]." },

  { id: "habermas-3", b: 9, lv: 1, t: "quote", core: true, title: "Habermas, 2022 · 3. Semiesferas",
    text: "…los usuarios exclusivos de los medios sociales parecen estar adoptando un modo de comunicación semipúblico, fragmentado y circular que está deformando su percepción de la esfera pública política como tal.",
    qsrc: "Habermas, *Un nuevo cambio estructural de la esfera pública y la política deliberativa*, Trotta, 2025, p. 14",
    simple: "El resultado no es una esfera pública más grande, sino muchas **semiesferas**: grupos de afines que se sienten públicos, pero funcionan como privados, y en los que se habla en círculo con los que ya piensan igual.",
    note: "Cita textual del avance del CSIC [cotejar]. «Semiesferas» traduce Halböffentlichkeiten." },

  { id: "se-pierde", b: 9, lv: 1, t: "statement", core: false, title: "Lo que se pierde",
    text: "Sin filtro editorial, sin hechos compartidos y sin distinguir lo público de lo privado, no hay deliberación. Hay semiesferas.",
    simple: "Byung-Chul Han retoma exactamente este diagnóstico y lo radicaliza. Antes de llegar a él, dos autores que explican de dónde viene su idea de «régimen»: Foucault y Deleuze.",
    sl: "Hacia dónde vamos",
    note: "Cierre del bloque y puente." },
);

SLIDES.push(
  // ════════ 10 · FOUCAULT
  { id: "foucault", b: 10, lv: 3, t: "bio", core: true, ti: "Michel Foucault", name: "Michel Foucault", meta: "Poitiers, 1926 – París, 1984",
    role: "Filósofo e historiador francés, catedrático de Historia de los sistemas de pensamiento en el Collège de France. Estudió cómo el poder produce saber y cómo las instituciones fabrican a las personas que dicen atender.",
    works: [["Historia de la locura en la época clásica (1961)", "cómo Occidente separó y encerró a los «locos»."],
      ["Las palabras y las cosas (1966)", "cómo cambian las reglas de lo que cada época puede pensar."],
      ["Vigilar y castigar (1975)", "el nacimiento de la prisión moderna y de la sociedad disciplinaria."],
      ["Historia de la sexualidad (1976–1984)", "cómo el poder regula la vida y el cuerpo."]],
    why: "Deleuze y Han describen el presente como lo que vino después del régimen disciplinario que Foucault analizó.",
    img: "Patio de una prisión o una fábrica de principios del siglo XX.",
    note: "Su pregunta constante: cómo el poder y el saber se producen mutuamente." },

  { id: "regimen", b: 10, lv: 1, t: "concept", core: true, title: "¿Qué es un régimen?",
    def: "Un **régimen** es el conjunto de reglas, instituciones y prácticas que determinan cómo se ejerce el poder y **qué cuenta como verdad** en una sociedad.",
    quote: "Cada sociedad tiene su régimen de verdad, su “política general de la verdad”: es decir, los tipos de discursos que ella acoge y hace funcionar como verdaderos; los mecanismos y las instancias que permiten distinguir los enunciados verdaderos o falsos…",
    qsrc: "Michel Foucault, «Verdad y poder», 1977, en *Microfísica del poder*, La Piqueta, 1992, p. 187",
    cols: "1fr 1fr",
    boxes: [
      { l: "Explicación", p: "En Foucault un régimen no es solo una forma de gobierno: es la manera en que el poder atraviesa la vida cotidiana y decide **quién está autorizado a decir la verdad** y con qué procedimientos." },
      { l: "Por qué importa", dark: true, p: "Cambiar de régimen es cambiar quién decide qué funciona como verdadero. Esa es la tesis de Han sobre el presente: vivimos un cambio de régimen." }],
    note: "La palabra viene del latín regimen, de regere: regir. La cita completa sigue: «…la manera de sancionar unos y otros; las técnicas y los procedimientos que son valorizados para la obtención de la verdad; el estatuto de aquellos encargados de decir qué es lo que funciona como verdadero»." },

  { id: "vigilar", b: 10, lv: 2, t: "concept", core: true, title: "*Vigilar y castigar* (1975)",
    lead: "Libro de Michel Foucault sobre el nacimiento de la prisión moderna y, con ella, de la **sociedad disciplinaria**. Su idea central:",
    dl: "Idea central",
    def: "Entre los siglos XVIII y XIX, el poder deja de castigar cuerpos en público y empieza a **disciplinarlos** en instituciones cerradas: la escuela, el cuartel, la fábrica, el hospital y la prisión.",
    cols: "1fr 1fr",
    boxes: [
      { l: "Qué es disciplinar", q: "Es dócil un cuerpo que puede ser sometido, que puede ser utilizado, que puede ser transformado y perfeccionado.", qs: "Foucault, *Vigilar y castigar*, Siglo XXI [cotejar]",
        p: "Moldear la conducta con horarios, filas, exámenes, normas y vigilancia constante, para producir personas obedientes y productivas." },
      { l: "Contexto", p: "Foucault lo escribe después de Mayo del 68 y de fundar, en 1971, el Grupo de Información sobre las Prisiones. El libro es también una intervención política." }],
    src: "Michel Foucault, *Vigilar y castigar. Nacimiento de la prisión*, 1975 (trad. Aurelio Garzón del Camino, Siglo XXI)",
    img: "Aula de principios del siglo XX con niños en filas, o taller con obreros alineados.",
    note: "Idea clave: el cambio del suplicio a la prisión no es solo humanitario, es técnico: disciplinar resulta más eficaz que destruir." },

  { id: "suplicio", b: 10, lv: 2, t: "two", core: false, title: "Del suplicio a la prisión",
    lead: "El libro abre con dos escenas separadas por ochenta años. Muestran el cambio de régimen de castigo:",
    two: [
      { h: "1757 · El suplicio", p: ["Ejecución pública de Robert-François Damiens en París.", "El castigo es un **espectáculo** sobre el cuerpo del condenado: el poder se muestra destruyendo."] },
      { h: "c. 1838 · El reglamento", p: ["Reglamento para una casa de jóvenes presos en París: la jornada, fijada minuto a minuto.", "El castigo ya no se exhibe: **se administra**. El poder se ejerce organizando el tiempo."] }],
    foot: "El cambio no es solo humanitario: es técnico. El poder descubre que es más eficaz disciplinar que destruir.",
    src: "Foucault, *Vigilar y castigar*, 1975, primera parte",
    img: "Grabado de una plaza pública antigua o una celda.",
    note: "El reglamento es el de Léon Faucher para la «casa de jóvenes detenidos» de París, que Foucault cita al inicio." },

  { id: "panoptico", b: 10, lv: 1, t: "concept", core: true, title: "El panóptico",
    def: "El **panóptico** es un modelo de prisión diseñado por Jeremy Bentham (1791): celdas en anillo alrededor de una torre central, desde la que un vigilante puede ver a todos sin ser visto.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Qué produce", q: "…inducir en el detenido un estado consciente y permanente de visibilidad que garantiza el funcionamiento automático del poder.", qs: "Foucault, *Vigilar y castigar* [cotejar]", p: "Como el preso nunca sabe si lo miran, actúa como si siempre lo miraran: **termina vigilándose solo**." },
      { l: "En México", p: "La penitenciaría de Lecumberri, en la Ciudad de México (1900), se construyó con planta radial según este principio. Hoy alberga el Archivo General de la Nación." },
      { l: "Por qué importa", dark: true, p: "Para Foucault el panóptico es el diagrama de toda la sociedad disciplinaria. Han lo retoma para decir que hoy se invirtió: **nadie nos obliga a exponernos; nos exhibimos**." }],
    src: "Jeremy Bentham, *El panóptico*, 1791 · Foucault, *Vigilar y castigar*, 1975, tercera parte",
    note: "Lecumberri, el «Palacio Negro», funcionó como cárcel hasta 1976; es sede del AGN desde 1982." },

  { id: "disciplinaria", b: 10, lv: 2, t: "table", core: false, title: "La sociedad disciplinaria, en cuatro rasgos",
    cols: "220px 1fr", head: ["Rasgo", "Cómo funciona"], lg: true,
    rows: [["Opera por", "Coacción: prohíbe, ordena y castiga."], ["Actúa sobre", "El cuerpo: posturas, horarios, movimientos."],
      ["Se ejerce en", "Instituciones cerradas: se pasa de una a otra, de la familia a la escuela, al cuartel, a la fábrica."],
      ["Vigila", "Desde fuera, con una mirada que el vigilado termina interiorizando."]],
    foot: "«¿Puede extrañar que la prisión se asemeje a las fábricas, a las escuelas, a los cuarteles, a los hospitales, todos los cuales se asemejan a las prisiones?» — Foucault [cotejar]",
    img: "Pasillo largo de una institución antigua.",
    note: "Estos cuatro rasgos son los que Deleuze y Han contrastan con el presente." },

  // ════════ 11 · DELEUZE
  { id: "deleuze", b: 11, lv: 3, t: "bio", core: true, ti: "Gilles Deleuze", name: "Gilles Deleuze", meta: "París, 1925 – 1995",
    role: "Filósofo francés, amigo y lector de Foucault. Pensó la diferencia, el deseo y las nuevas formas de poder; escribió varias obras con el psicoanalista Félix Guattari.",
    works: [["Diferencia y repetición (1968)", "su obra filosófica principal."],
      ["El Anti-Edipo (1972) y Mil mesetas (1980), con Guattari", "capitalismo, deseo y poder."],
      ["Foucault (1986)", "su lectura de la obra de su amigo."],
      ["«Post-scriptum sobre las sociedades de control» (1990)", "cinco páginas que describen, antes de internet, la lógica de las plataformas."]],
    why: "Es el eslabón entre la sociedad disciplinaria de Foucault y la infocracia de Han.",
    img: "Tarjetas perforadas, cintas magnéticas o una central telefónica de los años ochenta.",
    note: "El Post-scriptum está recogido en Conversaciones (Pre-Textos, trad. José Luis Pardo)." },

  { id: "posdata", b: 11, lv: 2, t: "concept", core: false, title: "«Post-scriptum sobre las sociedades de control» (1990)",
    lead: "Texto de cinco páginas publicado en 1990 en *L'Autre Journal*. Deleuze sostiene que las instituciones de encierro están en crisis y que las sustituye otra forma de poder.",
    dl: "La tesis",
    def: "El poder ya no encierra: **controla** de forma continua, abierta y sin muros. La formación, la evaluación y la deuda se vuelven permanentes.",
    cols: "1fr 1fr",
    boxes: [
      { l: "Contexto", p: "Todas las instituciones de encierro —cárcel, hospital, fábrica, escuela, familia— atraviesan, dice, una «crisis generalizada». Ya no se pasa de un encierro a otro: nunca se termina nada." },
      { l: "Por qué se dice que lo predijo", p: "Describe perfiles, contraseñas y tarjetas que abren o cierran accesos: la lógica de los datos y los algoritmos, **más de una década antes de las redes sociales**." }],
    src: "Deleuze, «Post-scriptum sobre las sociedades de control», *L'Autre Journal*, 1990 (trad. en *Polis*, 2006)",
    img: "Torniquetes de acceso o una tarjeta electrónica.",
    note: "Las citas de las láminas siguientes son de la traducción publicada en la revista Polis, 5(13), 2006 [cotejar] con la de Pre-Textos." },

  { id: "control", b: 11, lv: 1, t: "quote", core: true, title: "Deleuze · Las sociedades de control",
    text: "Se trata de las sociedades de control, que están sustituyendo a las disciplinarias.",
    qsrc: "Gilles Deleuze, *Post-scriptum sobre las sociedades de control*, 1990",
    simple: "El poder ya no necesita encerrarte para dirigirte. Te acompaña a donde vayas y ajusta lo que te ofrece en cada momento.",
    note: "Frase de apertura de la tesis." },

  { id: "moldes", b: 11, lv: 1, t: "quote", core: false, title: "Deleuze · Moldes y modulación",
    text: "Los encierros son moldes o moldeados diferentes, mientras que los controles constituyen una modulación, como una suerte de molde autodeformante.",
    qsrc: "Gilles Deleuze, *Post-scriptum sobre las sociedades de control*, 1990",
    simple: "Un molde da una forma fija: la escuela o la fábrica te forman y luego te sueltan. Una modulación cambia todo el tiempo y se ajusta a ti de forma continua, como un precio que cambia según tu historial o un contenido que se adapta a tus clics.",
    note: "Es la bisagra entre Foucault y lo que sigue." },

  { id: "dividuales", b: 11, lv: 1, t: "quote", core: true, title: "Deleuze · Dividuales",
    text: "Los individuos han devenido “dividuales” y las masas se han convertido en indicadores, datos, mercados o “bancos”.",
    qsrc: "Gilles Deleuze, *Post-scriptum sobre las sociedades de control*, 1990",
    simple: "Ya no eres una persona indivisible, sino un **perfil**: datos, contraseñas y puntajes que abren o cierran puertas. Deleuze lo ilustra con una ciudad imaginada por Guattari, donde cada quien sale de su casa con una tarjeta electrónica que abre unas barreras y no otras. Hoy: el historial crediticio, el perfil publicitario, el algoritmo de recomendación.",
    note: "«Dividual»: lo que se puede dividir en datos. Es el concepto de Deleuze que mejor anticipa el presente." },

  { id: "endeudado", b: 11, lv: 1, t: "quote", core: false, title: "Deleuze · Endeudado",
    text: "El hombre ya no está encerrado sino endeudado.",
    qsrc: "Gilles Deleuze, *Post-scriptum sobre las sociedades de control*, 1990",
    simple: "El control no necesita muros si te mantiene comprometido de por vida: con la deuda, con la formación que nunca termina, con la evaluación permanente.",
    note: "Frase breve; dejarla en silencio unos segundos antes de explicarla." },

  { id: "deleuze-han", b: 11, lv: 2, t: "two", core: false, title: "De Deleuze a Han",
    two: [
      { h: "Deleuze (1990)", p: ["Describe el control como algo que **se ejerce sobre nosotros**: barreras, tarjetas, deuda, evaluación.", "Todavía es un poder que se impone."] },
      { h: "Han (2014–2021)", p: ["Añade que, en el régimen de la información, el control **se acepta voluntariamente** y se vive como libertad.", "Entregamos los datos con gusto: no hace falta imponer nada."] }],
    foot: "Última línea del *Post-scriptum*: «No hay lugar para el temor ni para la esperanza, sólo cabe buscar nuevas armas». La retomamos al final.",
    img: "Pantallas encendidas en una habitación oscura.",
    note: "Puente al bloque de Han." },

  // ════════ 12 · HAN
  { id: "han", b: 12, lv: 3, t: "bio", core: true, ti: "Byung-Chul Han", name: "Byung-Chul Han", meta: "Seúl, 1959",
    role: "Filósofo surcoreano que vive y escribe en alemán, en Berlín. Estudió metalurgia en Corea, y filosofía, literatura y teología en Alemania. Escribe ensayos breves, de gran difusión, sobre la sociedad digital.",
    works: [["La sociedad del cansancio (2010)", "del deber al rendimiento: la autoexplotación."],
      ["En el enjambre (2013)", "la multitud digital, sin espacio público."],
      ["Psicopolítica (2014)", "el poder que ya no se dirige al cuerpo, sino a la mente."],
      ["Infocracia (2021)", "la digitalización y la crisis de la democracia."]],
    why: "Cómo leerlo: brillante como diagnóstico, débil como evidencia. Es una hipótesis poderosa que al final pondremos a prueba.",
    img: "Calle de Berlín o de Seúl de noche, con pantallas.",
    note: "Infocracia: Taurus, 2022, trad. Joaquín Chamorro Mielke. Libros cortos y sin aparato empírico." },

  { id: "psicopolitica", b: 12, lv: 1, t: "concept", core: true, title: "¿Qué es la psicopolítica?",
    def: "La **psicopolítica** es la forma de poder que ya no disciplina el cuerpo, sino que predice y orienta la mente a partir de los datos que entregamos voluntariamente.",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Explicación", p: "El poder disciplinario decía «no debes»; el psicopolítico dice «**puedes**». No reprime: seduce. La libertad misma se vuelve el medio de control." },
      { l: "Contraste", items: [["Disciplina", "Cuerpo · coacción · obediencia."], ["Psicopolítica", "Mente · seducción · participación."]] },
      { l: "Ejemplo", p: "Nadie nos obliga a publicar dónde estamos, qué comemos o qué pensamos: lo hacemos con gusto. Esos datos permiten **predecir y orientar** lo que haremos." }],
    src: "Byung-Chul Han, *Psicopolítica*, Herder, 2014 · *Infocracia*, Taurus, 2022",
    note: "Contraste con el panóptico: en el de Bentham el preso no ve al vigilante; en el digital, el vigilado se exhibe." },

  { id: "transparente", b: 12, lv: 1, t: "quote", core: false, title: "Han · La prisión transparente",
    text: "La prisión digital es transparente.",
    qsrc: "Byung-Chul Han, *Infocracia*, 2022, p. 15",
    simple: ["En el panóptico de Bentham el preso se sabía observado. En el digital nadie se siente preso: **nos exhibimos por gusto**, y esa exposición voluntaria es la que permite el control.",
      "Han: la dominación se consuma cuando libertad y vigilancia coinciden."],
    note: "La cita con página viene de la reseña de Cardozo Achury (Redalyc) [cotejar]. La segunda idea es paráfrasis de una frase citada en la reseña de Entreletras." },

  { id: "cambio-regimen", b: 12, lv: 2, t: "chain", core: true, title: "Cambio de régimen: de la disciplina a la infocracia",
    stages: [["Régimen disciplinario", ["Cuerpo", "Coacción", "Encierro"], "Poder sobre el cuerpo, en instituciones cerradas (Foucault)."],
      ["Mediocracia", ["Medios de masas", "Espectáculo", "Receptores pasivos"], "Era de la televisión: la política se vuelve espectáculo —*teatrocracia*— y el público mira."],
      ["Infocracia", ["Información", "Seducción", "Emisores activos"], "Era digital: todos emiten, nadie escucha. El discurso se disuelve en intercambio de información."]],
    foot: "Resultado, según Han: ciudadanos convertidos en «zombis del consumo y la comunicación, en lugar de ciudadanos capacitados» (p. 44).",
    src: "Byung-Chul Han, *Infocracia*, 2022, caps. 1 y 2",
    img: "Familia frente al televisor, años sesenta.",
    note: "Mediocracia y teatrocracia son términos de Han para la era de los medios de masas. Cita de la p. 44 según la reseña de Redalyc [cotejar]." },

  { id: "postman", b: 12, lv: 2, t: "concept", core: false, title: "La mediocracia según Neil Postman (1985)",
    dl: "Huxley, no Orwell",
    def: "Orwell temía a quienes nos privaran de información. Huxley temía a quienes nos dieran tanta que quedáramos reducidos a la pasividad y al egoísmo. Orwell temía que se nos ocultara la verdad; Huxley, que **la verdad se ahogara en un mar de irrelevancia**.",
    defsrc: "Neil Postman, *Divertirse hasta morir*, 1985, prólogo (trad. propia)",
    cols: "1fr 1fr",
    boxes: [
      { l: "Qué dice", p: "Cada medio tiene su propia forma de conocer: la imprenta favorece el argumento; la televisión, la imagen y el entretenimiento. Cuando la televisión domina, todo —política, educación, noticias— se vuelve espectáculo." },
      { l: "Por qué aquí", dark: true, p: "Es la mejor descripción de la mediocracia de Han, escrita cuarenta años antes y sin jerga. La infocracia no cancela a Huxley: **lo lleva al extremo**." }],
    img: "Pantalla de televisión antigua encendida.",
    note: "Del prólogo de Amusing Ourselves to Death. Remata con: «Orwell temía que lo que odiamos nos arruinara. Huxley temía que lo que amamos nos arruinara»." },

  { id: "infocracia", b: 12, lv: 1, t: "concept", core: true, title: "¿Qué es la infocracia?",
    def: "La **infocracia** es la forma que toma la democracia bajo el régimen de la información: el discurso, que requiere escuchar, argumentar y esperar, es sustituido por el intercambio acelerado de información.",
    quote: "La crisis de la democracia es ante todo una crisis del escuchar.",
    qsrc: "Byung-Chul Han, *Infocracia*, 2022, p. 48",
    cols: "1fr 1fr",
    boxes: [
      { l: "Explicación", p: "La información es **aditiva y fragmentaria**: se acumula, pero no construye relato ni comunidad. Circula más rápido de lo que se puede pensar." },
      { l: "Retoma a Habermas", p: "La esfera pública se desintegra en grupos que solo se oyen a sí mismos: las semiesferas que vimos." }],
    note: "Cita de la p. 48 según la reseña de Redalyc [cotejar]." },

  { id: "erosiones", b: 12, lv: 2, t: "table", core: false, title: "Lo que la infocracia erosiona",
    cols: "190px 1.25fr 1fr", head: ["Erosión", "En palabras de Han", "Qué significa"],
    rows: [["La escucha", "«La crisis de la democracia es ante todo una crisis del escuchar.»", "Todos hablan; nadie atiende al otro."],
      ["La deliberación", "«La coerción de acelerar la comunicación nos priva de la racionalidad.»", "No hay tiempo para argumentar."],
      ["La narrativa", "«Las narraciones se desintegran y acaban en informaciones.»", "Los datos sueltos no dan sentido ni orientación."],
      ["El otro", "«El otro está en trance de desaparición.»", "Solo nos oímos a nosotros mismos."],
      ["La verdad", "«La información circula ahora, completamente desconectada de la realidad.»", "Es el último capítulo del libro y el bloque de posverdad."]],
    src: "Byung-Chul Han, *Infocracia*, 2022",
    img: "Muro con carteles rasgados y superpuestos.",
    note: "Frases citadas en las reseñas de Entreletras y J. S. Rivera, sin número de página [cotejar] todas en el ejemplar." },

  { id: "infoxicacion", b: 12, lv: 2, t: "concept", core: false, title: "Infoxicación y economía de la atención",
    def: "**Infoxicación**: intoxicación por exceso de información; la incapacidad de procesar todo lo que se recibe.",
    defsrc: "Término de Alfons Cornella, 1996",
    quote: "Una riqueza de información crea una pobreza de atención.",
    qsrc: "Herbert Simon, 1971 (trad. propia)",
    cols: "1fr 1fr",
    boxes: [
      { l: "Explicación", p: "Cuando la información sobra, lo escaso es la **atención**, y lo escaso es lo que se compra y se vende: esa es la economía de la atención." },
      { l: "Con Han", p: "Más información no produce más conocimiento, sino menos capacidad de juzgar. Y **no hace falta censurar si se puede inundar**." }],
    img: "Escritorio sepultado en papeles, o una hemeroteca desbordada.",
    note: "Simon, «Designing Organizations for an Information-Rich World», 1971. El término infoxicación no es de Han." },

  { id: "psicometria", b: 12, lv: 2, t: "stats", core: true, title: "Psicometría: conocerte mejor que tu familia",
    h: "Cuántos «me gusta» de Facebook necesitó un modelo para juzgar tu personalidad mejor que…",
    stats: [["10", "un colega de trabajo"], ["70", "un amigo"], ["150", "tu familia"], ["300", "tu pareja"]],
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Qué es", p: "La **psicometría** mide rasgos psicológicos (personalidad, actitudes). Con datos digitales se puede hacer sin cuestionarios." },
      { l: "Cambridge Analytica (2018)", p: "Datos de hasta 87 millones de usuarios de Facebook, obtenidos sin consentimiento, para enviar propaganda electoral según el perfil de cada persona." },
      { l: "Capitalismo de la vigilancia", p: "Shoshana Zuboff (2019): las plataformas convierten nuestra conducta en *excedente conductual* y venden *productos de predicción*." }],
    src: "Youyou, Kosinski y Stillwell, *PNAS*, 112(4), 2015 (86 220 participantes) · Zuboff, *La era del capitalismo de la vigilancia*, 2019",
    img: "Cuestionario, formulario o tarjeta perforada.",
    note: "Es la evidencia empírica de lo que Han llama psicopolítica. Han usa el caso Cambridge Analytica como ejemplo." },

  { id: "algoritmos", b: 12, lv: 2, t: "concept", core: true, title: "Algoritmos e intenciones",
    dl: "Qué optimiza un algoritmo",
    def: "El algoritmo de recomendación no optimiza verdad ni calidad. Optimiza la **probabilidad de que reacciones**.",
    cols: "1fr 1fr",
    boxes: [
      { l: "Qué favorece", p: "Lo que más reacción produce: indignación, sorpresa, pertenencia. Cada palabra moral-emocional aumenta la difusión de un mensaje político: ≈20 % en el estudio original; ≈13 % en un metaanálisis de 27 estudios (2025)." },
      { l: "Captura de valores", p: "C. Thi Nguyen (2024): la plataforma sustituye nuestros fines difusos —conversar, entender— por métricas nítidas —likes, seguidores—, y terminamos queriendo la métrica." },
      { l: "¿Y la intención?", dark: true, span: 2, p: "No hace falta atribuir malicia: basta un objetivo mal elegido y una escala inmensa. La intención no está en el algoritmo, sino en la función que una empresa eligió optimizar. Han: «la política y la gobernanza son sustituidas por la planificación, el control y el condicionamiento» (p. 68)." }],
    src: "Brady et al., *PNAS*, 2017; metaanálisis en *PNAS Nexus*, 2025 · Nguyen, «Value Capture», *JESP*, 2024 · Han, *Infocracia*, 2022",
    img: "Sala de control o tablero de instrumentos.",
    note: "El metaanálisis de 2025 (27 estudios, 4.8 millones de mensajes) confirma el efecto, más pequeño que el original. Cita de la p. 68 según la reseña de Redalyc [cotejar]." },

  { id: "sintesis-han", b: 12, lv: 1, t: "statement", core: true, title: "Síntesis de Han",
    text: "El poder ya no prohíbe: seduce. Ya no censura: inunda. Ya no vigila desde fuera: nos exhibimos.",
    simple: "El resultado no es una sociedad más informada, sino una que ya no distingue. De ahí nace lo que Han llama la crisis de la verdad: la posverdad.",
    sl: "Qué se sigue",
    note: "Síntesis propia en cuatro frases." },
);

SLIDES.push(
  // ════════ 13 · POSVERDAD
  { id: "sec-posverdad", b: 13, lv: 3, t: "section", core: true, h: "Posverdad",
    what: "Qué es la posverdad, de dónde viene la palabra, ejemplos, qué la explica y qué dice la evidencia empírica.",
    why: "Es el punto donde se juntan todos los conceptos anteriores: creencia, testimonio, verdad de hecho, vicios, régimen.",
    img: "Cartel de propaganda de guerra o muro con consignas contradictorias." },

  { id: "posverdad", b: 13, lv: 1, t: "concept", core: true, title: "¿Qué es la posverdad?",
    dl: "Definición desde Han",
    def: "La **posverdad** no es el triunfo de la mentira sobre la verdad, sino la **indiferencia** hacia ella: un régimen en el que la información circula sin relación con los hechos.",
    quote: "La información circula ahora, completamente desconectada de la realidad, es un espacio hiperreal.",
    qsrc: "Byung-Chul Han, *Infocracia*, cap. «La crisis de la verdad»",
    cols: "1fr 1fr 1fr",
    boxes: [
      { l: "Explicación simple", p: "El problema no es que haya más mentiras, sino que **ya no importa si algo es verdad**: lo que cuenta es la velocidad y la reacción. Es el vicio de la indiferencia convertido en ambiente." },
      { l: "Definición de diccionario", p: "Oxford, palabra del año 2016: circunstancias en que los hechos objetivos influyen menos en la opinión pública que las apelaciones a la emoción y a la creencia personal." },
      { l: "Han sobre la verdad", q: "La verdad […] elevada a la categoría de relato, proporciona sentido y orientación. La sociedad de la información, en cambio, está vacía de sentido.", qs: "Han, *Infocracia* [cotejar]" }],
    note: "Las citas de Han vienen de la lectura de J. S. Rivera del capítulo «La crisis de la verdad» [cotejar] páginas en el ejemplar." },

  { id: "origen", b: 13, lv: 2, t: "table", core: false, title: "De dónde viene la palabra, y su crítica",
    cols: "250px 1fr", head: ["Momento", "Qué pasó"], lg: true,
    rows: [["1992 · Steve Tesich", "El dramaturgo la usa en *The Nation* a propósito del caso Irán-Contra y la Guerra del Golfo: «hemos decidido libremente que queremos vivir en un mundo de posverdad»."],
      ["2004 · Ralph Keyes", "Publica *The Post-Truth Era*: la mentira deja de avergonzar."],
      ["2016 · Diccionarios Oxford", "Palabra del año, por el Brexit y la elección de Donald Trump."],
      ["La crítica", "¿Hubo alguna vez una era de la verdad? La propaganda y la mentira de Estado son tan viejas como la política. Lo nuevo es la velocidad, la desaparición del filtro editorial y que cualquiera puede producir evidencia aparente."]],
    foot: "«Posverdad» es útil como nombre de una época, pero peligrosa como explicación: no aclara qué cambió. Eso lo hacen Arendt y Han.",
    img: "Rueda de prensa o podio vacío.",
    note: "La frase de Tesich es traducción propia de «we, as a free people, have freely decided that we want to live in some post-truth world»." },

  { id: "arendt", b: 13, lv: 2, t: "table", core: true, title: "Hannah Arendt: tres ideas sobre la verdad de hecho",
    cols: "240px 1.2fr 1fr", head: ["Idea", "En sus palabras (trad. propia)", "Qué significa"],
    rows: [["1 · Los hechos son frágiles", "«Los hechos y los acontecimientos son cosas infinitamente más frágiles que los axiomas, los descubrimientos y las teorías.»", "Dependen de testigos y registros: si desaparecen, desaparece el hecho."],
      ["2 · La mentira organizada busca desorientar", "El resultado de sustituir los hechos por mentiras no es que se crea la mentira, sino que «el sentido con el que nos orientamos en el mundo real […] queda destruido».", "El objetivo no es que creas la mentira, sino que dejes de poder distinguir."],
      ["3 · El sujeto ideal del totalitarismo", "No es el convencido, sino «aquel para quien la distinción entre hecho y ficción […] y entre verdadero y falso […] ya no existe».", "El poder no necesita convencidos: necesita gente que ya no distinga."]],
    src: "Hannah Arendt, «Verdad y política», 1967 · *Los orígenes del totalitarismo*, 1951",
    img: "Retrato de época o mesa de trabajo con máquina de escribir.",
    note: "Traducciones propias del inglés [cotejar] con las ediciones en español (Península; Taurus/Alianza). Arendt escribió antes de internet y describe con precisión el estado final que el entorno digital facilita. Han la cita en Infocracia." },

  { id: "manguera", b: 13, lv: 2, t: "concept", core: false, title: "La manguera de falsedades",
    def: "La **manguera de falsedades** (*firehose of falsehood*) es una forma de propaganda de alto volumen, por muchos canales, rápida y repetitiva, sin compromiso con la realidad ni con la coherencia.",
    defsrc: "Christopher Paul y Miriam Matthews, RAND Corporation, 2016",
    cols: "1fr 1fr",
    boxes: [
      { l: "Por qué funciona", p: "No busca convencer de algo en particular: busca **agotar**, saturar la capacidad de evaluar hasta que el receptor se rinde. Funciona aunque se contradiga." },
      { l: "Censura por adición", p: "La censura clásica quitaba información; la actual la inunda. No hace falta silenciar a un periodista si su nota queda ahogada bajo mil versiones. Es Arendt convertida en manual operativo." }],
    src: "Paul y Matthews, *The Russian «Firehose of Falsehood» Propaganda Model*, RAND, 2016 · Guriev y Treisman, *Spin Dictators*, 2022",
    img: "Muro saturado de carteles o pantallas.",
    note: "RAND describe el modelo de propaganda ruso contemporáneo; Guriev y Treisman documentan el giro de los autoritarismos hacia la manipulación informativa. «Censura por adición» es una síntesis propia de ambos." },

  { id: "ejemplos", b: 13, lv: 1, t: "cases", core: true, title: "Ejemplos de posverdad",
    lead: "Dos casos internacionales y dos mexicanos de signo político contrario, elegidos a propósito. En los cuatro, el hecho no se refuta: se vuelve irrelevante.",
    items: [{ t: "«Hechos alternativos»", m: "Estados Unidos · 2017", p: "Kellyanne Conway, asesora del presidente Trump, defendió en NBC (22 de enero) cifras falsas sobre la asistencia a la toma de posesión llamándolas «hechos alternativos».", w: "No se discute el hecho: se declara que hay otro." },
      { t: "Los 350 millones del Brexit", m: "Reino Unido · 2016", p: "La campaña afirmó en un autobús que el país enviaba 350 millones de libras semanales a la UE. La autoridad estadística británica lo calificó de «claro mal uso de las estadísticas oficiales».", w: "El dato se siguió repitiendo refutado." },
      { t: "«Yo tengo otros datos»", m: "México · 2019", p: "Frase del presidente López Obrador en la conferencia matutina para responder a cifras de prensa u oficiales, como las de empleo del IMSS y el Inegi (20 de junio de 2019).", w: "No niega el dato: lo desplaza." },
      { t: "«#FraudeElectoral»", m: "México · 2024", p: "Tras la elección de junio circuló, desde usuarios, personalidades de la oposición y algunos medios, la tendencia «fraude electoral» (más de 116 000 publicaciones en X). Verificado desmintió las pruebas presentadas.", w: "La sospecha sustituye a la prueba." }],
    src: "NBC, *Meet the Press*, 22/01/2017 · UK Statistics Authority, 2017 · *La Silla Rota*, 12/11/2019 · Verificado, 05/06/2024",
    note: "Decir en voz alta el criterio del pareo. En el caso de 2024, Verificado muestra que las «pruebas» comparaban casillas distintas y confundían municipios con distritos." },

  { id: "discusion", b: 13, lv: 2, t: "table", core: false, title: "Discusión: la posverdad con todo lo anterior",
    cols: "250px 1fr", head: ["Concepto de la sesión", "Qué explica de la posverdad"],
    rows: [["Creencia y justificación (Platón)", "Se cree por pertenencia, no por razones: falla la condición de justificación."],
      ["Testimonio", "Llega sin señales de credibilidad: no sabemos de quién depender."],
      ["Verdad de hecho (Arendt)", "Es la única que se puede negar, porque solo se atestigua."],
      ["Esfera pública (Habermas)", "Sin filtro editorial ni hechos compartidos, no hay deliberación."],
      ["Régimen de verdad (Foucault)", "Cambió quién decide qué funciona como verdadero."],
      ["Control (Deleuze) y psicopolítica (Han)", "El control se acepta voluntariamente y se vive como libertad."],
      ["Indiferencia (Frankfurt, Cassam)", "Es el vicio que define el ambiente: ya no importa si algo es verdad."]],
    img: "Mesa redonda o asamblea.",
    note: "Recorrer la sesión de regreso en dos minutos." },

  { id: "caemos", b: 13, lv: 2, t: "table", core: true, title: "Flaquezas: por qué caemos",
    lead: "No caemos por falta de inteligencia. La investigación muestra mecanismos que afectan a todos:",
    cols: "1fr 1.4fr 230px", head: ["Hallazgo", "Qué muestra", "Fuente"], kb: true, e: 2,
    rows: [["Más capacidad analítica, más polarización", "La misma tabla de datos, presentada como crema para la piel o como ley de armas: en la versión política, quienes tienen más habilidad numérica se polarizan más.", "Kahan et al., 2017"],
      ["Lo repetido suena verdadero", "La repetición aumenta la sensación de verdad, incluso en quien sabe que la afirmación es falsa.", "Fazio et al., 2015"],
      ["Creer sirve para pertenecer", "Muchas afirmaciones no describen el mundo: señalan de qué lado estás. Por eso corregir se siente como ataque.", "Kahan, cognición cultural"],
      ["¿Pereza o motivación?", "Otro programa sostiene que el problema es la falta de reflexión, no la lealtad al grupo. El debate sigue abierto.", "Pennycook y Rand, 2019"]],
    src: "Kahan, Peters, Dawson y Slovic, *Behavioural Public Policy*, 2017 · Fazio et al., *JEP: General*, 2015 · Pennycook y Rand, *Cognition*, 2019",
    img: "Multitud en un estadio o un mitin.",
    note: "Presentar el debate Kahan–Pennycook como debate abierto, sin resolverlo: es una muestra de cómo se ve el conocimiento honesto en construcción." },

  { id: "diagnostico-1", b: 13, lv: 2, t: "concept", core: true, title: "Flaquezas del diagnóstico (1): algoritmos y exposición",
    dl: "Lo que la evidencia matiza",
    def: "Las burbujas de filtro existen como patrón de exposición, pero cambiar el algoritmo **no cambió las actitudes**; y la exposición a lo falso es **baja y concentrada** en una minoría.",
    cols: "1.2fr 1fr",
    boxes: [
      { l: "Estudios con Meta (2020, publicados en 2023)", items: [["Qué se hizo", "Experimentos con unos 23 000 usuarios de Facebook e Instagram en EE. UU. durante tres meses: feed cronológico, sin contenido reenviado, o con un tercio menos de fuentes afines."], ["Qué se encontró", "Ningún efecto medible en polarización ni en actitudes."], ["Críticas", "Ventana corta, elección atípica y cambios de emergencia de Meta durante el estudio."]] },
      { l: "Budak et al. (*Nature*, 2024)", items: [["Exposición", "Lo falso es una parte ínfima de la dieta informativa de la mayoría."], ["Concentración", "El consumo se concentra en una minoría que lo busca activamente."], ["Algoritmos", "La demanda de las personas pesa más que la recomendación."]] }],
    src: "Guess et al. y Nyhan et al., *Science* y *Nature*, 2023 · Bagchi et al., *Science*, 2024 · Budak, Nyhan, Rothschild, Thorson y Watts, *Nature*, 630, 2024",
    img: "Laboratorio o archivo estadístico.",
    note: "Un curso que no diga esto cae en el mismo pecado que denuncia. Los datos son de EE. UU.; no hay equivalente mexicano y hay que decirlo." },

  { id: "diagnostico-2", b: 13, lv: 2, t: "concept", core: true, title: "Flaquezas del diagnóstico (2): corregir y la historia",
    dl: "Lo que la evidencia matiza",
    def: "Corregir **sí funciona**, y la manipulación de la información no empezó con internet. Lo que cambió es la velocidad, el filtro y la escala.",
    cols: "1fr 1fr",
    boxes: [
      { l: "El efecto de retroceso que no se replicó", p: "En 2010 se reportó que corregir una creencia falsa podía reforzarla. Wood y Porter (2019) lo pusieron a prueba con más de 10 000 personas y 52 temas: **ninguna corrección produjo ese efecto**; las correcciones acercan a la verdad." },
      { l: "¿Hubo alguna vez una era de la verdad?", p: "Herman y Chomsky (1988) mostraron cómo la prensa filtraba la información sin censura: propiedad, publicidad, fuentes oficiales. El filtro siempre existió; hoy cambió de dueño y de velocidad." },
      { l: "Conclusión", dark: true, span: 2, p: "La evidencia no refuta a Han: lo **precisa**. Debilita la historia de la mentira omnipresente y fortalece la de la confianza rota." }],
    src: "Nyhan y Reifler, *Political Behavior*, 2010 · Wood y Porter, *Political Behavior*, 41, 2019 · Herman y Chomsky, *Los guardianes de la libertad*, 1988",
    img: "Periódicos apilados o una rotativa.",
    note: "El episodio del efecto de retroceso es también un caso de cómo circula la desinformación sobre la desinformación: un hallazgo débil y atractivo se volvió sentido común." },

  { id: "tesis", b: 13, lv: 1, t: "statement", core: true, title: "La tesis de la sesión",
    text: "La crisis no es principalmente de falsedad. Es de criterio.",
    simple: "Lo que se erosiona no es el acceso a los hechos —nunca hemos tenido más—, sino las condiciones del juicio compartido: la **confianza calibrada**, la **atención sostenida** y la existencia de un **mundo común**.",
    sl: "Qué significa",
    note: "Es la frase que el público debe llevarse." },

  { id: "confiar", b: 13, lv: 1, t: "statement", core: true, title: "Desconfiar no basta",
    text: "Enseñar a desconfiar sin enseñar cómo construir la confianza produce escépticos globales: presa perfecta para cualquiera que les ofrezca certeza.",
    simple: ["Es necesario crear una **disposición a confiar cuando la fuente lo merezca**.",
      "danah boyd observó que muchas personas que caen en teorías conspirativas se ven a sí mismas como pensadores críticos: aprendieron a dudar de todo, pero no a reconocer cuándo una fuente merece confianza. Es el escepticismo global del inicio de la sesión."],
    sl: "Lo que se sigue",
    src: "A partir de danah boyd, «Did Media Literacy Backfire?», 2017, y Onora O'Neill, *A Question of Trust*, 2002",
    note: "La frase resume la advertencia de boyd; la segunda parte es la tesis de O'Neill sobre la confianza bien colocada." },

  // ════════ 14 · QUÉ SIGUE
  { id: "que-sigue", b: 14, lv: 2, t: "table", core: true, title: "Qué sigue: lo que no vimos hoy",
    cols: "270px 1fr", head: ["Tema", "Qué veremos"], lg: true,
    rows: [["Inteligencia artificial", "Deepfakes y el *dividendo del mentiroso*: cuando todo puede ser falso, todo se puede negar. Los asistentes de IA como fuente sin fuentes."],
      ["Burbujas y cámaras de eco", "No son lo mismo: en la burbuja faltan voces; en la cámara de eco, las voces de fuera están desacreditadas (C. Thi Nguyen)."],
      ["Defensas", "Evaluar la fuente antes que el contenido: lectura lateral, el método SIFT y la inoculación contra la manipulación."],
      ["Instituciones", "¿Quién verifica al verificador? De Verificado 2018 al «Detector de mentiras» de la conferencia matutina."]],
    img: "Camino, vía de tren o puerta abierta.",
    note: "Anticipo de la segunda sesión del curso completo de cuatro sesiones." },

  // ════════ 15 · CIERRE
  { id: "evaluacion", b: 15, lv: 1, t: "qr", core: true, title: "Antes de irte",
    items: [["Encuesta de Evaluación del Desempeño Docente.jpeg", "Encuesta de Evaluación del Desempeño Docente"]],
    note: "Pedir que contesten la encuesta antes de salir; dejar la lámina proyectada unos minutos." },

  { id: "gracias", b: 15, lv: 3, t: "close", core: true, ti: "Gracias",
    h: "Gracias",
    quote: "No hay lugar para el temor ni para la esperanza, sólo cabe buscar nuevas armas.",
    qsrc: "Gilles Deleuze, *Post-scriptum sobre las sociedades de control*, 1990",
    img: "La foto más fuerte de la sesión: una persona sola frente a una multitud, o un lector bajo una lámpara.",
    note: "Alternativa de Han: «la verdadera democracia necesita de aquellas personas que se atreven a decir la verdad» [cotejar]." },

  { id: "contacto", b: 15, lv: 3, t: "contact", core: false, ti: "Contacto",
    who: "René Samael Flores Ortega", mail: "samaelflores@taudux.com",
    extra: "Bibliografía completa en el documento de desarrollo del curso.",
    img: "La misma imagen de la portada." },
);

window.addEventListener("error", function (e) {
  var d = document.getElementById("jserr"); if (!d) { d = document.createElement("div"); d.id = "jserr";
    d.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99;background:#b00;color:#fff;font:14px/1.4 sans-serif;padding:10px 14px;max-width:80vw";
    document.body.appendChild(d); }
  d.textContent = "Error al cargar la presentación: " + e.message + " (línea " + e.lineno + ")";
});
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const md = s => s == null ? "" : esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[cotejar\]/g, '<mark class="cj">cotejar</mark>');
  const pad = n => String(n).padStart(2, "0");
  const sc = c => String(c).replace(/(\d+(?:\.\d+)?)px/g, "calc($1px*var(--k))");
  const arr = x => x == null ? [] : (Array.isArray(x) ? x : [x]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const stage = $("#stage");

  // ───────── Piezas
  const SRC = s => s.src ? `<div class="src">${md(s.src)}</div>` : "";
  const FOOT = s => s.foot ? `<div class="foot">${md(s.foot)}</div>` : "";
  const LEAD = s => s.lead ? `<p class="lead">${md(s.lead)}</p>` : "";
  const H2 = s => s.h ? `<p class="h2">${md(s.h)}</p>` : "";
  function box(b) {
    const q = b.q ? `<p class="qt">«${md(b.q)}»${b.qs ? `<span class="qs">${md(b.qs)}</span>` : ""}</p>` : "";
    const ps = arr(b.p).map(p => `<p>${md(p)}</p>`).join("");
    const its = arr(b.items).map(i => `<div class="it">${i[0] ? `<b>${md(i[0])}</b>` : ""}${md(i[1])}</div>`).join("");
    return `<div class="bx${b.dark ? " dark" : ""}"${b.span ? ` style="grid-column:span ${b.span}"` : ""}><span class="lab">${md(b.l)}</span>${q}${ps}${its}</div>`;
  }
  const BOXES = s => s.boxes ? `<div class="bxs" style="grid-template-columns:${sc(s.cols || `repeat(${s.boxes.length},1fr)`)}">${s.boxes.map(box).join("")}</div>` : "";
  const SIMPLE = (label, p) => p ? `<div class="simple"><span class="sl">${md(label)}</span>${arr(p).map(x => `<p>${md(x)}</p>`).join("")}</div>` : "";

  function content(s) {
    switch (s.t) {
      case "concept": return `${LEAD(s)}
        <div class="dbox"><span class="lab">${md(s.dl || "Definición")}</span><p class="dt">${md(s.def)}</p>${s.defsrc ? `<p class="ds">${md(s.defsrc)}</p>` : ""}</div>
        ${s.quote ? `<div class="dq">«${md(s.quote)}»<span class="qs">${md(s.qsrc)}</span></div>` : ""}
        ${BOXES(s)}${FOOT(s)}${SRC(s)}`;
      case "statement": return `<p class="big">${md(s.text)}</p>${SIMPLE(s.sl || "Explicación", s.simple)}${FOOT(s)}${SRC(s)}`;
      case "quote": return `<p class="bigq${s.para ? " para" : ""}">${s.para ? md(s.text) : "«" + md(s.text) + "»"}</p>
        ${s.qsrc ? `<span class="cite">${md(s.qsrc)}</span>` : ""}${SIMPLE(s.sl || "En palabras simples", s.simple)}`;
      case "list5": return `${LEAD(s)}<div class="q5">${s.items.map((q, i) => `<div class="q5r"><div class="n">${i + 1}</div>
        <div class="qq"><b>${md(q[0])}</b><span>${md(q[1])}</span></div><div class="tg"><i>Se ve en</i>${md(q[2])}</div></div>`).join("")}</div>${SRC(s)}`;
      case "table": {
        const n = s.head ? s.head.length : s.rows[0].length;
        const head = s.head ? s.head.map(h => `<div class="th">${md(h)}</div>`).join("") : "";
        const rows = s.rows.map(r => r.map((c, j) => `<div class="td${j === (s.k == null ? 0 : s.k) ? (s.kb ? " kb" : " k") : ""}${j === s.e ? " e" : ""}">${md(c)}</div>`).join("")).join("");
        return `${LEAD(s)}${H2(s)}<div class="tb${s.lg ? " lg" : ""}" style="grid-template-columns:${sc(s.cols || `repeat(${n},1fr)`)}">${head}${rows}</div>${BOXES(s)}${FOOT(s)}${SRC(s)}`;
      }
      case "stats": return `${H2(s)}<div class="sts" style="grid-template-columns:repeat(${s.stats.length},1fr)">${s.stats.map(x => `<div class="st"><b>${md(x[0])}</b><p>${md(x[1])}</p></div>`).join("")}</div>${BOXES(s)}${FOOT(s)}${SRC(s)}`;
      case "cards": return `${LEAD(s)}<div class="cards" style="grid-template-columns:repeat(${s.ncol || 3},1fr)">${s.items.map((x, i) => `<div class="card${s.hl === i ? " hl" : ""}"><b>${md(x[0])}</b><p>${md(x[1])}</p>${x[2] ? `<p class="x">${md(x[2])}</p>` : ""}</div>`).join("")}</div>${BOXES(s)}${FOOT(s)}${SRC(s)}`;
      case "chain": return `${LEAD(s)}<div class="chain">${s.stages.map((st, i) => `${i ? `<div class="arr">→</div>` : ""}<div class="stg${i === s.stages.length - 1 ? " hl" : ""}"><b>${md(st[0])}</b><div class="kw">${st[1].map(k => `<span>${md(k)}</span>`).join("")}</div><p>${md(st[2])}</p></div>`).join("")}</div>${BOXES(s)}${FOOT(s)}${SRC(s)}`;
      case "two": return `${LEAD(s)}<div class="two">${s.two.map(c => `<div class="col"><div class="ch">${md(c.h)}</div>${c.big ? `<p class="cq">${md(c.big)}</p>` : ""}${arr(c.p).map((p, i) => `<p class="cp${c.qi === i ? " q" : ""}">${md(p)}</p>`).join("")}</div>`).join("")}</div>${BOXES(s)}${FOOT(s)}${SRC(s)}`;
      // Las imágenes viven en una carpeta compartida de Slides para que otras
      // presentaciones las reusen; sus nombres llevan espacios y acentos. La ruta
      // va absoluta: en producción cleanUrls quita el index.html y la barra final,
      // y una ruta relativa con ../ subiría un nivel de más.
      case "qr": return `${LEAD(s)}<div class="qrs">${s.items.map(q => `<figure class="qr">
        <img src="/content/slides/30-ocr-2026_QR/${encodeURIComponent(q[0])}" alt="Código QR: ${esc(q[1])}">
        <figcaption>${md(q[1])}</figcaption></figure>`).join("")}</div>${FOOT(s)}`;
      case "cases": return `${LEAD(s)}<div class="cases">${s.items.map(c => `<div class="case"><div class="chd"><b>${md(c.t)}</b><span>${md(c.m)}</span></div><p>${md(c.p)}</p><p class="w">${md(c.w)}</p></div>`).join("")}</div>${SRC(s)}`;
    }
    return "";
  }

  function n3(s) {
    switch (s.t) {
      case "cover": return `
        <div class="blk bs abs" style="left:0;top:70px">${md(s.org)}</div>
        <div class="stk" style="bottom:118px"><div class="blk bt">${md(s.h)}</div><div class="blk bsub">${md(s.sub)}</div><div class="blk bs">${md(s.who)}</div></div>`;
      case "section": return `
        <div class="blk bn abs" style="left:0;top:96px">${pad(s.b)}</div>
        <div class="stk" style="bottom:92px"><div class="blk bt">${md(s.h)}</div>
          <div class="blk bb"><p><span class="l">Qué veremos</span>${md(s.what)}</p><p style="margin:0"><span class="l">Por qué importa</span>${md(s.why)}</p></div></div>`;
      case "bio": return `
        <div class="blk bn abs" style="left:0;top:70px">${pad(s.b)}</div>
        <div class="stk" style="bottom:74px"><div class="blk bt" style="font-size:52px">${md(s.name)}</div>
          <div class="blk bb"><p><span class="l">${md(s.meta)}</span>${md(s.role)}</p>
          <span class="l" style="margin-top:12px">Obras principales</span><ul>${s.works.map(w => `<li><em>${md(w[0])}</em> — ${md(w[1])}</li>`).join("")}</ul>
          ${s.why ? `<p style="margin:12px 0 0"><span class="l">Por qué importa aquí</span>${md(s.why)}</p>` : ""}</div></div>`;
      case "close": return `
        <div class="stk" style="bottom:140px"><div class="blk bt">${md(s.h)}</div>
          <div class="blk bb" style="font:italic 400 30px/1.4 var(--serif);max-width:1100px">«${md(s.quote)}»<span class="l" style="margin-top:14px;font-style:normal">${md(s.qsrc)}</span></div></div>`;
      case "contact": return `
        <div class="stk" style="bottom:190px"><div class="blk bt" style="font-size:42px">${md(s.who)}</div>
          <div class="blk bs">${md(s.mail)}</div><div class="blk bb">${md(s.extra)}</div></div>`;
    }
    return "";
  }

  // ───────── Construcción
  SLIDES.forEach((s, i) => { try {
    s.ti = String(s.ti || s.title || s.h || s.name || s.id).replace(/\*/g, "");
    const el = document.createElement("section");
    el.className = `slide lv${s.lv} t-${s.t}`;
    el.dataset.id = s.id;
    const x = 30 + ((i * 37) % 45), y = 26 + ((i * 23) % 38);
    const img = s.lv >= 2 ? `<div class="ph" style="--x:${x}%;--y:${y}%;--img:url('img/${s.id}.jpg'),url('img/${s.id}.png')"><i></i><b></b></div>
      <div class="cap"><b>img/${s.id}.jpg</b>${esc(s.img || "")}</div>` : "";
    let body;
    if (s.lv === 3) body = n3(s);
    else {
      const mid = (s.t === "statement" || s.t === "quote") ? " mid" : "";
      body = `<div class="hdr"><div class="tag">${pad(s.b)} · ${esc(BLOCKS[s.b])}</div><div class="ttl">${md(s.title)}</div></div>
        <div class="cnt${mid}">${content(s)}</div>`;
    }
    const left = s.lv === 3 ? (s.t === "cover" ? "" : `${pad(s.b)} · ${esc(BLOCKS[s.b])}`) : "Infocracia y epistemología digital";
    el.innerHTML = `<div class="paper"></div>${img}${body}<div class="meta"><span>${left}</span><span class="ctr"></span></div>`;
    stage.appendChild(el);
    s.el = el;
  } catch (err) { console.error("Lámina " + s.id, err); } });
  for (let i = SLIDES.length - 1; i >= 0; i--) if (!SLIDES[i].el) SLIDES.splice(i, 1);

  // ───────── Ajuste tipográfico: cada lámina toma el mayor tamaño que cabe
  const STEPS = [1.4, 1.32, 1.24, 1.16, 1.08, 1.0, 0.94, 0.88, 0.82];
  function fitType() {
    SLIDES.forEach(s => {
      const c = s.el.querySelector(".cnt"); if (!c) return;
      const kmax = s.kmax || ((s.t === "statement" || s.t === "quote") ? 1.3 : 1.4);
      for (const k of STEPS) {
        if (k > kmax) continue;
        c.style.setProperty("--k", k);
        if (c.scrollHeight <= c.clientHeight + 1 && c.scrollWidth <= c.clientWidth + 1) { s.fk = k; return; }
      }
      s.fk = STEPS[STEPS.length - 1];
    });
    document.body.dataset.fitted = "1";
  }
  const safeFit = () => { try { fitType(); } catch (e) { document.body.dataset.fitted = "1"; } };
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(safeFit, safeFit); else safeFit(); } catch (e) { safeFit(); }

  function fit() {
    const k = Math.min(innerWidth / 1600, innerHeight / 900);
    stage.style.transform = `translate(-50%,-50%) scale(${k})`;
  }
  addEventListener("resize", fit); fit();

  // ───────── Navegación
  let short = false;
  let list = [], pos = 0, cur = null;
  function build() { list = short ? SLIDES.filter(s => s.core) : SLIDES.slice(); document.body.classList.toggle("short", short); }
  build();
  function go(p, fromHash) {
    p = Math.max(0, Math.min(list.length - 1, p));
    const s = list[p];
    if (cur && cur !== s) cur.el.classList.remove("on");
    s.el.classList.add("on"); cur = s; pos = p;
    s.el.querySelector(".ctr").textContent = `${pos + 1} / ${list.length}`;
    if (!fromHash) { try { history.replaceState(null, "", "#" + s.id); } catch (e) {} }
    renderNotes(); updatePresenter();
    // Para el visor de Slides (barra de progreso y salto a una lámina).
    document.dispatchEvent(new CustomEvent("slides:cambio", { detail: { indice: pos, total: list.length } }));
  }
  const next = () => go(pos + 1), prev = () => go(pos - 1);
  function goId(id) {
    let p = list.findIndex(s => s.id === id);
    if (p < 0) {
      const all = SLIDES.findIndex(s => s.id === id);
      p = list.findIndex(s => SLIDES.indexOf(s) >= all);
      if (p < 0) p = list.length - 1;
    }
    go(p);
  }
  function toggleShort() {
    const id = cur ? cur.id : null;
    short = !short; store.set("infocracia2.short", short ? "1" : "0");
    build(); if (id) goId(id); else go(0);
  }

  const noteHTML = s => arr(s.note).length ? arr(s.note).map(p => `<p>${md(p)}</p>`).join("") : "<p>—</p>";
  const notesEl = $("#notes");
  function renderNotes() {
    if (!cur) return;
    notesEl.innerHTML = `<div class="nh"><b>${SLIDES.indexOf(cur) + 1} · ${esc(cur.ti)}</b><span>${pos + 1} / ${list.length} · ${esc(BLOCKS[cur.b])}</span></div>
      <div class="nb">${noteHTML(cur)}</div>${cur.img ? `<div class="ni">Imagen sugerida (img/${cur.id}.jpg): ${esc(cur.img)}</div>` : ""}`;
  }

  // ───────── Ventana del presentador
  let pw = null, t0 = null;
  function openPresenter() {
    pw = window.open("", "infocracia-presentador", "width=1000,height=740");
    if (!pw) return;
    t0 = t0 || Date.now();
    pw.document.open();
    pw.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Presentador · Infocracia</title>
      <style>body{margin:0;font:16px/1.55 system-ui,Segoe UI,Arial,sans-serif;background:#ECE9E2;color:#121212}
      header{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:#121212;color:#F4F2EC}
      header b{font-size:13px;letter-spacing:.2em;text-transform:uppercase}#clock{font:600 26px/1 system-ui}
      main{padding:16px 24px}h1{margin:0 0 4px;font-size:22px}.sub{color:#5C5A55;font-size:13px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:14px}
      #nt p{margin:0 0 10px}.nx{margin-top:16px;padding-top:12px;border-top:1px solid #bdb9b0;color:#5C5A55}.nx b{color:#121212}
      mark.cj{background:#121212;color:#F4F2EC;font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:2px 5px}
      .bt{display:flex;gap:8px;padding:14px 24px 0}.bt button{font:600 14px system-ui;padding:10px 18px;border:1.5px solid #121212;background:#fff;cursor:pointer}</style></head>
      <body><header><b id="pos"></b><span id="clock">00:00</span></header>
      <div class="bt"><button id="bp">‹ Anterior</button><button id="bn">Siguiente ›</button><button id="br">Reiniciar cronómetro</button></div>
      <main><h1 id="tt"></h1><div class="sub" id="bk"></div><div id="nt"></div><div class="nx" id="nx"></div></main></body></html>`);
    pw.document.close();
    pw.document.getElementById("bp").onclick = prev;
    pw.document.getElementById("bn").onclick = next;
    pw.document.getElementById("br").onclick = () => { t0 = Date.now(); tick(); };
    pw.document.addEventListener("keydown", onKey);
    updatePresenter();
  }
  function updatePresenter() {
    if (!pw || pw.closed || !cur) return;
    try {
      const d = pw.document;
      d.getElementById("pos").textContent = `${pos + 1} / ${list.length}${short ? " · versión para exponer" : ""}`;
      d.getElementById("tt").textContent = cur.ti;
      d.getElementById("bk").textContent = `${pad(cur.b)} · ${BLOCKS[cur.b]}`;
      d.getElementById("nt").innerHTML = noteHTML(cur);
      const nx = list[pos + 1];
      d.getElementById("nx").innerHTML = nx ? `Siguiente: <b>${esc(nx.ti)}</b>` : "Última lámina.";
    } catch (e) {}
  }
  function tick() {
    if (!pw || pw.closed || !t0) return;
    try { const s = Math.floor((Date.now() - t0) / 1000); pw.document.getElementById("clock").textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; } catch (e) {}
  }
  setInterval(tick, 1000);

  // ───────── Teclado y superposiciones
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(list.length - 1); }
  }
  document.addEventListener("keydown", onKey);
  let mt = null;
  document.addEventListener("mousemove", () => { document.body.classList.add("mouse"); clearTimeout(mt); mt = setTimeout(() => document.body.classList.remove("mouse"), 1800); });
  addEventListener("hashchange", () => { const id = location.hash.slice(1); if (!cur || id !== cur.id) goId(id); });

  // El contrato con el visor de Slides: cuántas láminas hay, en cuál va y saltar a una.
  window.slidesDeck = { get total() { return list.length; }, indice: () => pos, ir: n => go(n) };

  const startId = location.hash.slice(1);
  if (startId && SLIDES.some(s => s.id === startId)) goId(startId); else go(0);
})();

