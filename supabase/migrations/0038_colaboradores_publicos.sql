-- Colaboradores públicos: la página /colaboradores lista, sin sesión iniciada,
-- a quienes colaboran con Taudux. Un colaborador es una cuenta REAL marcada A
-- MANO desde el SQL Editor, igual que `es_prueba` (0028) y que el rol de
-- administración: no hay alta desde el navegador ni autoservicio.
--
-- Es una columna booleana aparte, y no un valor nuevo de `rol`, porque una
-- misma cuenta puede ser administradora Y colaboradora, y `rol` guarda uno solo.
--
-- POR QUÉ UNA FUNCIÓN Y NO UNA POLICY
--
-- La RLS filtra FILAS, no columnas. Una policy `for select to anon using
-- (es_colaborador)` entregaría la fila completa, y la 0001 sólo revocó
-- `update`: el SELECT a nivel tabla que Supabase concede por defecto a anon y
-- authenticated sigue vigente, así que por esa policy saldrían `telefono`,
-- `rol`, `es_prueba` y las fechas de cada colaborador. Recortar con grants por
-- columna tampoco sirve: cada usuario lee su PROPIA fila completa
-- (`perfiles_select_propio`, 0001), y quitarle `select (telefono)` a
-- authenticated rompería la pantalla de su cuenta.
--
-- Por eso la lista sale de `listar_colaboradores()`, `security definer`: lee
-- la tabla como su dueño y entrega sólo tres columnas. anon no gana ninguna
-- policy ni ningún grant sobre `perfiles`.
--
-- QUÉ NO EXPONE
--
-- Sólo nombre, apellidos y slug. Nada de `id`, `telefono`, `rol`, `es_prueba`,
-- `avisos_curso_nuevo` ni fechas. El `id` es la llave de la cuenta en
-- auth.users y no tiene por qué circular en una página pública: el slug es la
-- dirección pública del perfil.
--
-- EL SLUG
--
-- Se genera UNA vez, al marcar, desde el nombre sin apellidos ("María José" →
-- `maria-jose`). Si ya es de otra cuenta, se le agrega el primer apellido
-- (`diego-ramirez`, `diego-de-la-cruz`); si también está tomado, el marcado
-- falla y pide un slug a mano. No hay sufijos numéricos: `diego-2` no le dice
-- nada a nadie. Después queda FIJO: cambiar el nombre no lo regenera, porque
-- romper un enlace ya compartido es peor que un slug desactualizado.
--
-- `unaccent` no está habilitada, y `lower()` sobre letras no ASCII depende del
-- locale de la base, así que `slug_colaborador()` traduce los acentos con una
-- tabla fija y baja a minúsculas con collation "C". Sigue la misma regla que
-- el slug que antes calculaba el JS: NFD sin diacríticos, minúsculas,
-- `[^a-z0-9]+` → '-', sin guiones en los bordes.
--
-- CÓMO MARCAR / DESMARCAR
--
-- Marcar (el slug se calcula solo y el `returning` lo muestra):
--
--   update public.perfiles set es_colaborador = true
--   where id = '<uuid>' returning slug;
--
-- Con un slug elegido a mano, que gana sobre el automático:
--
--   update public.perfiles set es_colaborador = true, slug = 'profe-ivan'
--   where id = '<uuid>' returning slug;
--
-- Una cuenta por update: dos marcas en la misma sentencia no se ven entre sí
-- y, si calculan el mismo slug, la unicidad rechaza la sentencia entera.
--
-- Desmarcar (`set es_colaborador = false`) saca la cuenta de la lista pero
-- CONSERVA su slug reservado: volver a marcarla recupera el mismo. Sólo borrar
-- la cuenta lo libera.
--
-- CONSENTIMIENTO
--
-- Marcar a alguien publica su nombre completo en una página abierta a
-- cualquiera, sin sesión. Pregúntale antes a la persona.
--
-- SECURITY ADVISOR
--
-- El Security Advisor de Supabase VA a señalar `listar_colaboradores()` como
-- función SECURITY DEFINER ejecutable por anon. Es esperado: saltarse la RLS
-- es exactamente su trabajo, y lo hace acotado a tres columnas de filas
-- marcadas a mano, con `search_path` vacío y sin parámetros que manipular.
--
-- CODIFICACIÓN
--
-- Este archivo lleva letras acentuadas en la tabla de traducción. Si la sesión
-- que lo aplica no habla UTF8 (un psql con `PGCLIENTENCODING=WIN1252`, por
-- ejemplo) llegarían destrozadas y la función quedaría mal SIN ningún error:
-- por eso el preflight exige `client_encoding = UTF8`. El SQL Editor de
-- Supabase y la CLI ya la usan.
--
-- Aplicar dos veces es seguro: columnas con `if not exists`, constraints y
-- trigger se borran antes de crearse y las funciones son `create or replace`.

begin;

do $preflight$
begin
  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0038 preflight failed: public.perfiles is required (0001)';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0038 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

alter table public.perfiles
  add column if not exists es_colaborador boolean not null default false,
  add column if not exists slug text;

comment on column public.perfiles.es_colaborador is
  'Si la cuenta aparece en la página pública de colaboradores. Marca operativa '
  'puesta a mano desde el SQL Editor; al marcarla se le asigna un slug fijo. '
  'Publica el nombre completo: pedir consentimiento antes. Ver 0038.';

comment on column public.perfiles.slug is
  'Dirección pública del perfil de colaborador. Se calcula UNA vez al marcar '
  '(nombre, y primer apellido si choca) o se da a mano; nunca se regenera y '
  'desmarcar lo conserva reservado. Ver 0038.';

-- Sin grant update (es_colaborador, slug) a authenticated, a propósito: la
-- 0001 sólo abre nombre, apellidos y telefono, así que estas dos quedan
-- protegidas igual que `rol` y `es_prueba`. Un usuario que pudiera marcarse
-- se publicaría a sí mismo como colaborador de Taudux.
--
-- El INSERT queda cerrado por otro lado: Supabase concede INSERT sobre la
-- tabla por defecto, pero `perfiles` no tiene ninguna policy de INSERT (0001)
-- y la RLS lo niega. Una migración futura que abra el INSERT a los clientes
-- tiene que excluir estas columnas (with check (not es_colaborador and slug
-- is null)); el test de la 0038 lo vigila.

alter table public.perfiles
  drop constraint if exists perfiles_slug_key,
  drop constraint if exists perfiles_slug_formato,
  drop constraint if exists perfiles_colaborador_con_slug;

-- Único, pero admite muchos null: las cuentas nunca marcadas no tienen slug.
alter table public.perfiles
  add constraint perfiles_slug_key unique (slug),
  add constraint perfiles_slug_formato
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint perfiles_colaborador_con_slug
    check (not es_colaborador or slug is not null);

-- Minúsculas ASCII y guiones simples, sin bordes; null si no queda nada. La
-- tabla cubre mayúsculas Y minúsculas porque `lower()` sólo es predecible
-- sobre ASCII con collation "C".
create or replace function public.slug_colaborador(texto text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(
    btrim(
      regexp_replace(
        lower(
          translate(
            texto,
            'áéíóúüñàèìòùâêîôûäëïöçãõ' || 'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇÃÕ',
            'aeiouunaeiouaeiouaeiocao' || 'aeiouunaeiouaeiouaeiocao'
          ) collate "C"
        ),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    ),
    ''
  )
$function$;

-- Sólo actúa al marcar sin slug: uno dado a mano en el mismo update gana, y
-- uno ya asignado (incluso de una cuenta desmarcada y vuelta a marcar) nunca
-- se recalcula. El trigger escucha `update of es_colaborador`, así que editar
-- el nombre ni siquiera lo despierta.
--
-- Invoker a propósito: sólo quien ya puede escribir `es_colaborador`
-- (service_role o el dueño, desde el SQL Editor) llega a la rama que calcula;
-- ninguno de los dos está sujeto a la RLS de perfiles, así que la búsqueda de
-- choques ve todas las filas.
create or replace function public.asignar_slug_colaborador()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_base text;
  v_apellido text;
  v_candidato text;
  v_pista text;
begin
  if not new.es_colaborador or new.slug is not null then
    return new;
  end if;

  v_pista := format(
    'Asígnale un slug a mano en el mismo update: '
    'update public.perfiles set es_colaborador = true, slug = ''nombre-apellido'' '
    'where id = %L returning slug;',
    new.id
  );

  v_base := public.slug_colaborador(new.nombre);
  if v_base is null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'La cuenta %s no tiene nombre del que sacar su slug de colaborador.',
        new.id),
      hint = v_pista;
  end if;

  if not exists (
    select 1 from public.perfiles p
    where p.slug = v_base and p.id <> new.id
  ) then
    new.slug := v_base;
    return new;
  end if;

  -- Primer apellido con sus partículas: "de la Cruz" es UN apellido. Los
  -- grupos son no capturantes a propósito: con un grupo capturante,
  -- `substring(... from ...)` devolvería sólo ese grupo y no el match entero.
  v_apellido := substring(
    public.slug_colaborador(new.apellidos)
    from '^(?:(?:de|del|la|las|los|y)-)*[a-z0-9]+'
  );
  if v_apellido is null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'El slug "%s" ya es de otra cuenta y la cuenta %s no tiene apellidos '
        'con los que desempatar.',
        v_base, new.id),
      hint = v_pista;
  end if;

  v_candidato := v_base || '-' || v_apellido;
  if exists (
    select 1 from public.perfiles p
    where p.slug = v_candidato and p.id <> new.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Los slugs "%s" y "%s" ya son de otras cuentas; no se agregan sufijos '
        'numéricos.',
        v_base, v_candidato),
      hint = v_pista;
  end if;

  new.slug := v_candidato;
  return new;
end
$function$;

drop trigger if exists perfiles_asignar_slug_colaborador on public.perfiles;
create trigger perfiles_asignar_slug_colaborador
  before insert or update of es_colaborador on public.perfiles
  for each row execute function public.asignar_slug_colaborador();

-- language sql y no plpgsql: en plpgsql las columnas OUT de `returns table`
-- (nombre, apellidos, slug) sombrearían a las de la tabla dentro del cuerpo.
create or replace function public.listar_colaboradores()
returns table (nombre text, apellidos text, slug text)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.nombre, p.apellidos, p.slug
  from public.perfiles p
  where p.es_colaborador
  order by p.slug
$function$;

revoke all on function public.listar_colaboradores() from public;
grant execute on function public.listar_colaboradores() to anon, authenticated;

-- Los privilegios por defecto de Supabase conceden EXECUTE a anon y
-- authenticated directamente, no sólo vía public: hay que nombrarlos.
revoke all on function public.slug_colaborador(text) from public, anon, authenticated;
revoke all on function public.asignar_slug_colaborador() from public, anon, authenticated;

commit;
