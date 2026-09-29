-- Generador de QR (Tools → Generador de QR). Cada QR apunta a
-- https://go.taudux.com/<codigo>, y el redireccionador (qr-redireccion/) lo
-- manda al destino que guardó quien lo creó.
--
-- EL RIESGO QUE MANDA EN TODO ESTE ARCHIVO: ser el proveedor de un link
-- malicioso. De ahí salen las tres decisiones de fondo:
--
--   1. Sólo crea QR una cuenta confirmada (existe en public.perfiles, 0003), y
--      cada QR guarda quién lo creó. Si alguien abusa, se sabe quién fue.
--   2. Nadie escribe estas tablas desde el navegador. Crear pasa por la edge
--      function crear-qr, que revisa el link (reglas + Google Web Risk) y
--      luego llama a qr_crear() con service_role. Si `authenticated` pudiera
--      insertar, la revisión sería decorativa.
--   3. Eliminar no borra el rastro: el QR desaparece para su dueño, pero el
--      registro (quién, qué link, cuándo) se conserva 90 días para atender
--      reportes de abuso, y después se purga (0045).
--
-- LAS REGLAS DEL PLAN GRATIS, y dónde vive cada una:
--
--   · 5 QR activos a la vez → qr_planes.limite.
--   · Cada QR dura 7 días → qr_planes.duracion, fijada por qr_crear() al
--     crear. Ninguna columna de qr_codigos es escribible desde el cliente, así
--     que nadie puede estirarla.
--   · Un QR vencido libera su lugar (decisión de producto del 2026-09-28): el
--     conteo sólo mira los que no han vencido. El vencido sigue en la lista
--     como historial hasta que su dueño lo elimine o se purgue.
--   · No se edita el destino: para corregir un link se elimina y se crea otro.
--     Así nadie pasa la revisión con un link inocente para cambiarlo después
--     por uno malicioso. Por eso no hay función de "editar".
--
-- LOS PLANES DE PAGO siguen el patrón del extractor (0029): el catálogo es una
-- TABLA con interruptor `activo`. Encender uno es un insert/update acá, sin
-- desplegar nada. Hoy sólo existe `free`.
--
-- ADMINISTRADORES: public.perfiles.rol = 'admin' vía public.es_admin() (0004).
-- No hay tabla propia de administradores: dos fuentes de verdad para "quién es
-- admin" es como se pierden los permisos (0029).
--
-- UN CÓDIGO NUNCA SE REUTILIZA. Un QR impreso no puede terminar llevando al
-- link de otra persona. Mientras la fila existe, lo garantiza el unique de
-- `codigo`; después de la purga, qr_codigos_retirados.
--
-- Aplicar dos veces NO es seguro (create table sin if not exists), pero no hay
-- estado mutable aparte del catálogo: un reintento tras un fallo a mitad de
-- camino, sobre una base que nunca llegó a tener las tablas, es un re-run
-- limpio.

begin;

do $preflight$
begin
  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0044 preflight failed: public.perfiles is required';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0044 preflight failed: public.es_admin() is required (0004)';
  end if;
end
$preflight$;

-- --------------------------------------------------------------------------- --
-- Catálogo de planes
-- --------------------------------------------------------------------------- --

-- `limite` null = sin límite de QR activos. `duracion` null = los QR no vencen.
create table public.qr_planes (
  clave    text primary key,
  nombre   text not null,
  limite   int,
  duracion interval,
  activo   boolean not null default false,
  orden    int not null default 0,
  constraint qr_planes_limite_valido check (limite is null or limite >= 0),
  constraint qr_planes_duracion_valida check (duracion is null or duracion > interval '0')
);

comment on column public.qr_planes.activo is
  'El interruptor: un plan inactivo no rige para nadie (qr_crear cae a free). '
  'Lanzar un plan de pago es un insert/update acá, sin desplegar.';

insert into public.qr_planes (clave, nombre, limite, duracion, activo, orden)
values ('free', 'Gratis', 5, interval '7 days', true, 0)
on conflict (clave) do nothing;

-- --------------------------------------------------------------------------- --
-- Acceso por persona
-- --------------------------------------------------------------------------- --

-- Sin fila = plan free, sin bloqueo. `ilimitado` está aparte del plan por lo
-- mismo que en extractor_acceso (0029): dar acceso sin límites a una cuenta
-- (los QR de los propios eventos de Taudux, un socio) no debe obligar a
-- inventarle un plan. Se concede desde el SQL Editor, con `motivo`.
create table public.qr_acceso (
  user_id         uuid primary key references auth.users on delete cascade,
  plan            text not null default 'free' references public.qr_planes (clave),
  ilimitado       boolean not null default false,
  motivo          text,
  bloqueado       boolean not null default false,
  bloqueo_motivo  text,
  -- on delete set null: si se borra la cuenta del administrador que tocó la
  -- fila, la fila sigue valiendo; sin esto el borrado de esa cuenta fallaría.
  actualizado_por uuid references auth.users on delete set null,
  actualizado_en  timestamptz not null default now(),
  constraint qr_acceso_bloqueo_con_motivo
    check (not bloqueado or nullif(btrim(bloqueo_motivo), '') is not null)
);

comment on column public.qr_acceso.motivo is
  'Por qué se concedió `ilimitado` o un plan distinto ("QR de eventos de '
  'Taudux", "socio"). Sin esto, en tres meses nadie recuerda por qué.';

-- --------------------------------------------------------------------------- --
-- Los QR
-- --------------------------------------------------------------------------- --

create table public.qr_codigos (
  id                   bigint generated always as identity primary key,
  -- Sólo códigos generados por qr_generar_codigo(): 6 caracteres de un
  -- alfabeto sin 0/o ni 1/l/i, que se pueden dictar sin confusiones.
  codigo               text not null unique,
  destino              text not null,
  titulo               text,

  -- SIN foreign key a auth.users, a propósito (mismo criterio que
  -- eventos_negocio, 0027): el registro debe sobrevivir 90 días al borrado de
  -- la cuenta para poder atender un reporte de abuso. Al borrarse la cuenta,
  -- qr_baja_cuenta() marca sus QR como eliminados y dejan de funcionar.
  usuario_id           uuid not null,

  -- Cómo se aprobó el link: si el dominio estaba en la lista confiable de
  -- crear-qr, y cuándo lo revisó Google Web Risk por última vez. null en
  -- web_risk_revisado_en = nunca lo revisó (Web Risk sin configurar o caído;
  -- crear-qr sólo lo permite para dominios de la lista confiable).
  dominio_confiable    boolean not null,
  web_risk_revisado_en timestamptz,

  creado_en            timestamptz not null default now(),
  -- null = no vence (acceso ilimitado o plan sin duración).
  vence_en             timestamptz,

  eliminado_en         timestamptz,
  eliminado_por        text,

  bloqueado_en         timestamptz,
  bloqueo_motivo       text,
  bloqueado_por        text,

  constraint qr_codigos_codigo_valido
    check (codigo ~ '^[2-9a-hjkmnp-z]{6}$'),
  constraint qr_codigos_destino_https
    check (destino ~ '^https://' and char_length(destino) <= 2048),
  constraint qr_codigos_titulo_acotado
    check (titulo is null or char_length(titulo) between 1 and 80),
  constraint qr_codigos_eliminado_por_valido
    check (eliminado_por in ('usuario', 'cuenta_eliminada')),
  constraint qr_codigos_eliminado_completo
    check ((eliminado_en is null) = (eliminado_por is null)),
  constraint qr_codigos_bloqueado_por_valido
    check (bloqueado_por in ('administracion', 'cuenta', 'revision_automatica')),
  constraint qr_codigos_bloqueo_completo
    check ((bloqueado_en is null) = (bloqueado_por is null)
       and (bloqueado_en is null) = (bloqueo_motivo is null))
);

comment on column public.qr_codigos.bloqueado_por is
  'administracion = un admin lo bloqueó a mano. cuenta = se bloqueó la cuenta '
  'entera (desbloquearla lo restaura). revision_automatica = Google Web Risk lo '
  'marcó en la revisión diaria (0045).';

create index qr_codigos_usuario_creado_idx
  on public.qr_codigos (usuario_id, creado_en desc);

-- Códigos que ya se usaron y cuya fila se purgó. Sólo existe para que
-- qr_generar_codigo() no los vuelva a sortear: sin esto, 90 días después de la
-- purga un QR impreso podría empezar a llevar al link de otra persona.
create table public.qr_codigos_retirados (
  codigo      text primary key,
  retirado_en timestamptz not null default now()
);

-- --------------------------------------------------------------------------- --
-- Escaneos
-- --------------------------------------------------------------------------- --

-- Quien escanea no tiene cuenta ni la necesita. Se guarda lo mínimo para darle
-- al dueño un conteo útil: país (lo resuelve Vercel) y tipo de dispositivo
-- (lo clasifica el redireccionador). NUNCA la IP ni el user agent completo.
create table public.qr_escaneos (
  id           bigint generated always as identity primary key,
  qr_id        bigint not null references public.qr_codigos (id) on delete cascade,
  escaneado_en timestamptz not null default now(),
  pais         text,
  dispositivo  text not null default 'otro',
  constraint qr_escaneos_pais_iso check (pais is null or pais ~ '^[A-Z]{2}$'),
  constraint qr_escaneos_dispositivo_valido
    check (dispositivo in ('movil', 'tableta', 'escritorio', 'otro'))
);

create index qr_escaneos_qr_fecha_idx
  on public.qr_escaneos (qr_id, escaneado_en desc);

-- --------------------------------------------------------------------------- --
-- RLS y permisos
-- --------------------------------------------------------------------------- --

alter table public.qr_planes enable row level security;
alter table public.qr_acceso enable row level security;
alter table public.qr_codigos enable row level security;
alter table public.qr_codigos_retirados enable row level security;
alter table public.qr_escaneos enable row level security;

-- Supabase concede todo a anon/authenticated por default privileges; acá se
-- quita y se devuelve sólo la lectura. Ninguna escritura desde el navegador:
-- todo cambio pasa por las funciones de abajo.
revoke all on public.qr_planes, public.qr_acceso, public.qr_codigos,
  public.qr_codigos_retirados, public.qr_escaneos
  from anon, authenticated;

grant select on public.qr_planes to anon, authenticated;
grant select on public.qr_acceso, public.qr_codigos, public.qr_escaneos to authenticated;

-- El catálogo activo es público: la página lo muestra aun sin sesión.
create policy qr_planes_select_activos
  on public.qr_planes for select
  to anon, authenticated
  using (activo);

create policy qr_planes_select_admin
  on public.qr_planes for select
  to authenticated
  using ((select public.es_admin()));

create policy qr_acceso_select_propio
  on public.qr_acceso for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy qr_acceso_select_admin
  on public.qr_acceso for select
  to authenticated
  using ((select public.es_admin()));

-- El dueño ve sus QR, incluidos los vencidos y bloqueados (tiene que saber
-- por qué uno dejó de funcionar). Los que eliminó ya no son suyos de ver.
create policy qr_codigos_select_propio
  on public.qr_codigos for select
  to authenticated
  using (usuario_id = (select auth.uid()) and eliminado_en is null);

create policy qr_codigos_select_admin
  on public.qr_codigos for select
  to authenticated
  using ((select public.es_admin()));

create policy qr_escaneos_select_propio
  on public.qr_escaneos for select
  to authenticated
  using (exists (
    select 1 from public.qr_codigos c
     where c.id = qr_id
       and c.usuario_id = (select auth.uid())
       and c.eliminado_en is null
  ));

create policy qr_escaneos_select_admin
  on public.qr_escaneos for select
  to authenticated
  using ((select public.es_admin()));

-- qr_codigos_retirados: sin policies. Nadie la lee desde la API.

-- --------------------------------------------------------------------------- --
-- Funciones
-- --------------------------------------------------------------------------- --

-- Seis caracteres de '23456789abcdefghjkmnpqrstuvwxyz' (31 símbolos, ~887
-- millones de combinaciones). La aleatoriedad sale de gen_random_uuid(), que
-- ya usa el resto del repo (0012, 0015) y no pide pgcrypto.
create or replace function public.qr_generar_codigo()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alfabeto constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  v_bytes bytea;
  v_byte int;
  v_codigo text := '';
begin
  while pg_catalog.length(v_codigo) < 6 loop
    v_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    for i in 0..15 loop
      -- Los bytes 6 y 8 de un uuid v4 cargan la versión y la variante: no son
      -- aleatorios. Y un byte >= 248 se descarta porque 256 no es múltiplo de
      -- 31: tomarlo sesgaría el sorteo hacia los primeros símbolos.
      continue when i in (6, 8);
      v_byte := pg_catalog.get_byte(v_bytes, i);
      continue when v_byte >= 248;
      v_codigo := v_codigo || pg_catalog.substr(v_alfabeto, (v_byte % 31) + 1, 1);
      exit when pg_catalog.length(v_codigo) = 6;
    end loop;
  end loop;
  return v_codigo;
end;
$$;

-- El plan que rige para una cuenta: el suyo si está activo, si no `free`.
create or replace function public.qr_plan_de(p_usuario uuid)
returns public.qr_planes
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
    from public.qr_planes p
   where p.clave = coalesce(
           (select a.plan from public.qr_acceso a
             where a.user_id = p_usuario and exists (
               select 1 from public.qr_planes x where x.clave = a.plan and x.activo)),
           'free')
$$;

-- Por qué una cuenta NO puede crear un QR ahora, o null si sí puede.
-- crear-qr la llama ANTES de consultar a Google Web Risk, para no gastar una
-- revisión en alguien que de todos modos no puede crear; qr_crear() la vuelve a
-- llamar dentro del candado, que es la verificación que cuenta.
create or replace function public.qr_motivo_rechazo(p_usuario uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Techo contra el abuso de crear y eliminar en ciclo: cada alta cuesta una
  -- consulta a Web Risk. No aplica a cuentas ilimitadas.
  v_maximo_diario constant int := 20;
  v_acceso public.qr_acceso%rowtype;
  v_plan public.qr_planes%rowtype;
  v_activos int;
  v_ultimo_dia int;
begin
  if not exists (select 1 from public.perfiles where id = p_usuario) then
    return 'qr_sin_cuenta';
  end if;

  select * into v_acceso from public.qr_acceso where user_id = p_usuario;
  if v_acceso.bloqueado then
    return 'qr_cuenta_bloqueada';
  end if;
  if v_acceso.ilimitado then
    return null;
  end if;

  v_plan := public.qr_plan_de(p_usuario);
  if v_plan.limite is not null then
    -- Un vencido libera su lugar: sólo cuentan los que siguen vigentes.
    select count(*) into v_activos
      from public.qr_codigos
     where usuario_id = p_usuario
       and eliminado_en is null
       and (vence_en is null or vence_en > now());
    if v_activos >= v_plan.limite then
      return 'qr_limite_alcanzado';
    end if;
  end if;

  -- Cuenta también los eliminados: de eso se trata el techo.
  select count(*) into v_ultimo_dia
    from public.qr_codigos
   where usuario_id = p_usuario
     and creado_en > now() - interval '1 day';
  if v_ultimo_dia >= v_maximo_diario then
    return 'qr_demasiados_hoy';
  end if;

  return null;
end;
$$;

-- Crea un QR. Sólo la llama crear-qr (service_role), DESPUÉS de revisar el
-- link: esta función confía en `p_destino` y en cómo se revisó.
create or replace function public.qr_crear(
  p_usuario           uuid,
  p_destino           text,
  p_titulo            text,
  p_dominio_confiable boolean,
  p_web_risk_revisado boolean
)
returns public.qr_codigos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text;
  v_acceso public.qr_acceso%rowtype;
  v_plan public.qr_planes%rowtype;
  v_vence timestamptz;
  v_codigo text;
  v_fila public.qr_codigos%rowtype;
begin
  -- Serializa las altas de UNA cuenta: sin esto, dos pestañas creando a la vez
  -- con 4 activos pasarían las dos el conteo y la cuenta quedaría con 6.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('qr_crear:' || p_usuario::text, 0));

  v_motivo := public.qr_motivo_rechazo(p_usuario);
  if v_motivo is not null then
    raise exception using errcode = 'P0001', message = v_motivo;
  end if;

  select * into v_acceso from public.qr_acceso where user_id = p_usuario;
  v_plan := public.qr_plan_de(p_usuario);
  v_vence := case
    when coalesce(v_acceso.ilimitado, false) or v_plan.duracion is null then null
    else now() + v_plan.duracion
  end;

  for intento in 1..5 loop
    v_codigo := public.qr_generar_codigo();
    continue when exists (
      select 1 from public.qr_codigos_retirados where codigo = v_codigo);
    begin
      insert into public.qr_codigos
        (codigo, destino, titulo, usuario_id, dominio_confiable, web_risk_revisado_en, vence_en)
      values
        (v_codigo, p_destino, nullif(pg_catalog.btrim(p_titulo), ''), p_usuario,
         p_dominio_confiable, case when p_web_risk_revisado then now() end, v_vence)
      returning * into v_fila;
      return v_fila;
    exception
      when unique_violation then
        -- Otro QR se quedó con este código entre el sorteo y el insert.
        null;
    end;
  end loop;

  raise exception using errcode = 'P0001', message = 'qr_sin_codigo_libre';
end;
$$;

-- El dueño elimina uno de sus QR. Deja de funcionar al instante y libera su
-- lugar; el registro se conserva 90 días (ver el encabezado).
create or replace function public.qr_eliminar(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qr_codigos
     set eliminado_en = now(),
         eliminado_por = 'usuario'
   where id = p_id
     and usuario_id = (select auth.uid())
     and eliminado_en is null;
  return found;
end;
$$;

-- Lo que hace el redireccionador en cada escaneo. Registra el escaneo sólo si
-- el QR está activo: un QR vencido o bloqueado no suma visitas.
create or replace function public.qr_resolver(
  p_codigo      text,
  p_pais        text default null,
  p_dispositivo text default null
)
returns table (estado text, destino text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.qr_codigos%rowtype;
begin
  select * into v
    from public.qr_codigos c
   where c.codigo = pg_catalog.lower(pg_catalog.btrim(p_codigo));

  if not found or v.eliminado_en is not null then
    return query select 'inexistente'::text, null::text;
    return;
  end if;
  if v.bloqueado_en is not null then
    return query select 'bloqueado'::text, null::text;
    return;
  end if;
  if v.vence_en is not null and v.vence_en <= now() then
    return query select 'vencido'::text, null::text;
    return;
  end if;

  insert into public.qr_escaneos (qr_id, pais, dispositivo)
  values (
    v.id,
    case when pg_catalog.upper(p_pais) ~ '^[A-Z]{2}$' then pg_catalog.upper(p_pais) end,
    case when p_dispositivo in ('movil', 'tableta', 'escritorio') then p_dispositivo else 'otro' end
  );

  return query select 'activo'::text, v.destino;
end;
$$;

-- Moderación de UN QR. Sólo administración (es_admin() se comprueba acá
-- adentro: la función es security definer y la RLS no la protege).
create or replace function public.qr_moderar(
  p_id       bigint,
  p_bloquear boolean,
  p_motivo   text default null
)
returns public.qr_codigos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.qr_codigos%rowtype;
begin
  if not public.es_admin() then
    raise exception using errcode = '42501', message = 'qr_solo_admin';
  end if;

  if p_bloquear then
    if nullif(pg_catalog.btrim(p_motivo), '') is null then
      raise exception using errcode = 'P0001', message = 'qr_motivo_requerido';
    end if;
    update public.qr_codigos
       set bloqueado_en = now(),
           bloqueo_motivo = pg_catalog.btrim(p_motivo),
           bloqueado_por = 'administracion'
     where id = p_id
    returning * into v;
  else
    update public.qr_codigos
       set bloqueado_en = null,
           bloqueo_motivo = null,
           bloqueado_por = null
     where id = p_id
    returning * into v;
  end if;

  if not found then
    raise exception using errcode = 'P0001', message = 'qr_no_existe';
  end if;
  return v;
end;
$$;

-- Moderación de una CUENTA: bloquearla le impide crear QR y apaga los que
-- tiene. Desbloquearla restaura sólo los que se apagaron por el bloqueo de la
-- cuenta (bloqueado_por = 'cuenta'), no los que un admin bloqueó uno por uno.
-- Devuelve cuántos QR cambiaron.
create or replace function public.qr_moderar_cuenta(
  p_usuario  uuid,
  p_bloquear boolean,
  p_motivo   text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas int;
begin
  if not public.es_admin() then
    raise exception using errcode = '42501', message = 'qr_solo_admin';
  end if;
  if p_bloquear and nullif(pg_catalog.btrim(p_motivo), '') is null then
    raise exception using errcode = 'P0001', message = 'qr_motivo_requerido';
  end if;
  if not exists (select 1 from auth.users where id = p_usuario) then
    raise exception using errcode = 'P0001', message = 'qr_cuenta_inexistente';
  end if;

  insert into public.qr_acceso (user_id, bloqueado, bloqueo_motivo, actualizado_por, actualizado_en)
  values (
    p_usuario,
    p_bloquear,
    case when p_bloquear then pg_catalog.btrim(p_motivo) end,
    (select auth.uid()),
    now()
  )
  on conflict (user_id) do update
    set bloqueado = excluded.bloqueado,
        bloqueo_motivo = excluded.bloqueo_motivo,
        actualizado_por = excluded.actualizado_por,
        actualizado_en = excluded.actualizado_en;

  if p_bloquear then
    update public.qr_codigos
       set bloqueado_en = now(),
           bloqueo_motivo = 'Cuenta bloqueada: ' || pg_catalog.btrim(p_motivo),
           bloqueado_por = 'cuenta'
     where usuario_id = p_usuario
       and eliminado_en is null
       and bloqueado_en is null;
  else
    update public.qr_codigos
       set bloqueado_en = null,
           bloqueo_motivo = null,
           bloqueado_por = null
     where usuario_id = p_usuario
       and bloqueado_por = 'cuenta';
  end if;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- La revisión diaria (revisar-qr, 0045): qué QR le tocan hoy. Los activos que
-- no se revisaron en las últimas 20 horas, los nunca revisados primero.
create or replace function public.qr_pendientes_revision(p_limite int default 200)
returns table (id bigint, destino text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.destino
    from public.qr_codigos c
   where c.eliminado_en is null
     and c.bloqueado_en is null
     and (c.vence_en is null or c.vence_en > now())
     and (c.web_risk_revisado_en is null
          or c.web_risk_revisado_en < now() - interval '20 hours')
   order by c.web_risk_revisado_en nulls first, c.id
   limit greatest(p_limite, 0)
$$;

-- Anota el resultado de la revisión diaria. Con amenazas, el QR se bloquea
-- (salvo que ya estuviera bloqueado: ahí manda el bloqueo anterior).
create or replace function public.qr_registrar_revision(p_id bigint, p_amenazas text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.array_length(p_amenazas, 1), 0) > 0 then
    update public.qr_codigos
       set web_risk_revisado_en = now(),
           bloqueado_en = coalesce(bloqueado_en, now()),
           bloqueo_motivo = coalesce(bloqueo_motivo,
             'Google Web Risk: ' || pg_catalog.array_to_string(p_amenazas, ', ')),
           bloqueado_por = coalesce(bloqueado_por, 'revision_automatica')
     where id = p_id;
  else
    update public.qr_codigos
       set web_risk_revisado_en = now()
     where id = p_id;
  end if;
end;
$$;

-- Purga (la agenda 0045): borra lo eliminado o vencido hace más de 90 días, y
-- retira sus códigos para que nunca se vuelvan a sortear. Devuelve cuántos.
create or replace function public.qr_purgar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas int;
begin
  with purgados as (
    delete from public.qr_codigos
     where (eliminado_en is not null and eliminado_en < now() - interval '90 days')
        or (vence_en is not null and vence_en < now() - interval '90 days')
    returning codigo
  )
  insert into public.qr_codigos_retirados (codigo)
  select codigo from purgados
  on conflict (codigo) do nothing;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- Al borrarse una cuenta, sus QR dejan de funcionar al instante. Mismo molde
-- que registrar_baja_cuenta() (0027): un fallo acá NO debe poder abortar el
-- borrado real de la cuenta, así que se atrapa y queda en el log.
create or replace function public.qr_baja_cuenta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  begin
    update public.qr_codigos
       set eliminado_en = now(),
           eliminado_por = 'cuenta_eliminada'
     where usuario_id = old.id
       and eliminado_en is null;
  exception
    when others then
      raise warning 'qr_baja_cuenta failed for %: %', old.id, sqlerrm;
  end;
  return null;
end
$function$;

create trigger perfiles_qr_baja
  after delete on public.perfiles
  for each row execute function public.qr_baja_cuenta();

-- --------------------------------------------------------------------------- --
-- Quién puede llamar a qué
-- --------------------------------------------------------------------------- --

-- Supabase concede EXECUTE a anon/authenticated por default privileges. Se
-- quita de todas y se devuelve una por una.
revoke all on function public.qr_generar_codigo() from public, anon, authenticated;
revoke all on function public.qr_plan_de(uuid) from public, anon, authenticated;
revoke all on function public.qr_motivo_rechazo(uuid) from public, anon, authenticated;
revoke all on function public.qr_crear(uuid, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.qr_eliminar(bigint) from public, anon, authenticated;
revoke all on function public.qr_resolver(text, text, text) from public, anon, authenticated;
revoke all on function public.qr_moderar(bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.qr_moderar_cuenta(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.qr_pendientes_revision(int) from public, anon, authenticated;
revoke all on function public.qr_registrar_revision(bigint, text[]) from public, anon, authenticated;
revoke all on function public.qr_purgar() from public, anon, authenticated;
revoke all on function public.qr_baja_cuenta() from public, anon, authenticated;

-- Desde el navegador: eliminar lo propio, y moderar (que verifica es_admin()).
grant execute on function public.qr_eliminar(bigint) to authenticated;
grant execute on function public.qr_moderar(bigint, boolean, text) to authenticated;
grant execute on function public.qr_moderar_cuenta(uuid, boolean, text) to authenticated;

-- Desde los servidores (crear-qr, revisar-qr, el redireccionador).
grant execute on function public.qr_motivo_rechazo(uuid) to service_role;
grant execute on function public.qr_crear(uuid, text, text, boolean, boolean) to service_role;
grant execute on function public.qr_resolver(text, text, text) to service_role;
grant execute on function public.qr_pendientes_revision(int) to service_role;
grant execute on function public.qr_registrar_revision(bigint, text[]) to service_role;
grant execute on function public.qr_purgar() to service_role;

commit;
