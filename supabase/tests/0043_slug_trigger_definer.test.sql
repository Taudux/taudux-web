\set ON_ERROR_STOP on

-- Este archivo y la 0043 llevan acentos, y la migración exige client_encoding
-- UTF8 en su preflight. Se fija aquí para no depender del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
do $guard$
begin
  if current_database() <> 'taudux_slug_trigger_definer_0043_test' then
    raise exception 'Refusing to run outside taudux_slug_trigger_definer_0043_test';
  end if;
end
$guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$roles$;

-- Lo mínimo que la 0001 necesita, copiado del armado de las anteriores.
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

\ir ../migrations/0001_crear_perfiles.sql

grant usage on schema public to anon, authenticated;
grant select, insert on public.perfiles to anon, authenticated;
alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

create function pg_temp.assert_raises(sentencia text, estado text, message text)
returns void language plpgsql as $assert$
declare
  v_estado text;
  v_mensaje text;
begin
  begin
    execute sentencia;
  exception
    when others then
      get stacked diagnostics
        v_estado = returned_sqlstate,
        v_mensaje = message_text;
      if v_estado <> estado then
        raise exception 'assertion failed: % (esperaba %, llegó %: %)',
          message, estado, v_estado, v_mensaje;
      end if;
      return;
  end;
  raise exception 'assertion failed: % (la sentencia no falló)', message;
end
$assert$;

create function pg_temp.filas(sentencia text)
returns bigint language plpgsql as $filas$
declare
  v_filas bigint;
begin
  execute sentencia;
  get diagnostics v_filas = row_count;
  return v_filas;
end
$filas$;

-- Ids legibles: cuenta(7) = 43000000-0000-4000-8000-000000000007.
create function pg_temp.cuenta(n int) returns uuid
language sql immutable as $$
  select ('43000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

create function pg_temp.editar_propia(asignacion text) returns text
language sql immutable as $$
  select 'update public.fichas_colaborador set ' || asignacion
      || ' where id = auth.uid()'
$$;

-- Cambia una columna de la ficha de la cuenta 1, desde la administración.
create function pg_temp.poner(columna text, valor text) returns text
language sql immutable as $$
  select format('update public.fichas_colaborador set %I = %L where id = %L',
                columna, valor, pg_temp.cuenta(1))
$$;

insert into auth.users (id, raw_user_meta_data)
select pg_temp.cuenta(n), datos
from (values
  (1, '{"nombre": "Valeria", "apellidos": "Núñez"}'::jsonb),
  (2, '{"nombre": "Iván", "apellidos": "Soto"}'),
  (3, '{"nombre": "Begoña", "apellidos": "Ruiz"}')
) as semilla(n, datos);

\ir ../migrations/0038_colaboradores_publicos.sql

update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(1);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(2);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(3);

\ir ../migrations/0039_fichas_colaborador.sql
\ir ../migrations/0040_modalidad_trabajo_colaborador.sql

-- === El armado hasta la 0041 ================================================
-- Fichas de relleno: lo que esta prueba mira es el trigger del slug sobre
-- `public.perfiles`, no las fichas.

insert into public.fichas_colaborador
  (id, puesto, sector, ubicacion, stack, modalidad_trabajo, anio_inicio, bio)
values
  (pg_temp.cuenta(1), 'Analista', 'Financiero', 'Puebla, México',
   array['SQL', 'Python'], 'Híbrido', 2021, 'Una ficha completa y válida.'),
  (pg_temp.cuenta(2), 'Docente', 'Educación', 'Guadalajara, México',
   array['R', 'Excel'], 'Remoto', 2008, 'Enseño estadística desde 2008.');

\ir ../migrations/0041_etiquetas_empresa.sql
\ir ../migrations/0042_sector_opcional.sql

-- La 0040 ya declara `security definer` ella misma (ver ese archivo), así que
-- a esta altura de la cadena la función YA quedó definer y la sección de
-- abajo, tal como está escrita, no probaría nada. Se la vuelve a invoker a
-- mano para reconstruir el estado exacto de una base que corrió la 0040
-- VIEJA, sin el atributo — que es lo que existió en producción antes de este
-- arreglo, y lo que la 0043 (ahora como vía de actualización) tiene que
-- seguir pudiendo curar. Así la regresión real queda documentada y probada,
-- en vez de un estado que ya no ocurre en una base creada desde cero.
alter function public.asignar_slug_colaborador() security invoker;

-- === 1. La precondición: hoy un colaborador NO puede cambiarse el nombre ====
-- Si este 42501 dejara de ocurrir, la 0043 no estaría arreglando nada y el
-- resto del archivo pasaría en verde sin probar su cambio.

update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(1);

select pg_temp.assert_true(
  (select slug is not null from public.perfiles where id = pg_temp.cuenta(1)),
  'premisa: la cuenta 1 ya tiene slug de colaboradora'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.slug_colaborador(text)', 'execute'),
  'premisa: authenticated no puede ejecutar slug_colaborador()'
);
select pg_temp.assert_true(
  not (select prosecdef from pg_proc
        where oid = 'public.asignar_slug_colaborador()'::regprocedure),
  'premisa: el trigger todavía es SECURITY INVOKER'
);

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;

select pg_temp.assert_raises(
  'update public.perfiles set nombre = ''Valentina'' where id = auth.uid()',
  '42501',
  'antes de la 0043, una colaboradora no puede cambiarse el nombre'
);

reset role;

-- Y se pierde TODO el update, no sólo el nombre: el teléfono de la misma
-- sentencia tampoco queda.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_raises(
  'update public.perfiles set nombre = ''Valentina'', telefono = ''5551234567'' '
    'where id = auth.uid()',
  '42501',
  'el update entero cae, no sólo la columna del nombre'
);
reset role;
select pg_temp.assert_true(
  (select telefono is distinct from '5551234567' from public.perfiles where id = pg_temp.cuenta(1)),
  'el teléfono no se guardó'
);

-- Control: a una cuenta que NO colabora no le pasa nada. Es por esto que el
-- defecto no aparece en una prueba de humo cualquiera.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(3)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas('update public.perfiles set nombre = ''Begoña María'' where id = auth.uid()') = 1,
  'control: quien no colabora sí puede cambiarse el nombre'
);
reset role;

\ir ../migrations/0043_slug_trigger_definer.sql

-- === 2. Después: el renombrado funciona y el slug lo sigue =================

select pg_temp.assert_true(
  (select prosecdef from pg_proc
    where oid = 'public.asignar_slug_colaborador()'::regprocedure),
  'la 0043 dejó el trigger en SECURITY DEFINER'
);

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas('update public.perfiles set nombre = ''Valentina'', telefono = ''5551234567'' '
                'where id = auth.uid()') = 1,
  'ahora sí puede cambiarse el nombre'
);
reset role;

select pg_temp.assert_true(
  (select slug = 'valentina' from public.perfiles where id = pg_temp.cuenta(1)),
  'y el slug siguió al nombre'
);
select pg_temp.assert_true(
  (select telefono = '5551234567' from public.perfiles where id = pg_temp.cuenta(1)),
  'el resto del update también se guardó'
);

-- === 3. El revoke de la 0038 NO se devolvió ================================
-- Definer resuelve el privilegio por dentro; el cliente sigue sin poder
-- llamar a la función. Si alguien "arreglara" esto con un grant, esta guarda
-- lo dice.

select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.slug_colaborador(text)', 'execute')
  and not has_function_privilege('anon', 'public.slug_colaborador(text)', 'execute'),
  'slug_colaborador() sigue sin EXECUTE para el cliente'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.asignar_slug_colaborador()', 'execute'),
  'y el trigger tampoco se invoca a mano'
);

-- === 4. El desempate por apellido, que antes era ciego =====================
-- Los pre-chequeos de colisión corrían bajo la RLS del invocante, donde
-- perfiles_select_propio esconde las demás filas: no veían la colisión y sólo
-- frenaba la constraint única. Como definer, la ven.

update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(2);

select set_config('request.jwt.claim.sub', pg_temp.cuenta(2)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas('update public.perfiles set nombre = ''Valentina'' where id = auth.uid()') = 1,
  'una segunda Valentina puede renombrarse'
);
reset role;

select pg_temp.assert_true(
  (select slug = 'valentina-soto' from public.perfiles where id = pg_temp.cuenta(2)),
  'y desempata por su primer apellido en vez de chocar'
);
select pg_temp.assert_true(
  (select count(distinct slug) = 2 from public.perfiles
    where id in (pg_temp.cuenta(1), pg_temp.cuenta(2))),
  'las dos direcciones siguen siendo distintas'
);

-- === 5. Idempotencia =======================================================

\ir ../migrations/0043_slug_trigger_definer.sql

select pg_temp.assert_true(
  (select prosecdef from pg_proc
    where oid = 'public.asignar_slug_colaborador()'::regprocedure),
  're-aplicar la 0043 la deja en definer'
);
select pg_temp.assert_true(
  (select slug = 'valentina' from public.perfiles where id = pg_temp.cuenta(1)),
  'y no pisa los slugs ya calculados'
);

-- === 6. Reaplicar la 0040 nueva no revierte el atributo ====================
-- Guardia de regresión: antes de este arreglo, reaplicar la 0040 volvía la
-- función a SECURITY INVOKER en silencio —CREATE OR REPLACE FUNCTION le
-- asigna su default a todo atributo que el comando no nombra— y reabría el
-- 42501 de la sección 1. Ahora la 0040 nombra `security definer` ella misma:
-- si algún día alguien la vuelve a tocar y se lo olvida, esta guarda tiene
-- que reventar acá, no en producción.

\ir ../migrations/0040_modalidad_trabajo_colaborador.sql

do $regresion$
begin
  if not (select prosecdef from pg_proc
           where oid = 'public.asignar_slug_colaborador()'::regprocedure) then
    raise exception 'regresión: reaplicar la 0040 volvió el trigger a SECURITY INVOKER';
  end if;
end
$regresion$;

select '0043 slug trigger definer PASS' as result;
