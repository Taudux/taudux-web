-- Límites del extractor por PERSONA, y el lote deja de ser un sí/no.
--
-- Cierra dos cosas de una vez porque tocan la misma columna y la misma tabla:
-- si fueran dos migraciones, la primera dejaría `extractor_planes.lote` en un
-- estado (booleano) que la segunda tendría que volver a castear.
--
-- QUÉ CAMBIA
--
-- 1. `extractor_planes.lote` pasa de `boolean` a `int`: ya no es "¿puede subir
--    varios?" sino "¿CUÁNTOS a la vez?". Un booleano no puede decir "hasta 5",
--    y el día que Silver exista la respuesta correcta no es "los que quiera".
-- 2. El catálogo se sincroniza con `extractor/app.py` para `anonimo` y `free`
--    (2 documentos al mes, mensual, con descargas), que es lo que traía la
--    `0032_extractor_planes_2_por_2.sql` — esta migración la reemplaza entera;
--    aquella nunca se aplicó.
-- 3. `extractor_acceso` gana tres columnas para que administración pueda fijar
--    los números de UNA persona sin inventarle un plan.
--
-- LO QUE NO CAMBIA, A PROPÓSITO
--
-- `green`, `silver` y `gold` siguen con `activo = false`. Esta migración les
-- escribe un `lote` sensato (documentación para el día que se enciendan), pero
-- NO los activa: activarlos es una decisión de producto, no un efecto lateral
-- de arreglar un tipo de dato.
--
-- Tampoco se agrega selector de plan: lo único personalizable por usuario son
-- los dos números. `_plan()` en `app.py` sigue devolviendo `free` o `anonimo`.
--
-- POR QUÉ NO SE AGREGA NINGUNA POLICY DE ESCRITURA
--
-- Porque sería el mismo agujero que `0029:127-141` ya cerró para el plan (el
-- comentario en 127-130 y las dos policies de select en 131-141). Ahí quedó
-- escrito el motivo, y vale igual —o más— para estas tres columnas: *"si
-- alguien pudiera darse Gold desde el navegador, el catálogo entero sería
-- decorativo"*. Con `personalizado`, `limite` y `lote` abiertos a
-- `authenticated`, cualquiera se escribiría `limite = null` (sin techo) desde
-- la consola del navegador y la cuota entera sería decorativa.
--
-- Las dos policies de SELECT de `0029` (`extractor_acceso_select_propio` y
-- `extractor_acceso_select_admin`) alcanzan y sobran: cada quien lee su fila
-- —que es como `app.py` la consulta en el camino caliente, con el token de la
-- propia persona— y administración las lee todas. TODA escritura pasa por el
-- backend con `service_role`, que se salta la RLS, y ahí sí hay un
-- `_solo_admin()` delante.
--
-- POR QUÉ NO HAY BACKFILL
--
-- Ni las filas existentes de `extractor_acceso` ni los usuarios que no tienen
-- fila reciben números: heredan los del plan, resueltos en tiempo de lectura.
-- Escribirles hoy `limite = 2` los CONGELARÍA en 2: el día que
-- `PLAN_POR_DEFECTO` cambie de número, todo el que existía antes de esta
-- migración se quedaría con el viejo y nadie sabría por qué. Heredar es lo que
-- mantiene sincronizado a quien nunca fue tocado por un administrador.
--
-- POR QUÉ `personalizado` ES UNA COLUMNA Y NO `limite is not null`
--
-- Porque `limite = null` tiene DOS significados —"sin techo" y "nadie lo tocó
-- nunca"— y confundirlos regala cuota ilimitada por omisión: toda fila que
-- existiera antes de esta migración pasaría a ser ilimitada de golpe. La
-- bandera separa "esta fila manda" de "esta fila hereda", y `limite = null`
-- vuelve a significar una sola cosa: sin techo, y a propósito.
--
-- ⚠ `lote > limite` ES LEGAL y no se valida en contra. Con `limite = 3` y
-- `lote = 2`, la segunda subida de 2 archivos procesa UNO y avisa que omitió el
-- otro (la lógica de `omitidos` en `app.py`). Es la secuencia confirmada con
-- producto, no un descuido: la cuota cuenta PDF, no operaciones, así que un
-- lote más grande que el saldo se recorta solo. No lo "arregles" agregando un
-- check.
--
-- Aplicar dos veces es seguro: el cast va bajo un `if` que mira el tipo actual,
-- las columnas llevan `if not exists` y los checks se recrean con
-- `drop constraint if exists` delante.

begin;

do $preflight$
begin
  if to_regclass('public.extractor_planes') is null then
    raise exception using
      errcode = 'P0001',
      message = '0032 preflight failed: public.extractor_planes is required (0029)';
  end if;

  if to_regclass('public.extractor_acceso') is null then
    raise exception using
      errcode = 'P0001',
      message = '0032 preflight failed: public.extractor_acceso is required (0029)';
  end if;
end
$preflight$;

-- --------------------------------------------------------------------------- --
-- 1. `extractor_planes.lote`: de "sí/no" a "cuántos a la vez"
-- --------------------------------------------------------------------------- --
-- El `drop default` va ANTES del cast y no es opcional: el default vigente es
-- `false`, y Postgres castea también el default —una expresión constante, a la
-- que el `using` no aplica—, así que sin soltarlo primero el `alter type` falla
-- con "default for column lote cannot be cast automatically to type integer".
--
-- El `using` traduce el significado viejo: `true` era "varios a la vez" y el
-- único plan asignable que lo tenía era Silver, así que se convierte en su
-- número (5); `false` era "de uno en uno", que es exactamente 1.
do $lote_a_entero$
begin
  if (select data_type
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'extractor_planes'
         and column_name = 'lote') = 'boolean' then

    alter table public.extractor_planes alter column lote drop default;
    alter table public.extractor_planes
      alter column lote type int using (case when lote then 5 else 1 end);
    alter table public.extractor_planes alter column lote set default 1;
  end if;
end
$lote_a_entero$;

-- 1 es el piso real: "cero archivos a la vez" no es un plan, es un servicio
-- apagado, y eso ya lo dice `activo = false`.
alter table public.extractor_planes
  drop constraint if exists extractor_planes_lote_minimo;
alter table public.extractor_planes
  add constraint extractor_planes_lote_minimo check (lote >= 1);

comment on column public.extractor_planes.lote is
  'Cuántos PDF se pueden subir en UNA operación. 1 = de uno en uno. No es la '
  'cuota: la cuota cuenta documentos del periodo y vive en `limite`.';

-- --------------------------------------------------------------------------- --
-- 2. Los números del catálogo
-- --------------------------------------------------------------------------- --
-- Los tres inactivos se escriben igual: es documentación de la decisión
-- mientras esperan apagados, para que encenderlos sea un `update activo` y no
-- una discusión sobre cuántos archivos aguanta cada nivel.
update public.extractor_planes set lote = 1  where clave in ('anonimo', 'free', 'green');
update public.extractor_planes set lote = 5  where clave = 'silver';
update public.extractor_planes set lote = 20 where clave = 'gold';

-- `anonimo` y `free` quedan idénticos a `CATALOGO` en `extractor/app.py`
-- (hallazgo F32): 2 documentos al mes los dos, mensuales los dos, con
-- descargas los dos.
--
-- `anonimo` pasa de `mensual = false` (una sola vez, nunca se renueva) a
-- `mensual = true`: la cuenta ya no da más cupo, da continuidad entre
-- dispositivos. `free` baja de 3 a 2 por lo mismo — el mismo número con cuenta
-- y sin ella. `descargas` sube a `true` en `free` (hallazgo F29): quien puede
-- extraer puede descargar, porque el archivo ES el resultado de la extracción.
update public.extractor_planes
   set limite    = 2,
       mensual   = true,
       descargas = true
 where clave in ('anonimo', 'free');

-- --------------------------------------------------------------------------- --
-- 3. Límites por persona en `extractor_acceso`
-- --------------------------------------------------------------------------- --
alter table public.extractor_acceso
  add column if not exists personalizado boolean not null default false,
  add column if not exists limite        int,
  add column if not exists lote          int;

comment on column public.extractor_acceso.personalizado is
  'true = los números de esta fila MANDAN sobre los del plan, en las dos '
  'direcciones (suben y bajan). false = la fila hereda del plan y las otras '
  'dos columnas se ignoran. Es una columna y no `limite is not null` porque '
  'null significa "sin techo", no "nadie lo tocó".';
comment on column public.extractor_acceso.limite is
  'Documentos del periodo para esta persona. null = sin techo. 0 es válido y '
  'suspende sin tener que degradarle el plan. Sólo se lee si personalizado.';
comment on column public.extractor_acceso.lote is
  'PDF por operación para esta persona. Puede ser MAYOR que `limite`: la cuota '
  'cuenta PDF, así que un lote que no cabe se recorta y avisa qué omitió.';

-- `limite >= 0` y no `> 0`: cero es una decisión legítima (suspender a alguien
-- sin tocarle el plan ni borrarle la fila). El lote, en cambio, arranca en 1
-- por el mismo motivo que en el catálogo.
alter table public.extractor_acceso
  drop constraint if exists extractor_acceso_limite_valido;
alter table public.extractor_acceso
  add constraint extractor_acceso_limite_valido
  check (limite is null or limite >= 0);

alter table public.extractor_acceso
  drop constraint if exists extractor_acceso_lote_valido;
alter table public.extractor_acceso
  add constraint extractor_acceso_lote_valido
  check (lote is null or lote >= 1);

-- Una fila personalizada SIN `lote` no tiene respuesta a "¿cuántos archivos a
-- la vez?", y la respuesta por omisión tendría que salir del plan — que es
-- justo lo que `personalizado` dice que no manda. `limite` sí puede quedar en
-- null ahí: significa "sin techo", que es una respuesta.
alter table public.extractor_acceso
  drop constraint if exists extractor_acceso_personalizado_completo;
alter table public.extractor_acceso
  add constraint extractor_acceso_personalizado_completo
  check (not personalizado or lote is not null);

commit;
