\set ON_ERROR_STOP on

-- La migración y este archivo llevan acentos, y la 0050 exige client_encoding
-- UTF8 en su preflight. Se fija aquí para no depender del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
--
--   createdb taudux_foto_colaborador_0050_test
--   psql -d taudux_foto_colaborador_0050_test -f supabase/tests/0050_foto_colaborador.test.sql
do $guard$
begin
  if current_database() <> 'taudux_foto_colaborador_0050_test' then
    raise exception 'Refusing to run outside taudux_foto_colaborador_0050_test';
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

-- Lo mínimo que la 0001 REAL necesita para cargar: auth.users con el metadata
-- del signUp (handle_new_user lo lee) y auth.uid().
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Sustituto mínimo del auth.uid() de Supabase: lee el mismo GUC que PostgREST
-- fija en cada petición, así las policies corren por el camino real bajo
-- `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

-- Un Storage mínimo: lo que la migración toca y nada más. RLS activa en
-- objects, como en Supabase, y los grants que Supabase da por defecto.
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

\ir ../migrations/0001_crear_perfiles.sql

-- Defaults de Supabase, replicados ANTES de las migraciones nuevas: sin esto,
-- "authenticated no inserta foto_path" pasaría por un grant que aquí faltara y
-- no por el grant por columna de la 0050.
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

-- Ids legibles: cuenta(7) = 50000000-0000-4000-8000-000000000007.
create function pg_temp.cuenta(n int) returns uuid
language sql immutable as $$
  select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Una ruta de foto válida dentro de la carpeta de la cuenta n. El sufijo k
-- distingue una foto de otra.
create function pg_temp.foto(n int, k int default 1) returns text
language sql immutable as $$
  select pg_temp.cuenta(n)::text || '/'
      || ('9b2c1f60-5d3a-4e8b-8a47-' || lpad(k::text, 12, '0')) || '.webp'
$$;

-- cuenta 1 y 2: colaboradoras con ficha · 3: NO marcada · 4: colaboradora
-- que todavía no llenó su ficha.
insert into auth.users (id, raw_user_meta_data)
select pg_temp.cuenta(n), datos
from (values
  (1, '{"nombre": "Valeria", "apellidos": "Núñez"}'::jsonb),
  (2, '{"nombre": "Iván", "apellidos": "Soto"}'),
  (3, '{"nombre": "Begoña", "apellidos": "Ruiz"}'),
  (4, '{"nombre": "Luis", "apellidos": "Paz"}')
) as semilla(n, datos);

\ir ../migrations/0038_colaboradores_publicos.sql

update public.perfiles set es_colaborador = true
 where id in (pg_temp.cuenta(1), pg_temp.cuenta(2), pg_temp.cuenta(4));

\ir ../migrations/0039_fichas_colaborador.sql
\ir ../migrations/0040_modalidad_trabajo_colaborador.sql

insert into public.fichas_colaborador
  (id, puesto, sector, ubicacion, stack, modalidad_trabajo, anio_inicio, bio)
values
  (pg_temp.cuenta(1), 'Analista', 'Financiero', 'Puebla, México',
   array['SQL', 'Python'], 'Híbrido', 2021, 'Una ficha completa y válida.'),
  (pg_temp.cuenta(2), 'Docente', 'Educación', 'Guadalajara, México',
   array['R', 'Excel'], 'Remoto', 2008, 'Enseño estadística desde 2008.');

\ir ../migrations/0041_etiquetas_empresa.sql
\ir ../migrations/0042_sector_opcional.sql
\ir ../migrations/0043_slug_trigger_definer.sql

-- Un bucket ajeno, para probar que las policies de la 0050 no abren nada más.
insert into storage.buckets (id, name) values ('otro', 'otro');

\ir ../migrations/0050_foto_colaborador.sql
-- Idempotente: aplicarla dos veces no debe fallar ni duplicar nada.
\ir ../migrations/0050_foto_colaborador.sql

-- === 1. La columna ===========================================================

select pg_temp.assert_true(
  (select data_type = 'text' and is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public' and table_name = 'fichas_colaborador'
     and column_name = 'foto_path'),
  'foto_path existe, es text y admite null'
);
select pg_temp.assert_true(
  (select foto_path is null from public.fichas_colaborador where id = pg_temp.cuenta(1)),
  'las fichas que ya existían quedan sin foto'
);

-- === 2. El CHECK =============================================================

select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = %L where id = %L',
                       pg_temp.foto(1), pg_temp.cuenta(1))) = 1,
  'una ficha acepta una foto en su propia carpeta'
);
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = null where id = %L',
                       pg_temp.cuenta(1))) = 1,
  'y acepta quitarla (null)'
);

select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         pg_temp.foto(2), pg_temp.cuenta(1)),
  '23514', 'no se puede colgar la foto de la carpeta de otra cuenta');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         replace(pg_temp.foto(1), '.webp', '.png'), pg_temp.cuenta(1)),
  '23514', 'sólo .webp');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         upper(pg_temp.foto(1)), pg_temp.cuenta(1)),
  '23514', 'los uuid van en minúsculas');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         pg_temp.cuenta(1)::text || '/otra/' || split_part(pg_temp.foto(1), '/', 2), pg_temp.cuenta(1)),
  '23514', 'sin subcarpetas');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         pg_temp.foto(1) || E'\n', pg_temp.cuenta(1)),
  '23514', 'sin salto de línea al final');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         '', pg_temp.cuenta(1)),
  '23514', 'la ausencia es null, nunca la cadena vacía');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         'https://example.com/foto.webp', pg_temp.cuenta(1)),
  '23514', 'una URL no es una ruta');

-- === 3. Grants por columna ===================================================

select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.fichas_colaborador', 'foto_path', 'update')
  and not has_column_privilege('authenticated', 'public.fichas_colaborador', 'foto_path', 'insert'),
  'authenticated actualiza foto_path pero no la escribe al crear la ficha'
);
select pg_temp.assert_true(
  (select bool_and(has_column_privilege('authenticated', 'public.fichas_colaborador', columna, 'update'))
   from unnest(array['puesto', 'sector', 'ubicacion', 'herramientas', 'habilidades',
                     'idiomas', 'empresa', 'empresa_enlace', 'modalidad_trabajo',
                     'anio_inicio', 'bio', 'linkedin', 'github', 'correo']) as columna)
  and (select bool_and(has_column_privilege('authenticated', 'public.fichas_colaborador', columna, 'insert'))
      from unnest(array['id', 'puesto', 'sector', 'ubicacion', 'herramientas', 'habilidades',
                        'idiomas', 'empresa', 'empresa_enlace', 'modalidad_trabajo',
                        'anio_inicio', 'bio', 'linkedin', 'github', 'correo']) as columna),
  'el resto de los grants de la 0041 siguen en su lugar'
);
select pg_temp.assert_true(
  not has_column_privilege('anon', 'public.fichas_colaborador', 'foto_path', 'update')
  and not has_column_privilege('anon', 'public.fichas_colaborador', 'foto_path', 'select'),
  'anon no toca foto_path en la tabla'
);

-- La dueña cuelga y quita su foto con la sesión (RLS + grant por columna).
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = %L where id = %L',
                       pg_temp.foto(1), pg_temp.cuenta(1))) = 1,
  'la dueña cuelga su foto'
);
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = %L where id = %L',
                       pg_temp.foto(2), pg_temp.cuenta(2))) = 0,
  'y no toca la ficha de otra cuenta (la RLS no se la deja ver)'
);
reset role;

-- Una colaboradora sin ficha no puede crearla CON foto: foto_path no está en
-- el grant de insert.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(4)::text, false);
set role authenticated;
select pg_temp.assert_raises(
  format('insert into public.fichas_colaborador (id, puesto, herramientas, modalidad_trabajo, anio_inicio, bio, foto_path)
          values (%L, %L, array[%L], %L, 2020, %L, %L)',
         pg_temp.cuenta(4), 'Docente', 'SQL', 'Remoto', 'Una bio válida.', pg_temp.foto(4)),
  '42501', 'una ficha nueva no puede nacer con foto');
reset role;

-- === 4. La RPC pública =======================================================

select pg_temp.assert_true(
  pg_get_function_result('public.listar_colaboradores()'::regprocedure) =
    'TABLE(nombre text, apellidos text, slug text, puesto text, sector text, '
    'ubicacion text, herramientas text[], habilidades text[], idiomas text[], '
    'empresa text, empresa_enlace text, modalidad_trabajo text, '
    'anio_inicio integer, bio text, linkedin text, github text, correo text, '
    'foto_path text)',
  'la RPC devuelve foto_path al final'
);
select pg_temp.assert_true(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig) and p.provolatile = 's'
   from pg_proc p where p.oid = 'public.listar_colaboradores()'::regprocedure),
  'sigue siendo security definer, stable y con search_path vacío'
);
select pg_temp.assert_true(
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute')
  and has_function_privilege('authenticated', 'public.listar_colaboradores()', 'execute')
  and not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.listar_colaboradores()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'los grants de la RPC se reemitieron tras el drop y el revoke from public sigue'
);

set role anon;
select pg_temp.assert_true(
  (select c.foto_path = pg_temp.foto(1) from public.listar_colaboradores() as c where c.slug = 'valeria'),
  'anon recibe la ruta de la foto de quien la tiene'
);
select pg_temp.assert_true(
  (select count(*) = 3 and count(c.foto_path) = 1 from public.listar_colaboradores() as c),
  'las colaboradoras sin foto, con o sin ficha, salen con foto_path en null'
);
reset role;

-- === 5. El bucket ============================================================

select pg_temp.assert_true(
  (select public and file_size_limit = 1048576 and allowed_mime_types = array['image/webp']
   from storage.buckets where id = 'colaboradores-fotos'),
  'el bucket es público, de 1 MB y sólo webp'
);
update storage.buckets
   set public = false, file_size_limit = 1, allowed_mime_types = array['image/png']
 where id = 'colaboradores-fotos';
\ir ../migrations/0050_foto_colaborador.sql
select pg_temp.assert_true(
  (select public and file_size_limit = 1048576 and allowed_mime_types = array['image/webp']
   from storage.buckets where id = 'colaboradores-fotos'),
  'volver a aplicar la migración restituye los ajustes del bucket'
);

-- === 6. Las policies existen y son exactamente tres ==========================

select pg_temp.assert_true(
  (select count(*) = 3 from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'colaboradores_fotos%'),
  'tres policies, sin duplicar tras aplicarla dos veces'
);
select pg_temp.assert_true(
  (select array_agg(cmd order by cmd) = array['DELETE', 'INSERT', 'SELECT'] from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'colaboradores_fotos%'),
  'insertar, ver lo propio y borrar; nada de UPDATE'
);

-- === 7. Subir =================================================================

-- Una colaboradora marcada sube a SU carpeta.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', pg_temp.foto(1, 1));
insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', pg_temp.foto(1, 2));

select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$, pg_temp.foto(2)),
  '42501', 'no sube a la carpeta de otra cuenta');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$,
         replace(pg_temp.foto(1, 3), '.webp', '.png')),
  '42501', 'sólo .webp');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$,
         pg_temp.cuenta(1)::text || '/yo.webp'),
  '42501', 'el nombre tiene que ser un uuid');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$,
         pg_temp.cuenta(1)::text || '/sub/' || split_part(pg_temp.foto(1, 3), '/', 2)),
  '42501', 'sin subcarpetas');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('otro', %L)$$, pg_temp.foto(1, 3)),
  '42501', 'las policies de la 0050 no abren ningún otro bucket');
reset role;

-- Quien NO está marcada no sube ni a su propia carpeta.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(3)::text, false);
set role authenticated;
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$, pg_temp.foto(3)),
  '42501', 'una cuenta sin la marca de colaboradora no sube fotos');
reset role;

-- Sin sesión, tampoco.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$, pg_temp.foto(1, 4)),
  '42501', 'anon no sube fotos');
reset role;

-- Desmarcar a una colaboradora le quita la posibilidad de subir más.
update public.perfiles set es_colaborador = false where id = pg_temp.cuenta(2);
select set_config('request.jwt.claim.sub', pg_temp.cuenta(2)::text, false);
set role authenticated;
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$, pg_temp.foto(2)),
  '42501', 'una colaboradora desmarcada deja de poder subir');
reset role;
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(2);

-- === 8. Nadie lista la carpeta de otra cuenta ================================

select pg_temp.assert_true(
  (select count(*) = 2 from storage.objects where bucket_id = 'colaboradores-fotos'),
  'las dos fotos subidas están en el bucket'
);

-- La dueña sí ve su carpeta, y sólo la suya: es lo que le deja borrar.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(split_part(name, '/', 1) = pg_temp.cuenta(1)::text)
   from storage.objects where bucket_id = 'colaboradores-fotos'),
  'la dueña ve sus dos fotos'
);
reset role;

select set_config('request.jwt.claim.sub', pg_temp.cuenta(2)::text, false);
set role authenticated;
select pg_temp.assert_true(
  (select count(*) = 0 from storage.objects where bucket_id = 'colaboradores-fotos'),
  'otra colaboradora no ve (ni lista) las fotos ajenas'
);
reset role;

set role anon;
select pg_temp.assert_true(
  (select count(*) = 0 from storage.objects where bucket_id = 'colaboradores-fotos'),
  'anon no lista el bucket: las fotos se sirven por su URL pública, no por la RLS'
);
reset role;

-- === 9. Borrar ===============================================================

-- Otra cuenta no borra la foto ajena.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(2)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(format($$delete from storage.objects where bucket_id = 'colaboradores-fotos' and name = %L$$,
                       pg_temp.foto(1, 1))) = 0,
  'otra colaboradora no borra la foto de la primera'
);
reset role;
select pg_temp.assert_true(
  (select count(*) = 2 from storage.objects where bucket_id = 'colaboradores-fotos'),
  'la foto ajena sigue ahí'
);

-- La dueña borra la suya (así retira la anterior al subir otra, o al quitarla).
-- Con un DELETE ... WHERE, Postgres exige también la policy de SELECT: sin ella
-- este delete borraría CERO filas y la foto "quitada" seguiría publicada.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(format($$delete from storage.objects where bucket_id = 'colaboradores-fotos' and name = %L$$,
                       pg_temp.foto(1, 1))) = 1,
  'la dueña borra su foto anterior'
);
reset role;
select pg_temp.assert_true(
  (select count(*) = 1 from storage.objects where bucket_id = 'colaboradores-fotos'),
  'y el archivo ya no está'
);

-- Un objeto se reemplaza por uno nuevo, nunca se edita: no hay UPDATE.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(format($$update storage.objects set name = %L where bucket_id = 'colaboradores-fotos' and name = %L$$,
                       pg_temp.foto(1, 9), pg_temp.foto(1, 2))) = 0,
  'no se puede renombrar ni sobrescribir un objeto'
);
reset role;

select '0050 foto del colaborador PASS' as result;
