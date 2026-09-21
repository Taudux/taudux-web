\set ON_ERROR_STOP on

-- Este archivo y la 0041 llevan acentos, y la migración exige client_encoding
-- UTF8 en su preflight. Se fija aquí para no depender del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
do $guard$
begin
  if current_database() <> 'taudux_etiquetas_empresa_0041_test' then
    raise exception 'Refusing to run outside taudux_etiquetas_empresa_0041_test';
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

-- Ids legibles: cuenta(7) = 41000000-0000-4000-8000-000000000007.
create function pg_temp.cuenta(n int) returns uuid
language sql immutable as $$
  select ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
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

-- === La forma de producción, ANTES de la 0041 ================================
-- Dos fichas con `stack`. Es lo que la 0041 se va a encontrar: el contenido
-- son herramientas y por eso viaja con la columna, sin backfill.

insert into public.fichas_colaborador
  (id, puesto, sector, ubicacion, stack, modalidad_trabajo, anio_inicio, bio)
values
  (pg_temp.cuenta(1), 'Analista', 'Financiero', 'Puebla, México',
   array['SQL', 'Python'], 'Híbrido', 2021, 'Una ficha completa y válida.'),
  (pg_temp.cuenta(2), 'Docente', 'Educación', 'Guadalajara, México',
   array['R', 'Excel'], 'Remoto', 2008, 'Enseño estadística desde 2008.');

\ir ../migrations/0041_etiquetas_empresa.sql

-- === 1. Las columnas =========================================================

select pg_temp.assert_true(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'stack'
  ),
  'stack ya no existe'
);

select pg_temp.assert_true(
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name in ('herramientas', 'habilidades', 'idiomas')
      and data_type = 'ARRAY' and is_nullable = 'NO'),
  'las tres listas existen, son arreglos y ninguna admite null'
);

select pg_temp.assert_true(
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name in ('empresa', 'empresa_enlace')
      and data_type = 'text' and is_nullable = 'YES'),
  'empresa y su enlace existen, son text y admiten null'
);

-- El contenido viaja con la columna: nadie lo movió de lugar.
select pg_temp.assert_true(
  (select herramientas = array['SQL', 'Python'] and habilidades = '{}' and idiomas = '{}'
   from public.fichas_colaborador where id = pg_temp.cuenta(1)),
  'lo que estaba en stack quedó en herramientas, y las listas nuevas nacen vacías'
);

-- === 2. La función por elemento ==============================================

select pg_temp.assert_true(
  to_regprocedure('public.stack_colaborador_valido(text[])') is null,
  'la función vieja ya no existe'
);
select pg_temp.assert_true(
  to_regprocedure('public.etiquetas_colaborador_validas(text[])') is not null,
  'la función nueva existe'
);
select pg_temp.assert_true(
  (select not p.prosecdef and p.provolatile = 'i'
          and 'search_path=""' = any(p.proconfig)
   from pg_proc p
   where p.oid = 'public.etiquetas_colaborador_validas(text[])'::regprocedure),
  'sigue siendo invoker, immutable y con search_path vacío'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.etiquetas_colaborador_validas(text[])', 'execute')
  and not has_function_privilege('anon', 'public.etiquetas_colaborador_validas(text[])', 'execute'),
  'la ejecuta authenticated y no anon'
);

-- === 3. herramientas: las mismas reglas que tenía stack ======================

select pg_temp.assert_raises(pg_temp.poner('herramientas', '{}'), '23514', 'herramientas vacía');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set herramientas = %L where id = %L',
         array_fill('x'::text, array[13]), pg_temp.cuenta(1)),
  '23514', 'herramientas de 13 elementos');
select pg_temp.assert_raises(pg_temp.poner('herramientas', '{" SQL"}'), '23514', 'elemento con espacio al inicio');
select pg_temp.assert_raises(pg_temp.poner('herramientas', '{"SQL "}'), '23514', 'elemento con espacio al final');
select pg_temp.assert_raises(pg_temp.poner('herramientas', '{"SQL",""}'), '23514', 'elemento vacío');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set herramientas = array[%L] where id = %L',
         repeat('s', 41), pg_temp.cuenta(1)),
  '23514', 'elemento de 41 caracteres');
select pg_temp.assert_raises(pg_temp.poner('herramientas', '{"SQL",NULL}'), '23514', 'elemento null');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set herramientas = array[%L] where id = %L',
         E'SQL\tPython', pg_temp.cuenta(1)),
  '23514', 'elemento con tabulador');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set herramientas = array[%L] where id = %L',
         'SQL' || U&'\202A', pg_temp.cuenta(1)),
  '23514', 'elemento con U+202A');
-- El `case` está para que la dimensión se revise primero: sin él,
-- array_position falla con 0A000 en vez de 23514.
select pg_temp.assert_raises(pg_temp.poner('herramientas', '{{SQL,dbt},{Go,Rust}}'), '23514',
  'herramientas de dos dimensiones da 23514, no 0A000');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set herramientas = null where id = %L', pg_temp.cuenta(1)),
  '23502', 'herramientas null');

-- Los bordes válidos.
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set herramientas = %L where id = %L',
                       array_fill('x'::text, array[12]), pg_temp.cuenta(1))) = 1,
  'doce herramientas entran');
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set herramientas = array[%L] where id = %L',
                       repeat('s', 40), pg_temp.cuenta(1))) = 1,
  'un elemento de 40 entra');

-- === 4. habilidades e idiomas: opcionales, pero con las mismas reglas ========

-- EL CASO QUE MÁS IMPORTA. `array_ndims('{}'::text[])` devuelve NULL, no 1:
-- un arreglo vacío tiene CERO dimensiones. Sin el `coalesce` en la guarda del
-- CHECK, el `when` da NULL, cae al `else` y el CHECK rechaza el DEFAULT de su
-- propia columna. Este assert es el que caza esa regresión.
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.poner('habilidades', '{}')) = 1,
  'habilidades vacía se acepta: es su propio valor por defecto'
);
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.poner('idiomas', '{}')) = 1,
  'idiomas vacío se acepta'
);

-- El DEFAULT se aplica de verdad en un insert que omite las columnas.
insert into auth.users (id, raw_user_meta_data)
values (pg_temp.cuenta(4), '{"nombre": "Luis", "apellidos": "Paz"}'::jsonb);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(4);
insert into public.fichas_colaborador
  (id, puesto, sector, ubicacion, herramientas, modalidad_trabajo, anio_inicio, bio)
values
  (pg_temp.cuenta(4), 'Diseñador', 'Salud', 'Mérida, México',
   array['Figma'], 'Presencial', 2015, 'Diseño interfaces desde 2015.');
select pg_temp.assert_true(
  (select habilidades = '{}' and idiomas = '{}'
   from public.fichas_colaborador where id = pg_temp.cuenta(4)),
  'una ficha nueva que las omite las recibe vacías, no null'
);

select pg_temp.assert_raises(
  format('update public.fichas_colaborador set habilidades = null where id = %L', pg_temp.cuenta(1)),
  '23502', 'habilidades null');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set idiomas = null where id = %L', pg_temp.cuenta(1)),
  '23502', 'idiomas null');

select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set habilidades = %L where id = %L',
                       array_fill('x'::text, array[12]), pg_temp.cuenta(1))) = 1,
  'doce habilidades entran');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set habilidades = %L where id = %L',
         array_fill('x'::text, array[13]), pg_temp.cuenta(1)),
  '23514', 'trece habilidades no');

-- Las reglas por elemento las comparten las tres listas: misma función.
select pg_temp.assert_raises(pg_temp.poner('habilidades', '{" TDD"}'), '23514', 'habilidad sin recortar');
select pg_temp.assert_raises(pg_temp.poner('habilidades', '{"TDD",NULL}'), '23514', 'habilidad null');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set habilidades = array[%L] where id = %L',
         repeat('h', 41), pg_temp.cuenta(1)),
  '23514', 'habilidad de 41 caracteres');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set idiomas = array[%L] where id = %L',
         'Ingl' || U&'\00E9' || 's' || U&'\202A', pg_temp.cuenta(1)),
  '23514', 'idioma con U+202A');
select pg_temp.assert_raises(pg_temp.poner('habilidades', '{{TDD,CI},{Go,Rust}}'), '23514',
  'habilidades de dos dimensiones da 23514, no 0A000');

-- === 5. empresa ==============================================================

select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set empresa = null, empresa_enlace = null where id = %L',
                       pg_temp.cuenta(1))) = 1,
  'empresa null se acepta: es opcional');
select pg_temp.assert_raises(pg_temp.poner('empresa', ''), '23514', 'empresa vacía');
select pg_temp.assert_raises(pg_temp.poner('empresa', 'T'), '23514', 'empresa de un carácter');
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set empresa = %L where id = %L',
                       repeat('e', 80), pg_temp.cuenta(1))) = 1,
  'empresa de 80 entra');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set empresa = %L where id = %L',
         repeat('e', 81), pg_temp.cuenta(1)),
  '23514', 'empresa de 81');
select pg_temp.assert_raises(pg_temp.poner('empresa', ' Taudux'), '23514', 'empresa sin recortar');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set empresa = %L where id = %L',
         E'Tau\tdux', pg_temp.cuenta(1)),
  '23514', 'empresa con tabulador');

-- === 6. El enlace de la empresa ==============================================
-- Acá NO se fija el host: la empresa vive donde vive. Se fija el esquema
-- —https y nada más, porque este texto termina en un href— y que la autoridad
-- tenga un punto, para que una intranet no se publique como enlace.

select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set empresa = %L, empresa_enlace = %L where id = %L',
                       'Taudux', 'https://taudux.com', pg_temp.cuenta(1))) = 1,
  'un https con punto entra');
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set empresa_enlace = %L where id = %L',
                       'https://taudux.com/equipo?x=1#ancla', pg_temp.cuenta(1))) = 1,
  'con ruta, consulta y fragmento también');
select pg_temp.assert_raises(pg_temp.poner('empresa_enlace', 'http://taudux.com'), '23514',
  'http sin la ese no entra');
select pg_temp.assert_raises(pg_temp.poner('empresa_enlace', 'javascript:alert(1)'), '23514',
  'javascript: no entra');
select pg_temp.assert_raises(pg_temp.poner('empresa_enlace', 'https://intranet'), '23514',
  'una autoridad sin punto no entra');
select pg_temp.assert_raises(pg_temp.poner('empresa_enlace', 'https://taudux .com'), '23514',
  'con espacio no entra');
select pg_temp.assert_raises(pg_temp.poner('empresa_enlace', ''), '23514',
  'la cadena vacía no entra: la ausencia se escribe null');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set empresa_enlace = %L where id = %L',
         'https://taudux.com/' || repeat('z', 200), pg_temp.cuenta(1)),
  '23514', 'un enlace de más de 200');

-- === 7. El cruzado: un enlace sin nombre no se guarda ========================
-- Nombre sin enlace es un estado útil (texto plano). Enlace sin nombre es un
-- dato que la página nunca puede pintar y quedaría guardado e invisible.

select pg_temp.assert_raises(
  format('update public.fichas_colaborador set empresa = null, empresa_enlace = %L where id = %L',
         'https://taudux.com', pg_temp.cuenta(1)),
  '23514', 'un enlace sin nombre no se guarda');
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set empresa = %L, empresa_enlace = null where id = %L',
                       'Taudux', pg_temp.cuenta(1))) = 1,
  'un nombre sin enlace sí');
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set empresa = null, empresa_enlace = null where id = %L',
                       pg_temp.cuenta(1))) = 1,
  'los dos en null también');

-- === 8. Privilegios por columna ==============================================

select pg_temp.assert_true(
  (select bool_and(has_column_privilege('authenticated', 'public.fichas_colaborador', c, 'insert')
                   and has_column_privilege('authenticated', 'public.fichas_colaborador', c, 'update'))
   from unnest(array['herramientas', 'habilidades', 'idiomas', 'empresa', 'empresa_enlace']) as c),
  'authenticated escribe las cinco columnas');
select pg_temp.assert_true(
  not has_column_privilege('authenticated', 'public.fichas_colaborador', 'id', 'update'),
  'el update sigue sin incluir id');
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.fichas_colaborador', 'select'),
  'anon sigue sin tocar la tabla');

-- === 9. La RPC pública =======================================================

select pg_temp.assert_true(
  pg_get_function_result('public.listar_colaboradores()'::regprocedure) =
    'TABLE(nombre text, apellidos text, slug text, puesto text, sector text, '
    'ubicacion text, herramientas text[], habilidades text[], idiomas text[], '
    'empresa text, empresa_enlace text, modalidad_trabajo text, '
    'anio_inicio integer, bio text, linkedin text, github text, correo text)',
  'la RPC devuelve las columnas nuevas en su lugar'
);
select pg_temp.assert_true(
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute')
  and has_function_privilege('authenticated', 'public.listar_colaboradores()', 'execute'),
  'los grants de la RPC se reemitieron tras el drop'
);
select pg_temp.assert_true(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.listar_colaboradores()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'el revoke from public sigue puesto'
);

set role anon;
select pg_temp.assert_true(
  (select string_agg(k, ',' order by k collate "C")
   from (select distinct jsonb_object_keys(to_jsonb(c)) as k
         from public.listar_colaboradores() as c) as claves)
    = 'anio_inicio,apellidos,bio,correo,empresa,empresa_enlace,github,'
      'habilidades,herramientas,idiomas,linkedin,modalidad_trabajo,nombre,'
      'puesto,sector,slug,ubicacion',
  'anon ve las diecisiete claves, con las nuevas y sin stack'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.listar_colaboradores() as c
   where c.slug = 'begona' and c.herramientas is null and c.habilidades is null),
  'una colaboradora sin ficha sigue saliendo con los campos de ficha en null'
);
reset role;

-- === 10. Idempotencia ========================================================

update public.fichas_colaborador
   set habilidades = array['TDD'], idiomas = array['Español']
 where id = pg_temp.cuenta(1);

\ir ../migrations/0041_etiquetas_empresa.sql

select pg_temp.assert_true(
  (select habilidades = array['TDD'] and idiomas = array['Español']
   from public.fichas_colaborador where id = pg_temp.cuenta(1)),
  're-aplicar la 0041 no pisa lo guardado'
);
select pg_temp.assert_true(
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute'),
  're-aplicarla deja los grants de la RPC en su lugar'
);

select '0041 etiquetas y empresa PASS' as result;
