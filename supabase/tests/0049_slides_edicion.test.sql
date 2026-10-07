\set ON_ERROR_STOP on

-- La migración y este archivo llevan acentos. Se fija UTF8 para que no dependa
-- de la codificación del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
--
--   createdb taudux_slides_edicion_0049_test
--   psql -d taudux_slides_edicion_0049_test -f supabase/tests/0049_slides_edicion.test.sql
do $guard$
begin
  if current_database() <> 'taudux_slides_edicion_0049_test' then
    raise exception 'Refusing to run outside taudux_slides_edicion_0049_test';
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
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;

-- Lo que Supabase concede por su cuenta: TODO a anon/authenticated en tablas y
-- funciones nuevas de public. Sin reproducirlo, un `revoke` olvidado en la
-- migración pasaría esta prueba y abriría la tabla en producción.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text
);

-- Mismo stand-in de auth.uid() que 0044.test: lee el GUC que PostgREST fija
-- por request, así las policies corren por el camino real bajo `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Un Storage mínimo: lo que la migración toca y nada más. RLS activa en
-- objects, como en Supabase.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
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
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  apellidos text,
  rol text not null default 'usuario'
);
-- Como en producción (0001): los clientes sólo editan nombre y apellidos.
revoke all on public.perfiles from anon, authenticated;
grant select on public.perfiles to authenticated;
grant update (nombre, apellidos) on public.perfiles to authenticated;

create function public.es_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin'
  );
$$;

-- u1: autor · u2: otro autor · u3: administrador · u4: cuenta normal.
\set u1 '''49000000-0000-4000-8000-000000000001'''
\set u2 '''49000000-0000-4000-8000-000000000002'''
\set u3 '''49000000-0000-4000-8000-000000000003'''
\set u4 '''49000000-0000-4000-8000-000000000004'''

insert into auth.users (id, email) values
  (:u1, 'uno@example.com'),
  (:u2, 'dos@example.com'),
  (:u3, 'admin@example.com'),
  (:u4, 'cuatro@example.com');
insert into public.perfiles (id, nombre, apellidos, rol) values
  (:u1, 'Ana', 'Uno', 'usuario'),
  (:u2, 'Beto', 'Dos', 'usuario'),
  (:u3, 'Admin', 'Tres', 'admin'),
  (:u4, 'Cuatro', 'Normal', 'usuario');

\ir ../migrations/0048_slides_subidas.sql
-- Idempotente: aplicarla dos veces no debe fallar ni duplicar nada.
\ir ../migrations/0048_slides_subidas.sql
\ir ../migrations/0049_slides_edicion.sql
-- Idempotente también.
\ir ../migrations/0049_slides_edicion.sql

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

-- Cuántas filas toca una sentencia con el rol actual. La RLS oculta las filas
-- ajenas a un UPDATE/DELETE en vez de fallar: la prueba es que sean cero.
create function pg_temp.filas_afectadas(sentencia text)
returns integer language plpgsql as $f$
declare
  n integer;
begin
  execute sentencia;
  get diagnostics n = row_count;
  return n;
end
$f$;

create function pg_temp.fila(autor uuid, slug text, vis text)
returns text language sql as $f$
  select format(
    'insert into public.slides_subidas
       (slug, titulo, categoria, visibilidad, autor_id, archivo_path, total_laminas)
     values (%L, %L, ''Datos'', %L, %L, %L, 3)',
    slug, 'Título ' || slug, vis, autor, autor::text || '/' || slug || '/index.html')
$f$;

update public.perfiles set es_autor_slides = true where id in (:u1, :u2);

select pg_temp.fila(:u1, 'pub-uno', 'publico') \gset
:fila;
select pg_temp.fila(:u1, 'pub-dos', 'publico') \gset
:fila;
select pg_temp.fila(:u1, 'rev-uno', 'por_revisar') \gset
:fila;
select pg_temp.fila(:u2, 'rev-dos', 'por_revisar') \gset
:fila;
select pg_temp.fila(:u1, 'borrar-uno', 'por_revisar') \gset
:fila;

-- 0. LA COLUMNA NUEVA ------------------------------------------------------------
select pg_temp.assert_true(
  (select count(*) = 5 and min(version_archivo) = 1 and max(version_archivo) = 1
   from public.slides_subidas),
  'las filas arrancan en la versión 1 del archivo');
select pg_temp.assert_raises(
  format($$insert into public.slides_subidas
    (slug, titulo, categoria, visibilidad, autor_id, archivo_path, total_laminas, version_archivo)
    values ('version-cero', 'x', 'Datos', 'admins', %L, %L, 1, 0)$$,
    :u1, :u1 || '/version-cero/index.html'),
  '23514', 'la versión es positiva');
update public.slides_subidas set version_archivo = 3 where slug = 'pub-uno';
select pg_temp.assert_raises(
  $$update public.slides_subidas set version_archivo = 2 where slug = 'pub-uno'$$,
  'P0001', 'la versión del archivo no retrocede');

-- 1. EL AUTOR EDITA LO SUYO Y TERMINA «POR REVISAR» -------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    $$update public.slides_subidas set titulo = 'Título editado', visibilidad = 'publico'
      where slug = 'pub-uno'$$) = 1,
  'el autor edita su presentación pública');
reset role;
select pg_temp.assert_true(
  (select titulo = 'Título editado' and visibilidad = 'por_revisar'
   from public.slides_subidas where slug = 'pub-uno'),
  'aunque mande publico, la edición del autor la deja por_revisar (lo fuerza la base)');

set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    $$update public.slides_subidas set visibilidad = 'publico' where slug = 'rev-uno'$$) = 1,
  'el autor puede intentarlo: la fila es suya');
reset role;
select pg_temp.assert_true(
  (select visibilidad = 'por_revisar' from public.slides_subidas where slug = 'rev-uno'),
  'el autor no se publica a sí mismo ni por UPDATE');

-- 2. LO AJENO NO SE TOCA --------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    $$update public.slides_subidas set titulo = 'Robado' where slug = 'rev-dos'$$) = 0,
  'el autor no ve (ni edita) la fila de otro autor: cero filas');
select pg_temp.assert_true(
  pg_temp.filas_afectadas($$delete from public.slides_subidas where slug = 'rev-dos'$$) = 0,
  'el autor no borra la fila de otro autor');
-- Cambiar de autor: ni a otro autor marcado.
select pg_temp.assert_raises(
  format($$update public.slides_subidas set autor_id = %L,
             archivo_path = %L where slug = 'rev-uno'$$,
    :u2, :u2 || '/rev-uno/index.html'),
  'P0001', 'el autor no cambia el autor de su presentación');
reset role;
select pg_temp.assert_true(
  (select titulo = 'Título rev-dos' from public.slides_subidas where slug = 'rev-dos')
  and (select autor_id = :u1::uuid from public.slides_subidas where slug = 'rev-uno'),
  'lo ajeno y el autor quedaron intactos');

-- 3. EL AUTOR BORRA LO SUYO ------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas($$delete from public.slides_subidas where slug = 'borrar-uno'$$) = 1,
  'el autor borra su presentación');
reset role;
select pg_temp.assert_true(
  (select count(*) = 0 from public.slides_subidas where slug = 'borrar-uno'),
  'la fila ya no existe');

-- 4. UNA CUENTA NORMAL: NADA -------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u4, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    $$update public.slides_subidas set titulo = 'Intruso' where slug = 'pub-dos'$$) = 0,
  'una cuenta normal no edita ni lo público');
select pg_temp.assert_true(
  pg_temp.filas_afectadas($$delete from public.slides_subidas where slug = 'pub-dos'$$) = 0,
  'una cuenta normal no borra');
reset role;
select pg_temp.assert_true(
  (select titulo = 'Título pub-dos' from public.slides_subidas where slug = 'pub-dos'),
  'pub-dos intacta');

-- 5. EL ADMINISTRADOR: VISIBILIDAD Y AUTOR ---------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    $$update public.slides_subidas set visibilidad = 'admins' where slug = 'pub-dos'$$) = 1,
  'el admin cambia la visibilidad');
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    $$update public.slides_subidas set visibilidad = 'publico' where slug = 'rev-uno'$$) = 1,
  'el admin publica');
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$update public.slides_subidas set autor_id = %L, archivo_path = %L
             where slug = 'rev-uno'$$, :u2, :u2 || '/rev-uno/index.html')) = 1,
  'el admin cambia el autor a otro autor marcado, con las rutas que corresponden');
select pg_temp.assert_raises(
  format($$update public.slides_subidas set autor_id = %L, archivo_path = %L
           where slug = 'rev-uno'$$, :u4, :u4 || '/rev-uno/index.html'),
  'P0001', 'el admin no asigna a quien no está marcado');
select pg_temp.assert_raises(
  format($$update public.slides_subidas set autor_id = %L where slug = 'rev-uno'$$, :u1),
  '23514', 'cambiar el autor sin mover las rutas rompe la restricción de ruta');
reset role;
select pg_temp.assert_true(
  (select visibilidad = 'publico' and autor_id = :u2::uuid
   from public.slides_subidas where slug = 'rev-uno')
  and (select visibilidad = 'admins' from public.slides_subidas where slug = 'pub-dos'),
  'el admin conserva la visibilidad que eligió y el autor nuevo quedó');

-- Sin sesión (SQL Editor / service_role) la visibilidad no se fuerza.
select set_config('request.jwt.claim.sub', '', false);
update public.slides_subidas set visibilidad = 'publico' where slug = 'pub-dos';
select pg_temp.assert_true(
  (select visibilidad = 'publico' from public.slides_subidas where slug = 'pub-dos'),
  'quien opera la base sin sesión puede publicar a mano');

-- 6. LA VERSIÓN Y LA PORTADA MUEVEN «ACTUALIZADO» ----------------------------------------------
create temp table antes as
  select actualizado_en from public.slides_subidas where slug = 'pub-dos';
select pg_sleep(0.05);
update public.slides_subidas set categoria = 'Otra', visibilidad = 'admins' where slug = 'pub-dos';
select pg_temp.assert_true(
  (select s.actualizado_en = a.actualizado_en
   from public.slides_subidas s, antes a where s.slug = 'pub-dos'),
  'categoría y visibilidad no la mueven');
update public.slides_subidas set version_archivo = version_archivo + 1 where slug = 'pub-dos';
select pg_temp.assert_true(
  (select s.actualizado_en > a.actualizado_en
   from public.slides_subidas s, antes a where s.slug = 'pub-dos'),
  'subir la versión del archivo mueve actualizado_en');
truncate antes;
insert into antes select actualizado_en from public.slides_subidas where slug = 'pub-dos';
select pg_sleep(0.05);
update public.slides_subidas
  set portada_path = :u1 || '/pub-dos/portada.webp' where slug = 'pub-dos';
select pg_temp.assert_true(
  (select s.actualizado_en > a.actualizado_en
   from public.slides_subidas s, antes a where s.slug = 'pub-dos'),
  'cambiar la portada mueve actualizado_en');
update public.slides_subidas set visibilidad = 'publico' where slug = 'pub-dos';

-- 7. EL CATÁLOGO: version_archivo, es_mio y autor_id acotado --------------------------------------
set role anon;
select pg_temp.assert_true(
  (select count(*) = 2
     and bool_and(autor_id is null)
     and bool_and(es_mio = false)
     and bool_and(version_archivo >= 1)
   from public.catalogo_slides_subidas()),
  'anon: sólo lo público (pub-dos y rev-uno), sin autor_id y sin es_mio');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  (select count(*) filter (where es_mio) >= 1
     and bool_and(case when es_mio then autor_id = :u1::uuid else autor_id is null end)
   from public.catalogo_slides_subidas()),
  'el autor recibe su autor_id sólo en lo suyo; en lo ajeno, null');
select pg_temp.assert_true(
  (select count(*) = 0 from public.catalogo_slides_subidas() where slug = 'rev-dos'),
  'lo por revisar de otro autor no sale');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false);
select pg_temp.assert_true(
  (select bool_and(autor_id is not null) and bool_and(es_mio = false)
   from public.catalogo_slides_subidas()),
  'el admin recibe el autor_id de todo y nada es suyo');
reset role;

-- 8. STORAGE: REEMPLAZAR ARCHIVOS --------------------------------------------------------------------
insert into storage.objects (bucket_id, name) values
  ('slides', :u1 || '/pub-uno/index.html'),     -- fila por_revisar (editada arriba)
  ('slides', :u1 || '/pub-dos/index.html'),     -- fila pública
  ('slides', :u2 || '/rev-dos/index.html');

set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$update storage.objects set bucket_id = 'slides' where name = %L$$,
      :u1 || '/pub-uno/index.html')) = 1,
  'el autor reemplaza su archivo mientras la presentación no es pública');
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$update storage.objects set bucket_id = 'slides' where name = %L$$,
      :u1 || '/pub-dos/index.html')) = 0,
  'el autor no reemplaza el archivo de una presentación PÚBLICA: primero va a revisión');
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$update storage.objects set bucket_id = 'slides' where name = %L$$,
      :u2 || '/rev-dos/index.html')) = 0,
  'el autor no toca la carpeta de otro autor');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', :u4, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$update storage.objects set bucket_id = 'slides' where name = %L$$,
      :u1 || '/pub-uno/index.html')) = 0,
  'una cuenta normal no reemplaza nada');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$update storage.objects set bucket_id = 'slides' where name = %L$$,
      :u1 || '/pub-dos/index.html')) = 1,
  'el admin sí reemplaza cualquier objeto');
reset role;

-- Después de borrar la fila, el autor retira sus archivos (ya no están registrados).
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$delete from storage.objects where name = %L$$, :u1 || '/pub-dos/index.html')) = 0,
  'mientras la fila exista, el autor no borra el archivo registrado');
select pg_temp.assert_true(
  pg_temp.filas_afectadas($$delete from public.slides_subidas where slug = 'pub-dos'$$) = 1,
  'el autor borra la fila de la presentación pública');
select pg_temp.assert_true(
  pg_temp.filas_afectadas(
    format($$delete from storage.objects where name = %L$$, :u1 || '/pub-dos/index.html')) = 1,
  'borrada la fila, el autor retira su archivo');
reset role;

select 'ok: 0049_slides_edicion' as resultado;
