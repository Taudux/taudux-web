\set ON_ERROR_STOP on

-- Este archivo y la 0042 llevan acentos, y la migración exige client_encoding
-- UTF8 en su preflight. Se fija aquí para no depender del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
do $guard$
begin
  if current_database() <> 'taudux_sector_opcional_0042_test' then
    raise exception 'Refusing to run outside taudux_sector_opcional_0042_test';
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

-- Ids legibles: cuenta(7) = 42000000-0000-4000-8000-000000000007.
create function pg_temp.cuenta(n int) returns uuid
language sql immutable as $$
  select ('42000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
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
-- Dos fichas con `stack`, que la 0041 renombra a `herramientas`. Acá no se
-- prueba nada de eso: es el suelo sobre el que corre la 0042.

insert into public.fichas_colaborador
  (id, puesto, sector, ubicacion, stack, modalidad_trabajo, anio_inicio, bio)
values
  (pg_temp.cuenta(1), 'Analista', 'Financiero', 'Puebla, México',
   array['SQL', 'Python'], 'Híbrido', 2021, 'Una ficha completa y válida.'),
  (pg_temp.cuenta(2), 'Docente', 'Educación', 'Guadalajara, México',
   array['R', 'Excel'], 'Remoto', 2008, 'Enseño estadística desde 2008.');

\ir ../migrations/0041_etiquetas_empresa.sql

-- === 1. La precondición: hoy el sector es obligatorio ========================
-- Si esto dejara de fallar, la 0042 no estaría arreglando nada y el resto del
-- archivo pasaría en verde sin probar su cambio.

select pg_temp.assert_true(
  (select attnotnull from pg_attribute
    where attrelid = 'public.fichas_colaborador'::regclass and attname = 'sector'),
  'antes de la 0042 sector es NOT NULL'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set sector = null where id = %L', pg_temp.cuenta(1)),
  '23502', 'antes de la 0042 no se puede borrar el sector'
);

\ir ../migrations/0042_sector_opcional.sql

-- === 2. Después: el sector se puede dejar vacío =============================

select pg_temp.assert_true(
  (select not attnotnull from pg_attribute
    where attrelid = 'public.fichas_colaborador'::regclass and attname = 'sector'),
  'la 0042 soltó el NOT NULL'
);
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set sector = null where id = %L',
                       pg_temp.cuenta(1))) = 1,
  'una ficha existente puede borrar su sector'
);
select pg_temp.assert_true(
  (select sector is null from public.fichas_colaborador where id = pg_temp.cuenta(1)),
  'y queda en null, no en cadena vacía'
);

-- Una ficha nueva sin sector entra entera. La 3 no tenía ficha todavía.
select pg_temp.assert_true(
  pg_temp.filas(format(
    'insert into public.fichas_colaborador '
    '(id, puesto, ubicacion, herramientas, modalidad_trabajo, anio_inicio, bio) '
    'values (%L, %L, %L, array[%L], %L, %s, %L)',
    pg_temp.cuenta(3), 'Diseñadora', 'Mérida, México', 'Figma', 'Remoto', 2019,
    'Diseño producto desde 2019, sin empresa fija.')) = 1,
  'una ficha nueva se guarda sin sector'
);

-- === 3. El CHECK sigue vivo para los valores presentes =======================
-- `sector is null` pasa porque un CHECK que da NULL se aprueba; eso NO puede
-- convertirse en que cualquier cosa entre.

select pg_temp.assert_raises(pg_temp.poner('sector', ''), '23514', 'el sector vacío no entra');
select pg_temp.assert_raises(pg_temp.poner('sector', 'F'), '23514', 'un sector de un carácter');
select pg_temp.assert_raises(pg_temp.poner('sector', ' Fintech'), '23514', 'sector sin recortar');
select pg_temp.assert_raises(pg_temp.poner('sector', 'Fintech '), '23514', 'sector con espacio al final');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set sector = %L where id = %L',
         repeat('z', 81), pg_temp.cuenta(1)),
  '23514', 'un sector de más de 80');
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.poner('sector', 'Fintech')) = 1,
  'un sector válido sigue entrando');

-- === 4. La RPC devuelve la ficha sin sector ==================================
-- El agujero de verdad: si la fila sin sector se cayera de la lista, borrarlo
-- equivaldría a desaparecer del roster.

update public.fichas_colaborador set sector = null where id = pg_temp.cuenta(1);

select pg_temp.assert_true(
  (select count(*) from public.listar_colaboradores() where sector is null) = 2,
  'las dos fichas sin sector salen igual en la RPC'
);
select pg_temp.assert_true(
  (select puesto is not null and herramientas is not null
     from public.listar_colaboradores() where sector is null and puesto = 'Analista'),
  'y traen el resto de sus datos'
);
select pg_temp.assert_true(
  pg_get_function_result('public.listar_colaboradores()'::regprocedure) like '%sector text%',
  'la 0042 no tocó la firma de la RPC'
);
select pg_temp.assert_true(
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute'),
  'ni sus grants'
);

-- === 5. Privilegios por columna ==============================================
-- Soltar un NOT NULL no toca los grants, pero es barato fijarlo: si alguien
-- reescribiera la columna en vez de alterarla, esto lo vería.

select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.fichas_colaborador', 'sector', 'update')
  and has_column_privilege('authenticated', 'public.fichas_colaborador', 'sector', 'insert'),
  'authenticated sigue escribiendo sector'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.fichas_colaborador', 'select'),
  'anon sigue sin tocar la tabla'
);

-- === 6. Idempotencia =========================================================

update public.fichas_colaborador set sector = 'Salud' where id = pg_temp.cuenta(2);

\ir ../migrations/0042_sector_opcional.sql

select pg_temp.assert_true(
  (select sector = 'Salud' from public.fichas_colaborador where id = pg_temp.cuenta(2)),
  're-aplicar la 0042 no pisa lo guardado'
);
select pg_temp.assert_true(
  (select sector is null from public.fichas_colaborador where id = pg_temp.cuenta(1)),
  'ni le devuelve un sector a quien lo borró'
);
select pg_temp.assert_true(
  (select not attnotnull from pg_attribute
    where attrelid = 'public.fichas_colaborador'::regclass and attname = 'sector'),
  'y la columna sigue siendo nullable'
);

select '0042 sector opcional PASS' as result;
