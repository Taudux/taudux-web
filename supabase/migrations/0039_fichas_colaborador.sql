-- Fichas de colaborador ("Mi ficha"): cada cuenta marcada como colaboradora
-- (`perfiles.es_colaborador`, 0038) edita su propia ficha pública —rol,
-- especialidad, ubicación, stack, disponibilidad, año de inicio, bio y enlaces
-- de contacto— y la página /colaboradores la muestra sin sesión iniciada, a
-- través de la misma `listar_colaboradores()` de la 0038.
--
-- Una fila guardada es una ficha COMPLETA: no hay borradores. Todo lo
-- obligatorio es `not null`; lo único opcional son los tres enlaces
-- (linkedin, github, correo).
--
-- POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN PERFILES
--
-- Un grant por columna se concede a un ROL, no a una clase de filas: `grant
-- update (bio) on public.perfiles to authenticated` dejaría a TODA cuenta con
-- sesión escribir la bio de su fila, colaboradora o no, porque
-- `perfiles_update_propio` (0001) sólo pide que la fila sea propia. Endurecer
-- esa policy con la marca tampoco sirve: dejaría sin editar su nombre y su
-- teléfono a quien no colabora. Sólo una policy sobre una tabla propia puede
-- exigir las dos condiciones a la vez —ser colaborador Y ser el dueño— para
-- exactamente estos datos.
--
-- QUIÉN ESCRIBE QUÉ
--
-- * El dueño, con sesión y marcado: crea, lee y edita su ficha. No elige el
--   `id` de otra cuenta, no toca las fechas y no la borra.
-- * Una cuenta sin marcar: nada, ni siquiera sobre su propia fila.
-- * Nadie lee ni toca la ficha de otro. anon no tiene ningún privilegio sobre
--   la tabla: ve las fichas sólo a través de la RPC.
-- * La administración corrige a mano desde el SQL Editor, que corre como
--   dueño de la tabla: la RLS no lo alcanza (por eso NO es `force`), los
--   CHECK sí.
--
--     update public.fichas_colaborador set bio = '…' where id = '<uuid>';
--
-- Sin `id` en el grant de UPDATE, un upsert de PostgREST (`.upsert()`) falla
-- con 42501: su `on conflict do update` reescribe todas las columnas enviadas,
-- `id` incluida. "Mi ficha" crea con insert y después edita con update.
--
-- QUÉ SE VUELVE PÚBLICO (CONSENTIMIENTO)
--
-- TODO lo que la ficha guarda, el correo incluido, sale en una página abierta
-- a cualquiera, sin sesión. Guardar la ficha es publicarla, y quien la llena
-- tiene que saberlo antes de hacerlo.
--
-- Si alguien retira su consentimiento, se borra la fila (desde el navegador
-- nadie puede borrarla):
--
--     delete from public.fichas_colaborador where id = '<uuid>';
--
-- La cuenta sigue en la lista con su nombre; para sacarla también de ahí, se
-- desmarca (0038). Borrar la cuenta borra la ficha (`on delete cascade`).
--
-- DESMARCAR
--
-- `es_colaborador = false` oculta la ficha (la RPC filtra por la marca) y
-- bloquea su lectura y edición (las policies la piden), pero CONSERVA la
-- fila: volver a marcar la cuenta la devuelve tal cual. Si lo que se retiró
-- fue el consentimiento, desmarcar no alcanza: hay que borrar la fila.
--
-- LOS CHECK
--
-- Textos sin espacios en los bordes ni caracteres de control (la bio admite
-- saltos de línea, nada más), stack de 1 a 12 elementos, enlaces sólo https a
-- linkedin.com o github.com, y el correo con la misma lista blanca que el
-- front (colaboradores.datos.js): todo termina en un `href`. El año de inicio
-- tiene un rango fijo porque un CHECK tiene que dar lo mismo hoy que dentro de
-- diez años; uno atado a la fecha actual podría rechazar, al restaurar un
-- respaldo, filas que eran válidas.
--
-- `stack_colaborador_valido()` existe porque un CHECK no admite subconsultas y
-- hay que revisar CADA elemento del arreglo. Corre con los privilegios de
-- quien inserta o actualiza, así que authenticated CONSERVA su EXECUTE: sin
-- él, guardar la ficha fallaría con permiso denegado.
--
-- SECURITY ADVISOR
--
-- El Security Advisor de Supabase VA a señalar dos funciones SECURITY
-- DEFINER. Ambas son esperadas:
-- * `es_colaborador()`, ejecutable por authenticated: responde sólo por la
--   cuenta que pregunta (auth.uid()), sin parámetros, y existe para que las
--   policies lean la marca sin depender de la RLS de perfiles (el mismo patrón
--   que `es_admin()`, 0004).
-- * `listar_colaboradores()`, ejecutable por anon: ya estaba (0038); ahora
--   entrega también los campos de la ficha, y sigue sin `id`, `telefono` ni
--   fechas.
--
-- CODIFICACIÓN
--
-- Los `comment on` de este archivo llevan acentos: con una sesión que no
-- hable UTF8 quedarían destrozados en el catálogo sin ningún error. Por eso el
-- preflight exige `client_encoding = UTF8`, igual que la 0038.
--
-- Aplicar dos veces es seguro: la tabla es `if not exists`; constraints,
-- trigger y policies se borran antes de crearse; las funciones auxiliares son
-- `create or replace`, los grants se revocan antes de concederse, y la RPC se
-- borra y se recrea. Lo que ya NO se puede es volver a aplicar la 0038 después
-- de esta: su `create or replace` de `listar_colaboradores()` choca con la
-- forma nueva.

begin;

do $preflight$
begin
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.perfiles')
      and a.attname = 'es_colaborador'
      and not a.attisdropped
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0039 preflight failed: public.perfiles.es_colaborador is required (0038)';
  end if;

  if to_regprocedure('public.set_actualizado_en()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0039 preflight failed: public.set_actualizado_en() is required (0001)';
  end if;

  if to_regprocedure('public.listar_colaboradores()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0039 preflight failed: public.listar_colaboradores() is required (0038)';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0039 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- === Funciones auxiliares ====================================================

-- Cada elemento del stack: sin espacios en los bordes, de 1 a 40 caracteres y
-- sin caracteres de control; un elemento null es inválido. El arreglo vacío da
-- true: de eso se encarga `cardinality` en el CHECK de la tabla.
--
-- "Sin caracteres de control" son DOS expresiones, también en los CHECK de la
-- tabla. `[[:cntrl:]]` sólo cubre la categoría Cc de Unicode; los de formato
-- bidireccional (U+200E/200F, U+202A-202E, U+2066-2069) son Cf, pasan esa
-- clase y `btrim` no los quita. Con un U+202E en el rol, el texto se vería al
-- revés en la página pública: se rechazan aparte, en su propia expresión para
-- que cada una diga qué cubre.
create or replace function public.stack_colaborador_valido(stack text[])
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    bool_and(
      elemento is not null
      and elemento = btrim(elemento)
      and char_length(elemento) between 1 and 40
      and elemento !~ '[[:cntrl:]]'
      and elemento !~ '[‎‏‪-‮⁦-⁩]'
    ),
    true
  )
  from unnest(stack) as elemento
$function$;

-- EXECUTE para authenticated y no para anon: el CHECK la ejecuta como quien
-- guarda la ficha, y anon no guarda fichas. Los privilegios por defecto de
-- Supabase conceden EXECUTE a anon directamente, no sólo vía public: hay que
-- nombrarlo.
revoke all on function public.stack_colaborador_valido(text[]) from public, anon;
grant execute on function public.stack_colaborador_valido(text[]) to authenticated;

-- ¿La cuenta que pregunta está marcada como colaboradora? `security definer`
-- con `search_path` vacío, como `es_admin()` (0004): lee la fila propia sin
-- depender de la RLS de perfiles. Sin sesión, o sin perfil, responde false,
-- nunca null.
create or replace function public.es_colaborador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select p.es_colaborador from public.perfiles p where p.id = auth.uid()),
    false
  )
$function$;

-- Las policies la llaman como el usuario: authenticated la necesita.
revoke all on function public.es_colaborador() from public, anon;
grant execute on function public.es_colaborador() to authenticated;

-- === Tabla ===================================================================

create table if not exists public.fichas_colaborador (
  id uuid
    constraint fichas_colaborador_pkey primary key
    constraint fichas_colaborador_id_fkey
      references public.perfiles (id) on delete cascade,
  rol text not null,
  especialidad text not null,
  ubicacion text not null,
  stack text[] not null,
  disponibilidad text not null,
  anio_inicio integer not null,
  bio text not null,
  linkedin text,
  github text,
  correo text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Los CHECK se borran y se vuelven a crear en cada corrida: así una versión
-- nueva de este archivo los actualiza, y se re-validan contra las filas vivas.
alter table public.fichas_colaborador
  drop constraint if exists fichas_colaborador_rol_valido,
  drop constraint if exists fichas_colaborador_especialidad_valida,
  drop constraint if exists fichas_colaborador_ubicacion_valida,
  drop constraint if exists fichas_colaborador_stack_valido,
  drop constraint if exists fichas_colaborador_disponibilidad_valida,
  drop constraint if exists fichas_colaborador_anio_inicio_valido,
  drop constraint if exists fichas_colaborador_bio_valida,
  drop constraint if exists fichas_colaborador_linkedin_valido,
  drop constraint if exists fichas_colaborador_github_valido,
  drop constraint if exists fichas_colaborador_correo_valido;

alter table public.fichas_colaborador
  add constraint fichas_colaborador_rol_valido check (
    rol = btrim(rol)
    and char_length(rol) between 2 and 60
    and rol !~ '[[:cntrl:]]'
    and rol !~ '[‎‏‪-‮⁦-⁩]'
  ),
  add constraint fichas_colaborador_especialidad_valida check (
    especialidad = btrim(especialidad)
    and char_length(especialidad) between 2 and 80
    and especialidad !~ '[[:cntrl:]]'
    and especialidad !~ '[‎‏‪-‮⁦-⁩]'
  ),
  add constraint fichas_colaborador_ubicacion_valida check (
    ubicacion = btrim(ubicacion)
    and char_length(ubicacion) between 2 and 80
    and ubicacion !~ '[[:cntrl:]]'
    and ubicacion !~ '[‎‏‪-‮⁦-⁩]'
  ),
  -- `array_position` falla (con 0A000, no con 23514) ante un arreglo de más
  -- de una dimensión, y el orden de evaluación de un `and` no está
  -- garantizado: el `case` asegura que la dimensión se revise primero.
  add constraint fichas_colaborador_stack_valido check (
    case
      when array_ndims(stack) = 1 then
        cardinality(stack) between 1 and 12
        and array_position(stack, null::text) is null
        and public.stack_colaborador_valido(stack)
      else false
    end
  ),
  add constraint fichas_colaborador_disponibilidad_valida check (
    disponibilidad in ('Disponible', 'Parcial', 'No disponible')
  ),
  add constraint fichas_colaborador_anio_inicio_valido check (
    anio_inicio between 1950 and 2100
  ),
  -- La bio admite saltos de línea (`\n`) en medio, no en los bordes; un `\r`
  -- sigue siendo un carácter de control.
  add constraint fichas_colaborador_bio_valida check (
    bio = btrim(bio, E' \n')
    and char_length(bio) between 10 and 600
    and replace(bio, E'\n', '') !~ '[[:cntrl:]]'
    and bio !~ '[‎‏‪-‮⁦-⁩]'
  ),
  -- Los enlaces ausentes son null: la cadena vacía no pasa ninguna expresión.
  add constraint fichas_colaborador_linkedin_valido check (
    linkedin ~ '^https://([a-z0-9-]+\.)?linkedin\.com/[^[:space:]]+$'
    and char_length(linkedin) <= 200
  ),
  add constraint fichas_colaborador_github_valido check (
    github ~ '^https://(www\.)?github\.com/[^[:space:]]+$'
    and char_length(github) <= 200
  ),
  add constraint fichas_colaborador_correo_valido check (
    correo ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    and char_length(correo) <= 254
  );

drop trigger if exists fichas_colaborador_set_actualizado_en on public.fichas_colaborador;
create trigger fichas_colaborador_set_actualizado_en
  before update on public.fichas_colaborador
  for each row execute function public.set_actualizado_en();

comment on table public.fichas_colaborador is
  'Ficha pública de cada colaborador ("Mi ficha"). Una fila es una ficha '
  'completa y TODO lo que guarda es público vía listar_colaboradores(). Sólo '
  'el dueño marcado como colaborador la escribe; la administración la corrige '
  'o la borra a mano. Ver 0039.';

comment on column public.fichas_colaborador.id is
  'Cuenta dueña de la ficha (perfiles.id). Borrar la cuenta borra la ficha.';

comment on column public.fichas_colaborador.stack is
  'Tecnologías que muestra la ficha: de 1 a 12, cada una de 1 a 40 caracteres.';

comment on column public.fichas_colaborador.disponibilidad is
  'Disponible, Parcial o No disponible.';

comment on column public.fichas_colaborador.bio is
  'Presentación de 10 a 600 caracteres; admite saltos de línea.';

comment on column public.fichas_colaborador.correo is
  'Correo de contacto opcional. PÚBLICO: sale en la página sin sesión.';

-- === RLS y privilegios =======================================================

-- Sin `force`, a propósito: el dueño de la tabla (el SQL Editor) corrige
-- fichas sin pasar por las policies.
alter table public.fichas_colaborador enable row level security;

-- Supabase concede por defecto TODO sobre cada tabla nueva a anon y
-- authenticated. Se revoca y se abre sólo lo necesario: sin `id` en el UPDATE
-- ni fechas en ninguno de los dos, sin DELETE.
revoke all on table public.fichas_colaborador from public, anon, authenticated;

grant select on table public.fichas_colaborador to authenticated;
grant insert (id, rol, especialidad, ubicacion, stack, disponibilidad,
              anio_inicio, bio, linkedin, github, correo)
  on table public.fichas_colaborador to authenticated;
grant update (rol, especialidad, ubicacion, stack, disponibilidad,
              anio_inicio, bio, linkedin, github, correo)
  on table public.fichas_colaborador to authenticated;

-- `(select …)` y no la llamada directa: así Postgres evalúa cada función una
-- vez por sentencia y no una vez por fila (ver 0031).
drop policy if exists fichas_colaborador_select_propia on public.fichas_colaborador;
create policy fichas_colaborador_select_propia
  on public.fichas_colaborador for select
  to authenticated
  using (id = (select auth.uid()) and (select public.es_colaborador()));

drop policy if exists fichas_colaborador_insert_propia on public.fichas_colaborador;
create policy fichas_colaborador_insert_propia
  on public.fichas_colaborador for insert
  to authenticated
  with check (id = (select auth.uid()) and (select public.es_colaborador()));

drop policy if exists fichas_colaborador_update_propia on public.fichas_colaborador;
create policy fichas_colaborador_update_propia
  on public.fichas_colaborador for update
  to authenticated
  using (id = (select auth.uid()) and (select public.es_colaborador()))
  with check (id = (select auth.uid()) and (select public.es_colaborador()));

-- Sin policy de DELETE, a propósito: borrar una ficha es retirar un
-- consentimiento, y lo hace la administración a mano.

-- === RPC pública =============================================================

-- `create or replace` no puede cambiar las columnas de un RETURNS TABLE
-- ("cannot change return type of existing function"), así que se borra
-- primero, como `claim_curso_anuncio()` en la 0022. Nada en la base depende de
-- ella (la llama el front por PostgREST) y todo va en la misma transacción. El
-- drop se lleva sus grants: hay que repetirlos abajo.
drop function if exists public.listar_colaboradores();

-- language sql y no plpgsql: en plpgsql las columnas OUT de `returns table`
-- sombrearían a las de las tablas dentro del cuerpo. Una colaboradora sin
-- ficha sale igual, con los campos de ficha en null (left join).
create function public.listar_colaboradores()
returns table (
  nombre text,
  apellidos text,
  slug text,
  rol text,
  especialidad text,
  ubicacion text,
  stack text[],
  disponibilidad text,
  anio_inicio integer,
  bio text,
  linkedin text,
  github text,
  correo text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.nombre, p.apellidos, p.slug,
    f.rol, f.especialidad, f.ubicacion, f.stack, f.disponibilidad,
    f.anio_inicio, f.bio, f.linkedin, f.github, f.correo
  from public.perfiles p
  left join public.fichas_colaborador f on f.id = p.id
  where p.es_colaborador
  order by p.slug
$function$;

revoke all on function public.listar_colaboradores() from public;
grant execute on function public.listar_colaboradores() to anon, authenticated;

commit;
