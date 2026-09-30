/*
  ETL y ELT · Los procesos que mueven los datos — controlador del deck.

  Son los dos <script> que el HTML original traía en línea, en el mismo orden
  (primero los datos de los laboratorios, window.LABS; después el controlador).
  Salieron a este archivo porque la CSP de /content/slides no permite scripts
  en línea.

  Sobre el original sólo se agregó el contrato que el visor de Slides
  (slides.js) espera, el mismo que curso-sql/deck.js:

    window.slidesDeck = { total, indice(), ir(n) }
    document "slides:cambio" → detail: { indice, total }

  más Inicio/Fin, y el botón «Comenzar» conectado aquí en vez de con onclick.
  Los datos de las dos demos del HTML pasaron de <script type="text/plain"> a
  <template>, por la misma regla.
*/
window.LABS = {};
var LABS = window.LABS;

/* ===================== ETL 1 · Excel → limpiar → PostgreSQL ===================== */
LABS.etl1 = {
  title:'ETL 1 · Excel de ventas → PostgreSQL', level:'Simple',
  lanes:[{label:'Fuente',cols:[0]},{label:'Extraer',cols:[1]},{label:'Transformar',cols:[2]},{label:'Cargar',cols:[3]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'ventas_qro.xlsx',sub:'Excel · sucursal Querétaro'},
    {id:'ext',col:1,row:0,kind:'extract',icon:'🐍',label:'Extraer',sub:'pandas.read_excel'},
    {id:'tr',col:2,row:0,kind:'transform',icon:'🧽',label:'Transformar',sub:'fechas · montos · nombres · validar'},
    {id:'db',col:3,row:0,kind:'store',icon:'🗄️',label:'PostgreSQL',sub:'tabla ventas'}
  ],
  edges:[{from:'xlsx',to:'ext',n:1},{from:'ext',to:'tr',n:2},{from:'tr',to:'db',n:3}],
  files:[{name:'etl_ventas.py',lang:'python',code:`import pandas as pd
from sqlalchemy import create_engine

# 1) EXTRAER: leemos el Excel tal como lo manda la sucursal
df = pd.read_excel("ventas_qro.xlsx")

# 2) TRANSFORMAR: limpiamos ANTES de guardar
df["fecha"] = pd.to_datetime(df["fecha"], dayfirst=True).dt.date
df["monto"] = pd.to_numeric(df["monto"].str.replace(r"[$,MXN ]", "", regex=True),
                            errors="coerce")            # "" → NaN
df["producto"] = df["producto"].str.strip().str.lower()
df = df.dropna(subset=["monto"])                        # validar

# 3) CARGAR: solo la versión limpia llega a la base
motor = create_engine("postgresql://tienda@db:5432/ventas")
df.to_sql("ventas", motor, if_exists="append", index=False)
print(f"cargadas {len(df)} filas")`}],
  final:'ETL completo: extraer → transformar → cargar. A la base solo llegó dato validado; el Excel original sigue intacto en su carpeta.',
  steps:[
    {at:'xlsx',say:'El dato nace en el <b>Excel</b> de la sucursal: 4 filas tal como las capturaron.',
     data:{where:'📄 Excel · ventas_qro.xlsx',view:{fmt:'table',k:'excel',title:'ventas_qro.xlsx',cols:['fecha','producto','unidades','monto'],rows:[['03/09/26','Café Molido ',2,'$1,240.00 MXN'],['04/09/26',' té verde',5,'$ 890.00 MXN'],['05/09/26','Miel de Agave',1,''],['05/09/26','café molido',3,'$1,860.00 MXN']]},
       note:'Fechas ambiguas (¿3 de septiembre o 9 de marzo?), montos como texto con símbolos, nombres con mayúsculas y espacios, y una fila sin monto.'}},
    {file:'etl_ventas.py',line:5,at:'ext',edge:1,say:'<b>Extraer</b>: pandas lee el archivo y lo sube a memoria como DataFrame, sin cambiar nada.',
     data:{where:'🐍 En memoria · DataFrame df',note:'Mismo contenido, otra casa: ahora el dato vive en memoria y podemos operarlo.'}},
    {file:'etl_ventas.py',line:8,at:'tr',edge:2,say:'<b>Transformar</b> · fechas: interpretamos día/mes/año y las dejamos en formato ISO.',
     data:{col:{fecha:['2026-09-03','2026-09-04','2026-09-05','2026-09-05']},note:'ISO 8601 (AAAA-MM-DD) elimina la ambigüedad y ordena correctamente.'}},
    {file:'etl_ventas.py',lines:[9,10],say:'<b>Transformar</b> · montos: quitamos "$", comas y "MXN" y convertimos a número; lo vacío se vuelve NaN.',
     data:{col:{monto:[1240.0,890.0,'NaN',1860.0]},note:'Ahora se puede sumar. La fila sin monto quedó como NaN (dato faltante).'}},
    {file:'etl_ventas.py',line:11,say:'<b>Transformar</b> · productos: sin espacios sobrantes y en minúsculas, para que "Café Molido " y "café molido" sean el mismo.',
     data:{col:{producto:['café molido','té verde','miel de agave','café molido']},note:'Normalizar nombres evita que un mismo producto aparezca tres veces en los reportes.'}},
    {file:'etl_ventas.py',line:12,say:'<b>Transformar</b> · validar: la fila sin monto se descarta antes de cargar.',
     data:{delRows:[2],note:'Calidad en la puerta: un dato incompleto no llega a la base.'}},
    {file:'etl_ventas.py',line:15,say:'Abrimos la conexión a PostgreSQL.',
     data:{note:'La conexión define el destino; todavía no se escribe nada.'}},
    {file:'etl_ventas.py',line:16,at:'db',edge:3,say:'<b>Cargar</b>: las 3 filas limpias se insertan en la tabla <code>ventas</code>.',
     data:{where:'🗄️ PostgreSQL · tabla ventas',view:{fmt:'table',k:'sql',title:'ventas',cols:['fecha','producto','unidades','monto'],rows:[['2026-09-03','café molido',2,1240.0],['2026-09-04','té verde',5,890.0],['2026-09-05','café molido',3,1860.0]]},
       note:'A la base solo llegó dato validado. Nadie tendrá que volver a limpiar estas filas.'}},
    {file:'etl_ventas.py',line:17,say:'Listo: <b>cargadas 3 filas</b>. Un ETL completo en 17 líneas.',
     data:{note:'✓ Extraer → transformar → cargar. Fíjate en el orden: la T ocurrió en memoria, antes de tocar la base.'}}
  ]
};

/* ===================== ETL 2 · API → enmascarar → PostgreSQL + Drive ===================== */
LABS.etl2 = {
  title:'ETL 2 · API del CRM → enmascarar → PostgreSQL + Google Drive', level:'Simple 2',
  lanes:[{label:'Fuente',cols:[0]},{label:'Extraer',cols:[1]},{label:'Transformar',cols:[2]},{label:'Cargar',cols:[3]}],
  nodes:[
    {id:'api',col:0,row:0.5,kind:'source',icon:'🔌',label:'API del CRM',sub:'GET /api/clientes'},
    {id:'ext',col:1,row:0.5,kind:'extract',icon:'🐍',label:'Extraer',sub:'requests.get → JSON'},
    {id:'tr',col:2,row:0.5,kind:'transform',icon:'🛡️',label:'Transformar',sub:'enmascarar PII · normalizar'},
    {id:'db',col:3,row:0,kind:'store',icon:'🗄️',label:'PostgreSQL',sub:'tabla clientes (operación)'},
    {id:'drive',col:3,row:1,kind:'store',icon:'📁',label:'Google Drive',sub:'hoja clientes_comercial'}
  ],
  edges:[{from:'api',to:'ext',n:1},{from:'ext',to:'tr',n:2},{from:'tr',to:'db',n:3},{from:'tr',to:'drive',n:4}],
  files:[{name:'etl_clientes.py',lang:'python',code:`import requests, pandas as pd
from sqlalchemy import create_engine
import gspread

# 1) EXTRAER: pedimos los clientes a la API del CRM
resp = requests.get("https://crm.tienda.mx/api/clientes",
                    headers={"Authorization": "Bearer ***"})
resp.raise_for_status()                    # avisa si algo salió mal
df = pd.DataFrame(resp.json()["data"])

# 2) TRANSFORMAR: enmascarar datos personales y normalizar
df["rfc"]      = df["rfc"].str[:4] + "****" + df["rfc"].str[-1:]
df["correo"]   = df["correo"].str.replace(r"(.).*(@.*)", r"\\1***\\2", regex=True)
df["telefono"] = "•••• " + df["telefono"].str[-4:]
df["ciudad"]   = df["ciudad"].str.strip().str.title().replace({"Cdmx": "CDMX"})

# 3a) CARGAR: base operativa (PostgreSQL)
motor = create_engine("postgresql://tienda@db:5432/crm")
df.to_sql("clientes", motor, if_exists="replace", index=False)

# 3b) CARGAR: hoja en Google Drive para el equipo comercial
hoja = gspread.service_account().open("clientes_comercial").sheet1
hoja.update([df.columns.tolist()] + df.values.tolist())`}],
  final:'Una sola transformación, dos destinos. Ningún dato personal llegó crudo a ninguno de los dos.',
  steps:[
    {at:'api',say:'La fuente es una <b>API</b>: el CRM responde JSON con los datos personales en claro.',
     data:{where:'🔌 API del CRM · respuesta JSON',view:{fmt:'json',k:'api',title:'GET /api/clientes → 200 OK',obj:{data:[{id:101,nombre:'María González',rfc:'GORM850312QX8',correo:'maria.g@correo.mx',telefono:'4421185590',ciudad:' querétaro '},{id:102,nombre:'Luis Ramírez',rfc:'RALU900714HJ2',correo:'luis.ramirez@mail.mx',telefono:'4422107783',ciudad:'CDMX'},{id:103,nombre:'Ana Torres',rfc:'TOAA881120MB5',correo:'ana.torres@corp.mx',telefono:'4426650921',ciudad:'guadalajara'}]}},
       note:'RFC, correo y teléfono completos. Si esto aterrizara así en una base compartida, cualquiera con acceso lo vería.'}},
    {file:'etl_clientes.py',lines:[6,7],at:'ext',edge:1,say:'<b>Extraer</b>: hacemos la petición HTTP con nuestra credencial. La API devuelve el JSON.',
     data:{where:'🐍 En memoria · respuesta HTTP',note:'El token de acceso identifica a nuestro script; nunca se guarda en el código real (va en una variable de entorno).'}},
    {file:'etl_clientes.py',line:8,say:'Verificamos que la respuesta fue exitosa; si la API falló, el ETL se detiene aquí con un error claro.',
     data:{note:'Manejo de errores: mejor detenerse temprano que cargar datos a medias.'}},
    {file:'etl_clientes.py',line:9,say:'Convertimos la lista de JSON en una <b>tabla</b> (DataFrame): cada objeto es una fila.',
     data:{where:'🐍 En memoria · DataFrame df',view:{fmt:'table',k:'mem',title:'df',cols:['id','nombre','rfc','correo','telefono','ciudad'],rows:[[101,'María González','GORM850312QX8','maria.g@correo.mx','4421185590',' querétaro '],[102,'Luis Ramírez','RALU900714HJ2','luis.ramirez@mail.mx','4422107783','CDMX'],[103,'Ana Torres','TOAA881120MB5','ana.torres@corp.mx','4426650921','guadalajara']]},
       note:'Mismo dato, forma tabular. Todavía con datos personales en claro.'}},
    {file:'etl_clientes.py',line:12,at:'tr',edge:2,say:'<b>Transformar</b> · RFC: conservamos solo las 4 primeras letras y el último carácter.',
     data:{col:{rfc:['GORM****8','RALU****2','TOAA****5']},note:'Suficiente para reconocer a un cliente en soporte, inútil para suplantarlo.'}},
    {file:'etl_clientes.py',line:13,say:'<b>Transformar</b> · correo: dejamos la primera letra y el dominio.',
     data:{col:{correo:['m***@correo.mx','l***@mail.mx','a***@corp.mx']},note:'La expresión regular captura la primera letra y todo lo que sigue a "@".'}},
    {file:'etl_clientes.py',line:14,say:'<b>Transformar</b> · teléfono: solo los últimos 4 dígitos.',
     data:{col:{telefono:['•••• 5590','•••• 7783','•••• 0921']},note:'El patrón "últimos 4" es el mismo que usan bancos y aseguradoras.'}},
    {file:'etl_clientes.py',line:15,say:'<b>Transformar</b> · ciudad: sin espacios, capitalizada, y el caso especial "CDMX".',
     data:{col:{ciudad:['Querétaro','CDMX','Guadalajara']},note:'Normalizar aquí evita que "querétaro" y "Querétaro" cuenten como dos ciudades en los reportes.'}},
    {file:'etl_clientes.py',line:19,at:'db',edge:3,say:'<b>Cargar (a)</b>: la base operativa recibe la tabla ya enmascarada.',
     data:{where:'🗄️ PostgreSQL · tabla clientes',view:{fmt:'table',k:'sql',title:'clientes',cols:['id','nombre','rfc','correo','telefono','ciudad'],rows:[[101,'María González','GORM****8','m***@correo.mx','•••• 5590','Querétaro'],[102,'Luis Ramírez','RALU****2','l***@mail.mx','•••• 7783','CDMX'],[103,'Ana Torres','TOAA****5','a***@corp.mx','•••• 0921','Guadalajara']]},
       note:'Destino 1 de 2. El dato crudo nunca tocó esta base.'}},
    {file:'etl_clientes.py',lines:[22,23],at:'drive',edge:4,say:'<b>Cargar (b)</b>: la misma versión segura se escribe en una hoja de Google Drive para el equipo comercial.',
     data:{where:'📁 Google Drive · clientes_comercial',view:{fmt:'multi',parts:[
        {fmt:'table',k:'sql',title:'PostgreSQL · clientes',cols:['id','nombre','rfc','correo','telefono','ciudad'],rows:[[101,'María González','GORM****8','m***@correo.mx','•••• 5590','Querétaro'],[102,'Luis Ramírez','RALU****2','l***@mail.mx','•••• 7783','CDMX'],[103,'Ana Torres','TOAA****5','a***@corp.mx','•••• 0921','Guadalajara']]},
        {fmt:'table',k:'drive',title:'Google Drive · clientes_comercial (hoja)',cols:['id','nombre','rfc','correo','telefono','ciudad'],rows:[[101,'María González','GORM****8','m***@correo.mx','•••• 5590','Querétaro'],[102,'Luis Ramírez','RALU****2','l***@mail.mx','•••• 7783','CDMX'],[103,'Ana Torres','TOAA****5','a***@corp.mx','•••• 0921','Guadalajara']]}]},
       note:'✓ Dos destinos, una transformación. Comercial trabaja con una hoja que puede compartir sin riesgo.'}}
  ]
};

/* ===================== ETL 3 · Excel + API + scraping → join → PostgreSQL ===================== */
LABS.etl3 = {
  title:'ETL 3 · Excel + API + scraping → unir → PostgreSQL', level:'Compuesto',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Extraer',cols:[1]},{label:'Transformar',cols:[2]},{label:'Cargar',cols:[3]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'ventas_qro.xlsx',sub:'Excel · ventas del mes'},
    {id:'api',col:0,row:1,kind:'source',icon:'🔌',label:'API del CRM',sub:'clientes · JSON'},
    {id:'web',col:0,row:2,kind:'source',icon:'🕸️',label:'proveedor.mx',sub:'catálogo · HTML (scraping)'},
    {id:'ext',col:1,row:1,kind:'extract',icon:'🐍',label:'Extraer ×3',sub:'read_excel · requests · BeautifulSoup'},
    {id:'tr',col:2,row:1,kind:'transform',icon:'🔗',label:'Transformar',sub:'normalizar · unir · calcular'},
    {id:'db',col:3,row:1,kind:'store',icon:'🗄️',label:'PostgreSQL',sub:'ventas_enriquecidas'}
  ],
  edges:[{from:'xlsx',to:'ext',n:1},{from:'api',to:'ext',n:2},{from:'web',to:'ext',n:3},{from:'ext',to:'tr',n:4},{from:'tr',to:'db',n:5}],
  files:[{name:'etl_compuesto.py',lang:'python',code:`import requests, pandas as pd
from bs4 import BeautifulSoup
from sqlalchemy import create_engine

# 1) EXTRAER · fuente A: ventas en Excel
ventas = pd.read_excel("ventas_qro.xlsx")

# 1) EXTRAER · fuente B: clientes desde la API del CRM
clientes = pd.DataFrame(
    requests.get("https://crm.tienda.mx/api/clientes").json()["data"])

# 1) EXTRAER · fuente C: precios de lista con scraping
html = requests.get("https://proveedor.mx/catalogo").text
sopa = BeautifulSoup(html, "html.parser")
precios = pd.DataFrame([
    {"producto": fila.td.text.strip().lower(),
     "precio_lista": float(fila.find_all("td")[1].text.strip("$"))}
    for fila in sopa.select("table.catalogo tr")[1:]])

# 2) TRANSFORMAR: unir las tres fuentes en una venta enriquecida
ventas["producto"] = ventas["producto"].str.strip().str.lower()
df = (ventas.merge(clientes[["id", "ciudad"]],
                   left_on="cliente_id", right_on="id")
            .merge(precios, on="producto").drop(columns="id"))
df["descuento"] = 1 - df["monto"] / (df["precio_lista"] * df["unidades"])

# 3) CARGAR: una sola tabla lista para análisis
motor = create_engine("postgresql://tienda@db:5432/ventas")
df.to_sql("ventas_enriquecidas", motor, if_exists="replace", index=False)`}],
  final:'Tres fuentes con tres formatos (tabla, JSON, HTML) terminaron en una sola tabla lista para análisis.',
  steps:[
    {at:'xlsx',say:'<b>Fuente A</b> · las ventas del mes en Excel. Ya traen el id del cliente que compró.',
     data:{where:'📄 Excel · ventas_qro.xlsx',view:{fmt:'table',k:'excel',title:'ventas_qro.xlsx',cols:['fecha','cliente_id','producto','unidades','monto'],rows:[['2026-09-03',101,'Café Molido ',2,1240.0],['2026-09-04',102,' té verde',5,890.0],['2026-09-05',103,'Miel de Agave',1,450.0]]},
       note:'Sabemos qué se vendió y a quién (por id), pero no dónde vive el cliente ni cuál era el precio de lista.'}},
    {file:'etl_compuesto.py',line:6,at:'ext',edge:1,say:'<b>Extraer A</b>: el Excel sube a memoria como <code>ventas</code>.',
     data:{where:'🐍 En memoria · ventas'}},
    {file:'etl_compuesto.py',lines:[9,10],at:'api',say:'<b>Fuente B</b> · el CRM responde por API con la ciudad de cada cliente.',
     data:{where:'🔌 API del CRM · JSON',view:{fmt:'json',k:'api',title:'GET /api/clientes',obj:{data:[{id:101,nombre:'María González',ciudad:'Querétaro'},{id:102,nombre:'Luis Ramírez',ciudad:'CDMX'},{id:103,nombre:'Ana Torres',ciudad:'Guadalajara'}]}},
       note:'De aquí solo necesitaremos id y ciudad.'}},
    {file:'etl_compuesto.py',lines:[9,10],at:'ext',edge:2,say:'<b>Extraer B</b>: el JSON se convierte en la tabla <code>clientes</code>.',
     data:{where:'🐍 En memoria · clientes',view:{fmt:'table',k:'mem',title:'clientes',cols:['id','nombre','ciudad'],rows:[[101,'María González','Querétaro'],[102,'Luis Ramírez','CDMX'],[103,'Ana Torres','Guadalajara']]}}},
    {file:'etl_compuesto.py',line:13,at:'web',say:'<b>Fuente C</b> · la página del proveedor. No hay API ni archivo: solo tenemos el HTML.',
     data:{where:'🕸️ proveedor.mx/catalogo · HTML',view:{fmt:'html',k:'html',title:'GET /catalogo (fragmento)',text:'<table class="catalogo">\n  <tr><th>Producto</th><th>Precio</th></tr>\n  <tr><td>Café molido</td><td>$620</td></tr>\n  <tr><td>Té verde</td><td>$200</td></tr>\n  <tr><td>Miel de agave</td><td>$500</td></tr>\n</table>'},
       note:'El "esqueleto" de la página tal como lo recibe el navegador. Hay que buscar los datos dentro de las etiquetas.'}},
    {file:'etl_compuesto.py',line:14,at:'ext',edge:3,say:'<b>Extraer C</b>: BeautifulSoup convierte el HTML en un árbol navegable.',
     data:{where:'🐍 En memoria · sopa (árbol HTML)'}},
    {file:'etl_compuesto.py',lines:[15,18],say:'<b>Scraping</b>: por cada fila de la tabla tomamos el producto y el precio, y armamos <code>precios</code>.',
     data:{where:'🐍 En memoria · precios',view:{fmt:'table',k:'mem',title:'precios',cols:['producto','precio_lista'],rows:[['café molido',620.0],['té verde',200.0],['miel de agave',500.0]]},
       note:'Del HTML salió una tabla limpia. Ya tenemos las tres fuentes en memoria.'}},
    {file:'etl_compuesto.py',line:21,at:'tr',edge:4,say:'<b>Transformar</b> · normalizamos la llave de unión: el nombre del producto en <code>ventas</code>.',
     data:{where:'🐍 En memoria · ventas',view:{fmt:'table',k:'mem',title:'ventas',cols:['fecha','cliente_id','producto','unidades','monto'],rows:[['2026-09-03',101,'Café Molido ',2,1240.0],['2026-09-04',102,' té verde',5,890.0],['2026-09-05',103,'Miel de Agave',1,450.0]]}}},
    {file:'etl_compuesto.py',line:21,say:'Sin esto, "Café Molido " no encontraría a "café molido" en la tabla de precios.',
     data:{col:{producto:['café molido','té verde','miel de agave']},note:'Las llaves de unión deben coincidir exactamente: misma capitalización, sin espacios.'}},
    {file:'etl_compuesto.py',lines:[22,24],say:'<b>Unir</b>: cada venta recibe la ciudad de su cliente (por id) y el precio de lista de su producto (por nombre).',
     data:{view:{fmt:'table',k:'mem',title:'df = ventas ⋈ clientes ⋈ precios',cols:['fecha','cliente_id','producto','unidades','monto','ciudad','precio_lista'],rows:[['2026-09-03',101,'café molido',2,1240.0,'Querétaro',620.0],['2026-09-04',102,'té verde',5,890.0,'CDMX',200.0],['2026-09-05',103,'miel de agave',1,450.0,'Guadalajara',500.0]]},
       note:'Dos merge encadenados: el primero por cliente_id = id, el segundo por producto.'}},
    {file:'etl_compuesto.py',line:25,say:'<b>Calcular</b>: descuento efectivo = 1 − monto / (precio de lista × unidades).',
     data:{col:{descuento:[0.00,0.11,0.10]},note:'Un dato nuevo que ninguna fuente tenía por sí sola: nace de combinar las tres.'}},
    {file:'etl_compuesto.py',line:29,at:'db',edge:5,say:'<b>Cargar</b>: una sola tabla enriquecida en PostgreSQL.',
     data:{where:'🗄️ PostgreSQL · ventas_enriquecidas',view:{fmt:'table',k:'sql',title:'ventas_enriquecidas',cols:['fecha','cliente_id','producto','unidades','monto','ciudad','precio_lista','descuento'],rows:[['2026-09-03',101,'café molido',2,1240.0,'Querétaro',620.0,0.00],['2026-09-04',102,'té verde',5,890.0,'CDMX',200.0,0.11],['2026-09-05',103,'miel de agave',1,450.0,'Guadalajara',500.0,0.10]]},
       note:'✓ Tres fuentes, un almacén. El analista ya puede preguntar "¿dónde damos más descuento?" sin tocar Excel, API ni HTML.'}}
  ]
};

/* ===================== ETL 4 · 3 fuentes → T compleja → SQL + NoSQL + Drive ===================== */
LABS.etl4 = {
  title:'ETL 4 · Tres sucursales + CRM + proveedor → PostgreSQL + MongoDB + Drive', level:'Compuesto avanzado', tone:'amber',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Extraer',cols:[1]},{label:'Transformar (2 etapas)',cols:[2,3]},{label:'Cargar',cols:[4]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'Excel × 3 sucursales',sub:'QRO · CDMX · GDL · formatos distintos'},
    {id:'api',col:0,row:1,kind:'source',icon:'🔌',label:'API del CRM',sub:'clientes · JSON'},
    {id:'web',col:0,row:2,kind:'source',icon:'🕸️',label:'proveedor.mx',sub:'precios · scraping'},
    {id:'ext',col:1,row:1,kind:'extract',icon:'🐍',label:'Extraer',sub:'glob + read_excel · requests · scraping'},
    {id:'tr1',col:2,row:1,kind:'transform',icon:'🧪',label:'Homologar',sub:'renombrar · fechas · moneda · validar · deduplicar'},
    {id:'tr2',col:3,row:1,kind:'transform',icon:'🔗',label:'Enriquecer',sub:'unir · enmascarar · agregar'},
    {id:'db',col:4,row:0,kind:'store',icon:'🗄️',label:'PostgreSQL',sub:'ventas_detalle (transaccional)'},
    {id:'mongo',col:4,row:1,kind:'store',icon:'🍃',label:'MongoDB',sub:'clientes_360 (perfil)'},
    {id:'drive',col:4,row:2,kind:'store',icon:'📁',label:'Google Drive',sub:'reporte_regiones (dirección)'}
  ],
  edges:[{from:'xlsx',to:'ext',n:1},{from:'api',to:'ext',n:2},{from:'web',to:'ext',n:3},{from:'ext',to:'tr1',n:4},{from:'tr1',to:'tr2',n:5},{from:'tr2',to:'db',n:6},{from:'tr2',to:'mongo',n:7},{from:'tr2',to:'drive',n:8}],
  files:[{name:'etl_avanzado.py',lang:'python',code:`import glob, requests, pandas as pd
from sqlalchemy import create_engine
from pymongo import MongoClient
import gspread

MAPA = {"Fecha": "fecha", "fecha_venta": "fecha", "Importe": "monto",
        "Producto": "producto", "Cliente": "cliente_id"}

# 1) EXTRAER: tres sucursales, tres formatos distintos
partes = []
for archivo in glob.glob("ventas_*.xlsx"):
    parte = pd.read_excel(archivo).rename(columns=MAPA)
    parte["sucursal"] = archivo.split("_")[1].split(".")[0].upper()
    partes.append(parte)
ventas = pd.concat(partes, ignore_index=True)
clientes = pd.DataFrame(requests.get(API_CRM).json()["data"])
precios = extraer_precios("https://proveedor.mx/catalogo")   # scraping (ej. 3)

# 2a) TRANSFORMAR: homologar, validar y deduplicar
ventas["fecha"] = pd.to_datetime(ventas["fecha"], dayfirst=True).dt.date
ventas.loc[ventas["moneda"] == "USD", "monto"] *= 18.5        # a pesos
ventas["producto"] = ventas["producto"].str.strip().str.lower()
assert ventas["monto"].gt(0).all(), "monto inválido: se detiene el ETL"
ventas = ventas.drop_duplicates(subset=["fecha", "cliente_id", "producto"])

# 2b) TRANSFORMAR: enriquecer, enmascarar y agregar
clientes["rfc"] = clientes["rfc"].str[:4] + "****" + clientes["rfc"].str[-1:]
detalle = ventas.merge(clientes, left_on="cliente_id", right_on="id")
detalle = detalle.merge(precios, on="producto")
por_region = detalle.groupby(["sucursal", "producto"])["monto"].sum().reset_index()
perfil = detalle.groupby("cliente_id").agg(total=("monto", "sum"), compras=("monto", "size"))

# 3) CARGAR: tres destinos, tres usos
detalle.to_sql("ventas_detalle", create_engine(PG), if_exists="replace", index=False)
MongoClient(MONGO).tienda.clientes_360.insert_many(perfil.reset_index().to_dict("records"))
gspread.service_account().open("reporte_regiones").sheet1.update(
    [por_region.columns.tolist()] + por_region.values.tolist())`}],
  final:'Tres fuentes, dos etapas de transformación y tres destinos con tres usos distintos: transaccional, perfil de cliente y reporte de dirección.',
  steps:[
    {at:'xlsx',say:'<b>Fuente A</b> · tres sucursales, tres Excel… y tres formatos: columnas con otro nombre, una en dólares y una fila repetida.',
     data:{where:'📄 Excel · ventas_qro / ventas_cdmx / ventas_gdl',view:{fmt:'multi',parts:[
        {fmt:'table',k:'excel',title:'ventas_qro.xlsx',cols:['Fecha','Cliente','Producto','Importe','moneda'],rows:[['03/09/26',101,'Café Molido ',1240.0,'MXN'],['04/09/26',102,'té verde',890.0,'MXN']]},
        {fmt:'table',k:'excel',title:'ventas_cdmx.xlsx',cols:['fecha_venta','cliente_id','producto','monto','moneda'],rows:[['2026-09-04',103,'miel de agave',25.0,'USD'],['2026-09-04',103,'miel de agave',25.0,'USD']]},
        {fmt:'table',k:'excel',title:'ventas_gdl.xlsx',cols:['Fecha','Cliente','Producto','Importe','moneda'],rows:[['05/09/26',101,'CAFÉ MOLIDO',620.0,'MXN']]}]},
       note:'Cada sucursal captura como puede. Homologar esto a mano cada mes es justo lo que un ETL evita.'}},
    {file:'etl_avanzado.py',lines:[6,7],say:'Un <b>mapa de columnas</b> traduce cada nombre local al nombre estándar.',
     data:{note:'"Fecha" y "fecha_venta" pasarán a llamarse "fecha"; "Importe" será "monto". Un solo diccionario, tres formatos.'}},
    {file:'etl_avanzado.py',lines:[11,14],at:'ext',edge:1,say:'<b>Extraer A</b>: leemos cada archivo, renombramos sus columnas y anotamos de qué sucursal viene.',
     data:{where:'🐍 En memoria · partes',view:{fmt:'table',k:'mem',title:'ventas (concat de 3 partes)',cols:['fecha','cliente_id','producto','monto','moneda','sucursal'],rows:[['03/09/26',101,'Café Molido ',1240.0,'MXN','QRO'],['04/09/26',102,'té verde',890.0,'MXN','QRO'],['2026-09-04',103,'miel de agave',25.0,'USD','CDMX'],['2026-09-04',103,'miel de agave',25.0,'USD','CDMX'],['05/09/26',101,'CAFÉ MOLIDO',620.0,'MXN','GDL']]},
       note:'El nombre del archivo ("ventas_qro.xlsx") nos da la sucursal. Ya comparten columnas, pero siguen sucias.'}},
    {file:'etl_avanzado.py',line:15,say:'Apilamos las tres partes en una sola tabla <code>ventas</code> (5 filas).',
     data:{}},
    {file:'etl_avanzado.py',line:16,at:'api',say:'<b>Fuente B</b> · el CRM por API: nombre, RFC y ciudad de cada cliente.',
     data:{where:'🔌 API del CRM · JSON',view:{fmt:'json',k:'api',title:'GET /api/clientes',obj:{data:[{id:101,nombre:'María González',rfc:'GORM850312QX8',ciudad:'Querétaro'},{id:102,nombre:'Luis Ramírez',rfc:'RALU900714HJ2',ciudad:'CDMX'},{id:103,nombre:'Ana Torres',rfc:'TOAA881120MB5',ciudad:'Guadalajara'}]}}}},
    {file:'etl_avanzado.py',line:17,at:'ext',edge:[2,3],lit:['web'],say:'<b>Extraer B y C</b> · el CRM entra a memoria y los precios llegan con el mismo scraping del ejercicio 3, ahora empaquetado en una función.',
     data:{where:'🐍 En memoria · precios',view:{fmt:'table',k:'mem',title:'precios (scraping)',cols:['producto','precio_lista'],rows:[['café molido',620.0],['té verde',200.0],['miel de agave',500.0]]},
       note:'Reutilizar código: el extractor del proveedor ya existía; lo importamos como función.'}},
    {file:'etl_avanzado.py',line:20,at:'tr1',edge:4,say:'<b>Homologar</b> · fechas: dos formatos distintos ("03/09/26" y "2026-09-04") → un solo formato ISO.',
     data:{where:'🐍 En memoria · ventas',view:{fmt:'table',k:'mem',title:'ventas',cols:['fecha','cliente_id','producto','monto','moneda','sucursal'],rows:[['03/09/26',101,'Café Molido ',1240.0,'MXN','QRO'],['04/09/26',102,'té verde',890.0,'MXN','QRO'],['2026-09-04',103,'miel de agave',25.0,'USD','CDMX'],['2026-09-04',103,'miel de agave',25.0,'USD','CDMX'],['05/09/26',101,'CAFÉ MOLIDO',620.0,'MXN','GDL']]}}},
    {file:'etl_avanzado.py',line:20,say:'pandas interpreta ambos formatos con <code>dayfirst=True</code>.',
     data:{col:{fecha:['2026-09-03','2026-09-04','2026-09-04','2026-09-04','2026-09-05']}}},
    {file:'etl_avanzado.py',line:21,say:'<b>Homologar</b> · moneda: lo que venía en dólares se convierte a pesos (× 18.5).',
     data:{col:{monto:[1240.0,890.0,462.5,462.5,620.0]},note:'Sin esto, sumaríamos pesos con dólares. Un error clásico y silencioso.'}},
    {file:'etl_avanzado.py',line:22,say:'<b>Homologar</b> · productos: "Café Molido ", "CAFÉ MOLIDO" y "café molido" son el mismo producto.',
     data:{col:{producto:['café molido','té verde','miel de agave','miel de agave','café molido']}}},
    {file:'etl_avanzado.py',line:23,say:'<b>Validar</b>: todos los montos deben ser positivos. Si uno falla, el <code>assert</code> detiene el ETL aquí, antes de cargar nada.',
     data:{note:'✓ 5 montos > 0. Calidad en la puerta: un dato inválido nunca llega a ninguno de los tres destinos.'}},
    {file:'etl_avanzado.py',line:24,say:'<b>Deduplicar</b>: CDMX capturó dos veces la misma venta (misma fecha, cliente y producto). Nos quedamos con una.',
     data:{delRows:[3],note:'Sin esto, el reporte de dirección mostraría el doble de miel de agave en CDMX.'}},
    {file:'etl_avanzado.py',line:27,at:'tr2',edge:5,say:'<b>Enmascarar</b>: el RFC de los clientes se protege antes de unirlo con las ventas.',
     data:{where:'🐍 En memoria · clientes',view:{fmt:'table',k:'mem',title:'clientes',cols:['id','nombre','rfc','ciudad'],rows:[[101,'María González','GORM850312QX8','Querétaro'],[102,'Luis Ramírez','RALU900714HJ2','CDMX'],[103,'Ana Torres','TOAA881120MB5','Guadalajara']]}}},
    {file:'etl_avanzado.py',line:27,say:'Lo sensible se enmascara en memoria: ningún destino verá el RFC completo.',
     data:{col:{rfc:['GORM****8','RALU****2','TOAA****5']}}},
    {file:'etl_avanzado.py',lines:[28,29],say:'<b>Enriquecer</b>: cada venta recibe los datos (ya seguros) de su cliente y el precio de lista de su producto.',
     data:{where:'🐍 En memoria · detalle',view:{fmt:'table',k:'mem',title:'detalle',cols:['fecha','sucursal','cliente_id','nombre','rfc','ciudad','producto','monto','precio_lista'],rows:[['2026-09-03','QRO',101,'María González','GORM****8','Querétaro','café molido',1240.0,620.0],['2026-09-04','QRO',102,'Luis Ramírez','RALU****2','CDMX','té verde',890.0,200.0],['2026-09-04','CDMX',103,'Ana Torres','TOAA****5','Guadalajara','miel de agave',462.5,500.0],['2026-09-05','GDL',101,'María González','GORM****8','Querétaro','café molido',620.0,620.0]]},
       note:'4 ventas limpias, cada una con todo su contexto.'}},
    {file:'etl_avanzado.py',line:30,say:'<b>Agregar</b> · por región: ventas totales por sucursal y producto (lo que dirección quiere ver).',
     data:{where:'🐍 En memoria · por_region',view:{fmt:'table',k:'mem',title:'por_region',cols:['sucursal','producto','monto'],rows:[['CDMX','miel de agave',462.5],['GDL','café molido',620.0],['QRO','café molido',1240.0],['QRO','té verde',890.0]]}}},
    {file:'etl_avanzado.py',line:31,say:'<b>Agregar</b> · por cliente: total gastado y número de compras (el perfil 360).',
     data:{where:'🐍 En memoria · perfil',view:{fmt:'table',k:'mem',title:'perfil',cols:['cliente_id','total','compras'],rows:[[101,1860.0,2],[102,890.0,1],[103,462.5,1]]}}},
    {file:'etl_avanzado.py',line:34,at:'db',edge:6,say:'<b>Cargar 1/3</b>: el detalle transaccional a PostgreSQL, para operación y auditoría.',
     data:{where:'🗄️ PostgreSQL · ventas_detalle',view:{fmt:'table',k:'sql',title:'ventas_detalle',cols:['fecha','sucursal','cliente_id','producto','monto','rfc','ciudad'],rows:[['2026-09-03','QRO',101,'café molido',1240.0,'GORM****8','Querétaro'],['2026-09-04','QRO',102,'té verde',890.0,'RALU****2','CDMX'],['2026-09-04','CDMX',103,'miel de agave',462.5,'TOAA****5','Guadalajara'],['2026-09-05','GDL',101,'café molido',620.0,'GORM****8','Querétaro']]}}},
    {file:'etl_avanzado.py',line:35,at:'mongo',edge:7,say:'<b>Cargar 2/3</b>: el perfil por cliente a MongoDB, como un documento por cliente para la app de soporte.',
     data:{where:'🍃 MongoDB · clientes_360',view:{fmt:'json',k:'nosql',title:'tienda.clientes_360',obj:[{cliente_id:101,total:1860.0,compras:2},{cliente_id:102,total:890.0,compras:1},{cliente_id:103,total:462.5,compras:1}]},
       note:'Un documento por cliente: la app lo lee de un solo golpe, sin joins.'}},
    {file:'etl_avanzado.py',lines:[36,37],at:'drive',edge:8,say:'<b>Cargar 3/3</b>: el reporte por región a Google Drive, donde dirección lo abre sin instalar nada.',
     data:{where:'📁 Google Drive · reporte_regiones',view:{fmt:'multi',parts:[
        {fmt:'table',k:'sql',title:'PostgreSQL · ventas_detalle (4 filas)',cols:['fecha','sucursal','producto','monto'],rows:[['2026-09-03','QRO','café molido',1240.0],['2026-09-04','QRO','té verde',890.0],['2026-09-04','CDMX','miel de agave',462.5],['2026-09-05','GDL','café molido',620.0]]},
        {fmt:'json',k:'nosql',title:'MongoDB · clientes_360 (3 documentos)',obj:[{cliente_id:101,total:1860.0,compras:2},{cliente_id:102,total:890.0,compras:1},{cliente_id:103,total:462.5,compras:1}]},
        {fmt:'table',k:'drive',title:'Google Drive · reporte_regiones (hoja)',cols:['sucursal','producto','monto'],rows:[['CDMX','miel de agave',462.5],['GDL','café molido',620.0],['QRO','café molido',1240.0],['QRO','té verde',890.0]]}]},
       note:'✓ Tres destinos, tres usos. Todo salió del mismo proceso, validado y con lo sensible protegido antes de aterrizar.'}}
  ]
};

/* ===================== ELT 1 · Excel + API → warehouse → SQL ===================== */
LABS.elt1 = {
  title:'ELT 1 · Excel + API → warehouse (crudo) → SQL adentro', level:'Simple', tone:'purple',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Extraer',cols:[1]},{label:'Cargar (crudo)',cols:[2]},{label:'Transformar (en el destino)',cols:[3]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'ventas_qro.xlsx',sub:'Excel · sucio, como siempre'},
    {id:'api',col:0,row:1,kind:'source',icon:'🔌',label:'API del CRM',sub:'clientes · JSON'},
    {id:'ext',col:1,row:0.5,kind:'extract',icon:'🐍',label:'Extraer',sub:'sin limpiar nada'},
    {id:'wh',col:2,row:0.5,kind:'store',icon:'☁️',label:'Warehouse',sub:'raw_ventas · raw_clientes'},
    {id:'tr',col:3,row:0.5,kind:'transform',icon:'🧮',label:'SQL en el warehouse',sub:'ventas_por_cliente'}
  ],
  edges:[{from:'xlsx',to:'ext',n:1},{from:'api',to:'ext',n:2},{from:'ext',to:'wh',n:3},{from:'wh',to:'tr',n:4}],
  files:[
    {name:'cargar_crudo.py',lang:'python',code:`import requests, pandas as pd
from sqlalchemy import create_engine

wh = create_engine("bigquery://tienda/analitica")      # el warehouse

# 1) EXTRAER: leemos las fuentes tal cual, sin limpiar
ventas   = pd.read_excel("ventas_qro.xlsx")
clientes = pd.DataFrame(requests.get(API_CRM).json()["data"])

# 2) CARGAR: crudo, sin tocar nada (la T viene después, en SQL)
ventas.to_sql("raw_ventas", wh, if_exists="append", index=False)
clientes.to_sql("raw_clientes", wh, if_exists="append", index=False)
print("crudo cargado; la transformación corre en el warehouse")`},
    {name:'transformar.sql',lang:'sql',code:`-- 3) TRANSFORMAR: dentro del warehouse, con su cómputo
CREATE OR REPLACE TABLE ventas_por_cliente AS
SELECT
    c.nombre,
    c.ciudad,
    LOWER(TRIM(v.producto))          AS producto,
    SUM(CAST(v.monto AS FLOAT64))    AS total
FROM raw_ventas   v
JOIN raw_clientes c ON c.id = v.cliente_id
GROUP BY c.nombre, c.ciudad, producto
ORDER BY total DESC;`}
  ],
  final:'Python solo extrajo y cargó; toda la transformación la hizo el warehouse con SQL. El crudo sigue ahí para cualquier otra pregunta.',
  steps:[
    {at:'xlsx',say:'<b>Fuente A</b> · el Excel de la sucursal, con los mismos problemas de siempre.',
     data:{where:'📄 Excel · ventas_qro.xlsx',view:{fmt:'table',k:'excel',title:'ventas_qro.xlsx',cols:['fecha','cliente_id','producto','unidades','monto'],rows:[['03/09/26',101,'Café Molido ',2,'1240'],['04/09/26',102,' té verde',5,'890'],['05/09/26',101,'café molido',3,'1860']]},
       note:'Fechas ambiguas, montos como texto, nombres inconsistentes. En ELT no los tocaremos aquí.'}},
    {file:'cargar_crudo.py',line:7,at:'ext',edge:1,say:'<b>Extraer A</b>: el Excel sube a memoria. Y ya. Nada de limpiar.',
     data:{where:'🐍 En memoria · ventas (crudo)'}},
    {file:'cargar_crudo.py',line:8,at:'ext',edge:2,lit:['api'],say:'<b>Extraer B</b>: el CRM responde por API y también sube tal cual.',
     data:{where:'🐍 En memoria · clientes (crudo)',view:{fmt:'json',k:'api',title:'GET /api/clientes',obj:{data:[{id:101,nombre:'María González',ciudad:'Querétaro'},{id:102,nombre:'Luis Ramírez',ciudad:'CDMX'}]}}}},
    {file:'cargar_crudo.py',line:11,at:'wh',edge:3,say:'<b>Cargar</b>: las ventas aterrizan crudas en <code>raw_ventas</code>. Fíjate: siguen sucias.',
     data:{where:'☁️ Warehouse · raw_ventas',view:{fmt:'table',k:'wh',title:'raw_ventas (tal cual llegó)',cols:['fecha','cliente_id','producto','unidades','monto'],rows:[['03/09/26',101,'Café Molido ',2,'1240'],['04/09/26',102,' té verde',5,'890'],['05/09/26',101,'café molido',3,'1860']]},
       note:'Esto es lo que distingue a ELT: el destino recibe el crudo. La limpieza vendrá después, adentro.'}},
    {file:'cargar_crudo.py',line:12,say:'<b>Cargar</b>: los clientes, a <code>raw_clientes</code>. Dos tablas crudas, listas para transformar.',
     data:{where:'☁️ Warehouse · raw_ventas + raw_clientes',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'raw_ventas',cols:['fecha','cliente_id','producto','unidades','monto'],rows:[['03/09/26',101,'Café Molido ',2,'1240'],['04/09/26',102,' té verde',5,'890'],['05/09/26',101,'café molido',3,'1860']]},
        {fmt:'table',k:'wh',title:'raw_clientes',cols:['id','nombre','ciudad'],rows:[[101,'María González','Querétaro'],[102,'Luis Ramírez','CDMX']]}]}}},
    {file:'cargar_crudo.py',line:13,say:'Python terminó. <b>E</b> y <b>L</b> listos; ahora cambia el lenguaje: la <b>T</b> se escribe en SQL.',
     data:{note:'El script fue mínimo a propósito: en ELT la inteligencia vive en el warehouse.'}},
    {file:'transformar.sql',line:2,at:'tr',edge:4,say:'<b>Transformar</b> · dentro del warehouse: creamos la tabla de negocio con una consulta.',
     data:{where:'☁️ Warehouse · motor SQL',note:'CREATE TABLE … AS SELECT: el resultado de la consulta se materializa como una tabla nueva.'}},
    {file:'transformar.sql',lines:[8,9],say:'<b>JOIN</b>: unimos cada venta con su cliente por <code>cliente_id</code>.',
     data:{view:{fmt:'table',k:'wh',title:'raw_ventas ⋈ raw_clientes',cols:['nombre','ciudad','producto','monto'],rows:[['María González','Querétaro','Café Molido ','1240'],['Luis Ramírez','CDMX',' té verde','890'],['María González','Querétaro','café molido','1860']]},
       note:'El warehouse hace el join en paralelo; con millones de filas seguiría siendo rápido.'}},
    {file:'transformar.sql',line:6,say:'<b>LOWER(TRIM(…))</b>: normalizamos el producto, ahora con SQL en vez de pandas.',
     data:{col:{producto:['café molido','té verde','café molido']}}},
    {file:'transformar.sql',line:7,say:'<b>CAST</b>: el monto que venía como texto se vuelve número para poder sumarlo.',
     data:{col:{monto:[1240.0,890.0,1860.0]},note:'Misma limpieza que en ETL, pero ejecutada por el motor del destino.'}},
    {file:'transformar.sql',line:10,say:'<b>GROUP BY</b>: sumamos por cliente, ciudad y producto.',
     data:{view:{fmt:'table',k:'wh',title:'agregado',cols:['nombre','ciudad','producto','total'],rows:[['María González','Querétaro','café molido',3100.0],['Luis Ramírez','CDMX','té verde',890.0]]},
       note:'Las dos compras de café de María se consolidaron en una fila.'}},
    {file:'transformar.sql',line:11,say:'Ordenamos y la tabla <code>ventas_por_cliente</code> queda materializada en el warehouse.',
     data:{where:'☁️ Warehouse · ventas_por_cliente',view:{fmt:'table',k:'wh',title:'ventas_por_cliente',cols:['nombre','ciudad','producto','total'],rows:[['María González','Querétaro','café molido',3100.0],['Luis Ramírez','CDMX','té verde',890.0]]},
       note:'✓ ELT completo. Y raw_ventas sigue intacta: si mañana preguntan por unidades en vez de monto, no hay que volver al Excel.'}}
  ]
};

/* ===================== ELT 2 · 3 fuentes → warehouse + MongoDB → T en cada uno ===================== */
LABS.elt2 = {
  title:'ELT 2 · Excel + API + eventos → warehouse + MongoDB → SQL y aggregation', level:'Simple 2', tone:'purple',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Extraer',cols:[1]},{label:'Cargar (crudo)',cols:[2]},{label:'Transformar (en cada destino)',cols:[3]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'ventas_qro.xlsx',sub:'Excel · tabular'},
    {id:'api',col:0,row:1,kind:'source',icon:'🔌',label:'API del CRM',sub:'clientes · tabular'},
    {id:'ev',col:0,row:2,kind:'source',icon:'⚡',label:'Eventos de la app',sub:'JSON · vistas y compras'},
    {id:'ext',col:1,row:1,kind:'extract',icon:'🐍',label:'Extraer ×3',sub:'sin limpiar nada'},
    {id:'wh',col:2,row:0.5,kind:'store',icon:'☁️',label:'Warehouse SQL',sub:'raw_ventas · raw_clientes'},
    {id:'mongo',col:2,row:1.5,kind:'store',icon:'🍃',label:'MongoDB',sub:'eventos_raw (documentos)'},
    {id:'trsql',col:3,row:0.5,kind:'transform',icon:'🧮',label:'SQL',sub:'ventas_por_ciudad'},
    {id:'trmongo',col:3,row:1.5,kind:'transform',icon:'🧩',label:'Aggregation pipeline',sub:'eventos_por_producto'}
  ],
  edges:[{from:'xlsx',to:'ext',n:1},{from:'api',to:'ext',n:2},{from:'ev',to:'ext',n:3},{from:'ext',to:'wh',n:4},{from:'ext',to:'mongo',n:5},{from:'wh',to:'trsql',n:6},{from:'mongo',to:'trmongo',n:7}],
  files:[
    {name:'cargar_crudo.py',lang:'python',code:`import json, requests, pandas as pd
from sqlalchemy import create_engine
from pymongo import MongoClient

wh    = create_engine("bigquery://tienda/analitica")
mongo = MongoClient("mongodb://mongo:27017").tienda

# 1) EXTRAER: tres fuentes, tal cual
ventas   = pd.read_excel("ventas_qro.xlsx")
clientes = pd.DataFrame(requests.get(API_CRM).json()["data"])
eventos  = [json.loads(linea) for linea in open("eventos_app.jsonl")]

# 2) CARGAR crudo: lo tabular al warehouse, lo semiestructurado a Mongo
ventas.to_sql("raw_ventas", wh, if_exists="append", index=False)
clientes.to_sql("raw_clientes", wh, if_exists="append", index=False)
mongo.eventos_raw.insert_many(eventos)`},
    {name:'transformar.sql',lang:'sql',code:`-- 3a) TRANSFORMAR en el warehouse: ventas por ciudad
CREATE OR REPLACE TABLE ventas_por_ciudad AS
SELECT c.ciudad,
       SUM(CAST(v.monto AS FLOAT64)) AS total
FROM raw_ventas   v
JOIN raw_clientes c ON c.id = v.cliente_id
GROUP BY c.ciudad;`},
    {name:'agregar_eventos.js',lang:'js',code:`// 3b) TRANSFORMAR en MongoDB: agregación sobre los eventos crudos
db.eventos_raw.aggregate([
  { $match: { evento: "compra" } },            // solo compras
  { $group: { _id: "$producto",
              compras: { $sum: 1 },
              ingreso: { $sum: "$monto" } } },
  { $sort: { ingreso: -1 } },
  { $out: "eventos_por_producto" }             // materializar
])`}
  ],
  final:'Tres fuentes, dos almacenes y tres lenguajes: Python para mover, SQL para transformar lo tabular y un pipeline de agregación para lo semiestructurado.',
  steps:[
    {at:'xlsx',say:'<b>Fuente A</b> · el Excel de ventas (tabular).',
     data:{where:'📄 Excel · ventas_qro.xlsx',view:{fmt:'table',k:'excel',title:'ventas_qro.xlsx',cols:['fecha','cliente_id','producto','monto'],rows:[['03/09/26',101,'Café Molido ','1240'],['04/09/26',102,' té verde','890'],['05/09/26',101,'café molido','1860']]}}},
    {file:'cargar_crudo.py',line:9,at:'ext',edge:1,say:'<b>Extraer A</b>: sube a memoria sin limpiar.',data:{where:'🐍 En memoria · ventas'}},
    {file:'cargar_crudo.py',line:10,at:'ext',edge:2,lit:['api'],say:'<b>Extraer B</b>: el CRM por API (tabular).',
     data:{where:'🐍 En memoria · clientes',view:{fmt:'json',k:'api',title:'GET /api/clientes',obj:{data:[{id:101,nombre:'María González',ciudad:'Querétaro'},{id:102,nombre:'Luis Ramírez',ciudad:'CDMX'}]}}}},
    {file:'cargar_crudo.py',line:11,at:'ev',say:'<b>Fuente C</b> · los eventos de la app: un JSON por línea, y no todos tienen la misma forma.',
     data:{where:'⚡ Eventos de la app · eventos_app.jsonl',view:{fmt:'json',k:'json',title:'eventos_app.jsonl (4 líneas)',obj:[{evento:'vista',producto:'té verde',ts:'2026-09-03T10:02:11Z'},{evento:'compra',producto:'café molido',monto:620,ts:'2026-09-03T10:05:40Z'},{evento:'compra',producto:'café molido',monto:620,ts:'2026-09-04T17:22:03Z'},{evento:'compra',producto:'miel de agave',monto:500,ts:'2026-09-05T09:47:55Z',cupon:'OTOÑO10'}]},
       note:'Una "vista" no trae monto y una "compra" trae un cupón que las demás no tienen. Forzar un esquema fijo aquí sería una pelea.'}},
    {file:'cargar_crudo.py',line:11,at:'ext',edge:3,say:'<b>Extraer C</b>: leemos línea por línea; cada una es un diccionario en memoria.',data:{where:'🐍 En memoria · eventos (lista de dicts)'}},
    {file:'cargar_crudo.py',lines:[14,15],at:'wh',edge:4,say:'<b>Cargar</b> · lo tabular va crudo al warehouse SQL.',
     data:{where:'☁️ Warehouse · raw_ventas + raw_clientes',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'raw_ventas',cols:['fecha','cliente_id','producto','monto'],rows:[['03/09/26',101,'Café Molido ','1240'],['04/09/26',102,' té verde','890'],['05/09/26',101,'café molido','1860']]},
        {fmt:'table',k:'wh',title:'raw_clientes',cols:['id','nombre','ciudad'],rows:[[101,'María González','Querétaro'],[102,'Luis Ramírez','CDMX']]}]},
       note:'Filas y columnas: un warehouse SQL es su casa natural.'}},
    {file:'cargar_crudo.py',line:16,at:'mongo',edge:5,say:'<b>Cargar</b> · lo semiestructurado va crudo a MongoDB, documento por documento.',
     data:{where:'🍃 MongoDB · eventos_raw',view:{fmt:'json',k:'nosql',title:'tienda.eventos_raw (4 documentos)',obj:[{evento:'vista',producto:'té verde',ts:'2026-09-03T10:02:11Z'},{evento:'compra',producto:'café molido',monto:620,ts:'2026-09-03T10:05:40Z'},{evento:'compra',producto:'café molido',monto:620,ts:'2026-09-04T17:22:03Z'},{evento:'compra',producto:'miel de agave',monto:500,ts:'2026-09-05T09:47:55Z',cupon:'OTOÑO10'}]},
       note:'Mongo no exige que todos los documentos tengan los mismos campos. El cupón entra sin problema.'}},
    {file:'transformar.sql',line:2,at:'trsql',edge:6,say:'<b>Transformar (a)</b> · en el warehouse, con SQL: ventas por ciudad.',
     data:{where:'☁️ Warehouse · motor SQL',view:{fmt:'table',k:'wh',title:'raw_ventas ⋈ raw_clientes',cols:['ciudad','monto'],rows:[['Querétaro','1240'],['CDMX','890'],['Querétaro','1860']]}}},
    {file:'transformar.sql',lines:[4,7],say:'CAST a número, suma y agrupación por ciudad.',
     data:{view:{fmt:'table',k:'wh',title:'ventas_por_ciudad',cols:['ciudad','total'],rows:[['Querétaro',3100.0],['CDMX',890.0]]},note:'Tabla materializada en el warehouse, lista para el tablero.'}},
    {file:'agregar_eventos.js',line:2,at:'trmongo',edge:7,say:'<b>Transformar (b)</b> · en MongoDB, con su propio lenguaje: un <i>pipeline</i> de etapas.',
     data:{where:'🍃 MongoDB · aggregation',view:{fmt:'json',k:'nosql',title:'eventos_raw (entrada del pipeline)',obj:[{evento:'vista',producto:'té verde'},{evento:'compra',producto:'café molido',monto:620},{evento:'compra',producto:'café molido',monto:620},{evento:'compra',producto:'miel de agave',monto:500,cupon:'OTOÑO10'}]}}},
    {file:'agregar_eventos.js',line:3,say:'<b>$match</b>: nos quedamos solo con las compras; la vista se descarta.',
     data:{view:{fmt:'json',k:'nosql',title:'tras $match (3 documentos)',obj:[{evento:'compra',producto:'café molido',monto:620},{evento:'compra',producto:'café molido',monto:620},{evento:'compra',producto:'miel de agave',monto:500,cupon:'OTOÑO10'}]}}},
    {file:'agregar_eventos.js',lines:[4,6],say:'<b>$group</b>: por producto, contamos compras y sumamos el monto.',
     data:{view:{fmt:'json',k:'nosql',title:'tras $group',obj:[{_id:'café molido',compras:2,ingreso:1240},{_id:'miel de agave',compras:1,ingreso:500}]},note:'El equivalente de GROUP BY, pero sobre documentos.'}},
    {file:'agregar_eventos.js',line:7,say:'<b>$sort</b>: del mayor ingreso al menor.',data:{}},
    {file:'agregar_eventos.js',line:8,say:'<b>$out</b>: materializamos el resultado como una colección nueva.',
     data:{where:'☁️ Warehouse + 🍃 MongoDB',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'Warehouse · ventas_por_ciudad',cols:['ciudad','total'],rows:[['Querétaro',3100.0],['CDMX',890.0]]},
        {fmt:'json',k:'nosql',title:'MongoDB · eventos_por_producto',obj:[{_id:'café molido',compras:2,ingreso:1240},{_id:'miel de agave',compras:1,ingreso:500}]}]},
       note:'✓ Cada destino transformó lo suyo, con su lenguaje. Los crudos siguen intactos en ambos.'}}
  ]
};

/* ===================== ELT 3 · Homologación en el warehouse → warehouse + Drive ===================== */
LABS.elt3 = {
  title:'ELT 3 · Excel Norte + API tienda en línea → homologar en SQL → warehouse + Drive', level:'Compuesto', tone:'purple',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Extraer',cols:[1]},{label:'Cargar (crudo)',cols:[2]},{label:'Transformar (en el destino)',cols:[3]},{label:'Servir',cols:[4]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'ventas_norte.xlsx',sub:'Fecha · Producto · Importe (MXN)'},
    {id:'api',col:0,row:1,kind:'source',icon:'🔌',label:'API tienda en línea',sub:'fecha_venta · total (USD)'},
    {id:'ext',col:1,row:0.5,kind:'extract',icon:'🐍',label:'Extraer',sub:'dos formatos, tal cual'},
    {id:'wh',col:2,row:0.5,kind:'store',icon:'☁️',label:'Warehouse',sub:'raw_norte · raw_online'},
    {id:'tr',col:3,row:0.5,kind:'transform',icon:'🧮',label:'SQL: homologar',sub:'UNION ALL → ventas_unificadas'},
    {id:'drive',col:4,row:0.5,kind:'serve',icon:'📁',label:'Google Drive',sub:'ventas_unificadas (hoja)'}
  ],
  edges:[{from:'xlsx',to:'ext',n:1},{from:'api',to:'ext',n:2},{from:'ext',to:'wh',n:3},{from:'wh',to:'tr',n:4},{from:'tr',to:'drive',n:5}],
  files:[
    {name:'cargar_crudo.py',lang:'python',code:`import requests, pandas as pd
from sqlalchemy import create_engine

wh = create_engine("bigquery://tienda/analitica")

# 1) EXTRAER: dos fuentes con formatos distintos, tal cual
norte  = pd.read_excel("ventas_norte.xlsx")
online = pd.DataFrame(requests.get("https://tienda.mx/api/pedidos").json())

# 2) CARGAR crudo: cada una a su propia tabla raw_*
norte.to_sql("raw_norte", wh, if_exists="append", index=False)
online.to_sql("raw_online", wh, if_exists="append", index=False)`},
    {name:'homologar.sql',lang:'sql',code:`-- 3) TRANSFORMAR en el warehouse: dos formatos → una sola tabla
CREATE OR REPLACE TABLE ventas_unificadas AS
SELECT
    PARSE_DATE('%d/%m/%y', Fecha)     AS fecha,
    LOWER(TRIM(Producto))             AS producto,
    CAST(Importe AS FLOAT64)          AS monto_mxn,
    'sucursal norte'                  AS canal
FROM raw_norte
UNION ALL
SELECT
    DATE(fecha_venta)                 AS fecha,
    LOWER(TRIM(producto))             AS producto,
    total * 18.5                      AS monto_mxn,    -- USD → MXN
    'tienda en línea'                 AS canal
FROM raw_online;`},
    {name:'publicar_drive.py',lang:'python',code:`import pandas as pd, gspread
from sqlalchemy import create_engine

# 4) SERVIR: la tabla unificada, ya transformada, a una hoja compartida
wh = create_engine("bigquery://tienda/analitica")
df = pd.read_sql("SELECT * FROM ventas_unificadas ORDER BY fecha", wh)
hoja = gspread.service_account().open("ventas_unificadas").sheet1
hoja.update([df.columns.tolist()] + df.values.tolist())`}
  ],
  final:'Dos fuentes que no hablaban el mismo idioma aterrizaron crudas y se homologaron con un solo UNION ALL. El resultado vive en el warehouse y se sirve en Drive.',
  steps:[
    {at:'xlsx',say:'<b>Fuente A</b> · la sucursal Norte: pesos, fecha día/mes/año y columnas con mayúscula.',
     data:{where:'📄 Excel · ventas_norte.xlsx',view:{fmt:'table',k:'excel',title:'ventas_norte.xlsx',cols:['Fecha','Producto','Importe'],rows:[['03/09/26','Café Molido',1240],['04/09/26','Té verde',890]]}}},
    {file:'cargar_crudo.py',line:7,at:'ext',edge:1,say:'<b>Extraer A</b>: sube tal cual.',data:{where:'🐍 En memoria · norte'}},
    {file:'cargar_crudo.py',line:8,at:'api',say:'<b>Fuente B</b> · la tienda en línea responde por API: dólares, fecha-hora ISO y otros nombres de columna.',
     data:{where:'🔌 API tienda en línea · JSON',view:{fmt:'json',k:'api',title:'GET /api/pedidos',obj:[{fecha_venta:'2026-09-04T10:22:00Z',producto:'miel de agave',total:27.0},{fecha_venta:'2026-09-05T18:05:00Z',producto:'Café molido',total:33.5}]},
       note:'Mismo negocio, dos "idiomas": Fecha vs fecha_venta, Importe vs total, MXN vs USD.'}},
    {file:'cargar_crudo.py',line:8,at:'ext',edge:2,say:'<b>Extraer B</b>: el JSON sube a memoria como tabla, sin tocar.',data:{where:'🐍 En memoria · online'}},
    {file:'cargar_crudo.py',lines:[11,12],at:'wh',edge:3,say:'<b>Cargar crudo</b>: cada fuente a su propia tabla <code>raw_*</code>. Dos formatos, sin decidir nada todavía.',
     data:{where:'☁️ Warehouse · raw_norte + raw_online',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'raw_norte',cols:['Fecha','Producto','Importe'],rows:[['03/09/26','Café Molido',1240],['04/09/26','Té verde',890]]},
        {fmt:'table',k:'wh',title:'raw_online',cols:['fecha_venta','producto','total'],rows:[['2026-09-04T10:22:00Z','miel de agave',27.0],['2026-09-05T18:05:00Z','Café molido',33.5]]}]},
       note:'Conservar cada crudo con su forma original es una ventaja: si la homologación tuviera un error, se corrige y se vuelve a correr sin re-extraer.'}},
    {file:'homologar.sql',line:2,at:'tr',edge:4,say:'<b>Transformar</b> · la homologación es una sola consulta SQL dentro del warehouse.',
     data:{where:'☁️ Warehouse · motor SQL',note:'Homologar = poner ambas fuentes en el mismo idioma: nombres, fecha, moneda y una etiqueta de canal.'}},
    {file:'homologar.sql',lines:[4,7],say:'<b>Parte 1</b> · raw_norte: PARSE_DATE lee "03/09/26", LOWER/TRIM normaliza, CAST a número y etiquetamos el canal.',
     data:{view:{fmt:'table',k:'wh',title:'parte 1 · raw_norte homologada',cols:['fecha','producto','monto_mxn','canal'],rows:[['2026-09-03','café molido',1240.0,'sucursal norte'],['2026-09-04','té verde',890.0,'sucursal norte']]}}},
    {file:'homologar.sql',lines:[11,14],say:'<b>Parte 2</b> · raw_online: DATE() recorta la hora, y <code>total × 18.5</code> convierte dólares a pesos.',
     data:{view:{fmt:'table',k:'wh',title:'parte 2 · raw_online homologada',cols:['fecha','producto','monto_mxn','canal'],rows:[['2026-09-04','miel de agave',499.5,'tienda en línea'],['2026-09-05','café molido',619.75,'tienda en línea']]},
       note:'Las mismas cuatro columnas, con los mismos nombres y unidades que la parte 1.'}},
    {file:'homologar.sql',line:9,say:'<b>UNION ALL</b> apila las dos partes: ya hablan el mismo idioma.',
     data:{where:'☁️ Warehouse · ventas_unificadas',view:{fmt:'table',k:'wh',title:'ventas_unificadas',cols:['fecha','producto','monto_mxn','canal'],rows:[['2026-09-03','café molido',1240.0,'sucursal norte'],['2026-09-04','té verde',890.0,'sucursal norte'],['2026-09-04','miel de agave',499.5,'tienda en línea'],['2026-09-05','café molido',619.75,'tienda en línea']]},
       note:'Una sola tabla con la columna canal para poder comparar sucursal vs. en línea.'}},
    {file:'publicar_drive.py',line:6,say:'<b>Servir</b> · leemos la tabla ya transformada desde el warehouse…',data:{where:'🐍 En memoria · df (desde el warehouse)'}},
    {file:'publicar_drive.py',lines:[7,8],at:'drive',edge:5,say:'…y la publicamos en una hoja de Google Drive para quien no usa SQL.',
     data:{where:'📁 Google Drive · ventas_unificadas',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'Warehouse · ventas_unificadas',cols:['fecha','producto','monto_mxn','canal'],rows:[['2026-09-03','café molido',1240.0,'sucursal norte'],['2026-09-04','té verde',890.0,'sucursal norte'],['2026-09-04','miel de agave',499.5,'tienda en línea'],['2026-09-05','café molido',619.75,'tienda en línea']]},
        {fmt:'table',k:'drive',title:'Google Drive · ventas_unificadas (hoja)',cols:['fecha','producto','monto_mxn','canal'],rows:[['2026-09-03','café molido',1240.0,'sucursal norte'],['2026-09-04','té verde',890.0,'sucursal norte'],['2026-09-04','miel de agave',499.5,'tienda en línea'],['2026-09-05','café molido',619.75,'tienda en línea']]}]},
       note:'✓ Dos almacenes distintos: el warehouse (donde se transformó) y Drive (donde se consume).'}}
  ]
};

/* ===================== ELT 4 · Medallion: bronce → plata → oro → servir ===================== */
LABS.elt4 = {
  title:'ELT 4 · Arquitectura Medallion: bronce → plata → oro → tres consumidores', level:'Compuesto complejo', tone:'purple',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Ingesta',cols:[1]},{label:'Bronce · crudo',cols:[2],tone:'bronze'},{label:'Plata · limpio',cols:[3],tone:'silver'},{label:'Oro · negocio',cols:[4],tone:'gold'},{label:'Servir',cols:[5]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'Excel × 3 sucursales',sub:'ventas · sucias'},
    {id:'api',col:0,row:1,kind:'source',icon:'🔌',label:'API del CRM',sub:'clientes · con RFC'},
    {id:'web',col:0,row:2,kind:'source',icon:'🕸️',label:'proveedor.mx',sub:'precios · scraping'},
    {id:'ev',col:0,row:3,kind:'source',icon:'⚡',label:'Eventos de la app',sub:'JSON'},
    {id:'ing',col:1,row:1.5,kind:'extract',icon:'🐍',label:'Ingesta',sub:'tal cual, con marca de tiempo'},
    {id:'bronze',col:2,row:1.5,kind:'bronze',icon:'🥉',label:'Bronce',sub:'raw_ventas · raw_clientes · raw_precios · raw_eventos'},
    {id:'silver',col:3,row:1.5,kind:'silver',icon:'🥈',label:'Plata',sub:'limpio · homologado · enmascarado'},
    {id:'gold',col:4,row:1.5,kind:'gold',icon:'🥇',label:'Oro',sub:'ventas_region · clientes_360'},
    {id:'bi',col:5,row:0.5,kind:'serve',icon:'📊',label:'Power BI',sub:'tablero de ventas'},
    {id:'mongo',col:5,row:1.5,kind:'store',icon:'🍃',label:'MongoDB',sub:'clientes_360 (app soporte)'},
    {id:'drive',col:5,row:2.5,kind:'store',icon:'📁',label:'Google Drive',sub:'reporte_direccion'}
  ],
  edges:[{from:'xlsx',to:'ing',n:1},{from:'api',to:'ing',n:2},{from:'web',to:'ing',n:3},{from:'ev',to:'ing',n:4},{from:'ing',to:'bronze',n:5},{from:'bronze',to:'silver',n:6},{from:'silver',to:'gold',n:7},{from:'gold',to:'bi',n:8},{from:'gold',to:'mongo',n:9},{from:'gold',to:'drive',n:10}],
  files:[
    {name:'ingesta.py',lang:'python',code:`import glob, requests, pandas as pd
from datetime import datetime
from sqlalchemy import create_engine

lago  = create_engine("bigquery://tienda/bronce")        # capa BRONCE
ahora = datetime.utcnow()

def a_bronce(df, tabla):
    df["_ingestado_en"] = ahora                          # marca de tiempo
    df.to_sql(tabla, lago, if_exists="append", index=False)

# INGESTA: todo tal cual, sin limpiar, sin decidir nada todavía
for archivo in glob.glob("ventas_*.xlsx"):
    a_bronce(pd.read_excel(archivo).assign(sucursal=archivo[7:-5]), "raw_ventas")
a_bronce(pd.DataFrame(requests.get(API_CRM).json()["data"]), "raw_clientes")
a_bronce(extraer_precios("https://proveedor.mx/catalogo"), "raw_precios")
a_bronce(pd.read_json("eventos_app.jsonl", lines=True), "raw_eventos")`},
    {name:'plata.sql',lang:'sql',code:`-- Capa PLATA: limpiar, homologar y enmascarar (en producción: modelos dbt)
CREATE OR REPLACE TABLE plata.ventas AS
SELECT
    COALESCE(SAFE.PARSE_DATE('%d/%m/%y', fecha), SAFE.PARSE_DATE('%Y-%m-%d', fecha)) AS fecha,
    UPPER(sucursal)                                             AS sucursal,
    LOWER(TRIM(producto))                                       AS producto,
    CASE WHEN moneda = 'USD' THEN monto * 18.5 ELSE monto END   AS monto_mxn,
    cliente_id
FROM bronce.raw_ventas
WHERE monto > 0                                                  -- validar
QUALIFY ROW_NUMBER() OVER (PARTITION BY fecha, cliente_id, producto
                           ORDER BY _ingestado_en DESC) = 1;    -- deduplicar

CREATE OR REPLACE TABLE plata.clientes AS
SELECT id, nombre, ciudad,
       CONCAT(SUBSTR(rfc, 1, 4), '****', SUBSTR(rfc, -1)) AS rfc  -- enmascarar
FROM bronce.raw_clientes;`},
    {name:'oro.sql',lang:'sql',code:`-- Capa ORO: tablas de negocio, listas para consumir
CREATE OR REPLACE TABLE oro.ventas_region AS
SELECT sucursal, producto, SUM(monto_mxn) AS monto
FROM plata.ventas
GROUP BY sucursal, producto;

CREATE OR REPLACE TABLE oro.clientes_360 AS
SELECT c.id AS cliente_id, c.nombre, c.rfc, c.ciudad,
       SUM(v.monto_mxn) AS total,
       COUNT(*)         AS compras,
       MAX(v.fecha)     AS ultima_compra
FROM plata.ventas v
JOIN plata.clientes c ON c.id = v.cliente_id
GROUP BY 1, 2, 3, 4;`},
    {name:'servir.py',lang:'python',code:`import pandas as pd, gspread
from pymongo import MongoClient
from sqlalchemy import create_engine

oro = create_engine("bigquery://tienda/oro")

# SERVIR: de la capa ORO a cada consumidor
# (a) Power BI se conecta directo a oro.ventas_region: no hay que mover nada
# (b) MongoDB: un documento por cliente para la app de soporte
perfil = pd.read_sql("SELECT * FROM clientes_360", oro)
MongoClient(MONGO).tienda.clientes_360.insert_many(perfil.to_dict("records"))
# (c) Google Drive: el reporte por región para dirección
region = pd.read_sql("SELECT * FROM ventas_region ORDER BY monto DESC", oro)
gspread.service_account().open("reporte_direccion").sheet1.update(
    [region.columns.tolist()] + region.values.tolist())`}
  ],
  final:'Bronce guarda todo lo que llegó; plata lo deja limpio y seguro; oro lo vuelve respuesta de negocio. Tres consumidores distintos, un solo origen de verdad.',
  steps:[
    {at:'xlsx',lit:['api','web','ev'],say:'<b>Cuatro fuentes</b>. En Medallion no se decide nada al entrar: todo cae tal cual.',
     data:{where:'Fuentes · Excel + API + scraping + eventos',view:{fmt:'multi',parts:[
        {fmt:'table',k:'excel',title:'ventas_*.xlsx (3 archivos, vista combinada)',cols:['fecha','cliente_id','producto','monto','moneda'],rows:[['03/09/26',101,'Café Molido ',1240.0,'MXN'],['04/09/26',102,'té verde',890.0,'MXN'],['2026-09-04',103,'miel de agave',25.0,'USD'],['2026-09-04',103,'miel de agave',25.0,'USD'],['05/09/26',101,'CAFÉ MOLIDO',620.0,'MXN'],['05/09/26',104,'té verde',-200.0,'MXN']]},
        {fmt:'json',k:'api',title:'API del CRM',obj:{data:[{id:101,nombre:'María González',rfc:'GORM850312QX8',ciudad:'Querétaro'},{id:102,nombre:'Luis Ramírez',rfc:'RALU900714HJ2',ciudad:'CDMX'},{id:103,nombre:'Ana Torres',rfc:'TOAA881120MB5',ciudad:'Guadalajara'}]}},
        {fmt:'table',k:'html',title:'proveedor.mx (scraping)',cols:['producto','precio_lista'],rows:[['café molido',620.0],['té verde',200.0],['miel de agave',500.0]]},
        {fmt:'json',k:'json',title:'eventos_app.jsonl',obj:[{evento:'compra',producto:'café molido',monto:620},{evento:'vista',producto:'té verde'}]}]},
       note:'Dos formatos de fecha, una venta en dólares, una repetida, una con monto negativo (devolución mal capturada) y un RFC completo. Todo entra.'}},
    {file:'ingesta.py',lines:[8,10],at:'ing',edge:[1,2,3,4],say:'<b>Ingesta</b>: una función mínima que agrega marca de tiempo y apila en bronce. Sin limpiar.',
     data:{where:'🐍 Ingesta · a_bronce()',note:'La marca _ingestado_en nos deja saber cuándo llegó cada fila (y deduplicar quedándonos con la más reciente).'}},
    {file:'ingesta.py',lines:[13,14],at:'bronze',edge:5,say:'<b>Bronce</b> · las ventas de las tres sucursales, tal cual, con su sucursal y su marca de tiempo.',
     data:{where:'🥉 Bronce · raw_ventas',view:{fmt:'table',k:'wh',title:'bronce.raw_ventas',cols:['fecha','cliente_id','producto','monto','moneda','sucursal','_ingestado_en'],rows:[['03/09/26',101,'Café Molido ',1240.0,'MXN','qro','06:00'],['04/09/26',102,'té verde',890.0,'MXN','qro','06:00'],['2026-09-04',103,'miel de agave',25.0,'USD','cdmx','06:00'],['2026-09-04',103,'miel de agave',25.0,'USD','cdmx','06:00'],['05/09/26',101,'CAFÉ MOLIDO',620.0,'MXN','gdl','06:00'],['05/09/26',104,'té verde',-200.0,'MXN','gdl','06:00']]},
       note:'Sigue sucia a propósito. Bronce es la copia fiel de la realidad.'}},
    {file:'ingesta.py',lines:[15,17],say:'<b>Bronce</b> completo: clientes (con RFC en claro), precios y eventos. La despensa entera.',
     data:{where:'🥉 Bronce · 4 tablas crudas',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'bronce.raw_ventas (6 filas)',cols:['fecha','cliente_id','producto','monto','moneda','sucursal'],rows:[['03/09/26',101,'Café Molido ',1240.0,'MXN','qro'],['2026-09-04',103,'miel de agave',25.0,'USD','cdmx'],['05/09/26',104,'té verde',-200.0,'MXN','gdl']]},
        {fmt:'json',k:'wh',title:'bronce.raw_clientes',obj:[{id:101,nombre:'María González',rfc:'GORM850312QX8',ciudad:'Querétaro'},{id:102,nombre:'Luis Ramírez',rfc:'RALU900714HJ2',ciudad:'CDMX'},{id:103,nombre:'Ana Torres',rfc:'TOAA881120MB5',ciudad:'Guadalajara'}]},
        {fmt:'table',k:'wh',title:'bronce.raw_precios',cols:['producto','precio_lista'],rows:[['café molido',620.0],['té verde',200.0],['miel de agave',500.0]]},
        {fmt:'json',k:'wh',title:'bronce.raw_eventos',obj:[{evento:'compra',producto:'café molido',monto:620},{evento:'vista',producto:'té verde'}]}]},
       note:'⚠ Bronce contiene datos sensibles en crudo: su acceso debe estar restringido. Este es el punto débil de ELT que vimos en la brecha de Snowflake.'}},
    {file:'plata.sql',line:2,at:'silver',edge:6,say:'<b>Plata</b> · limpiamos con SQL, dentro del warehouse. Empezamos por las ventas.',
     data:{where:'🥈 Plata · motor SQL',view:{fmt:'table',k:'wh',title:'bronce.raw_ventas → plata.ventas',cols:['fecha','sucursal','producto','monto','moneda','cliente_id'],rows:[['03/09/26','qro','Café Molido ',1240.0,'MXN',101],['04/09/26','qro','té verde',890.0,'MXN',102],['2026-09-04','cdmx','miel de agave',25.0,'USD',103],['2026-09-04','cdmx','miel de agave',25.0,'USD',103],['05/09/26','gdl','CAFÉ MOLIDO',620.0,'MXN',101],['05/09/26','gdl','té verde',-200.0,'MXN',104]]}}},
    {file:'plata.sql',line:4,say:'Fechas: dos formatos → uno. <code>SAFE.PARSE_DATE</code> devuelve NULL si el formato no coincide, y <code>COALESCE</code> toma el que sí.',
     data:{col:{fecha:['2026-09-03','2026-09-04','2026-09-04','2026-09-04','2026-09-05','2026-09-05']}}},
    {file:'plata.sql',line:5,say:'Sucursal en mayúsculas.',data:{col:{sucursal:['QRO','QRO','CDMX','CDMX','GDL','GDL']}}},
    {file:'plata.sql',line:6,say:'Producto normalizado.',data:{col:{producto:['café molido','té verde','miel de agave','miel de agave','café molido','té verde']}}},
    {file:'plata.sql',line:7,say:'Moneda homologada: lo que venía en USD se convierte a pesos.',
     data:{rename:{monto:'monto_mxn'},col:{monto_mxn:[1240.0,890.0,462.5,462.5,620.0,-200.0]},drop:['moneda']}},
    {file:'plata.sql',line:10,say:'<b>Validar</b>: <code>WHERE monto > 0</code> deja fuera la devolución mal capturada.',
     data:{delRows:[5],note:'En ELT la validación no detiene nada: filtra al construir plata. El registro raro sigue en bronce por si hay que investigarlo.'}},
    {file:'plata.sql',lines:[11,12],say:'<b>Deduplicar</b>: de las dos filas iguales de CDMX nos quedamos con la ingestada más recientemente.',
     data:{delRows:[3]}},
    {file:'plata.sql',lines:[14,17],say:'<b>Plata · clientes</b>: el RFC se enmascara aquí con SQL. En bronce sigue completo; por eso bronce es de acceso restringido.',
     data:{where:'🥈 Plata · ventas + clientes',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'plata.ventas (4 filas limpias)',cols:['fecha','sucursal','producto','monto_mxn','cliente_id'],rows:[['2026-09-03','QRO','café molido',1240.0,101],['2026-09-04','QRO','té verde',890.0,102],['2026-09-04','CDMX','miel de agave',462.5,103],['2026-09-05','GDL','café molido',620.0,101]]},
        {fmt:'table',k:'wh',title:'plata.clientes (RFC enmascarado)',cols:['id','nombre','ciudad','rfc'],rows:[[101,'María González','Querétaro','GORM****8'],[102,'Luis Ramírez','CDMX','RALU****2'],[103,'Ana Torres','Guadalajara','TOAA****5']]}]},
       note:'Plata es la capa de confianza: desde aquí cualquier analista puede trabajar sin ver datos personales.'}},
    {file:'oro.sql',lines:[2,5],at:'gold',edge:7,say:'<b>Oro</b> · las tablas de negocio. Primero: ventas por región y producto.',
     data:{where:'🥇 Oro · ventas_region',view:{fmt:'table',k:'wh',title:'oro.ventas_region',cols:['sucursal','producto','monto'],rows:[['CDMX','miel de agave',462.5],['GDL','café molido',620.0],['QRO','café molido',1240.0],['QRO','té verde',890.0]]}}},
    {file:'oro.sql',lines:[7,14],say:'<b>Oro</b> · el perfil 360 de cada cliente: total, compras y última compra, con el RFC ya enmascarado.',
     data:{where:'🥇 Oro · clientes_360',view:{fmt:'table',k:'wh',title:'oro.clientes_360',cols:['cliente_id','nombre','rfc','ciudad','total','compras','ultima_compra'],rows:[[101,'María González','GORM****8','Querétaro',1860.0,2,'2026-09-05'],[102,'Luis Ramírez','RALU****2','CDMX',890.0,1,'2026-09-04'],[103,'Ana Torres','TOAA****5','Guadalajara',462.5,1,'2026-09-04']]},
       note:'Cada capa responde una pregunta distinta: bronce "¿qué llegó?", plata "¿qué es confiable?", oro "¿qué necesita el negocio?".'}},
    {file:'servir.py',line:8,at:'bi',edge:8,say:'<b>Servir (a)</b> · Power BI se conecta directo a oro. No hay que mover nada.',
     data:{where:'📊 Power BI ← oro.ventas_region',view:{fmt:'table',k:'wh',title:'Power BI · tablero de ventas ← oro.ventas_region',cols:['sucursal','producto','monto'],rows:[['QRO','café molido',1240.0],['QRO','té verde',890.0],['GDL','café molido',620.0],['CDMX','miel de agave',462.5]]}}},
    {file:'servir.py',lines:[10,11],at:'mongo',edge:9,say:'<b>Servir (b)</b> · un documento por cliente a MongoDB, para que la app de soporte lo lea de un golpe.',
     data:{where:'🍃 MongoDB · clientes_360',view:{fmt:'json',k:'nosql',title:'tienda.clientes_360',obj:[{cliente_id:101,nombre:'María González',rfc:'GORM****8',ciudad:'Querétaro',total:1860.0,compras:2,ultima_compra:'2026-09-05'},{cliente_id:102,nombre:'Luis Ramírez',rfc:'RALU****2',ciudad:'CDMX',total:890.0,compras:1,ultima_compra:'2026-09-04'},{cliente_id:103,nombre:'Ana Torres',rfc:'TOAA****5',ciudad:'Guadalajara',total:462.5,compras:1,ultima_compra:'2026-09-04'}]}}},
    {file:'servir.py',lines:[13,15],at:'drive',edge:10,say:'<b>Servir (c)</b> · el reporte por región a Google Drive, para dirección.',
     data:{where:'📁 Google Drive · reporte_direccion',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'Power BI ← oro.ventas_region',cols:['sucursal','producto','monto'],rows:[['QRO','café molido',1240.0],['QRO','té verde',890.0],['GDL','café molido',620.0],['CDMX','miel de agave',462.5]]},
        {fmt:'json',k:'nosql',title:'MongoDB · clientes_360 (3 documentos)',obj:[{cliente_id:101,total:1860.0,compras:2},{cliente_id:102,total:890.0,compras:1},{cliente_id:103,total:462.5,compras:1}]},
        {fmt:'table',k:'drive',title:'Google Drive · reporte_direccion (hoja)',cols:['sucursal','producto','monto'],rows:[['QRO','café molido',1240.0],['QRO','té verde',890.0],['GDL','café molido',620.0],['CDMX','miel de agave',462.5]]}]},
       note:'✓ Tres consumidores, un origen de verdad. Y si mañana preguntan por los cupones de la app, bronce ya los tiene.'}}
  ]
};

/* ===================== HÍBRIDO · ETL + ELT orquestados con un DAG de Airflow ===================== */
LABS.hibrido = {
  title:'Híbrido · un DAG de Airflow orquesta ETL (lo sensible) y ELT (el grueso)', level:'Avanzado', tone:'amber',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Tareas del DAG',cols:[1]},{label:'Almacenes',cols:[2]},{label:'T en el destino',cols:[3]},{label:'Servir',cols:[4]}],
  nodes:[
    {id:'api',col:0,row:0,kind:'source',icon:'🔌',label:'API del CRM',sub:'clientes · sensible'},
    {id:'xlsx',col:0,row:1,kind:'source',icon:'📄',label:'Excel ventas',sub:'3 sucursales'},
    {id:'ev',col:0,row:2,kind:'source',icon:'⚡',label:'Eventos app',sub:'JSON'},
    {id:'etl',col:1,row:0,kind:'transform',icon:'🛡️',label:'etl_clientes',sub:'ETL · enmascarar ANTES'},
    {id:'load',col:1,row:1.5,kind:'extract',icon:'📥',label:'cargar_bronce',sub:'ELT · crudo al warehouse'},
    {id:'pg',col:2,row:0,kind:'store',icon:'🗄️',label:'PostgreSQL',sub:'clientes (ya seguro)'},
    {id:'wh',col:2,row:1.5,kind:'store',icon:'☁️',label:'Warehouse',sub:'bronce.raw_* · plata.clientes'},
    {id:'tsql',col:3,row:1.5,kind:'transform',icon:'🧮',label:'transformar_sql',sub:'bronce → plata → oro'},
    {id:'drive',col:4,row:1.5,kind:'serve',icon:'📁',label:'publicar_drive',sub:'ventas_semana (hoja)'}
  ],
  edges:[{from:'api',to:'etl',n:1},{from:'etl',to:'pg',n:2},{from:'etl',to:'wh',n:3},{from:'xlsx',to:'load',n:4},{from:'ev',to:'load',n:5},{from:'load',to:'wh',n:6},{from:'wh',to:'tsql',n:7},{from:'tsql',to:'drive',n:8}],
  tasks:[{id:'etl_clientes',file:'tareas/etl_clientes.py'},{id:'cargar_bronce',file:'tareas/cargar_bronce.py'},{id:'transformar_sql',file:'tareas/transformar.sql'},{id:'publicar_drive',file:'tareas/publicar_drive.py'}],
  dag:[['etl_clientes','cargar_bronce'],'transformar_sql','publicar_drive'],
  files:[
    {name:'dag.py',lang:'python',box:'A',code:`from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.providers.common.sql.operators.sql import (
    SQLExecuteQueryOperator)
from datetime import datetime
from tareas import etl_clientes, cargar_bronce, publicar_drive

# todos los días a las 6:00
with DAG("tienda_hibrido", start_date=datetime(2026, 9, 1),
         schedule="0 6 * * *", catchup=False) as dag:

    # ETL: lo sensible (se enmascara ANTES de cargar)
    t_etl = PythonOperator(task_id="etl_clientes",
                           python_callable=etl_clientes.run)
    # ELT: el grueso (crudo al warehouse)
    t_load = PythonOperator(task_id="cargar_bronce",
                            python_callable=cargar_bronce.run)
    # T en el destino (SQL dentro del warehouse)
    t_sql = SQLExecuteQueryOperator(task_id="transformar_sql",
                                    conn_id="warehouse",
                                    sql="tareas/transformar.sql")
    t_pub = PythonOperator(task_id="publicar_drive",
                           python_callable=publicar_drive.run)

    # corchetes = en paralelo · >> = "y después"
    [t_etl, t_load] >> t_sql >> t_pub`},
    {name:'tareas/etl_clientes.py',lang:'python',box:'B',code:`import requests, pandas as pd
from sqlalchemy import create_engine

def run():
    # ETL: extraer → ENMASCARAR → cargar
    datos = requests.get(API_CRM).json()["data"]
    df = pd.DataFrame(datos)
    df["rfc"] = (df["rfc"].str[:4] + "****"
                 + df["rfc"].str[-1:])
    df["telefono"] = "•••• " + df["telefono"].str[-4:]
    df.to_sql("clientes", create_engine(PG),
              if_exists="replace", index=False)
    df.to_sql("clientes", create_engine(WH),
              schema="plata", if_exists="replace",
              index=False)`},
    {name:'tareas/cargar_bronce.py',lang:'python',box:'B',code:`import glob, pandas as pd
from sqlalchemy import create_engine

def run():
    # ELT: extraer → cargar CRUDO a bronce
    wh = create_engine(WH)
    for archivo in glob.glob("ventas_*.xlsx"):
        ventas = pd.read_excel(archivo)
        ventas["sucursal"] = archivo[7:-5]
        ventas.to_sql("raw_ventas", wh, schema="bronce",
                      if_exists="append", index=False)
    eventos = pd.read_json("eventos_app.jsonl",
                           lines=True)
    eventos.to_sql("raw_eventos", wh, schema="bronce",
                   if_exists="append", index=False)`},
    {name:'tareas/transformar.sql',lang:'sql',box:'B',code:`-- T en el destino: bronce → plata → oro
CREATE OR REPLACE TABLE plata.ventas AS
SELECT PARSE_DATE('%d/%m/%y', fecha) AS fecha,
       UPPER(sucursal)       AS sucursal,
       LOWER(TRIM(producto)) AS producto,
       monto, cliente_id
FROM bronce.raw_ventas
WHERE monto > 0;

CREATE OR REPLACE TABLE oro.ventas_semana AS
SELECT v.sucursal, c.ciudad, v.producto,
       SUM(v.monto) AS monto
FROM plata.ventas v
-- clientes ya enmascarados por el ETL:
JOIN plata.clientes c ON c.id = v.cliente_id
GROUP BY 1, 2, 3;`},
    {name:'tareas/publicar_drive.py',lang:'python',box:'B',code:`import pandas as pd, gspread
from sqlalchemy import create_engine

def run():
    # SERVIR: oro → hoja semanal de dirección
    df = pd.read_sql("SELECT * FROM oro.ventas_semana",
                     create_engine(WH))
    gc = gspread.service_account()
    hoja = gc.open("ventas_semana").sheet1
    hoja.update([df.columns.tolist()]
                + df.values.tolist())`}
  ],
  final:'Un DAG, cuatro tareas, dos en paralelo. Lo sensible viajó por ETL y lo masivo por ELT, y ambos se unieron en el warehouse sin exponer datos personales.',
  steps:[
    {hl:[{file:'dag.py',lines:[8,10]}],say:'<b>El DAG</b>: un flujo programado todos los días a las 6:00. Airflow lo lee y decide qué corre, cuándo y en qué orden.',
     data:{where:'🗂️ Airflow · scheduler',note:'Un DAG no mueve datos por sí mismo: es el director de orquesta. Cada tarea es un script aparte (ventana de la derecha).'}},
    {hl:[{file:'dag.py',lines:[25,26]}],say:'<b>Las dependencias</b>: <code>etl_clientes</code> y <code>cargar_bronce</code> corren en <b>paralelo</b>; cuando ambas terminan, <code>transformar_sql</code>; y al final, <code>publicar_drive</code>.',
     data:{note:'Corchetes = paralelo. >> = "y después". Con una línea describimos toda la arquitectura.'}},
    {task:'etl_clientes',hl:[{file:'dag.py',lines:[12,14]},{file:'tareas/etl_clientes.py',lines:[6,7]}],at:'etl',edge:1,lit:['api'],say:'<b>Tarea etl_clientes (ETL)</b> · extraemos los clientes del CRM: traen RFC y teléfono en claro.',
     data:{where:'🔌 API del CRM → memoria',view:{fmt:'json',k:'api',title:'GET /api/clientes',obj:{data:[{id:101,nombre:'María González',rfc:'GORM850312QX8',telefono:'4421185590',ciudad:'Querétaro'},{id:102,nombre:'Luis Ramírez',rfc:'RALU900714HJ2',telefono:'4422107783',ciudad:'CDMX'}]}},
       note:'Por ser sensible, este dato va por el camino ETL: se transforma en memoria, antes de cualquier destino.'}},
    {task:'etl_clientes',hl:[{file:'dag.py',lines:[12,14]},{file:'tareas/etl_clientes.py',lines:[8,10]}],say:'<b>ETL</b> · enmascaramos RFC y teléfono en memoria.',
     data:{where:'🐍 En memoria · df',view:{fmt:'table',k:'mem',title:'df (enmascarado)',cols:['id','nombre','rfc','telefono','ciudad'],rows:[[101,'María González','GORM****8','•••• 5590','Querétaro'],[102,'Luis Ramírez','RALU****2','•••• 7783','CDMX']]}}},
    {task:'etl_clientes',hl:[{file:'dag.py',lines:[12,14]},{file:'tareas/etl_clientes.py',lines:[11,12]}],at:'pg',edge:2,say:'<b>ETL</b> · cargamos la versión segura en PostgreSQL (operación).',
     data:{where:'🗄️ PostgreSQL · clientes',view:{fmt:'table',k:'sql',title:'clientes',cols:['id','nombre','rfc','telefono','ciudad'],rows:[[101,'María González','GORM****8','•••• 5590','Querétaro'],[102,'Luis Ramírez','RALU****2','•••• 7783','CDMX']]}}},
    {task:'etl_clientes',hl:[{file:'dag.py',lines:[12,14]},{file:'tareas/etl_clientes.py',lines:[13,15]}],at:'wh',edge:3,say:'…y una copia igual de segura a <code>plata.clientes</code> en el warehouse, para que la T de oro pueda unir sin ver datos sensibles.',
     data:{where:'☁️ Warehouse · plata.clientes',view:{fmt:'table',k:'wh',title:'plata.clientes',cols:['id','nombre','rfc','telefono','ciudad'],rows:[[101,'María González','GORM****8','•••• 5590','Querétaro'],[102,'Luis Ramírez','RALU****2','•••• 7783','CDMX']]},
       note:'✓ etl_clientes terminó. En paralelo corría cargar_bronce: veámosla.'}},
    {task:'cargar_bronce',hl:[{file:'dag.py',lines:[15,17]},{file:'tareas/cargar_bronce.py',lines:[7,9]}],at:'load',edge:4,lit:['xlsx'],say:'<b>Tarea cargar_bronce (ELT)</b> · las ventas de las tres sucursales suben crudas, sin limpiar.',
     data:{where:'📄 Excel → memoria',view:{fmt:'table',k:'excel',title:'ventas_qro.xlsx (una de tres)',cols:['fecha','cliente_id','producto','monto','sucursal'],rows:[['03/09/26',101,'Café Molido ',1240.0,'qro'],['04/09/26',102,' té verde',890.0,'qro'],['05/09/26',101,'café molido',620.0,'qro']]},
       note:'Por ser masivo y no sensible, este dato va por el camino ELT.'}},
    {task:'cargar_bronce',hl:[{file:'dag.py',lines:[15,17]},{file:'tareas/cargar_bronce.py',lines:[12,13]}],edge:5,lit:['ev'],say:'<b>ELT</b> · los eventos de la app también van crudos.',
     data:{where:'⚡ Eventos → memoria',view:{fmt:'json',k:'json',title:'eventos_app.jsonl',obj:[{evento:'compra',producto:'café molido',monto:620,ts:'2026-09-05T09:47:55Z'},{evento:'vista',producto:'té verde',ts:'2026-09-05T09:50:02Z'}]}}},
    {task:'cargar_bronce',hl:[{file:'dag.py',lines:[15,17]},{file:'tareas/cargar_bronce.py',lines:[10,11]},{file:'tareas/cargar_bronce.py',lines:[14,15]}],at:'wh',edge:6,say:'<b>ELT</b> · bronce recibe todo tal cual.',
     data:{where:'☁️ Warehouse · bronce',view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'bronce.raw_ventas',cols:['fecha','cliente_id','producto','monto','sucursal'],rows:[['03/09/26',101,'Café Molido ',1240.0,'qro'],['04/09/26',102,' té verde',890.0,'qro'],['05/09/26',101,'café molido',620.0,'qro']]},
        {fmt:'json',k:'wh',title:'bronce.raw_eventos',obj:[{evento:'compra',producto:'café molido',monto:620},{evento:'vista',producto:'té verde'}]}]},
       note:'✓ Las dos tareas paralelas terminaron. Airflow libera la siguiente: transformar_sql.'}},
    {task:'transformar_sql',hl:[{file:'dag.py',lines:[18,21]},{file:'tareas/transformar.sql',lines:[2,8]}],at:'tsql',edge:7,say:'<b>Tarea transformar_sql</b> · la T corre en el warehouse: de bronce a plata (limpiar y validar).',
     data:{where:'☁️ Warehouse · plata.ventas',view:{fmt:'table',k:'wh',title:'plata.ventas',cols:['fecha','sucursal','producto','monto','cliente_id'],rows:[['2026-09-03','QRO','café molido',1240.0,101],['2026-09-04','QRO','té verde',890.0,102],['2026-09-05','QRO','café molido',620.0,101]]}}},
    {task:'transformar_sql',hl:[{file:'dag.py',lines:[18,21]},{file:'tareas/transformar.sql',lines:[10,16]}],say:'De plata a <b>oro</b>: unimos con <code>plata.clientes</code>, que llegó enmascarada por el camino ETL. Los dos caminos se encuentran aquí.',
     data:{where:'☁️ Warehouse · oro.ventas_semana',view:{fmt:'table',k:'wh',title:'oro.ventas_semana',cols:['sucursal','ciudad','producto','monto'],rows:[['QRO','Querétaro','café molido',1860.0],['QRO','CDMX','té verde',890.0]]},
       note:'La ciudad viene de la tabla de clientes (ETL) y el monto de las ventas (ELT). Nadie en el warehouse vio un RFC completo.'}},
    {task:'publicar_drive',hl:[{file:'dag.py',lines:[22,23]},{file:'tareas/publicar_drive.py',lines:[6,11]}],at:'drive',edge:8,say:'<b>Tarea publicar_drive</b> · el resultado de oro sale a la hoja semanal de dirección.',
     data:{where:'📁 Google Drive · ventas_semana',view:{fmt:'table',k:'drive',title:'Google Drive · ventas_semana (hoja)',cols:['sucursal','ciudad','producto','monto'],rows:[['QRO','Querétaro','café molido',1860.0],['QRO','CDMX','té verde',890.0]]}}},
    {hl:[{file:'dag.py',lines:[25,26]}],say:'<b>DAG completado</b>: 4 tareas, 2 en paralelo, ETL y ELT en una misma arquitectura. Mañana a las 6:00 vuelve a correr solo.',
     data:{note:'✓ Si una tarea falla, Airflow la reintenta y avisa; las que dependen de ella esperan. Eso es orquestar.'}}
  ]
};

/* ===================== LAMBDA · batch + streaming ===================== */
LABS.lambda = {
  title:'Lambda · capa batch (ETL nocturno) + capa de velocidad (Kafka) + capa de servicio', level:'Avanzado', tone:'amber',
  lanes:[{label:'Fuentes',cols:[0]},{label:'Batch / Velocidad',cols:[1]},{label:'Almacenes',cols:[2]},{label:'Servir',cols:[3]}],
  nodes:[
    {id:'xlsx',col:0,row:0,kind:'source',icon:'📄',label:'ventas_dia.xlsx',sub:'llega cada noche'},
    {id:'stream',col:0,row:2,kind:'source',icon:'⚡',label:'Compras en la app',sub:'Kafka · evento por evento'},
    {id:'batch',col:1,row:0,kind:'transform',icon:'🌙',label:'ETL nocturno',sub:'limpia y agrega (2:00 am)'},
    {id:'consumer',col:1,row:2,kind:'transform',icon:'🔄',label:'Consumidor Kafka',sub:'procesa al vuelo'},
    {id:'pg',col:2,row:0,kind:'store',icon:'🗄️',label:'PostgreSQL',sub:'ventas_diarias (histórico)'},
    {id:'mongo',col:2,row:2,kind:'store',icon:'🍃',label:'MongoDB',sub:'ventas_hoy (tiempo real)'},
    {id:'serve',col:3,row:1,kind:'serve',icon:'📊',label:'Capa de servicio',sub:'histórico + hoy'}
  ],
  edges:[{from:'xlsx',to:'batch',n:1},{from:'batch',to:'pg',n:2},{from:'stream',to:'consumer',n:3},{from:'consumer',to:'mongo',n:4},{from:'pg',to:'serve',n:5},{from:'mongo',to:'serve',n:6}],
  files:[
    {name:'batch_nocturno.py',lang:'python',code:`import pandas as pd
from sqlalchemy import create_engine

# CAPA BATCH: corre a las 2:00 am con las ventas del día anterior
df = pd.read_excel("ventas_dia.xlsx")
df["fecha"]    = pd.to_datetime(df["fecha"], dayfirst=True).dt.date
df["producto"] = df["producto"].str.strip().str.lower()
diario = df.groupby(["fecha", "producto"], as_index=False)["monto"].sum()
diario.to_sql("ventas_diarias", create_engine(PG), if_exists="append", index=False)`},
    {name:'consumidor_stream.py',lang:'python',code:`from kafka import KafkaConsumer
from pymongo import MongoClient
import json

# CAPA DE VELOCIDAD: cada compra se procesa en cuanto ocurre
consumidor = KafkaConsumer("compras", bootstrap_servers="kafka:9092",
                           value_deserializer=lambda b: json.loads(b))
hoy = MongoClient(MONGO).tienda.ventas_hoy

for mensaje in consumidor:                        # llega un evento…
    compra = mensaje.value
    hoy.update_one({"producto": compra["producto"]},
                   {"$inc": {"monto": compra["monto"], "compras": 1}},
                   upsert=True)                   # …y el acumulado ya cambió`},
    {name:'servir.sql',lang:'sql',code:`-- CAPA DE SERVICIO: lo consolidado (batch) + lo de hoy (streaming)
SELECT producto, SUM(monto) AS monto
FROM (
    SELECT producto, monto FROM ventas_diarias     -- batch: hasta anoche
    UNION ALL
    SELECT producto, monto FROM ventas_hoy         -- streaming: desde medianoche
)
GROUP BY producto
ORDER BY monto DESC;`}
  ],
  final:'Dos caminos, una respuesta: el lote da exactitud sobre el pasado; el stream da frescura sobre el presente; la capa de servicio los une.',
  steps:[
    {at:'xlsx',say:'<b>Capa batch</b> · cada noche llega el Excel con las ventas del día. Hoy es 22 de septiembre; el archivo trae el 21.',
     data:{where:'📄 Excel · ventas_dia.xlsx',view:{fmt:'table',k:'excel',title:'ventas_dia.xlsx (21/09)',cols:['fecha','producto','monto'],rows:[['21/09/26','Café Molido ',1240.0],['21/09/26','té verde',890.0],['21/09/26','café molido',620.0]]}}},
    {file:'batch_nocturno.py',line:5,at:'batch',edge:1,say:'<b>ETL nocturno</b> · a las 2:00 am el script lee el archivo…',data:{where:'🐍 En memoria · df'}},
    {file:'batch_nocturno.py',lines:[6,7],say:'…limpia fechas y productos…',
     data:{col:{fecha:['2026-09-21','2026-09-21','2026-09-21'],producto:['café molido','té verde','café molido']}}},
    {file:'batch_nocturno.py',line:8,say:'…y agrega por día y producto.',
     data:{view:{fmt:'table',k:'mem',title:'diario',cols:['fecha','producto','monto'],rows:[['2026-09-21','café molido',1860.0],['2026-09-21','té verde',890.0]]}}},
    {file:'batch_nocturno.py',line:9,at:'pg',edge:2,say:'<b>Cargar</b> · el histórico en PostgreSQL crece un día. Exacto, pero solo se actualiza una vez al día.',
     data:{where:'🗄️ PostgreSQL · ventas_diarias',view:{fmt:'table',k:'sql',title:'ventas_diarias (histórico)',cols:['fecha','producto','monto'],rows:[['2026-09-20','café molido',1500.0],['2026-09-20','té verde',700.0],['2026-09-21','café molido',1860.0],['2026-09-21','té verde',890.0]]},
       note:'Si dirección pregunta a las 9:05 am "¿cuánto llevamos hoy?", esta tabla no lo sabe. Para eso está la otra capa.'}},
    {file:'consumidor_stream.py',lines:[6,8],at:'consumer',edge:3,lit:['stream'],say:'<b>Capa de velocidad</b> · un consumidor escucha el tópico <code>compras</code> de Kafka, todo el día.',
     data:{where:'⚡ Kafka · tópico compras',view:{fmt:'stream',k:'stream',title:'tópico compras (hoy, 22/09)',events:[]},note:'Esperando eventos… Cada compra en la app publica un mensaje aquí en cuanto ocurre.'}},
    {file:'consumidor_stream.py',lines:[10,14],at:'mongo',edge:4,say:'<b>08:12</b> · llega una compra de café. El consumidor la procesa al vuelo: <code>$inc</code> suma al acumulado del producto.',
     data:{where:'🍃 MongoDB · ventas_hoy',view:{fmt:'multi',parts:[
        {fmt:'stream',k:'stream',title:'tópico compras',events:[{t:'08:12',txt:'compra · café molido · $620'}]},
        {fmt:'json',k:'nosql',title:'tienda.ventas_hoy',obj:[{producto:'café molido',monto:620,compras:1}]}]},
       note:'upsert=True: si el producto no existía hoy, se crea el documento; si existía, se incrementa.'}},
    {file:'consumidor_stream.py',lines:[10,14],say:'<b>08:40</b> · una miel de agave. Otro documento nuevo.',
     data:{view:{fmt:'multi',parts:[
        {fmt:'stream',k:'stream',title:'tópico compras',events:[{t:'08:12',txt:'compra · café molido · $620'},{t:'08:40',txt:'compra · miel de agave · $500'}]},
        {fmt:'json',k:'nosql',title:'tienda.ventas_hoy',obj:[{producto:'café molido',monto:620,compras:1},{producto:'miel de agave',monto:500,compras:1}]}]}}},
    {file:'consumidor_stream.py',lines:[10,14],say:'<b>09:05</b> · otro café. El acumulado de café ya va en $1,240 y 2 compras, segundos después de la venta.',
     data:{view:{fmt:'multi',parts:[
        {fmt:'stream',k:'stream',title:'tópico compras',events:[{t:'08:12',txt:'compra · café molido · $620'},{t:'08:40',txt:'compra · miel de agave · $500'},{t:'09:05',txt:'compra · café molido · $620'}]},
        {fmt:'json',k:'nosql',title:'tienda.ventas_hoy',obj:[{producto:'café molido',monto:1240,compras:2},{producto:'miel de agave',monto:500,compras:1}]}]},
       note:'Frescura de segundos. A cambio, esta capa solo sabe de "hoy": no reprocesa el histórico.'}},
    {file:'servir.sql',line:4,at:'serve',edge:5,say:'<b>Capa de servicio</b> · a las 9:05 dirección pregunta "¿cuánto llevamos?". Primero, lo consolidado del batch (hasta anoche).',
     data:{where:'📊 Capa de servicio · consulta',view:{fmt:'table',k:'wh',title:'batch · ventas_diarias agregada (hasta anoche)',cols:['producto','monto'],rows:[['café molido',3360.0],['té verde',1590.0]]}}},
    {file:'servir.sql',line:6,edge:6,say:'…después, lo fresco del stream (desde medianoche).',
     data:{view:{fmt:'multi',parts:[
        {fmt:'table',k:'wh',title:'batch · hasta anoche',cols:['producto','monto'],rows:[['café molido',3360.0],['té verde',1590.0]]},
        {fmt:'table',k:'nosql',title:'streaming · hoy (ventas_hoy)',cols:['producto','monto'],rows:[['café molido',1240.0],['miel de agave',500.0]]}]}}},
    {file:'servir.sql',lines:[2,9],say:'<b>UNION ALL + GROUP BY</b>: una sola respuesta, exacta hasta anoche y fresca hasta este minuto.',
     data:{where:'📊 Capa de servicio · respuesta',view:{fmt:'table',k:'wh',title:'ventas hasta las 9:05 de hoy',cols:['producto','monto'],rows:[['café molido',4600.0],['té verde',1590.0],['miel de agave',500.0]]},
       note:'✓ Lambda: batch para exactitud, streaming para frescura, servicio para unirlos. Esta noche el ETL consolidará lo de hoy y ventas_hoy se vacía.'}}
  ]
};

/*LABDATA*/

(function(){
  'use strict';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FAST = !!window.__LAB_FAST;
  var LABS = window.LABS || {};
  window.Labs = {};

  /* ============================================================ utilidades ============================================================ */
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  var KW = {
    python:['import','from','as','def','return','for','in','if','else','elif','with','not','and','or','None','True','False','lambda','class','while','try','except','finally','raise','pass','print','yield','global','assert','is'],
    sql:['select','from','where','group','by','order','create','or','replace','table','view','as','sum','count','avg','min','max','join','left','right','inner','outer','full','on','limit','insert','into','update','set','delete','values','and','not','null','desc','asc','distinct','having','union','all','case','when','then','else','end','between','like','is','using','qualify','over','partition','with','float64','true','false'],
    js:['var','let','const','function','return','if','else','for','while','new','true','false','null','undefined','this','of','in','typeof','db']
  };
  function tokenize(line, lang){
    if(line.trim()===''){ return '&nbsp;'; }
    var kws=KW[lang]||KW.python;
    var kwRe=new RegExp('^(?:'+kws.join('|')+')\\b', lang==='sql'?'i':'');
    var comRe = lang==='python' ? /^#[^\n]*/ : (lang==='sql' ? /^--[^\n]*/ : /^\/\/[^\n]*/);
    var strRe = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/;
    var numRe = /^\d+(?:\.\d+)?/;
    var jinRe = /^\{\{[^}]*\}\}/;
    var funRe = /^[A-Za-z_]\w*(?=\s*\()/;
    var wordRe= /^[A-Za-z_]\w*/;
    var wsRe  = /^\s+/;
    var s=line, out='', guard=0, m;
    while(s.length && guard++<8000){
      if((m=s.match(comRe))){ out+='<span class="tk-com">'+esc(m[0])+'</span>'; s=s.slice(m[0].length); continue; }
      if((m=s.match(strRe))){ out+='<span class="tk-str">'+esc(m[0])+'</span>'; s=s.slice(m[0].length); continue; }
      if((m=s.match(jinRe))){ out+='<span class="tk-jinja">'+esc(m[0])+'</span>'; s=s.slice(m[0].length); continue; }
      if((m=s.match(numRe))){ out+='<span class="tk-num">'+esc(m[0])+'</span>'; s=s.slice(m[0].length); continue; }
      if((m=s.match(kwRe))){  out+='<span class="tk-key">'+esc(m[0])+'</span>'; s=s.slice(m[0].length); continue; }
      if((m=s.match(funRe))){ out+='<span class="tk-fun">'+esc(m[0])+'</span>'; s=s.slice(m[0].length); continue; }
      if((m=s.match(wordRe))){ out+=esc(m[0]); s=s.slice(m[0].length); continue; }
      if((m=s.match(wsRe))){  out+=m[0]; s=s.slice(m[0].length); continue; }
      out+=esc(s[0]); s=s.slice(1);
    }
    return out;
  }
  function buildCodePre(code, lang){
    var pre=document.createElement('pre'); pre.className='code';
    code.replace(/\n$/,'').split('\n').forEach(function(l){ var d=document.createElement('span'); d.className='cl'; d.innerHTML=tokenize(l,lang); pre.appendChild(d); });
    return pre;
  }

  /* ============================================================ RUNNER (demos conceptuales) ============================================================ */
  // Los datos de cada demo viven en <template> (antes <script type="text/plain">,
  // que la regla de la CSP cuenta como script inline). El texto de un <template>
  // está en su .content, no en su textContent.
  function textoDe(el){ return el.content ? el.content.textContent : el.textContent; }
  function buildRunner(root){
    var codeEl=root.querySelector('[data-code]'), stepsEl=root.querySelector('[data-steps]');
    if(!codeEl||!stepsEl) return;
    var lang=codeEl.getAttribute('data-lang')||'text';
    var pre=buildCodePre(textoDe(codeEl), lang);
    root.querySelector('.runner-code-wrap').appendChild(pre);
    var clLines=Array.prototype.slice.call(pre.querySelectorAll('.cl'));
    var steps; try{ steps=JSON.parse(textoDe(stepsEl)); }catch(e){ steps=[]; }
    var term=root.querySelector('[data-term]'), chip=root.querySelector('[data-chip]'), badge=root.querySelector('[data-badge]');
    var runBtn=root.querySelector('[data-run]'), resetBtn=root.querySelector('[data-reset]');
    var fileName=(root.querySelector('.runner-file')||{}).textContent||'script';
    var outcome=root.getAttribute('data-outcome')||'ok';
    var running=false, curTable=null;
    function setChip(cls,txt){ chip.className='status-chip'+(cls?(' '+cls):''); chip.innerHTML='<span class="sc-dot"></span> '+txt; }
    function addLog(text,k){ var d=document.createElement('div'); d.className='tline'+(k?(' t-'+k):''); d.textContent=text; term.appendChild(d); curTable=null; term.scrollTop=term.scrollHeight; }
    function startTable(head){ var t=document.createElement('table'); t.className='ttable'; var tr=document.createElement('tr'); head.forEach(function(h){ var th=document.createElement('th'); th.textContent=h; tr.appendChild(th); }); t.appendChild(tr); term.appendChild(t); curTable=t; term.scrollTop=term.scrollHeight; }
    function addRow(cells,cls){ if(!curTable) startTable(cells.map(function(_,i){return 'col'+(i+1);})); var tr=document.createElement('tr'); cells.forEach(function(c,i){ var td=document.createElement('td'); td.textContent=c; if(cls&&cls[i]) td.className=cls[i]; tr.appendChild(td); }); curTable.appendChild(tr); term.scrollTop=term.scrollHeight; }
    function clearRun(){ clLines.forEach(function(c){ c.classList.remove('active','ran'); }); }
    function resetRun(){ running=false; clearRun(); term.innerHTML='<div class="term-empty">// la salida aparecerá aquí al ejecutar…</div>'; setChip('','en espera'); badge.classList.remove('show','is-warn'); runBtn.disabled=false; }
    function run(){
      if(running) return; running=true; runBtn.disabled=true;
      clearRun(); term.innerHTML=''; curTable=null; badge.classList.remove('show','is-warn');
      setChip('st-run','ejecutando…');
      addLog(lang==='sql' ? 'warehouse=# ejecutando…' : '$ python '+fileName, 'cmd');
      var i=0;
      (function stepNext(){
        if(i>=steps.length){
          clLines.forEach(function(c){ c.classList.remove('active'); });
          if(outcome==='warn'){ setChip('st-err','riesgo detectado'); badge.classList.add('show','is-warn'); }
          else { setChip('st-done','completado'); badge.classList.add('show'); }
          running=false; runBtn.disabled=false; return;
        }
        var st=steps[i++];
        setTimeout(function(){
          if(typeof st.line==='number'){ clLines.forEach(function(c){c.classList.remove('active');}); var el=clLines[st.line-1]; if(el){ el.classList.add('active','ran'); } }
          if(st.head) startTable(st.head); else if(st.row) addRow(st.row, st.cls); else if(st.log) addLog(st.log, st.k);
          stepNext();
        }, (REDUCED||FAST)?0:340);
      })();
    }
    runBtn.addEventListener('click',run);
    if(resetBtn) resetBtn.addEventListener('click',resetRun);
    resetRun();
  }

  /* ============================================================ FLOW (definiciones) ============================================================ */
  function buildFlow(root){
    var play=root.querySelector('[data-flow-play]');
    var stages=Array.prototype.slice.call(root.querySelectorAll('[data-stage]'));
    var arrows=Array.prototype.slice.call(root.querySelectorAll('.flow-arrow'));
    var packet=root.querySelector('[data-flow-packet]'), note=root.querySelector('[data-flow-note]');
    if(!play||!stages.length) return;
    var defaultNote=note?note.innerHTML:'', finalNote=root.getAttribute('data-final')||'', playing=false;
    if(packet) packet.style.transition='left .5s var(--ease), top .5s var(--ease), transform .3s var(--ease), opacity .3s';
    function reset(){ stages.forEach(function(s){s.classList.remove('lit','done');}); arrows.forEach(function(a){a.classList.remove('filled');}); if(packet){ packet.classList.remove('on'); packet.style.opacity='0'; packet.style.transform='translate(-50%,-50%) scale(0)'; } if(note) note.innerHTML=defaultNote; }
    function place(el){ if(!packet||!el) return; var fr=root.getBoundingClientRect(), r=el.getBoundingClientRect(); packet.style.left=(r.left-fr.left+r.width/2)+'px'; packet.style.top=(r.top-fr.top+r.height/2)+'px'; }
    function play_(){
      if(playing) return; playing=true; play.disabled=true; reset();
      setTimeout(function(){
        if(packet){ place(stages[0]); packet.style.opacity='1'; packet.classList.add('on'); packet.style.transform='translate(-50%,-50%) scale(1)'; }
        var i=0;
        (function nextStage(){
          if(i>=stages.length){ if(packet){ packet.style.transform='translate(-50%,-50%) scale(0)'; setTimeout(function(){packet.classList.remove('on');},300); } if(note&&finalNote) note.innerHTML='✓ '+finalNote; playing=false; play.disabled=false; return; }
          var s=stages[i]; s.classList.add('lit'); if(note&&s.getAttribute('data-note')) note.innerHTML=s.getAttribute('data-note');
          setTimeout(function(){ s.classList.remove('lit'); s.classList.add('done'); if(i<stages.length-1){ if(arrows[i]) arrows[i].classList.add('filled'); place(stages[i+1]); } i++; setTimeout(nextStage, (REDUCED||FAST)?0:(i<stages.length?500:0)); }, (REDUCED||FAST)?0:820);
        })();
      }, (REDUCED||FAST)?0:60);
    }
    play.addEventListener('click',play_);
  }

  /* ============================================================ MEDIDOR DE COSTO ============================================================ */
  function buildCostDemo(root){
    var btn=root.querySelector('[data-cd-run]'), costEl=root.querySelector('[data-cd-cost]'), runsEl=root.querySelector('[data-cd-runs]'), bar=root.querySelector('[data-cd-bar]'), note=root.querySelector('[data-cd-note]');
    if(!btn) return; var runs=0, cost=0;
    btn.addEventListener('click',function(){
      runs++; cost+=18.4;
      costEl.textContent='$ '+cost.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
      runsEl.textContent='· '+runs+' corrida'+(runs===1?'':'s');
      bar.style.width=Math.min(runs/8*100,100)+'%';
      if(runs>=5){ bar.classList.add('danger'); costEl.classList.add('danger'); note.innerHTML='Factura desbocada: pagas la <b>misma</b> limpieza en cada consulta. Aquí es donde ETL (transformar una vez) gana.'; }
      if(runs>=8) btn.disabled=true;
    });
  }

  /* ============================================================ LAB · DFD (SVG) ============================================================ */
  var svgNS='http://www.w3.org/2000/svg';
  function el(tag,attrs,parent){ var e=document.createElementNS(svgNS,tag); for(var k in attrs) e.setAttribute(k,attrs[k]); if(parent) parent.appendChild(e); return e; }
  function wrapText(text,max,maxLines){
    var words=String(text).split(/\s+/), lines=[], cur='';
    words.forEach(function(w){ if(!w) return; if((cur+' '+w).trim().length>max && cur){ lines.push(cur.trim()); cur=w; } else { cur=(cur+' '+w); } });
    if(cur.trim()) lines.push(cur.trim());
    if(lines.length>maxLines){ lines=lines.slice(0,maxLines); lines[maxLines-1]=lines[maxLines-1].slice(0,max-1)+'…'; }
    return lines;
  }
  /* Pictogramas propios (24×24, trazo blanco sobre el mosaico) */
  var ICONS={
    sheet:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 14.5h16M10 4v16"/>',
    api:'<path d="M9 4.5c-1.9 0-2.9 1-2.9 2.8v2c0 1.3-.7 2.2-1.9 2.7 1.2.5 1.9 1.4 1.9 2.7v2c0 1.8 1 2.8 2.9 2.8M15 4.5c1.9 0 2.9 1 2.9 2.8v2c0 1.3.7 2.2 1.9 2.7-1.2.5-1.9 1.4-1.9 2.7v2c0 1.8-1 2.8-2.9 2.8"/>',
    web:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.3 2.2 3.4 4.9 3.4 8s-1.1 5.8-3.4 8c-2.3-2.2-3.4-4.9-3.4-8s1.1-5.8 3.4-8z"/>',
    bolt:'<path d="M13 3L5.5 13.2h5.8L10.5 21 18 10.8h-5.8z"/>',
    terminal:'<rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="M7 10l3 2.2L7 14.4M12.5 15h4.5"/>',
    funnel:'<path d="M4.5 5h15l-5.8 7.2V19l-3.4-1.8v-5z"/>',
    shield:'<path d="M12 3.2l6.8 2.9v4.8c0 4.3-2.9 7.9-6.8 9.9-3.9-2-6.8-5.6-6.8-9.9V6.1z"/><path d="M9.1 12.1l2 2 3.9-4"/>',
    link:'<path d="M10.2 13.8a3.8 3.8 0 0 1 0-5.4l2.3-2.3a3.8 3.8 0 0 1 5.4 5.4l-1.3 1.3M13.8 10.2a3.8 3.8 0 0 1 0 5.4l-2.3 2.3a3.8 3.8 0 0 1-5.4-5.4l1.3-1.3"/>',
    flask:'<path d="M9 3.5h6M10.2 3.5v6L5.3 18a2 2 0 0 0 1.7 3h10a2 2 0 0 0 1.7-3l-4.9-8.5v-6"/><path d="M7.4 15h9.2"/>',
    db:'<ellipse cx="12" cy="6" rx="7" ry="2.7"/><path d="M5 6v12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6"/><path d="M5 12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7"/>',
    docs:'<path d="M9 3.5h6.5l3.5 3.5v10.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"/><path d="M15.5 3.5V7H19"/><path d="M5 7.5v12a1 1 0 0 0 1 1h9"/><path d="M10.5 11.5h5.5M10.5 14.8h5.5"/>',
    folder:'<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 10.5h17"/>',
    cloud:'<path d="M7.5 18.5h9.5a4 4 0 0 0 .7-7.94A5.9 5.9 0 0 0 6.4 9.3a4.6 4.6 0 0 0 1.1 9.2z"/>',
    sigma:'<path d="M17 5H7.5l5.5 7-5.5 7H17"/>',
    layers:'<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.2L12 20.7l8.5-4.5"/>',
    chart:'<path d="M4 20h16"/><path d="M7 17v-5M12 17V7M17 17v-8" style="stroke-width:3.2"/>',
    ingest:'<path d="M12 3.5v10.5M7.8 9.8L12 14l4.2-4.2"/><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
    moon:'<path d="M19.5 14.6A7.6 7.6 0 1 1 9.4 4.5a6.1 6.1 0 0 0 10.1 10.1z"/>',
    loop:'<path d="M19.5 10.5a7.6 7.6 0 0 0-13.4-3.4L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M4.5 13.5a7.6 7.6 0 0 0 13.4 3.4l1.6-1.9"/><path d="M19.5 19.5V15H15"/>',
    node:'<circle cx="12" cy="12" r="6"/>'
  };
  var EMOJI_ICON={'📄':'sheet','🔌':'api','🕸':'web','⚡':'bolt','🐍':'terminal','🧽':'funnel','🛡':'shield','🔗':'link','🧪':'flask','🗄':'db','📁':'folder','🍃':'docs','☁':'cloud','🧮':'sigma','🧩':'layers','🥉':'layers','🥈':'layers','🥇':'layers','📊':'chart','📥':'ingest','🌙':'moon','🔄':'loop'};
  var KIND_FILL={source:'#4A5263',extract:'#12716E',transform:'#B07A12',store:'#8A4FAB',serve:'#3F8A4B',bronze:'#9C6534',silver:'#6F7785',gold:'#A5831A',process:'#5E6169'};
  var LANG={python:{t:'Py',c:'#0E5D5A'},sql:{t:'SQL',c:'#7B3F9C'},js:{t:'JS',c:'#8A6410'},none:{t:'dato',c:'#3E4451'}};

  function mkPoly(pts){ var cum=[0]; for(var i=1;i<pts.length;i++){ cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1])); } return {pts:pts,cum:cum,len:cum[cum.length-1]}; }
  function polyAt(P,d){
    if(d<=0) return {x:P.pts[0][0],y:P.pts[0][1]};
    for(var i=1;i<P.cum.length;i++){ if(P.cum[i]>=d){ var seg=(P.cum[i]-P.cum[i-1])||1, t=(d-P.cum[i-1])/seg; return {x:P.pts[i-1][0]+(P.pts[i][0]-P.pts[i-1][0])*t, y:P.pts[i-1][1]+(P.pts[i][1]-P.pts[i-1][1])*t}; } }
    var z=P.pts[P.pts.length-1]; return {x:z[0],y:z[1]};
  }
  function subPoly(P,d0,d1){ var out=[], a=polyAt(P,d0); out.push([a.x,a.y]); for(var i=1;i<P.pts.length-1;i++){ if(P.cum[i]>d0&&P.cum[i]<d1) out.push(P.pts[i]); } var b=polyAt(P,d1); out.push([b.x,b.y]); return out; }
  function qpts(p0,c,p2){ var o=[]; [0.25,0.5,0.75,1].forEach(function(t){ var u=1-t; o.push([u*u*p0[0]+2*u*t*c[0]+t*t*p2[0], u*u*p0[1]+2*u*t*c[1]+t*t*p2[1]]); }); return o; }

  function buildDFD(sc, container, id){
    var T=46, ML=14, TOP=34, RG=112, DESIGN=1120;
    var ncols=0, maxRow=0;
    sc.nodes.forEach(function(n){ ncols=Math.max(ncols,n.col+1); maxRow=Math.max(maxRow,n.row); });
    var CG=Math.max(150,Math.min(230,(DESIGN-2*ML)/ncols));
    var FIRST=TOP+46, W=Math.round(2*ML+ncols*CG), H=Math.round(FIRST+maxRow*RG+T/2+62);
    var svg=el('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,'aria-hidden':'true'}); container.appendChild(svg);
    var defs=el('defs',{},svg);
    function marker(mid,color){ var m=el('marker',{id:mid,viewBox:'0 0 10 10',refX:'8.6',refY:'5',markerWidth:'7.5',markerHeight:'7.5',orient:'auto',markerUnits:'userSpaceOnUse'},defs); el('path',{d:'M0,0.6 L10,5 L0,9.4 z',fill:color},m); }
    marker('arr-'+id,'#B3AEA2'); marker('arr2-'+id,'#12716E');
    /* carriles */
    (sc.lanes||[]).forEach(function(l){
      var c0=Math.min.apply(null,l.cols), c1=Math.max.apply(null,l.cols);
      var x=ML+c0*CG+5, w=(c1-c0+1)*CG-10;
      el('rect',{x:x,y:TOP,width:w,height:H-TOP-6,rx:12,'class':'dfd-lane-bg'+(l.tone?' tone-'+l.tone:'')},svg);
      var t=el('text',{x:x+w/2,y:TOP-12,'text-anchor':'middle','class':'dfd-lane-label'},svg); t.textContent=l.label;
    });
    var pos={}; sc.nodes.forEach(function(n){ pos[n.id]={cx:ML+(n.col+0.5)*CG, cy:FIRST+n.row*RG}; });
    /* conectores ortogonales con esquinas redondeadas */
    var outDeg={}, inDeg={}, incoming={}, outgoing={};
    sc.edges.forEach(function(e){ outDeg[e.from]=(outDeg[e.from]||0)+1; inDeg[e.to]=(inDeg[e.to]||0)+1; });
    var gE=el('g',{},svg), gB=el('g',{},svg), edgeEls={}, edgeByPair={}, badges=[];
    sc.edges.forEach(function(e){
      var a=pos[e.from], b=pos[e.to]; if(!a||!b) return;
      var x1=a.cx+T/2+3, y1=a.cy, x2=b.cx-T/2-5, y2=b.cy, d, pts, bx, by;
      if(Math.abs(y1-y2)<0.5){
        d='M'+x1+','+y1+' L'+x2+','+y2; pts=[[x1,y1],[x2,y2]];
        var f=(outDeg[e.from]>1)?0.6:((inDeg[e.to]>1)?0.28:0.5); bx=x1+(x2-x1)*f; by=y1;
      } else {
        var mx=Math.round((x1+x2)/2), s=y2>y1?1:-1, r=Math.min(10,Math.abs(y2-y1)/2,(x2-x1)/4);
        d='M'+x1+','+y1+' L'+(mx-r)+','+y1+' Q'+mx+','+y1+' '+mx+','+(y1+s*r)+' L'+mx+','+(y2-s*r)+' Q'+mx+','+y2+' '+(mx+r)+','+y2+' L'+x2+','+y2;
        pts=[[x1,y1],[mx-r,y1]].concat(qpts([mx-r,y1],[mx,y1],[mx,y1+s*r])).concat([[mx,y2-s*r]]).concat(qpts([mx,y2-s*r],[mx,y2],[mx+r,y2])).concat([[x2,y2]]);
        if(outDeg[e.from]>1){ bx=mx+0.38*(x2-mx); by=y2; } else { bx=(x1+mx)/2; by=y1; }
      }
      badges.forEach(function(q){ if(Math.abs(q.x-bx)<22&&Math.abs(q.y-by)<22){ bx+=24; } });
      badges.push({x:bx,y:by});
      var p=el('path',{d:d,'class':'dfd-edge','marker-end':'url(#arr-'+id+')'},gE);
      var rec={el:p,poly:mkPoly(pts)};
      edgeEls[e.n]=rec; edgeByPair[e.from+'>'+e.to]=rec;
      (incoming[e.to]=incoming[e.to]||[]).push(rec); (outgoing[e.from]=outgoing[e.from]||[]).push(rec);
      var g=el('g',{'class':'dfd-badge'},gB); el('circle',{cx:bx,cy:by,r:9.5},g);
      var t=el('text',{x:bx,y:by+3.8,'text-anchor':'middle'},g); t.textContent=e.n;
    });
    /* nodos tipo mosaico */
    var gN=el('g',{},svg), nodeEls={};
    var maxChars=Math.max(18,Math.floor((CG-26)/6.2));
    sc.nodes.forEach(function(n){
      var p=pos[n.id], kind=n.kind||'process';
      var g=el('g',{'class':'dfd-node k-'+kind,transform:'translate('+p.cx+','+p.cy+')'},gN);
      el('rect',{x:-T/2-5,y:-T/2-5,width:T+10,height:T+10,rx:15,'class':'dfd-ring'},g);
      el('rect',{x:-T/2,y:-T/2,width:T,height:T,rx:12,fill:KIND_FILL[kind]||KIND_FILL.process,'class':'dfd-tile'},g);
      var key=n.ic||EMOJI_ICON[(n.icon||'').replace(/️/g,'')]||'node';
      var ig=el('g',{'class':'dfd-ico',transform:'translate(-12,-12)'},g); ig.innerHTML=ICONS[key]||ICONS.node;
      var lb=el('text',{x:0,y:T/2+19,'text-anchor':'middle','class':'n-label'},g); lb.textContent=n.label||'';
      wrapText(n.sub||'',maxChars,2).forEach(function(s,i){ var t=el('text',{x:0,y:T/2+35+i*14,'text-anchor':'middle','class':'n-sub'},g); t.textContent=s; });
      var tt=el('title',{},g); tt.textContent=(n.label||'')+(n.sub?' — '+n.sub:'');
      nodeEls[n.id]=g;
    });
    /* paquete con etiqueta de lenguaje */
    var packet=el('g',{'class':'dfd-packet'},svg);
    var pRect=el('rect',{x:-22,y:-10,width:44,height:20,rx:10,fill:LANG.none.c},packet);
    var pText=el('text',{x:0,y:3.9,'text-anchor':'middle'},packet); pText.textContent=LANG.none.t;
    var halfW=22, pk={x:0,y:0}, cur=null, anim=null, fadeT=null, litNodes=[];
    function setLang(lang){ var L=LANG[lang]||LANG.none; if(pText.textContent===L.t) return; pText.textContent=L.t; var w=Math.max(32,L.t.length*7.4+14); halfW=w/2; pRect.setAttribute('x',-w/2); pRect.setAttribute('width',w); pRect.setAttribute('fill',L.c); }
    function setPos(x,y){ pk.x=x; pk.y=y; packet.setAttribute('transform','translate('+x.toFixed(1)+','+y.toFixed(1)+')'); }
    function stopAnim(){ if(anim){ cancelAnimationFrame(anim); anim=null; } if(fadeT){ clearTimeout(fadeT); fadeT=null; } }
    function arrival(rec){ return polyAt(rec.poly, Math.max(0, rec.poly.len-halfW+2)); }
    function restPoint(nid){
      var inc=incoming[nid]; if(inc&&inc.length) return arrival(inc[0]);
      var out=outgoing[nid]; if(out&&out.length) return polyAt(out[0].poly, Math.min(out[0].poly.len, halfW+4));
      return {x:pos[nid].cx, y:pos[nid].cy-T/2-16};
    }
    function setLit(nid){ var g=nodeEls[nid]; if(!g) return; g.classList.add('lit'); g.classList.remove('done'); if(litNodes.indexOf(nid)<0) litNodes.push(nid); }
    function settle(){ litNodes.forEach(function(n){ nodeEls[n].classList.remove('lit'); nodeEls[n].classList.add('done'); }); litNodes=[]; }
    function moveTo(nid,instant){
      if(!pos[nid]) return;
      if(nid===cur){ setLit(nid); return; }
      settle(); setLit(nid); stopAnim();
      var rec=edgeByPair[cur+'>'+nid];
      var target=rec?arrival(rec):restPoint(nid);
      if(cur===null||REDUCED||FAST||instant){ setPos(target.x,target.y); packet.classList.add('on'); cur=nid; return; }
      if(!rec){ packet.classList.remove('on'); fadeT=setTimeout(function(){ setPos(target.x,target.y); packet.classList.add('on'); fadeT=null; },230); cur=nid; return; }
      /* atraviesa el nodo actual y sigue la flecha hasta el siguiente */
      var d0=Math.min(rec.poly.len, halfW+4), d1=Math.max(d0, rec.poly.len-halfW+2);
      var path=mkPoly([[pk.x,pk.y]].concat(subPoly(rec.poly,d0,d1)));
      var D=Math.max(480,Math.min(1050,path.len*2.3)), t0=performance.now();
      packet.classList.add('on');
      (function frame(now){ var t=Math.min(1,(now-t0)/D), e=t<.5?2*t*t:-1+(4-2*t)*t, q=polyAt(path,e*path.len); setPos(q.x,q.y); anim=(t<1)?requestAnimationFrame(frame):null; })(t0);
      cur=nid;
    }
    function fillEdge(n){ var r=edgeEls[n]; if(r){ r.el.classList.add('filled'); r.el.setAttribute('marker-end','url(#arr2-'+id+')'); } }
    function reset(){ stopAnim(); for(var k in nodeEls){ nodeEls[k].classList.remove('lit','done'); } for(var n in edgeEls){ edgeEls[n].el.classList.remove('filled'); edgeEls[n].el.setAttribute('marker-end','url(#arr-'+id+')'); } packet.classList.remove('on'); litNodes=[]; cur=null; setLang('none'); }
    function finish(){ stopAnim(); settle(); packet.classList.remove('on'); }
    return {moveTo:moveTo, lit:setLit, fillEdge:fillEdge, reset:reset, finish:finish, setLang:setLang};
  }

  /* ============================================================ PANEL DE CONTROLES · arrastre ============================================================ */
  var LP_KEY='etlelt.panelPos', lpPos=null;
  function lpApply(){ var r=document.documentElement; if(lpPos){ r.style.setProperty('--lp-left',lpPos.x+'px'); r.style.setProperty('--lp-top',lpPos.y+'px'); r.classList.add('lp-moved'); } else { r.style.removeProperty('--lp-left'); r.style.removeProperty('--lp-top'); r.classList.remove('lp-moved'); } }
  function lpClamp(x,y,w,h){ return {x:Math.round(Math.max(6,Math.min(window.innerWidth-w-6,x))), y:Math.round(Math.max(6,Math.min(window.innerHeight-h-6,y)))}; }
  function lpSave(){ try{ if(lpPos) localStorage.setItem(LP_KEY,JSON.stringify(lpPos)); else localStorage.removeItem(LP_KEY); }catch(e){} }
  try{ var lpSaved=JSON.parse(localStorage.getItem(LP_KEY)||'null'); if(lpSaved&&typeof lpSaved.x==='number'&&typeof lpSaved.y==='number') lpPos=lpClamp(lpSaved.x,lpSaved.y,70,300); }catch(e){ lpPos=null; }
  lpApply();
  function isNarrow(){ return !!(window.matchMedia && window.matchMedia('(max-width:520px)').matches); }
  function makeDraggable(panel,grip){
    var ox=0, oy=0, dragging=false;
    grip.addEventListener('pointerdown',function(e){ if(isNarrow()||e.button>0) return; e.preventDefault(); var r=panel.getBoundingClientRect(); ox=e.clientX-r.left; oy=e.clientY-r.top; dragging=true; panel.classList.add('dragging'); try{ grip.setPointerCapture(e.pointerId); }catch(_){} });
    grip.addEventListener('pointermove',function(e){ if(!dragging) return; lpPos=lpClamp(e.clientX-ox,e.clientY-oy,panel.offsetWidth,panel.offsetHeight); lpApply(); });
    function end(e){ if(!dragging) return; dragging=false; panel.classList.remove('dragging'); try{ grip.releasePointerCapture(e.pointerId); }catch(_){} lpSave(); }
    grip.addEventListener('pointerup',end); grip.addEventListener('pointercancel',end);
    grip.addEventListener('dblclick',function(){ lpPos=null; lpApply(); lpSave(); });
  }
  window.addEventListener('resize',function(){ if(!lpPos) return; var p=document.querySelector('.lab-panel.show'); lpPos=lpClamp(lpPos.x,lpPos.y,p?p.offsetWidth:70,p?p.offsetHeight:300); lpApply(); });

  /* ============================================================ LAB · motor ============================================================ */
  function buildLab(root){
    var id=root.getAttribute('data-lab'), sc=LABS[id];
    if(!sc){ root.innerHTML='<div class="lab-note">Ejercicio no encontrado: '+esc(id)+'</div>'; return; }
    root.innerHTML='';
    var N=sc.steps.length;
    /* encabezado */
    var head=document.createElement('div'); head.className='lab-head';
    head.innerHTML='<span class="lab-lv'+(sc.tone?' lv-'+sc.tone:'')+'">'+esc(sc.level||'')+'</span><span class="lab-title">'+esc(sc.title||'')+'</span><span class="lab-hint">teclas <b>B</b> / <b>N</b> = paso atrás / adelante</span>';
    root.appendChild(head);
    /* 1 · diagrama */
    var dfdWrap=document.createElement('div'); dfdWrap.className='lab-dfd'; root.appendChild(dfdWrap);
    var dfd=buildDFD(sc,dfdWrap,id);
    /* tira del DAG (solo en orquestación) */
    var taskEls={};
    if(sc.tasks&&sc.tasks.length){
      var dag=document.createElement('div'); dag.className='lab-dag';
      var lbl=document.createElement('span'); lbl.className='dag-lbl'; lbl.textContent='DAG'; dag.appendChild(lbl);
      var seq=sc.dag||sc.tasks.map(function(t){return t.id;});
      seq.forEach(function(item,i){
        if(i>0){ var a=document.createElement('span'); a.className='dag-arrow'; a.textContent='→'; dag.appendChild(a); }
        var group=Array.isArray(item)?item:[item];
        if(group.length>1){ var o=document.createElement('span'); o.className='dag-par'; o.textContent='['; dag.appendChild(o); }
        group.forEach(function(tid,j){
          if(j>0){ var p=document.createElement('span'); p.className='dag-par'; p.textContent='∥'; dag.appendChild(p); }
          var chip=document.createElement('button'); chip.type='button'; chip.className='dag-task'; chip.innerHTML='<span class="dt-dot"></span>'+esc(tid);
          chip.addEventListener('click',function(){ var t=sc.tasks.filter(function(x){return x.id===tid;})[0]; if(t) showFile(t.file); for(var k in taskEls) taskEls[k].classList.toggle('sel',k===tid); });
          dag.appendChild(chip); taskEls[tid]=chip;
        });
        if(group.length>1){ var c=document.createElement('span'); c.className='dag-par'; c.textContent=']'; dag.appendChild(c); }
      });
      root.appendChild(dag);
    }
    /* 2 · código (3/4, centrado, tema oscuro) */
    var hasB=sc.files.some(function(f){return f.box==='B';});
    var codeBox=document.createElement('div'); codeBox.className='lab-codebox'+(hasB?' dual':''); root.appendChild(codeBox);
    var boxes={};
    ['A','B'].forEach(function(bx){
      if(bx==='B'&&!hasB) return;
      var ed=document.createElement('div'); ed.className='lab-editor';
      var tabs=document.createElement('div'); tabs.className='lab-tabs';
      tabs.innerHTML=(bx==='A')?'<span class="ed-dots" aria-hidden="true"><i></i><i></i><i></i></span>':'';
      ed.appendChild(tabs);
      var bl=document.createElement('span'); bl.className='lab-box-lbl'; bl.textContent=hasB?(bx==='A'?'DAG · orquestación':'tarea en ejecución'):''; tabs.appendChild(bl);
      codeBox.appendChild(ed); boxes[bx]={el:ed,tabs:tabs,lbl:bl,files:{},active:null,order:[]};
    });
    sc.files.forEach(function(f){
      var bx=(f.box==='B'&&hasB)?'B':'A', box=boxes[bx];
      var tab=document.createElement('button'); tab.type='button'; tab.className='lab-tab'; tab.title=f.name; tab.innerHTML=esc(f.name.split('/').pop())+'<span class="tl">'+esc(f.lang)+'</span>';
      box.tabs.insertBefore(tab, box.lbl);
      var pre=buildCodePre(f.code,f.lang); pre.style.display='none'; box.el.appendChild(pre);
      box.files[f.name]={pre:pre,tab:tab,lines:Array.prototype.slice.call(pre.querySelectorAll('.cl')),box:bx,lang:f.lang}; box.order.push(f.name);
      tab.addEventListener('click',function(){ showFile(f.name); });
    });
    function findFile(name){ for(var bx in boxes){ if(boxes[bx].files[name]) return boxes[bx].files[name]; } return null; }
    function showFile(name){ var f=findFile(name); if(!f) return; var box=boxes[f.box]; for(var n in box.files){ box.files[n].pre.style.display=(n===name)?'block':'none'; box.files[n].tab.classList.toggle('active',n===name); } box.active=name; tabIntoView(f.tab); }
    function tabIntoView(t){ var bar=t.parentNode; try{ var tr=t.getBoundingClientRect(), cr=bar.getBoundingClientRect(); if(tr.width&&(tr.left<cr.left||tr.right>cr.right)) bar.scrollLeft+=((tr.left+tr.right)/2-(cr.left+cr.right)/2); }catch(e){} }
    function showFirst(){ for(var bx in boxes){ if(boxes[bx].order[0]) showFile(boxes[bx].order[0]); } }
    function eachLine(fn){ for(var bx in boxes){ for(var n in boxes[bx].files){ boxes[bx].files[n].lines.forEach(fn); } } }
    function clearHl(){ eachLine(function(c){ c.classList.remove('active','ran'); }); }
    function clearActive(){ eachLine(function(c){ c.classList.remove('active'); }); }
    function hlLines(name,a,b,quiet){
      var f=findFile(name); if(!f) return; showFile(name); if(b===undefined) b=a;
      for(var i=a;i<=b;i++){ var ln=f.lines[i-1]; if(ln) ln.classList.add('active','ran'); }
      var first=f.lines[a-1], last=f.lines[b-1]||first;
      if(first){ try{
        var pr=f.pre.getBoundingClientRect(), r1=first.getBoundingClientRect(), r2=last.getBoundingClientRect();
        var mid=(r1.top+r2.bottom)/2, target=f.pre.scrollTop+(mid-pr.top)-f.pre.clientHeight/2;
        if(quiet||REDUCED||FAST) f.pre.scrollTop=target; else f.pre.scrollTo({top:target,behavior:'smooth'});
      }catch(e){} }
    }
    showFirst();
    /* narración del paso: franja entre el código y la salida */
    var caption=document.createElement('div'); caption.className='lab-caption'; caption.setAttribute('data-say',''); caption.setAttribute('aria-live','polite'); caption.innerHTML='<span class="lc-t"></span>'; root.appendChild(caption);
    /* 3 · salida de datos (a todo lo ancho, crece hacia abajo) */
    var dataCol=document.createElement('div'); dataCol.className='lab-data'; root.appendChild(dataCol);
    var dhead=document.createElement('div'); dhead.className='lab-data-head'; dhead.innerHTML='<span class="ld-title">Estado del dato</span><span class="lab-where" data-where>—</span>'; dataCol.appendChild(dhead);
    var dnote=document.createElement('div'); dnote.className='lab-note'; dataCol.appendChild(dnote);
    var dbody=document.createElement('div'); dbody.className='lab-data-body'; dataCol.appendChild(dbody);
    var whereEl=dhead.querySelector('[data-where]');
    /* 4 · panel de controles: vertical, flotante y arrastrable (vive fuera de la lámina) */
    var slideEl=root.closest('.slide'), slideId=slideEl?slideEl.id:'';
    var panel=document.createElement('div'); panel.className='lab-panel'; panel.id='lp-'+id;
    panel.setAttribute('role','toolbar'); panel.setAttribute('aria-label','Controles del ejercicio'); panel.setAttribute('aria-orientation','vertical');
    panel.innerHTML='<div class="lp-grip" title="Arrastra para mover · doble clic: regresar a su lugar" aria-hidden="true">⠿</div>'+
      '<button type="button" class="lp-btn" data-back title="Paso anterior (tecla B)"><span class="ic">⏮</span><span class="bt">Atrás</span></button>'+
      '<button type="button" class="lp-btn primary" data-play title="Ejecutar o pausar"><span class="ic">▶</span><span class="bt">Ejecutar</span></button>'+
      '<button type="button" class="lp-btn" data-step title="Paso siguiente (tecla N)"><span class="ic">⏭</span><span class="bt">Paso</span></button>'+
      '<button type="button" class="lp-btn" data-reset title="Reiniciar"><span class="ic">↺</span><span class="bt">Reiniciar</span></button>'+
      '<button type="button" class="lp-btn lp-speed" data-speed title="Velocidad: normal"><span class="ic">1×</span><span class="bt">normal</span></button>'+
      '<div class="lp-step" data-stepn><span class="lp-k">paso</span> 0 / '+N+'</div>';
    document.body.appendChild(panel);
    makeDraggable(panel, panel.querySelector('.lp-grip'));
    window.addEventListener('deck:slide',function(e){ panel.classList.toggle('show', !!(e.detail&&e.detail.id===slideId)); });
    var backBtn=panel.querySelector('[data-back]'), playBtn=panel.querySelector('[data-play]'), stepBtn=panel.querySelector('[data-step]'), resetBtn=panel.querySelector('[data-reset]'), speedBtn=panel.querySelector('[data-speed]'), stepEl=panel.querySelector('[data-stepn]'), sayEl=caption.firstChild;
    var INITIAL_SAY='Usa el <b>panel de controles</b> (a la izquierda; puedes arrastrarlo a donde quieras): <b>Ejecutar</b> corre todo el proceso; <b>Paso</b> y <b>Atrás</b> avanzan y regresan a tu ritmo. El diagrama, el código y el dato se mueven juntos.';

    var state=null, hl={}, where='—', note='';
    var KIND={excel:'Excel',api:'API · JSON',html:'HTML',mem:'DataFrame',sql:'SQL',wh:'Warehouse',nosql:'NoSQL',drive:'Google Drive',stream:'Stream',json:'JSON'};
    function fmtNum(n){ if(Number.isInteger(n)) return String(n); return String(Math.round(n*100)/100); }
    function renderTable(v,prefix){
      var t=document.createElement('table'); t.className='dtab'; var thead=document.createElement('tr');
      (v.cols||[]).forEach(function(c,ci){ var th=document.createElement('th'); th.textContent=c; if(hl[prefix+'h'+ci]) th.className='chg'; thead.appendChild(th); });
      t.appendChild(thead);
      (v.rows||[]).forEach(function(r,ri){
        var tr=document.createElement('tr'); if(r._del) tr.className='del'; else if(hl[prefix+'row'+ri]) tr.className='new';
        (v.cols||[]).forEach(function(c,ci){ var td=document.createElement('td'); var val=r[ci]; td.textContent=(val===null||val===undefined)?'':(typeof val==='number'?fmtNum(val):String(val)); if(typeof val==='number') td.classList.add('num'); if(hl[prefix+'r'+ri+'c'+ci]) td.classList.add('chg'); tr.appendChild(td); });
        t.appendChild(tr);
      });
      return t;
    }
    function isFlat(v){ if(Array.isArray(v)) return v.every(function(x){ return x===null||typeof x!=='object'; }); return Object.keys(v).every(function(k){ var x=v[k]; return x===null||typeof x!=='object'; }); }
    function jsonHTML(v,path,ind,prefix){
      var pad=function(n){ return new Array(n+1).join('  '); }, out, sub=function(k){ return path?path+'.'+k:String(k); };
      var obj=(v&&typeof v==='object');
      if(obj && isFlat(v) && JSON.stringify(v).length<=104){
        if(Array.isArray(v)) out='['+v.map(function(x,i){ return jsonHTML(x,sub(i),0,prefix); }).join(', ')+']';
        else { var k1=Object.keys(v); out=k1.length?'{ '+k1.map(function(k){ return '<span class="jk">"'+esc(k)+'"</span>: '+jsonHTML(v[k],sub(k),0,prefix); }).join(', ')+' }':'{}'; }
      }
      else if(Array.isArray(v)){ out = v.length ? '[\n'+v.map(function(x,i){ return pad(ind+1)+jsonHTML(x,sub(i),ind+1,prefix); }).join(',\n')+'\n'+pad(ind)+']' : '[]'; }
      else if(obj){ var ks=Object.keys(v); out = ks.length ? '{\n'+ks.map(function(k){ return pad(ind+1)+'<span class="jk">"'+esc(k)+'"</span>: '+jsonHTML(v[k],sub(k),ind+1,prefix); }).join(',\n')+'\n'+pad(ind)+'}' : '{}'; }
      else if(typeof v==='string') out='<span class="js">"'+esc(v)+'"</span>';
      else if(typeof v==='number') out='<span class="jn">'+v+'</span>';
      else out='<span class="jb">'+String(v)+'</span>';
      return hl[prefix+'j:'+path] ? '<span class="chg">'+out+'</span>' : out;
    }
    function renderView(v,prefix){
      var wrap=document.createElement('div'); wrap.className=(v.fmt==='multi')?'dv-multi':'dv';
      if(v.fmt==='multi'){ (v.parts||[]).forEach(function(p,i){ wrap.appendChild(renderView(p,prefix+i+':')); }); return wrap; }
      var h=document.createElement('div'); h.className='dv-h';
      var kcls=v.k==='sql'?'k-sql':v.k==='nosql'?'k-nosql':v.k==='drive'?'k-drive':v.k==='wh'?'k-wh':'';
      h.innerHTML='<span class="dvk '+kcls+'">'+esc(KIND[v.k]||(v.fmt==='table'?'Tabla':v.fmt))+'</span><span>'+esc(v.title||'')+'</span>'; wrap.appendChild(h);
      if(v.fmt==='table'){ wrap.appendChild(renderTable(v,prefix)); }
      else if(v.fmt==='json'){ var pj=document.createElement('pre'); pj.className='djson'; pj.innerHTML=jsonHTML(v.obj,'',0,prefix); wrap.appendChild(pj); }
      else if(v.fmt==='html'){ var ph=document.createElement('pre'); ph.className='dhtml'; ph.innerHTML=esc(v.text||'').replace(/(&lt;\/?[a-zA-Z][^&]*?&gt;)/g,'<span class="tg">$1</span>'); wrap.appendChild(ph); }
      else if(v.fmt==='stream'){ var s=document.createElement('div'); s.className='dstream'; var evs=v.events||[]; if(!evs.length){ s.innerHTML='<div class="lab-data-empty">sin eventos todavía…</div>'; } evs.forEach(function(e,i){ var d=document.createElement('div'); d.className='dev'+(i===evs.length-1?' new':''); d.innerHTML='<span class="ev-t">'+esc(e.t||'')+'</span><span>'+esc(e.txt||'')+'</span>'; s.appendChild(d); }); wrap.appendChild(s); }
      return wrap;
    }
    function renderData(){ dbody.innerHTML=''; dbody.classList.toggle('single', !!state && state.fmt!=='multi'); whereEl.textContent=where; dnote.innerHTML=note||''; if(!state){ dbody.innerHTML='<div class="lab-data-empty">El dato aparecerá aquí conforme avance el proceso…</div>'; return; } dbody.appendChild(renderView(state,'')); }
    function purge(t){ if(t&&t.rows) t.rows=t.rows.filter(function(r){ return !r._del; }); }
    function setPath(obj,path,val){ var parts=path.split('.'), cur=obj; for(var i=0;i<parts.length-1;i++){ var k=Array.isArray(cur)?+parts[i]:parts[i]; if(cur[k]===undefined) cur[k]={}; cur=cur[k]; } var last=Array.isArray(cur)?+parts[parts.length-1]:parts[parts.length-1]; cur[last]=val; }
    function applyData(d){
      if(!d) return; hl={};
      if(state){ if(state.fmt==='multi') (state.parts||[]).forEach(purge); else purge(state); }
      if(d.view){ state=JSON.parse(JSON.stringify(d.view)); }
      if(d.where!==undefined) where=d.where;
      if(d.note!==undefined) note=d.note; else note='';
      var t=state, prefix='';
      if(state&&state.fmt==='multi'&&d.part!==undefined){ t=state.parts[d.part]; prefix=d.part+':'; }
      if(!t) return;
      if(d.rename){ for(var o in d.rename){ var ri_=(t.cols||[]).indexOf(o); if(ri_>=0){ t.cols[ri_]=d.rename[o]; hl[prefix+'h'+ri_]=1; } } }
      if(d.col){ for(var name in d.col){ var vals=d.col[name]; var ci=(t.cols||[]).indexOf(name); if(ci<0){ t.cols.push(name); ci=t.cols.length-1; (t.rows||[]).forEach(function(r){ r.push(null); }); hl[prefix+'h'+ci]=1; } vals.forEach(function(v,ri){ if(t.rows[ri]){ t.rows[ri][ci]=v; hl[prefix+'r'+ri+'c'+ci]=1; } }); } }
      if(d.cell){ d.cell.forEach(function(c){ var ci=t.cols.indexOf(c[1]); if(ci>=0&&t.rows[c[0]]){ t.rows[c[0]][ci]=c[2]; hl[prefix+'r'+c[0]+'c'+ci]=1; } }); }
      if(d.drop){ d.drop.forEach(function(cn){ var ci=t.cols.indexOf(cn); if(ci>=0){ t.cols.splice(ci,1); t.rows.forEach(function(r){ r.splice(ci,1); }); } }); }
      if(d.rows){ t.rows=d.rows.map(function(r){ return r.slice(); }); t.rows.forEach(function(r,ri){ hl[prefix+'row'+ri]=1; }); }
      if(d.addRows){ d.addRows.forEach(function(r){ t.rows.push(r.slice()); hl[prefix+'row'+(t.rows.length-1)]=1; }); }
      if(d.delRows){ d.delRows.forEach(function(ri){ if(t.rows[ri]) t.rows[ri]._del=true; }); }
      if(d.json&&t.obj!==undefined){ for(var p in d.json){ setPath(t.obj,p,d.json[p]); hl[prefix+'j:'+p]=1; } }
    }
    /* pasos */
    var idx=-1, running=false, timer=null, prevTask=null, speed=1;
    function markTask(tid,cls){ var c=taskEls[tid]; if(!c) return; c.classList.remove('running','ok'); if(cls) c.classList.add(cls); }
    function syncBack(){ backBtn.disabled = running || idx<0; }
    function applyStep(k,quiet){
      var st=sc.steps[k];
      clearActive();
      if(st.hl){ st.hl.forEach(function(h){ if(h.lines) hlLines(h.file,h.lines[0],h.lines[1],quiet); else hlLines(h.file,h.line,undefined,quiet); }); }
      else if(st.file){ if(st.lines) hlLines(st.file,st.lines[0],st.lines[1],quiet); else if(st.line) hlLines(st.file,st.line,undefined,quiet); else showFile(st.file); }
      var lf=st.hl?st.hl[st.hl.length-1].file:st.file, fm=lf?findFile(lf):null;
      dfd.setLang(fm?fm.lang:'none');
      if(st.task){ if(prevTask&&prevTask!==st.task) markTask(prevTask,'ok'); markTask(st.task,'running'); prevTask=st.task; }
      else if(prevTask){ markTask(prevTask,'ok'); prevTask=null; }
      if(st.edge){ [].concat(st.edge).forEach(function(n){ dfd.fillEdge(n); }); }
      if(st.at){ dfd.moveTo(st.at,quiet); }
      if(st.lit){ st.lit.forEach(function(n){ dfd.lit(n); }); }
      applyData(st.data); renderData();
      sayEl.innerHTML='<b>Paso '+(k+1)+'</b> · '+(st.say||'');
      stepEl.innerHTML='<span class="lp-k">paso</span> '+(k+1)+' / '+N;
      syncBack();
    }
    function stepBack(){
      if(running||idx<0) return;
      var target=idx-1;
      reset();
      for(var k=0;k<=target;k++){ idx=k; applyStep(k,true); }
      if(target>=0) playBtn.innerHTML='<span class="ic">▶</span><span class="bt">Continuar</span>';
      syncBack();
    }
    function finish(){
      running=false; clearTimeout(timer); dfd.finish();
      if(prevTask){ markTask(prevTask,'ok'); prevTask=null; }
      sayEl.innerHTML='<b>✓ Completado</b> · '+(sc.final||'');
      stepEl.innerHTML='<span class="lp-k">paso</span> '+N+' / '+N;
      playBtn.innerHTML='<span class="ic">↺</span><span class="bt">Repetir</span>'; stepBtn.disabled=true;
      syncBack();
    }
    function stepFwd(){ if(idx>=N-1) return false; idx++; applyStep(idx); if(idx>=N-1) finish(); return true; }
    function reset(){
      running=false; clearTimeout(timer); idx=-1; prevTask=null;
      dfd.reset(); clearHl(); state=null; hl={}; where='—'; note=''; renderData();
      for(var t in taskEls){ taskEls[t].classList.remove('running','ok','sel'); }
      sayEl.innerHTML=INITIAL_SAY; stepEl.innerHTML='<span class="lp-k">paso</span> 0 / '+N;
      playBtn.innerHTML='<span class="ic">▶</span><span class="bt">Ejecutar</span>'; stepBtn.disabled=false; showFirst();
      for(var bx in boxes){ for(var n in boxes[bx].files){ boxes[bx].files[n].pre.scrollTop=0; } }
      syncBack();
    }
    function tick(){ if(!running) return; var ok=stepFwd(); if(!ok||idx>=N-1){ running=false; return; } var d=(sc.steps[idx].dur||1700)/speed; timer=setTimeout(tick,(REDUCED||FAST)?0:d); }
    function play(){
      if(running){ running=false; clearTimeout(timer); playBtn.innerHTML='<span class="ic">▶</span><span class="bt">Continuar</span>'; stepBtn.disabled=false; syncBack(); return; }
      if(idx>=N-1) reset();
      running=true; playBtn.innerHTML='<span class="ic">⏸</span><span class="bt">Pausar</span>'; stepBtn.disabled=true; syncBack(); tick();
    }
    function step(){ if(running) return; if(idx>=N-1) reset(); stepFwd(); }
    playBtn.addEventListener('click',play);
    stepBtn.addEventListener('click',step);
    backBtn.addEventListener('click',stepBack);
    resetBtn.addEventListener('click',reset);
    var SPEEDS=[{v:1,i:'1×',l:'normal'},{v:1.8,i:'2×',l:'rápido'},{v:0.6,i:'½×',l:'lento'}], si=0;
    speedBtn.addEventListener('click',function(){ si=(si+1)%SPEEDS.length; speed=SPEEDS[si].v; speedBtn.innerHTML='<span class="ic">'+SPEEDS[si].i+'</span><span class="bt">'+SPEEDS[si].l+'</span>'; speedBtn.title='Velocidad: '+SPEEDS[si].l; });
    reset();
    var api={ panel:panel, step:step, back:stepBack, play:play, reset:reset, stepAll:function(){ reset(); while(stepFwd()){} }, total:N, get index(){ return idx; }, get running(){ return running; } };
    root.__lab=api; window.Labs[id]=api;
  }

  /* ============================================================ BOOT PORTADA ============================================================ */
  var bootDone=false;
  function maybeBoot(){
    if(bootDone) return; bootDone=true;
    var box=document.getElementById('bootBox'), reveal=['coverTitle','coverSub','coverMeta','coverCta'];
    function show(){ reveal.forEach(function(id){ var e=document.getElementById(id); if(e){ e.classList.add('in'); if(REDUCED||FAST){ e.style.opacity='1'; e.style.transform='none'; } } }); }
    if(!box){ show(); return; }
    var lines=Array.prototype.slice.call(box.querySelectorAll('.bl')), i=0;
    (function nextLine(){ if(i>=lines.length){ setTimeout(show,(REDUCED||FAST)?0:180); return; } lines[i++].classList.add('show'); setTimeout(nextLine,(REDUCED||FAST)?0:420); })();
  }

  /* ============================================================ NAVEGACIÓN ============================================================ */
  var deck=document.getElementById('deck');
  var slides=Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  var total=slides.length, cur=0;
  var curNum=document.getElementById('curNum'), totNum=document.getElementById('totNum');
  totNum.textContent=total;
  function render(dir){
    slides.forEach(function(s,i){ s.classList.toggle('is-active',i===cur); s.classList.toggle('rev',dir<0&&i===cur); });
    slides[cur].scrollTop=0;
    curNum.textContent=cur+1;
    if(cur===0) maybeBoot();
    try{ window.dispatchEvent(new CustomEvent('deck:slide',{detail:{index:cur,id:slides[cur].id}})); }catch(e){}
    // Contrato del visor de Slides: avisa en cada cambio de diapositiva.
    document.dispatchEvent(new CustomEvent('slides:cambio',{detail:{indice:cur,total:total}}));
  }
  function goTo(i,dir){ i=Math.max(0,Math.min(total-1,i)); if(i===cur) return; if(dir===undefined) dir=(i>cur?1:-1); cur=i; render(dir); }
  function next(){ goTo(cur+1,1); }
  function prev(){ goTo(cur-1,-1); }
  document.addEventListener('keydown',function(e){
    var t=(e.target.tagName||'').toLowerCase(), role=e.target.getAttribute&&e.target.getAttribute('role');
    var interactive=(t==='button'||t==='a'||t==='input'||t==='textarea'||t==='select'||e.target.isContentEditable||role==='button');
    if(e.key==='ArrowRight'){ e.preventDefault(); next(); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); prev(); }
    else if(e.key==='Home'){ e.preventDefault(); goTo(0); }
    else if(e.key==='End'){ e.preventDefault(); goTo(total-1); }
    else if(e.key==='n'||e.key==='N'){ var lab=slides[cur].querySelector('.lab'); if(lab&&lab.__lab&&!lab.__lab.running){ e.preventDefault(); lab.__lab.step(); } }
    else if(e.key==='b'||e.key==='B'){ var labB=slides[cur].querySelector('.lab'); if(labB&&labB.__lab&&!labB.__lab.running){ e.preventDefault(); labB.__lab.back(); } }
  });
  /* ============================================================ INIT ============================================================ */
  Array.prototype.forEach.call(document.querySelectorAll('[data-runner]'),buildRunner);
  Array.prototype.forEach.call(document.querySelectorAll('[data-flow]'),buildFlow);
  Array.prototype.forEach.call(document.querySelectorAll('[data-costdemo]'),buildCostDemo);
  Array.prototype.forEach.call(document.querySelectorAll('.lab[data-lab]'),buildLab);
  // El botón «Comenzar» de la portada: antes era un onclick en línea, que la CSP de Slides bloquea.
  Array.prototype.forEach.call(document.querySelectorAll('[data-deck-next]'),function(b){ b.addEventListener('click',next); });
  render(1);
  window.Deck={ next:next, prev:prev, goTo:goTo };
  window.slidesDeck={ total:total, indice:function(){ return cur; }, ir:function(n){ goTo(n); } };
})();
