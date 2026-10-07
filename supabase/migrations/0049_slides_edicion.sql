-- Slides: editar y borrar presentaciones subidas (0048).
--
-- QUÉ AGREGA
--
--   · `version_archivo`: contador que sube cada vez que se reemplaza el HTML.
--     El visor lo pone en la URL de descarga (`?v=N`): Storage sirve el archivo
--     con `cache-control: max-age=3600` y, sin la versión en la URL, el
--     navegador conservaría el HTML viejo hasta una hora después de reemplazarlo.
--   · el autor puede EDITAR y BORRAR sus propias presentaciones (0048 sólo le
--     dejaba subirlas).
--   · `catalogo_slides_subidas()` entrega además `version_archivo`, `es_mio` y
--     `autor_id` (este último sólo a un administrador o al propio autor).
--
-- QUIÉN ESCRIBE (y lo hace cumplir la base, no la interfaz)
--
--   · Administrador: lo mismo que en 0048, y además puede cambiar de autor una
--     presentación (los archivos se mueven a la carpeta del nuevo autor).
--   · Autor (marcado): edita y borra SÓLO las suyas. No cambia de autor y no
--     elige visibilidad: CUALQUIER edición de una cuenta que no es
--     administradora deja la fila en 'por_revisar', aunque mande 'publico'. Lo
--     fuerza el trigger, no el cliente. Lo que estaba público deja de verse
--     hasta que un administrador lo vuelva a publicar.
--   · Cualquier otra cuenta: nada.
--
-- EL TRIGGER Y LAS CUENTAS SIN SESIÓN
--
-- El trigger sólo fuerza 'por_revisar' y rechaza el cambio de autor cuando hay
-- una sesión (`auth.uid()` no es null) que no es administradora. El SQL Editor
-- y `service_role` no tienen `auth.uid()`: ahí manda quien opera la base y
-- puede publicar a mano, como hasta ahora.
--
-- STORAGE
--
-- Reemplazar el HTML o la portada es un `upsert`, que necesita policy de
-- UPDATE sobre los objetos: se abre al autor dentro de su carpeta y con las
-- mismas dos formas de ruta que acepta el insert. Para que un autor no pueda
-- cambiar a escondidas el archivo de una presentación PÚBLICA (saltándose la
-- revisión), esa policy no le deja tocar rutas hoy públicas: primero la fila
-- pasa a 'por_revisar' (lo hace el cliente antes de subir) y recién entonces
-- puede reemplazar el archivo.
--
-- Borrar: el autor borra la fila y luego sus archivos. La policy de borrado de
-- objetos de 0048 ya se lo permite cuando la ruta dejó de estar registrada.
--
-- Aplicar dos veces es seguro: columna con `if not exists`, policies que se
-- borran antes de crearse, funciones `create or replace` y el catálogo se
-- recrea con `drop function if exists` (cambia su tipo de retorno).

begin;

do $preflight$
begin
  if to_regclass('public.slides_subidas') is null then
    raise exception using
      errcode = 'P0001',
      message = '0049 preflight failed: public.slides_subidas is required (0048)';
  end if;

  if to_regprocedure('public.es_autor_slides()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0049 preflight failed: public.es_autor_slides() is required (0048)';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0049 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Versión del archivo
-- ---------------------------------------------------------------------------

alter table public.slides_subidas
  add column if not exists version_archivo integer not null default 1;

alter table public.slides_subidas
  drop constraint if exists slides_subidas_version_positiva;
alter table public.slides_subidas
  add constraint slides_subidas_version_positiva check (version_archivo > 0);

comment on column public.slides_subidas.version_archivo is
  'Sube en uno cada vez que se reemplaza el HTML. Va en la URL de descarga '
  '(?v=N) para saltarse la caché del navegador. Ver 0049.';

-- ---------------------------------------------------------------------------
-- 2. Trigger de validación
-- ---------------------------------------------------------------------------

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

  -- Una cuenta con sesión que no es administradora (el autor editando lo
  -- suyo) no cambia de autor y no decide la visibilidad: toda edición vuelve
  -- a revisión. Sin sesión (SQL Editor, service_role) no se aplica.
  if auth.uid() is not null and not public.es_admin() then
    if new.autor_id is distinct from old.autor_id then
      raise exception using
        errcode = 'P0001',
        message = 'Sólo un administrador puede cambiar el autor de una presentación.';
    end if;
    new.visibilidad := 'por_revisar';
  end if;

  if new.version_archivo < old.version_archivo then
    raise exception using
      errcode = 'P0001',
      message = 'La versión del archivo no retrocede.';
  end if;

  new.creado_en := old.creado_en;
  new.subido_por := old.subido_por;

  -- La fecha de «última modificación» sólo se mueve cuando cambia lo que se
  -- ve: el archivo (o su versión), la portada, el título o la descripción.
  -- Publicar, cambiar de categoría o de visibilidad no la toca.
  if new.archivo_path is distinct from old.archivo_path
    or new.version_archivo is distinct from old.version_archivo
    or new.portada_path is distinct from old.portada_path
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

revoke all on function public.slides_subidas_validar() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS de la tabla: el autor edita y borra lo suyo
-- ---------------------------------------------------------------------------

drop policy if exists slides_subidas_update_autor on public.slides_subidas;
create policy slides_subidas_update_autor
  on public.slides_subidas for update to authenticated
  using (autor_id = auth.uid() and public.es_autor_slides())
  with check (autor_id = auth.uid() and visibilidad = 'por_revisar');

drop policy if exists slides_subidas_delete_autor on public.slides_subidas;
create policy slides_subidas_delete_autor
  on public.slides_subidas for delete to authenticated
  using (autor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Storage: reemplazar archivos en la carpeta propia
-- ---------------------------------------------------------------------------

drop policy if exists slides_objetos_update_autor on storage.objects;
create policy slides_objetos_update_autor
  on storage.objects for update to authenticated
  using (
    bucket_id = 'slides'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9]+(-[a-z0-9]+)*/(index\.html|portada\.webp)$'
    and public.es_autor_slides()
    and split_part(name, '/', 1) = auth.uid()::text
    and not public.slides_ruta_publica(name)
  )
  with check (
    bucket_id = 'slides'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9]+(-[a-z0-9]+)*/(index\.html|portada\.webp)$'
    and public.es_autor_slides()
    and split_part(name, '/', 1) = auth.uid()::text
    and not public.slides_ruta_publica(name)
  );

-- ---------------------------------------------------------------------------
-- 5. Catálogo con versión, «es mío» y autor_id acotado
-- ---------------------------------------------------------------------------

-- Cambia el tipo de retorno: `create or replace` no alcanza.
drop function if exists public.catalogo_slides_subidas();

-- `autor_id` sólo sale para quien ya puede leer la fila entera por RLS (un
-- administrador, o el propio autor): para anon y para el resto es null. El
-- formulario lo usa para preseleccionar al autor.
create function public.catalogo_slides_subidas()
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
  portada_path text,
  version_archivo integer,
  es_mio boolean,
  autor_id uuid
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.id, s.slug, s.titulo, s.descripcion, s.categoria, s.visibilidad,
         s.total_laminas, s.actualizado_en,
         btrim(concat_ws(' ', p.nombre, p.apellidos)) as autor,
         s.archivo_path, s.portada_path,
         s.version_archivo,
         coalesce(s.autor_id = auth.uid(), false) as es_mio,
         case when public.es_admin() or s.autor_id = auth.uid()
              then s.autor_id end as autor_id
  from public.slides_subidas s
  join public.perfiles p on p.id = s.autor_id
  where s.visibilidad = 'publico'
     or public.es_admin()
     or s.autor_id = auth.uid()
  order by s.actualizado_en desc, s.slug
$function$;

revoke all on function public.catalogo_slides_subidas() from public, anon, authenticated;
grant execute on function public.catalogo_slides_subidas() to anon, authenticated;

commit;
