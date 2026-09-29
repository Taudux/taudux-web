-- Aceptación de los Términos y Condiciones del extractor: la EVIDENCIA de que
-- cada persona consintió, qué versión aceptó y cuándo.
--
-- POR QUÉ EXISTE
--
-- El extractor procesa estados de cuenta, y la ley de datos personales exige
-- consentimiento EXPRESO para tratar información financiera. La carga de probar
-- que se obtuvo recae en el responsable, no en el usuario: si alguien reclama,
-- TAUDUX tiene que poder mostrar quién aceptó, qué versión y cuándo. La cláusula
-- XLIV de los Términos permite conservar esta evidencia electrónica.
--
-- Hasta esta migración, la aceptación sólo quedaba en el navegador de la
-- persona (localStorage): consintió, pero TAUDUX no guardaba prueba.
--
-- LAS TRES REGLAS QUE ESTA TABLA HACE CUMPLIR (y el porqué de cada una)
--
-- 1. SÓLO SE AGREGAN FILAS. Un trigger rechaza UPDATE, DELETE y TRUNCATE para
--    todos, service_role incluido (los triggers no se saltan con BYPASSRLS).
--    Una evidencia que se puede editar no prueba nada. Si alguien revoca su
--    consentimiento, se AGREGA una fila `revocacion`; la aceptación original
--    se queda, porque es la prueba de que el tratamiento anterior fue lícito.
--    La única salida es `purgar_aceptaciones_terminos()`, para el plazo de
--    conservación que fije la asesoría jurídica (ver abajo).
--
-- 2. SÓLO ESCRIBE EL SERVIDOR. La API la escribe con service_role; a anon y
--    authenticated se les retira todo privilegio de escritura y no hay
--    política de INSERT. Desde el navegador nadie puede fabricar ni borrar una
--    aceptación.
--
-- 3. CADA VERSIÓN ES UNA FILA NUEVA. Cuando se publica una versión nueva de los
--    Términos, la API vuelve a pedir la aceptación y queda otra fila. Así queda
--    el historial de qué aceptó cada quien y cuándo.
--
-- QUÉ NO GUARDA
--
-- Nada del contenido de ningún documento: ni banco, ni nombre de archivo, ni
-- movimientos. Sólo el acto de aceptar. Igual que `extractor_uso` (0030) no
-- sabe de qué banco era el documento.
--
-- POR QUÉ `user_id` NO TIENE LLAVE FORÁNEA A auth.users
--
-- A diferencia de `extractor_uso` (on delete cascade), aquí borrar la cuenta
-- NO borra la evidencia. La cláusula L de los Términos prevé conservar
-- información para "ejercer o defender derechos" después de terminada la
-- relación, y una aceptación que desaparece junto con la cuenta ya no puede
-- probar nada. El plazo lo fija la asesoría jurídica y lo aplica la purga.
-- Si la asesoría decide lo contrario, la migración siguiente agrega la llave
-- con `on delete cascade` y la purga deja de ser necesaria para ese caso.
--
-- UNA PERSONA, UN SUJETO
--
-- Cada fila es de una cuenta (`user_id`) O de una visita sin cuenta
-- (`sesion_anon`), nunca de las dos: es lo que resuelve `_identidad()` en la
-- API. Si alguien acepta sin cuenta y luego se registra, son dos sujetos y dos
-- aceptaciones — la cuenta nueva acepta de nuevo, igual que estrena cuota.
--
-- Aplicar dos veces es seguro: todo lleva `if not exists` o `or replace`.

begin;

do $preflight$
begin
  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0047 preflight failed: public.es_admin() is required (0004)';
  end if;
end
$preflight$;

create table if not exists public.aceptacion_terminos (
  id          bigserial primary key,
  user_id     uuid,
  sesion_anon text,
  version     text not null,
  evento      text not null default 'aceptacion',
  ocurrido_en timestamptz not null default now(),
  frase       text,
  ip          inet,
  navegador   text,
  constraint aceptacion_terminos_un_sujeto
    check ((user_id is null) <> (sesion_anon is null)),
  constraint aceptacion_terminos_evento_valido
    check (evento in ('aceptacion', 'revocacion')),
  -- "1.0", "1.1", "2.0"… La API manda TERMINOS_VERSION; una errata ahí
  -- ("v1", "1,0") haría que nadie tuviera aceptada la versión vigente.
  constraint aceptacion_terminos_version_formato
    check (version ~ '^[0-9]+(\.[0-9]+)*$'),
  -- El mismo formato que la API exige al header X-Sesion-Anon.
  constraint aceptacion_terminos_sesion_formato
    check (sesion_anon is null or sesion_anon ~ '^[0-9a-f]{16,40}$'),
  -- Una aceptación lleva la frase; una revocación no.
  constraint aceptacion_terminos_frase_si_acepta
    check ((evento = 'aceptacion') = (frase is not null)),
  constraint aceptacion_terminos_frase_largo
    check (frase is null or char_length(frase) <= 120),
  constraint aceptacion_terminos_navegador_largo
    check (navegador is null or char_length(navegador) <= 500)
);

comment on table public.aceptacion_terminos is
  'Evidencia de aceptación (y revocación) de los Términos del extractor. SÓLO '
  'se agregan filas: un trigger rechaza UPDATE/DELETE/TRUNCATE. No lleva nada '
  'del contenido de ningún documento.';
comment on column public.aceptacion_terminos.user_id is
  'Cuenta que aceptó. SIN llave foránea a propósito: borrar la cuenta no borra '
  'la evidencia (cláusula L de los Términos). La purga aplica el plazo legal.';
comment on column public.aceptacion_terminos.sesion_anon is
  'Identificador opaco de quien aceptó sin cuenta (header X-Sesion-Anon).';
comment on column public.aceptacion_terminos.version is
  'Versión de los Términos aceptada o revocada: TERMINOS_VERSION de la API.';
comment on column public.aceptacion_terminos.frase is
  'Lo que la persona escribió, tal cual (la API ya verificó que coincide). Es '
  'la manifestación de voluntad misma, no un resumen de ella.';
comment on column public.aceptacion_terminos.ip is
  'Primera IP de X-Forwarded-For (Cloud Run). Evidencia, no rastreo.';
comment on column public.aceptacion_terminos.navegador is
  'User-Agent, recortado a 500 caracteres.';

-- La pregunta que la API hace en cada petición: "¿el último evento de este
-- sujeto es una aceptación de la versión vigente?". Los dos índices la sirven.
create index if not exists aceptacion_terminos_user_reciente
  on public.aceptacion_terminos (user_id, ocurrido_en desc, id desc)
  where user_id is not null;
create index if not exists aceptacion_terminos_anon_reciente
  on public.aceptacion_terminos (sesion_anon, ocurrido_en desc, id desc)
  where sesion_anon is not null;

-- ------------------------------------------------------------- sólo agregar --
create or replace function public.aceptacion_terminos_solo_agregar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- La purga legal abre esta puerta para SU transacción y nada más
  -- (set_config local). Nadie más la tiene.
  if tg_op = 'DELETE'
     and current_setting('taudux.purga_aceptaciones', true) = 'on' then
    return old;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'aceptacion_terminos es sólo de agregar: ' || lower(tg_op)
      || ' no está permitido. Para revocar, inserta un evento ''revocacion''.';
end
$$;

drop trigger if exists aceptacion_terminos_sin_cambios on public.aceptacion_terminos;
create trigger aceptacion_terminos_sin_cambios
  before update or delete on public.aceptacion_terminos
  for each row execute function public.aceptacion_terminos_solo_agregar();

drop trigger if exists aceptacion_terminos_sin_truncate on public.aceptacion_terminos;
create trigger aceptacion_terminos_sin_truncate
  before truncate on public.aceptacion_terminos
  for each statement execute function public.aceptacion_terminos_solo_agregar();

-- ------------------------------------------------------------- la consulta --
-- La regla en un solo lugar, para que la API no la reimplemente: vale sólo si
-- el ÚLTIMO evento del sujeto es una aceptación de ESA versión. Una revocación
-- posterior la anula; una aceptación de una versión vieja no cuenta.
create or replace function public.terminos_aceptados(
  p_user_id uuid,
  p_sesion_anon text,
  p_version text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select a.evento = 'aceptacion' and a.version = p_version
    from public.aceptacion_terminos a
    where (p_user_id is not null and a.user_id = p_user_id)
       or (p_user_id is null and p_sesion_anon is not null
           and a.sesion_anon = p_sesion_anon)
    order by a.ocurrido_en desc, a.id desc
    limit 1
  ), false)
$$;

comment on function public.terminos_aceptados(uuid, text, text) is
  'true si el último evento del sujeto es una aceptación de p_version. Con '
  'user_id se ignora la sesión anónima: la cuenta manda.';

-- ------------------------------------------------------------------- purga --
-- Aplica el plazo de conservación. NO SE PROGRAMA en esta migración: el plazo
-- lo fija la asesoría jurídica (pregunta 3 del memorando del 2026-09-28), y
-- programarla antes sería decidirlo por ella.
--
-- Borra la historia completa de los sujetos INACTIVOS: aquellos cuyo evento
-- más reciente es anterior a p_antes. Nunca toca a quien sigue activo, así que
-- la evidencia vigente de un usuario actual no puede desaparecer por aplicar
-- el plazo. Devuelve cuántas filas borró.
create or replace function public.purgar_aceptaciones_terminos(p_antes timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borradas integer;
begin
  if p_antes is null or p_antes > now() - interval '30 days' then
    raise exception using
      errcode = 'P0001',
      message = 'purgar_aceptaciones_terminos: p_antes debe ser de hace al '
        || 'menos 30 días (freno contra un plazo mal escrito)';
  end if;

  perform set_config('taudux.purga_aceptaciones', 'on', true);

  with inactivos as (
    select coalesce(a.user_id::text, a.sesion_anon) as sujeto
    from public.aceptacion_terminos a
    group by 1
    having max(a.ocurrido_en) < p_antes
  )
  delete from public.aceptacion_terminos a
  using inactivos i
  where coalesce(a.user_id::text, a.sesion_anon) = i.sujeto;

  get diagnostics v_borradas = row_count;
  perform set_config('taudux.purga_aceptaciones', 'off', true);
  return v_borradas;
end
$$;

-- ---------------------------------------------------------------- permisos --
-- Supabase da por defecto todo sobre las tablas nuevas a anon y authenticated.
-- La RLS sin políticas ya lo bloquea; el revoke lo dice sin depender de ella.
revoke all on public.aceptacion_terminos from anon, authenticated;
revoke all on sequence public.aceptacion_terminos_id_seq from anon, authenticated;

revoke all on function public.terminos_aceptados(uuid, text, text) from public, anon, authenticated;
revoke all on function public.purgar_aceptaciones_terminos(timestamptz) from public, anon, authenticated;
revoke all on function public.aceptacion_terminos_solo_agregar() from public, anon, authenticated;

do $grants$
begin
  -- En Supabase existe; en una base de pruebas puede no existir.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Supabase también le da TODO por defecto a service_role. El trigger ya
    -- rechazaría el UPDATE/DELETE, pero la API no tiene por qué poder
    -- intentarlo: su trabajo es agregar y consultar, y nada más.
    revoke update, delete, truncate on public.aceptacion_terminos from service_role;
    grant select, insert on public.aceptacion_terminos to service_role;
    grant usage on sequence public.aceptacion_terminos_id_seq to service_role;
    grant execute on function public.terminos_aceptados(uuid, text, text) to service_role;
    grant execute on function public.purgar_aceptaciones_terminos(timestamptz) to service_role;
  end if;
end
$grants$;

-- RLS. La escribe el servidor con service_role, que salta la RLS; acá sólo se
-- decide quién puede LEER. Administración, para auditar o atender una
-- solicitud ARCO. Nadie más: no hay política para que cada quien vea la suya
-- porque la IP y el navegador no son algo que el cliente necesite de vuelta.
alter table public.aceptacion_terminos enable row level security;

drop policy if exists aceptacion_terminos_select_admin on public.aceptacion_terminos;
create policy aceptacion_terminos_select_admin
  on public.aceptacion_terminos for select
  to authenticated
  using ((select public.es_admin()));

grant select on public.aceptacion_terminos to authenticated;

commit;
