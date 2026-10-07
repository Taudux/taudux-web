\set ON_ERROR_STOP on

-- La migración y este archivo llevan acentos. Se fija UTF8 para que no dependa
-- de la codificación del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
--
--   createdb taudux_slides_subidas_0048_test
--   psql -d taudux_slides_subidas_0048_test -f supabase/tests/0048_slides_subidas.test.sql
do $guard$
begin
  if current_database() <> 'taudux_slides_subidas_0048_test' then
    raise exception 'Refusing to run outside taudux_slides_subidas_0048_test';
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

-- u1: autor · u2: otro autor · u3: administrador · u4: cuenta normal ·
-- u5: cuenta normal que NO es autor y sube a su propia carpeta.
\set u1 '''48000000-0000-4000-8000-000000000001'''
\set u2 '''48000000-0000-4000-8000-000000000002'''
\set u3 '''48000000-0000-4000-8000-000000000003'''
\set u4 '''48000000-0000-4000-8000-000000000004'''

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

-- Inserta una fila con las rutas bien formadas. Como `autor` y `vis`, que es
-- lo que cambia entre casos.
create function pg_temp.fila(autor uuid, slug text, vis text, cat text default 'Datos')
returns text language sql as $f$
  select format(
    'insert into public.slides_subidas
       (slug, titulo, categoria, visibilidad, autor_id, archivo_path, total_laminas)
     values (%L, %L, %L, %L, %L, %L, 3)',
    slug, 'Título ' || slug, cat, vis, autor, autor::text || '/' || slug || '/index.html')
$f$;

-- Marcar autor desde el SQL Editor (superusuario), como dice la cabecera.
update public.perfiles set es_autor_slides = true where id in (:u1, :u2);

-- 0. LA CONFIGURACIÓN DEL BUCKET -------------------------------------------------
select pg_temp.assert_true(
  (select not public and file_size_limit = 15728640
     and allowed_mime_types @> array['text/html', 'image/webp']
     and cardinality(allowed_mime_types) = 4
   from storage.buckets where id = 'slides'),
  'el bucket slides es privado, de 15 MB y sólo HTML e imágenes');

-- 1. EL AUTOR TIENE QUE ESTAR MARCADO, SEA QUIEN SEA QUIEN INSERTA -----------------
select pg_temp.assert_raises(pg_temp.fila(:u4, 'no-marcado', 'admins'),
  'P0001', 'ni siquiera el superusuario asigna a un autor sin marcar');

-- 2. ANON: SÓLO LO PÚBLICO, Y SÓLO POR EL CATÁLOGO ---------------------------------
select pg_temp.fila(:u1, 'publica-uno', 'publico') \gset
:fila;
select pg_temp.fila(:u1, 'privada-admin', 'admins', 'Privadas') \gset
:fila;
select pg_temp.fila(:u1, 'revisar-uno', 'por_revisar', 'Revisión') \gset
:fila;
select pg_temp.fila(:u2, 'revisar-dos', 'por_revisar', 'Otra') \gset
:fila;

set role anon;
select pg_temp.assert_raises('select * from public.slides_subidas', '42501',
  'anon no lee la tabla: entregaría autor_id');
select pg_temp.assert_true(
  (select count(*) = 1 and min(slug) = 'publica-uno' and min(autor) = 'Ana Uno'
   from public.catalogo_slides_subidas()),
  'anon ve por el catálogo sólo la pública, con el nombre del autor');
select pg_temp.assert_true(
  (select count(*) = 1 and min(categoria) = 'Datos' from public.categorias_slides()),
  'anon sólo ve la categoría de lo público');
select pg_temp.assert_raises('select * from public.listar_autores_slides()', '42501',
  'anon no ejecuta listar_autores_slides');
select pg_temp.assert_raises('select public.es_autor_slides()', '42501',
  'anon no ejecuta es_autor_slides');
select pg_temp.assert_raises(pg_temp.fila(:u1, 'de-anon', 'publico'), '42501',
  'anon no inserta');
select pg_temp.assert_true(
  (select not (to_jsonb(c) ? 'autor_id') from public.catalogo_slides_subidas() c limit 1),
  'el catálogo no trae autor_id');
reset role;

-- 3. UN AUTOR: LO SUYO Y LO PÚBLICO, NO LO PRIVADO AJENO ---------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  (select count(*) = 3 from public.catalogo_slides_subidas()),
  'el autor ve lo público y SUS filas (privada-admin y revisar-uno), no revisar-dos');
select pg_temp.assert_true(
  (select count(*) = 3 from public.slides_subidas),
  'por la tabla, el mismo recorte por RLS');
select pg_temp.assert_true(
  (select not exists (select 1 from public.slides_subidas where slug = 'revisar-dos')),
  'el autor no ve lo del otro autor');
select pg_temp.assert_true(public.es_autor_slides(), 'u1 es autor');
select pg_temp.assert_true(
  (select count(*) = 0 from public.listar_autores_slides()),
  'un autor no recibe la lista de autores');

-- Inserta como él y por_revisar: sí.
select pg_temp.fila(:u1, 'mia-nueva', 'por_revisar') \gset
:fila;
-- Como el otro: no. Público: no. 'admins': no.
select pg_temp.assert_raises(pg_temp.fila(:u2, 'a-nombre-de-otro', 'por_revisar'), '42501',
  'un autor no sube a nombre de otro');
select pg_temp.assert_raises(pg_temp.fila(:u1, 'me-publico', 'publico'), '42501',
  'un autor no se publica a sí mismo');
select pg_temp.assert_raises(pg_temp.fila(:u1, 'me-privatizo', 'admins'), '42501',
  'un autor sólo sube por_revisar');
-- No edita ni borra: la RLS le oculta la fila a UPDATE/DELETE (cero filas).
update public.slides_subidas set visibilidad = 'publico' where slug = 'mia-nueva';
delete from public.slides_subidas where slug = 'mia-nueva';
reset role;
select pg_temp.assert_true(
  (select visibilidad = 'por_revisar' from public.slides_subidas where slug = 'mia-nueva'),
  'el autor no pudo publicar su propia fila ni borrarla');

-- 4. UNA CUENTA NORMAL: NADA -------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u4, false);
select pg_temp.assert_true(not public.es_autor_slides(), 'u4 no es autor');
select pg_temp.assert_true(
  (select count(*) = 1 from public.catalogo_slides_subidas()),
  'una cuenta normal ve sólo lo público');
-- El trigger de validación corre antes que la RLS: sin marca de autor ni
-- siquiera llega a ella.
select pg_temp.assert_raises(pg_temp.fila(:u4, 'intruso', 'por_revisar'), 'P0001',
  'una cuenta normal no inserta');
select pg_temp.assert_raises(pg_temp.fila(:u1, 'intruso-2', 'por_revisar'), '42501',
  'ni a nombre de un autor');
reset role;

-- 5. EL ADMINISTRADOR: TODO, CON AUTOR MARCADO ------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false);
select pg_temp.assert_true(
  (select count(*) = 5 from public.catalogo_slides_subidas()),
  'el admin ve todo');
select pg_temp.assert_true(
  (select count(*) = 2 and array_agg(nombre order by nombre) = array['Ana', 'Beto']::text[]
   from public.listar_autores_slides()),
  'el admin recibe sólo a los autores marcados');
select pg_temp.assert_true(
  (select count(*) = 4 from public.categorias_slides()),
  'el admin ve todas las categorías');
select pg_temp.fila(:u2, 'del-admin', 'admins') \gset
:fila;
select pg_temp.assert_raises(pg_temp.fila(:u4, 'a-un-no-autor', 'admins'), 'P0001',
  'el admin no puede asignar como autor a quien no está marcado');
update public.slides_subidas set visibilidad = 'publico' where slug = 'revisar-uno';
select pg_temp.assert_true(
  (select visibilidad = 'publico' from public.slides_subidas where slug = 'revisar-uno'),
  'el admin publica lo por revisar');
reset role;

-- 6. LAS RESTRICCIONES Y LOS TRIGGERS ----------------------------------------------
select pg_temp.assert_raises(pg_temp.fila(:u1, 'Mayúsculas', 'admins'), '23514',
  'el slug es kebab-case');
select pg_temp.assert_raises(pg_temp.fila(:u1, 'publica-uno', 'admins'), '23505',
  'el slug es único');
select pg_temp.assert_raises(pg_temp.fila(:u1, 'sin-categoria', 'admins', ' '), '23514',
  'la categoría no puede ser sólo espacios');
select pg_temp.assert_raises(
  format($$insert into public.slides_subidas
    (slug, titulo, categoria, visibilidad, autor_id, archivo_path, total_laminas)
    values ('ruta-ajena', 'x', 'Datos', 'admins', %L, %L, 1)$$,
    :u1, :u2 || '/ruta-ajena/index.html'),
  '23514', 'la ruta del archivo tiene que ser la del autor y el slug');
select pg_temp.assert_raises(
  format($$insert into public.slides_subidas
    (slug, titulo, categoria, visibilidad, autor_id, archivo_path, total_laminas)
    values ('sin-laminas', 'x', 'Datos', 'admins', %L, %L, 0)$$,
    :u1, :u1 || '/sin-laminas/index.html'),
  '23514', 'una presentación tiene al menos una lámina');

-- La fecha de última modificación sólo se mueve con el contenido.
update public.slides_subidas set actualizado_en = '2020-01-01' where slug = 'del-admin';
select pg_temp.assert_true(
  (select actualizado_en > '2020-01-02' from public.slides_subidas where slug = 'del-admin'),
  'el cliente no fija actualizado_en');
create temp table antes as
  select actualizado_en from public.slides_subidas where slug = 'del-admin';
select pg_sleep(0.05);
update public.slides_subidas set categoria = 'Otra categoría', visibilidad = 'publico'
  where slug = 'del-admin';
select pg_temp.assert_true(
  (select s.actualizado_en = a.actualizado_en
   from public.slides_subidas s, antes a where s.slug = 'del-admin'),
  'cambiar categoría o visibilidad no mueve la última modificación');
update public.slides_subidas set titulo = 'Título nuevo' where slug = 'del-admin';
select pg_temp.assert_true(
  (select s.actualizado_en > a.actualizado_en
   from public.slides_subidas s, antes a where s.slug = 'del-admin'),
  'cambiar el título sí la mueve');
select pg_temp.assert_raises(
  $$update public.slides_subidas set slug = 'otro' where slug = 'del-admin'$$,
  'P0001', 'el slug no cambia');

-- subido_por lo pone el servidor, no el cliente.
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false);
insert into public.slides_subidas
  (slug, titulo, categoria, visibilidad, autor_id, archivo_path, total_laminas, subido_por)
values ('firma', 'Firma', 'Datos', 'admins', :u1, :u1 || '/firma/index.html', 1, :u2);
reset role;
select pg_temp.assert_true(
  (select subido_por = :u3::uuid from public.slides_subidas where slug = 'firma'),
  'subido_por es quien insertó, no lo que mandó el cliente');

-- 7. EL BUCKET -----------------------------------------------------------------------
-- Objetos de ejemplo, escritos como el superusuario.
insert into storage.objects (bucket_id, name) values
  ('slides', :u1 || '/publica-uno/index.html'),
  ('slides', :u1 || '/privada-admin/index.html'),
  ('slides', :u2 || '/revisar-dos/index.html');

-- Sin sesión: el GUC de la última cuenta no puede colarse a anon.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.assert_true(
  (select count(*) = 1 and min(name) = :u1 || '/publica-uno/index.html'
   from storage.objects where bucket_id = 'slides'),
  'anon descarga sólo el HTML de lo público');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false);
select pg_temp.assert_true(
  (select count(*) = 2 from storage.objects where bucket_id = 'slides'),
  'el autor ve lo público y lo de su carpeta, no la carpeta de otro autor');
-- Sube a su carpeta: sí. A la de otro, con otra forma, o con otro nombre: no.
insert into storage.objects (bucket_id, name) values ('slides', :u1 || '/mia-nueva/index.html');
insert into storage.objects (bucket_id, name) values ('slides', :u1 || '/mia-nueva/portada.webp');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('slides', %L)$$, :u2 || '/x/index.html'),
  '42501', 'un autor no escribe en la carpeta de otro');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('slides', %L)$$, :u1 || '/x/otra-cosa.html'),
  '42501', 'sólo index.html y portada.webp');
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('slides', %L)$$, :u1 || '/../x/index.html'),
  '42501', 'sin rutas con ..');
-- Su subida a medias (sin fila) la puede retirar; lo ya registrado, no.
delete from storage.objects where bucket_id = 'slides' and name = :u1 || '/mia-nueva/portada.webp';
delete from storage.objects where bucket_id = 'slides' and name = :u1 || '/publica-uno/index.html';
-- Tampoco edita objetos.
update storage.objects set name = :u1 || '/zzz/index.html' where name = :u1 || '/mia-nueva/index.html';
reset role;
select pg_temp.assert_true(
  (select count(*) = 1 from storage.objects where name = :u1 || '/publica-uno/index.html')
  and (select count(*) = 0 from storage.objects where name = :u1 || '/mia-nueva/portada.webp')
  and (select count(*) = 1 from storage.objects where name = :u1 || '/mia-nueva/index.html'),
  'el autor retiró lo suyo sin registrar y no pudo tocar lo registrado ni renombrar');

-- Una cuenta normal no escribe en el bucket ni siquiera en su propia carpeta.
set role authenticated;
select set_config('request.jwt.claim.sub', :u4, false);
select pg_temp.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('slides', %L)$$, :u4 || '/mio/index.html'),
  '42501', 'quien no es autor no sube archivos ni a su propia carpeta');
reset role;

-- El administrador escribe en cualquier carpeta y borra lo que sea.
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false);
insert into storage.objects (bucket_id, name) values ('slides', :u2 || '/del-admin/index.html');
select pg_temp.assert_true(
  (select count(*) = 5 from storage.objects where bucket_id = 'slides'),
  'el admin ve todos los objetos');
delete from storage.objects where name = :u2 || '/del-admin/index.html';
reset role;
select pg_temp.assert_true(
  (select count(*) = 0 from storage.objects where name = :u2 || '/del-admin/index.html'),
  'el admin borra objetos');

-- 8. LA MARCA DE AUTOR NO SE PUEDE PONER DESDE EL CLIENTE --------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :u4, false);
select pg_temp.assert_raises(
  $$update public.perfiles set es_autor_slides = true$$,
  '42501', 'un usuario no se marca a sí mismo como autor');
reset role;

select 'ok: 0048_slides_subidas' as resultado;
