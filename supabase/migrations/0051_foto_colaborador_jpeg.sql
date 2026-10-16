-- Foto del colaborador, parte 2: también se acepta JPEG.
--
-- POR QUÉ
--
-- El editor de «Mi ficha» exporta la foto con `canvas.toBlob(..., 'image/webp')`.
-- Safari (y por tanto todos los navegadores de iPhone, que usan WebKit) NO sabe
-- codificar WebP: devuelve en silencio un PNG de 2 a 3 MB, y el bucket de la
-- 0050 (sólo WebP, 1 MB) lo rechazaba. Ahora el editor cae a JPEG cuando el
-- navegador no entrega WebP, y el bucket y la base lo aceptan.
--
-- QUÉ CAMBIA
--
--   · el bucket `colaboradores-fotos` admite `image/webp` e `image/jpeg`
--     (el límite de 1 MB sigue igual).
--   · las policies de insertar y borrar aceptan `.webp` o `.jpg` en el nombre.
--     La de SELECT no filtra por extensión y no se toca.
--   · el CHECK de `fichas_colaborador.foto_path` acepta las dos extensiones.
--
-- RUTAS EN EL BUCKET
--
--   <user_id>/<uuid>.webp
--   <user_id>/<uuid>.jpg
--
-- Todo lo demás de la 0050 (carpeta propia, uuid nuevo por foto, grants, RPC
-- `listar_colaboradores()`) queda igual. La RPC no hardcodea la extensión.
--
-- CODIFICACIÓN
--
-- Este archivo lleva acentos. El preflight exige `client_encoding = UTF8`.
--
-- Aplicar dos veces es seguro: el CHECK y las policies se borran antes de
-- crearse y el bucket es `on conflict`.

begin;

do $preflight$
begin
  if to_regclass('public.fichas_colaborador') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'fichas_colaborador'
         and column_name = 'foto_path'
     ) then
    raise exception using
      errcode = 'P0001',
      message = '0051 preflight failed: public.fichas_colaborador.foto_path is required (0050)';
  end if;

  if to_regprocedure('public.es_colaborador()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0051 preflight failed: public.es_colaborador() is required (0039)';
  end if;

  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception using
      errcode = 'P0001',
      message = '0051 preflight failed: storage.buckets and storage.objects are required (Supabase Storage)';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0051 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- === 1. El CHECK ============================================================

-- Fuera de los bloques `do` y con la regex en una sola línea, como en la 0050.
-- Nulo pasa: la ausencia de foto se escribe null, nunca ''.
alter table public.fichas_colaborador
  drop constraint if exists fichas_colaborador_foto_path_valida;
alter table public.fichas_colaborador
  add constraint fichas_colaborador_foto_path_valida check (
    foto_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    and split_part(foto_path, '/', 1) = id::text
  );

comment on column public.fichas_colaborador.foto_path is
  'Ruta de la foto en el bucket público colaboradores-fotos '
  '(<user_id>/<uuid>.webp o <user_id>/<uuid>.jpg). Null si no hay foto. La '
  'carpeta debe ser el id de la ficha.';

-- === 2. Bucket y policies de Storage ========================================

-- WebP donde el navegador lo codifica; JPEG donde no (Safari). Mismo límite.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'colaboradores-fotos',
  'colaboradores-fotos',
  true,
  1048576,
  array['image/webp', 'image/jpeg']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/webp', 'image/jpeg'];

-- Igual que en la 0050, con la extensión ampliada.
drop policy if exists colaboradores_fotos_insert on storage.objects;
create policy colaboradores_fotos_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'colaboradores-fotos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.es_colaborador()
  );

drop policy if exists colaboradores_fotos_delete on storage.objects;
create policy colaboradores_fotos_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'colaboradores-fotos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.es_colaborador()
  );

-- La policy de SELECT (colaboradores_fotos_select) de la 0050 no depende de la
-- extensión y se queda como está. Sigue sin haber policy de UPDATE.

commit;
