-- Foto del colaborador: cada ficha puede colgar una foto cuadrada que se
-- publica en /colaboradores (tarjeta, vista previa y perfil).
--
-- QUÉ AGREGA
--
--   · `fichas_colaborador.foto_path`: la ruta de la foto dentro del bucket,
--     nula mientras la persona no haya subido ninguna.
--   · el bucket PÚBLICO `colaboradores-fotos` (sólo WebP, 1 MB por archivo).
--   · tres policies en `storage.objects`: insertar, ver y borrar lo PROPIO.
--   · `listar_colaboradores()` devuelve `foto_path` al final.
--
-- RUTAS EN EL BUCKET
--
--   <user_id>/<uuid>.webp
--
-- La carpeta es el uuid de la cuenta y la RLS deja escribir sólo dentro de la
-- propia. El CHECK de `foto_path` repite la forma de la ruta Y exige que la
-- carpeta sea el id de la ficha: nadie puede colgar de su ficha el archivo de
-- otra cuenta aunque conozca la ruta.
--
-- POR QUÉ UN NOMBRE NUEVO POR FOTO
--
-- Storage sirve los objetos públicos con `cache-control: max-age=3600` y los
-- navegadores (y el CDN) los guardan. Si la foto nueva reusara la ruta de la
-- vieja, durante una hora cada visitante vería la anterior. Con un uuid nuevo
-- por foto la URL cambia, no hay nada que invalidar, y por eso tampoco hay
-- policy de UPDATE: cada foto es un objeto nuevo y el anterior se borra.
--
-- LA POLICY DE SELECT ES SÓLO DE LA CARPETA PROPIA
--
-- Los objetos de un bucket público se sirven por su URL pública sin pasar por
-- la RLS, así que la lectura NO necesita policy. La que hay existe por el
-- borrado: un DELETE con WHERE lee las filas, y Postgres le aplica también las
-- policies de SELECT. Sin ella, `storage.remove()` borra CERO filas sin dar
-- error (lo comprueba supabase/tests/0050_foto_colaborador.test.sql): la foto
-- anterior, o la que la persona quitó, seguiría sirviéndose por su URL para
-- siempre. Por eso se acota a la carpeta de quien pregunta: nadie puede LISTAR
-- la carpeta de otra cuenta ni enumerar las fotos del bucket, y anon no tiene
-- ninguna. A una foto ajena sólo se llega conociendo su ruta completa, y esa
-- ruta sólo sale en `listar_colaboradores()`.
--
-- GRANTS
--
-- `foto_path` entra en el `grant update` y NO en el de `insert`: una foto
-- cuelga de una ficha que ya existe. La interfaz sube la foto y luego hace un
-- UPDATE de esa sola columna; el botón «Guardar ficha» nunca la manda.
--
-- CONSENTIMIENTO
--
-- La foto es PÚBLICA y se publica en cuanto la persona la guarda, sin
-- revisión previa. Si hay que retirar una, un administrador la borra desde
-- Storage y deja `foto_path` en null (SQL Editor).
--
-- BORRAR UNA CUENTA
--
-- Como en la 0048: borrar la cuenta borra la ficha, pero NO el archivo del
-- bucket (Supabase no permite borrar objetos con SQL). Queda huérfano y,
-- como el bucket es público, sigue sirviéndose por su URL hasta que alguien
-- lo quite desde Storage.
--
-- SECURITY ADVISOR
--
-- Puede avisar de que el bucket es público y permite listar; aquí cada quien
-- sólo lista su propia carpeta (ver la policy de SELECT). `listar_colaboradores()` ya era
-- `security definer` ejecutable por anon desde la 0038.
--
-- CODIFICACIÓN
--
-- Este archivo lleva acentos. El preflight exige `client_encoding = UTF8`.
--
-- Aplicar dos veces es seguro: la columna es `if not exists`, el CHECK y las
-- policies se borran antes de crearse, el bucket es `on conflict` y la RPC se
-- recrea.

begin;

do $preflight$
begin
  if to_regclass('public.fichas_colaborador') is null then
    raise exception using
      errcode = 'P0001',
      message = '0050 preflight failed: public.fichas_colaborador is required (0039)';
  end if;

  if to_regprocedure('public.listar_colaboradores()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0050 preflight failed: public.listar_colaboradores() is required (0038/0039/0040/0041)';
  end if;

  if to_regprocedure('public.es_colaborador()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0050 preflight failed: public.es_colaborador() is required (0039)';
  end if;

  -- La RPC que se reescribe abajo es la de la 0041: sin `habilidades` sería
  -- la de antes y le faltarían columnas.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'habilidades'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0050 preflight failed: falta habilidades (0041)';
  end if;

  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception using
      errcode = 'P0001',
      message = '0050 preflight failed: storage.buckets and storage.objects are required (Supabase Storage)';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0050 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- === 1. La columna ==========================================================

alter table public.fichas_colaborador
  add column if not exists foto_path text;

-- Fuera de los bloques `do` y con la regex en una sola línea: los tests de
-- Node la leen con expresiones regulares. Nulo pasa (un CHECK con null da
-- `unknown`, no `false`): la ausencia de foto se escribe null, nunca ''.
alter table public.fichas_colaborador
  drop constraint if exists fichas_colaborador_foto_path_valida;
alter table public.fichas_colaborador
  add constraint fichas_colaborador_foto_path_valida check (
    foto_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and split_part(foto_path, '/', 1) = id::text
  );

comment on column public.fichas_colaborador.foto_path is
  'Ruta de la foto en el bucket público colaboradores-fotos '
  '(<user_id>/<uuid>.webp). Null si no hay foto. La carpeta debe ser el id '
  'de la ficha.';

-- === 2. Privilegios por columna =============================================

-- La lista de la 0041 más `foto_path`, sólo en UPDATE: una foto cuelga de una
-- ficha que ya existe, no se escribe al crearla. Ninguna migración posterior
-- a la 0041 volvió a emitir estos grants.
grant insert (id, puesto, sector, ubicacion, herramientas, habilidades, idiomas,
              empresa, empresa_enlace, modalidad_trabajo, anio_inicio, bio,
              linkedin, github, correo)
  on table public.fichas_colaborador to authenticated;
grant update (puesto, sector, ubicacion, herramientas, habilidades, idiomas,
              empresa, empresa_enlace, modalidad_trabajo, anio_inicio, bio,
              linkedin, github, correo, foto_path)
  on table public.fichas_colaborador to authenticated;

-- === 3. La RPC pública ======================================================

-- Cambia el RETURNS TABLE y `create or replace` no puede: drop + create, como
-- la 0041. EL DROP SE LLEVA LOS GRANTS: se repiten abajo.
drop function if exists public.listar_colaboradores();

create function public.listar_colaboradores()
returns table (
  nombre text,
  apellidos text,
  slug text,
  puesto text,
  sector text,
  ubicacion text,
  herramientas text[],
  habilidades text[],
  idiomas text[],
  empresa text,
  empresa_enlace text,
  modalidad_trabajo text,
  anio_inicio integer,
  bio text,
  linkedin text,
  github text,
  correo text,
  foto_path text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.nombre, p.apellidos, p.slug,
    f.puesto, f.sector, f.ubicacion,
    f.herramientas, f.habilidades, f.idiomas,
    f.empresa, f.empresa_enlace,
    f.modalidad_trabajo, f.anio_inicio, f.bio, f.linkedin, f.github, f.correo,
    f.foto_path
  from public.perfiles p
  left join public.fichas_colaborador f on f.id = p.id
  where p.es_colaborador
  order by p.slug
$function$;

revoke all on function public.listar_colaboradores() from public;
grant execute on function public.listar_colaboradores() to anon, authenticated;

-- === 4. Bucket y policies de Storage ========================================

-- Público: la foto se sirve por URL sin sesión. 1 MB y sólo WebP: el editor
-- exporta un cuadrado de hasta 1024 px a calidad 0.92, muy por debajo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'colaboradores-fotos',
  'colaboradores-fotos',
  true,
  1048576,
  array['image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/webp'];

-- Sube sólo dentro de su carpeta, con la forma exacta de ruta y sólo mientras
-- siga marcado como colaborador.
drop policy if exists colaboradores_fotos_insert on storage.objects;
create policy colaboradores_fotos_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'colaboradores-fotos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.es_colaborador()
  );

-- Borra sólo lo propio: la foto anterior al subir una nueva, o la que quita.
drop policy if exists colaboradores_fotos_delete on storage.objects;
create policy colaboradores_fotos_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'colaboradores-fotos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.es_colaborador()
  );

-- Ver lo propio: lo que necesita el borrado de arriba (ver la cabecera), y lo
-- que usa la página para listar su carpeta y dejar en ella sólo la foto
-- actual (limpiarCarpetaDeFoto en ficha.service.js). Nada más. Sin exigir la
-- marca de colaboradora: quien la perdió sigue pudiendo ver su carpeta, y el
-- borrado de arriba sí la exige.
drop policy if exists colaboradores_fotos_select on storage.objects;
create policy colaboradores_fotos_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'colaboradores-fotos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Sin policy de UPDATE: cada foto es un objeto nuevo y el anterior se borra.

commit;
