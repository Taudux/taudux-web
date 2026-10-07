-- Slides subidas: administradores y autores suben presentaciones HTML desde la
-- página /slides, públicas o privadas. Hasta ahora todas vivían en el
-- repositorio (src/content/slides/<slug>/).
--
-- QUÉ AGREGA
--
--   · `perfiles.es_autor_slides`: marca de autor, puesta A MANO como
--     `es_colaborador` (0038). Un autor puede subir presentaciones; no es un
--     rol nuevo porque una misma cuenta puede ser administradora Y autora.
--   · el bucket PRIVADO `slides` (HTML y portada de cada presentación).
--   · la tabla `slides_subidas`: una fila por presentación.
--   · funciones para el catálogo, la lista de autores y las categorías.
--
-- VISIBILIDAD
--
--   'publico'      lo lee cualquiera, sin sesión.
--   'admins'       sólo administradores.
--   'por_revisar'  administradores y su autor. Es donde cae TODO lo que sube
--                  un autor que no es administrador; un administrador decide
--                  si pasa a 'publico'.
--
-- QUIÉN ESCRIBE (y lo hace cumplir la RLS, no la interfaz)
--
--   · Administrador: inserta, actualiza y borra lo que sea, con la
--     visibilidad que quiera, y elige el autor (obligatorio, y marcado).
--   · Autor: sólo inserta, sólo con `autor_id = auth.uid()` y sólo
--     'por_revisar'. No actualiza ni borra filas.
--   · Cualquier otra cuenta: nada.
--
-- RUTAS EN EL BUCKET
--
--   <autor_id>/<slug>/index.html
--   <autor_id>/<slug>/portada.webp     (opcional)
--
-- La carpeta es el uuid del autor: la RLS del bucket deja a un autor escribir
-- sólo dentro de la suya. Consecuencia asumida: quien pueda leer la ruta de
-- una presentación pública (el catálogo la entrega, el visor la necesita para
-- descargar el HTML) ve ese uuid. No es una credencial; es la misma llave que
-- `auth.users`, y sólo circula la de quienes ya firman presentaciones
-- públicas. El NOMBRE del autor sí sale del catálogo, nunca otro dato suyo.
--
-- POR QUÉ LA TABLA NO SE LEE DIRECTO DESDE anon
--
-- La RLS filtra filas, no columnas: dejar a anon leer `slides_subidas`
-- entregaría `autor_id` y `subido_por` de cada presentación pública. Por eso
-- anon no tiene ningún grant sobre la tabla y el catálogo sale de
-- `catalogo_slides_subidas()`, `security definer`, que aplica la misma regla
-- de visibilidad y devuelve el nombre del autor y no su id (mismo
-- razonamiento que `listar_colaboradores()` en 0038). Por la misma razón el
-- bucket consulta la tabla a través de funciones `security definer` y no con
-- un `exists` directo.
--
-- CÓMO MARCAR / DESMARCAR UN AUTOR (SQL Editor de Supabase)
--
--   update public.perfiles set es_autor_slides = true
--   where id = '<uuid>' returning nombre, apellidos;
--
--   update public.perfiles set es_autor_slides = false
--   where id = '<uuid>';
--
-- Desmarcar NO borra lo que ya subió esa cuenta: las presentaciones siguen,
-- con su nombre. Sólo le quita la posibilidad de subir más.
--
-- CONSENTIMIENTO
--
-- Marcar a alguien publica su nombre completo al pie de cada presentación
-- pública que firme, visible para cualquiera sin sesión. Pregúntale antes a la
-- persona.
--
-- BORRAR UNA CUENTA
--
-- `autor_id` lleva `on delete cascade`: borrar la cuenta de un autor borra sus
-- filas, pero NO sus archivos del bucket (Supabase no permite borrar objetos
-- con SQL; hay que quitarlos desde Storage). Quedan huérfanos y sin ninguna
-- fila que los haga visibles, salvo para los administradores.
--
-- SECURITY ADVISOR
--
-- Va a señalar las funciones `security definer` ejecutables por anon
-- (`catalogo_slides_subidas`, `categorias_slides`, `slides_ruta_publica`).
-- Es esperado y es su trabajo: saltarse la RLS acotado a lo que cada una
-- devuelve, con `search_path` vacío y sin parámetros que manipular, salvo la
-- ruta de `slides_ruta_publica`, que sólo contesta sí o no.
--
-- CODIFICACIÓN
--
-- Este archivo lleva acentos. El preflight exige `client_encoding = UTF8`
-- (el SQL Editor de Supabase y la CLI ya la usan).
--
-- Aplicar dos veces es seguro: columnas y tabla con `if not exists`, policies
-- y triggers se borran antes de crearse y las funciones son `create or
-- replace`.

begin;

do $preflight$
begin
  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0048 preflight failed: public.perfiles is required (0001)';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0048 preflight failed: public.es_admin() is required (0004)';
  end if;

  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception using
      errcode = 'P0001',
      message = '0048 preflight failed: Supabase Storage is required';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0048 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Marca de autor
-- ---------------------------------------------------------------------------

alter table public.perfiles
  add column if not exists es_autor_slides boolean not null default false;

comment on column public.perfiles.es_autor_slides is
  'Si la cuenta puede subir presentaciones a Slides. Marca operativa puesta a '
  'mano desde el SQL Editor. Publica el nombre completo en las presentaciones '
  'públicas que firme: pedir consentimiento antes. Ver 0048.';

-- Sin grant update a authenticated, a propósito, igual que `es_colaborador`:
-- la 0001 sólo abre nombre, apellidos y telefono por columna. Quien pudiera
-- marcarse se daría permiso de subir archivos.

create or replace function public.es_autor_slides()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select p.es_autor_slides from public.perfiles p where p.id = auth.uid()),
    false
  )
$function$;

-- ---------------------------------------------------------------------------
-- 2. Tabla
-- ---------------------------------------------------------------------------

create table if not exists public.slides_subidas (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  slug          text not null,
  titulo        text not null,
  descripcion   text not null default '',
  categoria     text not null,
  visibilidad   text not null,
  autor_id      uuid not null references public.perfiles (id) on delete cascade,
  archivo_path  text not null,
  portada_path  text,
  total_laminas integer not null,
  subido_por    uuid references public.perfiles (id) on delete set null,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint slides_subidas_slug_key unique (slug),
  constraint slides_subidas_archivo_key unique (archivo_path),
  constraint slides_subidas_slug_formato
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  constraint slides_subidas_titulo_longitud
    check (char_length(titulo) between 1 and 160 and titulo = btrim(titulo)),
  constraint slides_subidas_descripcion_longitud
    check (char_length(descripcion) <= 600),
  constraint slides_subidas_categoria_formato
    check (char_length(categoria) between 1 and 40 and categoria = btrim(categoria)),
  constraint slides_subidas_visibilidad_valida
    check (visibilidad in ('publico', 'admins', 'por_revisar')),
  constraint slides_subidas_total_positivo
    check (total_laminas > 0),
  -- Las rutas se derivan del autor y del slug: la RLS del bucket exige la
  -- misma forma, y así ninguna fila apunta a un objeto de otra carpeta.
  constraint slides_subidas_archivo_ruta
    check (archivo_path = autor_id::text || '/' || slug || '/index.html'),
  constraint slides_subidas_portada_ruta
    check (portada_path is null
      or portada_path = autor_id::text || '/' || slug || '/portada.webp')
);

comment on table public.slides_subidas is
  'Presentaciones HTML subidas desde /slides. Visibilidad publico | admins | '
  'por_revisar. anon no la lee: el catálogo sale de catalogo_slides_subidas(). '
  'Ver 0048.';

alter table public.slides_subidas enable row level security;

-- Supabase concede todo a anon y authenticated en las tablas nuevas: se
-- retira y se abre sólo lo necesario. La RLS decide qué filas.
revoke all on table public.slides_subidas from public, anon, authenticated;
grant select, insert, update, delete on table public.slides_subidas to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------

-- Security definer: el administrador que sube a nombre de otra cuenta no
-- puede leer su fila de `perfiles` por RLS, y el autor tiene que estar marcado
-- sea quien sea el que inserta.
create or replace function public.slides_subidas_validar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' or new.autor_id is distinct from old.autor_id then
    if not exists (
      select 1 from public.perfiles p
      where p.id = new.autor_id and p.es_autor_slides
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'El autor de una presentación tiene que estar marcado como autor de Slides.',
        hint = 'Márcalo con: update public.perfiles set es_autor_slides = true where id = ''<uuid>'';';
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- Lo que el cliente mande en estas columnas no cuenta: las pone el servidor.
    new.subido_por := auth.uid();
    new.creado_en := now();
    new.actualizado_en := now();
    return new;
  end if;

  if new.slug is distinct from old.slug then
    raise exception using
      errcode = 'P0001',
      message = 'El slug de una presentación no cambia: es su dirección.';
  end if;

  new.creado_en := old.creado_en;
  new.subido_por := old.subido_por;

  -- La fecha de «última modificación» sólo se mueve cuando cambia lo que se
  -- ve: el archivo, el título o la descripción. Publicar, cambiar de
  -- categoría o de visibilidad no la toca.
  if new.archivo_path is distinct from old.archivo_path
    or new.titulo is distinct from old.titulo
    or new.descripcion is distinct from old.descripcion
    or new.total_laminas is distinct from old.total_laminas then
    new.actualizado_en := now();
  else
    new.actualizado_en := old.actualizado_en;
  end if;

  return new;
end
$function$;

drop trigger if exists slides_subidas_validar on public.slides_subidas;
create trigger slides_subidas_validar
  before insert or update on public.slides_subidas
  for each row execute function public.slides_subidas_validar();

-- ---------------------------------------------------------------------------
-- 4. RLS de la tabla
-- ---------------------------------------------------------------------------

drop policy if exists slides_subidas_select on public.slides_subidas;
create policy slides_subidas_select
  on public.slides_subidas for select to authenticated
  using (visibilidad = 'publico' or public.es_admin() or autor_id = auth.uid());

drop policy if exists slides_subidas_insert_admin on public.slides_subidas;
create policy slides_subidas_insert_admin
  on public.slides_subidas for insert to authenticated
  with check (public.es_admin());

drop policy if exists slides_subidas_insert_autor on public.slides_subidas;
create policy slides_subidas_insert_autor
  on public.slides_subidas for insert to authenticated
  with check (
    autor_id = auth.uid()
    and visibilidad = 'por_revisar'
    and public.es_autor_slides()
  );

drop policy if exists slides_subidas_update_admin on public.slides_subidas;
create policy slides_subidas_update_admin
  on public.slides_subidas for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

drop policy if exists slides_subidas_delete_admin on public.slides_subidas;
create policy slides_subidas_delete_admin
  on public.slides_subidas for delete to authenticated
  using (public.es_admin());

-- ---------------------------------------------------------------------------
-- 5. Funciones de lectura
-- ---------------------------------------------------------------------------

-- El catálogo que ve quien pregunta: lo público, y además lo privado si es
-- administrador, y lo suyo si es autor. Devuelve el nombre del autor, nunca su
-- id. Las rutas sí salen: el visor las necesita para descargar el HTML.
create or replace function public.catalogo_slides_subidas()
returns table (
  id uuid,
  slug text,
  titulo text,
  descripcion text,
  categoria text,
  visibilidad text,
  total_laminas integer,
  actualizado_en timestamptz,
  autor text,
  archivo_path text,
  portada_path text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.id, s.slug, s.titulo, s.descripcion, s.categoria, s.visibilidad,
         s.total_laminas, s.actualizado_en,
         btrim(concat_ws(' ', p.nombre, p.apellidos)) as autor,
         s.archivo_path, s.portada_path
  from public.slides_subidas s
  join public.perfiles p on p.id = s.autor_id
  where s.visibilidad = 'publico'
     or public.es_admin()
     or s.autor_id = auth.uid()
  order by s.actualizado_en desc, s.slug
$function$;

-- Categorías ya usadas y visibles para quien pregunta, para sugerirlas en el
-- formulario y no terminar con «Datos» y «datos» como dos distintas.
create or replace function public.categorias_slides()
returns table (categoria text)
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct s.categoria
  from public.slides_subidas s
  where s.visibilidad = 'publico'
     or public.es_admin()
     or s.autor_id = auth.uid()
  order by s.categoria
$function$;

-- La lista del formulario del administrador. Para cualquier otra cuenta, vacía.
create or replace function public.listar_autores_slides()
returns table (id uuid, nombre text, apellidos text)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id, p.nombre, p.apellidos
  from public.perfiles p
  where public.es_admin() and p.es_autor_slides
  order by p.nombre, p.apellidos
$function$;

-- Para las policies del bucket. Contestan sí o no sobre UNA ruta; no listan
-- nada.
create or replace function public.slides_ruta_publica(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.slides_subidas s
    where s.visibilidad = 'publico'
      and (s.archivo_path = p_ruta or s.portada_path = p_ruta)
  )
$function$;

create or replace function public.slides_ruta_registrada(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.slides_subidas s
    where s.archivo_path = p_ruta or s.portada_path = p_ruta
  )
$function$;

-- Los privilegios por defecto de Supabase conceden EXECUTE a anon y
-- authenticated directamente: hay que nombrarlos.
revoke all on function public.es_autor_slides() from public, anon, authenticated;
revoke all on function public.catalogo_slides_subidas() from public, anon, authenticated;
revoke all on function public.categorias_slides() from public, anon, authenticated;
revoke all on function public.listar_autores_slides() from public, anon, authenticated;
revoke all on function public.slides_ruta_publica(text) from public, anon, authenticated;
revoke all on function public.slides_ruta_registrada(text) from public, anon, authenticated;
revoke all on function public.slides_subidas_validar() from public, anon, authenticated;

grant execute on function public.es_autor_slides() to authenticated;
grant execute on function public.catalogo_slides_subidas() to anon, authenticated;
grant execute on function public.categorias_slides() to anon, authenticated;
grant execute on function public.listar_autores_slides() to authenticated;
grant execute on function public.slides_ruta_publica(text) to anon, authenticated;
grant execute on function public.slides_ruta_registrada(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Bucket y policies de Storage
-- ---------------------------------------------------------------------------

-- Privado: nada se sirve por URL pública. Se descarga con la sesión (HTML) o
-- con una URL firmada (portada), y la policy de lectura decide quién.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'slides',
  'slides',
  false,
  15728640,
  array['text/html', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = array['text/html', 'image/jpeg', 'image/png', 'image/webp'];

drop policy if exists slides_objetos_select on storage.objects;
create policy slides_objetos_select
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'slides'
    and (
      public.es_admin()
      or split_part(name, '/', 1) = auth.uid()::text
      or public.slides_ruta_publica(name)
    )
  );

-- Un autor sube sólo dentro de su carpeta, con una de las dos formas de ruta
-- que reconoce la tabla, y sólo mientras siga marcado.
drop policy if exists slides_objetos_insert on storage.objects;
create policy slides_objetos_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'slides'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9]+(-[a-z0-9]+)*/(index\.html|portada\.webp)$'
    and (
      public.es_admin()
      or (
        public.es_autor_slides()
        and split_part(name, '/', 1) = auth.uid()::text
      )
    )
  );

drop policy if exists slides_objetos_update on storage.objects;
create policy slides_objetos_update
  on storage.objects for update to authenticated
  using (bucket_id = 'slides' and public.es_admin())
  with check (bucket_id = 'slides' and public.es_admin());

-- El administrador borra lo que sea. El autor sólo puede deshacer SU subida a
-- medias: un archivo que todavía no tiene fila (el insert falló y hay que
-- retirarlo). Uno ya registrado sólo lo borra un administrador.
drop policy if exists slides_objetos_delete on storage.objects;
create policy slides_objetos_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'slides'
    and (
      public.es_admin()
      or (
        public.es_autor_slides()
        and split_part(name, '/', 1) = auth.uid()::text
        and not public.slides_ruta_registrada(name)
      )
    )
  );

commit;
