\set ON_ERROR_STOP on

-- La migración y este archivo llevan acentos, y la 0050 y la 0051 exigen client_encoding
-- UTF8 en su preflight. Se fija aquí para no depender del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
--
--   createdb taudux_foto_colaborador_0051_test
--   psql -d taudux_foto_colaborador_0051_test -f supabase/tests/0051_foto_colaborador_jpeg.test.sql
do $guard$
begin
  if current_database() <> 'taudux_foto_colaborador_0051_test' then
    raise exception 'Refusing to run outside taudux_foto_colaborador_0051_test';
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

-- Un bucket ajeno, para probar que las policies no abren nada más.
insert into storage.buckets (id, name) values ('otro', 'otro');

\ir ../migrations/0050_foto_colaborador.sql
-- Idempotente: aplicarla dos veces no debe fallar ni duplicar nada.
\ir ../migrations/0050_foto_colaborador.sql

-- Una ruta .jpg válida dentro de la carpeta de la cuenta n (misma forma que
-- pg_temp.foto, con la extensión nueva).
create function pg_temp.foto_jpg(n int, k int default 1) returns text
language sql immutable as $$
  select replace(pg_temp.foto(n, k), '.webp', '.jpg')
$$;

-- === 0. Antes de la 0051: la 0050 sólo deja .webp ============================

select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         pg_temp.foto_jpg(1), pg_temp.cuenta(1)),
  '23514', 'con la 0050 sola, .jpg no pasa el CHECK');
select pg_temp.assert_true(
  (select allowed_mime_types = array['image/webp'] from storage.buckets where id = 'colaboradores-fotos'),
  'con la 0050 sola, el bucket sólo admite webp'
);

\ir ../migrations/0051_foto_colaborador_jpeg.sql
-- Idempotente: aplicarla dos veces no debe fallar ni duplicar nada.
\ir ../migrations/0051_foto_colaborador_jpeg.sql

-- === 1. El CHECK =============================================================

select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = %L where id = %L',
                       pg_temp.foto(1), pg_temp.cuenta(1))) = 1,
  'sigue aceptando .webp'
);
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = %L where id = %L',
                       pg_temp.foto_jpg(1), pg_temp.cuenta(1))) = 1,
  'ahora acepta .jpg en la carpeta propia'
);
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = null where id = %L',
                       pg_temp.cuenta(1))) = 1,
  'y sigue aceptando quitarla (null)'
);

select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         pg_temp.foto_jpg(2), pg_temp.cuenta(1)),
  '23514', 'un .jpg tampoco cuelga de la carpeta de otra cuenta');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         replace(pg_temp.foto(1), '.webp', '.png'), pg_temp.cuenta(1)),
  '23514', '.png sigue sin pasar');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         replace(pg_temp.foto(1), '.webp', '.jpeg'), pg_temp.cuenta(1)),
  '23514', 'la extensión es .jpg, no .jpeg');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         upper(pg_temp.foto_jpg(1)), pg_temp.cuenta(1)),
  '23514', 'los uuid y la extensión van en minúsculas');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         pg_temp.foto_jpg(1) || E'\n', pg_temp.cuenta(1)),
  '23514', 'sin salto de línea al final');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         pg_temp.cuenta(1)::text || '/otra/' || split_part(pg_temp.foto_jpg(1), '/', 2), pg_temp.cuenta(1)),
  '23514', 'sin subcarpetas');
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set foto_path = %L where id = %L',
         '', pg_temp.cuenta(1)),
  '23514', 'la ausencia sigue siendo null, nunca la cadena vacía');

select pg_temp.assert_true(
  (select count(*) = 1 from pg_constraint
   where conrelid = 'public.fichas_colaborador'::regclass
     and conname = 'fichas_colaborador_foto_path_valida'),
  'un solo CHECK de foto_path, sin duplicar tras aplicarla dos veces'
);
select pg_temp.assert_true(
  (select col_description('public.fichas_colaborador'::regclass, a.attnum) like '%.jpg%'
   from pg_attribute a
   where a.attrelid = 'public.fichas_colaborador'::regclass and a.attname = 'foto_path'),
  'el comentario de la columna menciona .jpg'
);

-- La dueña cuelga un .jpg con su sesión (RLS + grant por columna).
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(format('update public.fichas_colaborador set foto_path = %L where id = %L',
                       pg_temp.foto_jpg(1), pg_temp.cuenta(1))) = 1,
  'la dueña cuelga su foto .jpg'
);
reset role;

-- La RPC pública devuelve la ruta tal cual, con la extensión que tenga.
set role anon;
select pg_temp.assert_true(
  (select c.foto_path = pg_temp.foto_jpg(1) from public.listar_colaboradores() as c where c.slug = 'valeria'),
  'anon recibe la ruta .jpg de quien la tiene'
);
reset role;

-- === 2. El bucket ============================================================

select pg_temp.assert_true(
  (select public and file_size_limit = 1048576
          and allowed_mime_types = array['image/webp', 'image/jpeg']
   from storage.buckets where id = 'colaboradores-fotos'),
  'el bucket es público, de 1 MB y admite webp y jpeg'
);
update storage.buckets
   set public = false, file_size_limit = 1, allowed_mime_types = array['image/png']
 where id = 'colaboradores-fotos';
\ir ../migrations/0051_foto_colaborador_jpeg.sql
select pg_temp.assert_true(
  (select public and file_size_limit = 1048576
          and allowed_mime_types = array['image/webp', 'image/jpeg']
   from storage.buckets where id = 'colaboradores-fotos'),
  'volver a aplicar la migración restituye los ajustes del bucket'
);

-- === 3. Las policies siguen siendo exactamente tres ==========================

select pg_temp.assert_true(
  (select count(*) = 3 from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'colaboradores_fotos%'),
  'tres policies, sin duplicar tras aplicar la 0050 y la 0051 dos veces'
);
select pg_temp.assert_true(
  (select array_agg(cmd order by cmd) = array['DELETE', 'INSERT', 'SELECT'] from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'colaboradores_fotos%'),
  'insertar, ver lo propio y borrar; nada de UPDATE'
);

-- === 4. Subir ================================================================

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', pg_temp.foto(1, 1));
insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', pg_temp.foto_jpg(1, 2));

select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$, pg_temp.foto_jpg(2)),
  '42501', 'un .jpg no sube a la carpeta de otra cuenta');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$,
         replace(pg_temp.foto(1, 3), '.webp', '.png')),
  '42501', '.png sigue sin pasar');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$,
         replace(pg_temp.foto(1, 3), '.webp', '.jpeg')),
  '42501', 'la extensión es .jpg, no .jpeg');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$,
         pg_temp.cuenta(1)::text || '/yo.jpg'),
  '42501', 'el nombre tiene que ser un uuid');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$,
         pg_temp.cuenta(1)::text || '/sub/' || split_part(pg_temp.foto_jpg(1, 3), '/', 2)),
  '42501', 'sin subcarpetas');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('otro', %L)$$, pg_temp.foto_jpg(1, 3)),
  '42501', 'las policies no abren ningún otro bucket');
reset role;

-- Quien NO está marcada no sube ni un .jpg a su propia carpeta.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(3)::text, false);
set role authenticated;
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$, pg_temp.foto_jpg(3)),
  '42501', 'una cuenta sin la marca de colaboradora no sube fotos');
reset role;

-- Sin sesión, tampoco.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('colaboradores-fotos', %L)$$, pg_temp.foto_jpg(1, 4)),
  '42501', 'anon no sube fotos');
reset role;

-- === 5. Ver y borrar =========================================================

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(split_part(name, '/', 1) = pg_temp.cuenta(1)::text)
   from storage.objects where bucket_id = 'colaboradores-fotos'),
  'la dueña ve sus dos fotos, la .webp y la .jpg'
);
reset role;

select set_config('request.jwt.claim.sub', pg_temp.cuenta(2)::text, false);
set role authenticated;
select pg_temp.assert_true(
  (select count(*) = 0 from storage.objects where bucket_id = 'colaboradores-fotos'),
  'otra colaboradora no ve las fotos ajenas'
);
select pg_temp.assert_true(
  pg_temp.filas(format($$delete from storage.objects where bucket_id = 'colaboradores-fotos' and name = %L$$,
                       pg_temp.foto_jpg(1, 2))) = 0,
  'otra colaboradora no borra el .jpg de la primera'
);
reset role;

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(format($$delete from storage.objects where bucket_id = 'colaboradores-fotos' and name = %L$$,
                       pg_temp.foto_jpg(1, 2))) = 1,
  'la dueña borra su .jpg'
);
select pg_temp.assert_true(
  pg_temp.filas(format($$delete from storage.objects where bucket_id = 'colaboradores-fotos' and name = %L$$,
                       pg_temp.foto(1, 1))) = 1,
  'y su .webp anterior, que la 0051 no rompió'
);
reset role;
select pg_temp.assert_true(
  (select count(*) = 0 from storage.objects where bucket_id = 'colaboradores-fotos'),
  'el bucket queda vacío'
);

select '0051 foto del colaborador JPEG PASS' as result;

