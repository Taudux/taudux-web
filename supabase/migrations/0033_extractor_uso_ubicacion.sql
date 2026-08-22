-- Ubicación APROXIMADA de cada extracción, para saber desde dónde se usa la
-- herramienta sin depender de los reportes de un tercero.
--
-- LO QUE ESTA MIGRACIÓN NO AGREGA, Y ES EL PUNTO
--
-- No hay columna para la dirección IP, y no la va a haber. La IP se lee del
-- header `X-Forwarded-For`, se convierte a ciudad EN MEMORIA contra una base
-- GeoIP local —nunca viaja a un tercero— y se descarta en la misma petición.
-- Guardarla convertiría una métrica agregada en un rastro por persona.
--
-- Es la misma pregunta que la 0030 dejó planteada para su caso: *"si alguna
-- vez alguien necesita cruzarlas, la respuesta correcta es preguntar por qué,
-- no agregar la columna."* Acá la respuesta es que no hace falta: para pintar
-- un mapa de ciudades, la ciudad alcanza.
--
-- POR QUÉ EL GRANO SE DETIENE EN LA CIUDAD
--
-- Más fino identifica. Una ciudad con miles de habitantes no señala a nadie;
-- una colonia o un par de coordenadas, sí — y cruzadas con `creado_en` todavía
-- más. La granularidad no es un detalle de implementación: es lo que hace que
-- este dato sea agregable y no un perfil.
--
-- Por eso tampoco se agrega latitud/longitud, aunque la base GeoIP las
-- devuelva. El mapa del panel colorea estados, no clava alfileres.
--
-- QUÉ SIGUE INTACTO DE LA 0030
--
-- `extractor_metrica_banco` sigue sin identidad de ninguna clase: sin user_id,
-- sin sesión, sin IP y sin hora fina. La ubicación va SÓLO en la tabla que ya
-- sabía quién, así que no aparece ningún cruce nuevo. Sigue sin poder
-- responderse "en qué banco tiene cuenta esta persona", y ahora tampoco
-- "desde dónde consulta su banco".
--
-- LEGAL (LFPDPPP)
--
-- La ubicación aproximada NO es dato sensible: la lista del Art. 3 es cerrada
-- (origen racial o étnico, salud, genética, creencias, afiliación sindical,
-- opiniones políticas, preferencia sexual) y la ciudad no está en ella. No
-- exige consentimiento expreso, pero SÍ exige que el aviso de privacidad
-- declare la finalidad. Ver openspec/legal/privacidad-ga4-draft.md, Cambio 4.
--
-- Aplicar dos veces es seguro: todo lleva `if not exists`.

begin;

do $preflight$
begin
  if to_regclass('public.extractor_uso') is null then
    raise exception using
      errcode = 'P0001',
      message = '0033 preflight failed: 0030 must be applied first';
  end if;
end
$preflight$;

-- Las tres NULABLES, y no es descuido: la geolocalización FALLA ABIERTO. Una
-- IP que la base no reconoce, una petición sin el header, o la base GeoIP
-- ausente en un entorno de pruebas dejan `null` — que significa "no se supo",
-- y es una respuesta honesta. Un valor por omisión ('Desconocida', 'MX')
-- sería inventar un dato y contaminaría cualquier agregado que se haga
-- después.
alter table public.extractor_uso
  add column if not exists ciudad text,
  add column if not exists region text,
  add column if not exists pais   text;

comment on column public.extractor_uso.ciudad is
  'Ciudad aproximada, derivada de la IP en memoria y sin guardarla. Es el '
  'grano MÁS FINO permitido: por debajo identifica. null = no se pudo saber.';
comment on column public.extractor_uso.region is
  'Estado o provincia. Es lo que colorea el mapa del panel de administración.';
comment on column public.extractor_uso.pais is
  'Código ISO-3166-1 alfa-2 (MX, US...). Dos caracteres, no el nombre: el '
  'nombre cambia de idioma según quién lo escriba y rompe los agregados.';

-- `pais` en dos caracteres o nada. Un check barato que evita que alguien
-- empiece a guardar 'México' en unas filas y 'MX' en otras — el día que pase,
-- los agregados del panel mienten sin que nada falle.
alter table public.extractor_uso
  drop constraint if exists extractor_uso_pais_iso2;
alter table public.extractor_uso
  add constraint extractor_uso_pais_iso2
  check (pais is null or pais ~ '^[A-Z]{2}$');

-- El índice que va a pedir el mapa: "cuántas extracciones por región este
-- mes". Sin él, cada apertura del panel recorre la tabla entera.
create index if not exists extractor_uso_region_fecha
  on public.extractor_uso (region, creado_en);

commit;
