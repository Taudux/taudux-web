\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_cuentas_prueba_0028_test' then
    raise exception 'Refusing to run outside taudux_cuentas_prueba_0028_test';
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

create schema auth;
create table auth.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  deleted_at timestamptz
);

-- Minimal stand-in for Supabase's real auth.uid(): reads the same GUC
-- (request.jwt.claim.sub) PostgREST sets per request, so policies written
-- against auth.uid() exercise the real RLS path under `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  rol text not null default 'usuario',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Mismo patrón de grant por columna que 0001_crear_perfiles.sql:26-27: nadie
-- tiene UPDATE por defecto, sólo se abre una columna puntual a
-- authenticated. Es el control positivo del caso 5: si `nombre` es
-- actualizable y `es_prueba` no, la ausencia de grant sobre `es_prueba` en
-- 0028 es una decisión verificada, no un olvido casual del fixture.
revoke update on public.perfiles from anon, authenticated;
grant update (nombre) on public.perfiles to authenticated;

-- Real es_admin(), mismo shape que 0004: el preflight de 0027 lo exige.
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

-- Sembrado ANTES del \ir a propósito: ejercita el backfill de 0027 (esta
-- suite también re-corre esa aserción para confirmar cero regresión).
insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-4000-8000-000000000001', 'usuario1@example.com', now()),
  ('10000000-0000-4000-8000-000000000002', 'usuario2@example.com', now()),
  ('10000000-0000-4000-8000-000000000003', 'usuario3@example.com', now());
insert into public.perfiles (id, nombre, rol, creado_en) values
  ('10000000-0000-4000-8000-000000000001', 'Uno', 'usuario', '2026-01-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000002', 'Dos', 'usuario', '2026-01-02T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000003', 'Tres', 'usuario', '2026-01-03T00:00:00Z');

\ir ../migrations/0027_eventos_negocio.sql
\ir ../migrations/0028_cuentas_prueba.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- === Re-corrida de aserciones clave de 0027 (cero regresión) ===============

-- 1. Backfill: los 3 perfiles sembrados antes del \ir generaron su
-- alta_confirmada, con ocurrido_en = perfiles.creado_en (no now()).
select pg_temp.assert_true(
  (select count(*) = 3 from public.eventos_negocio
   where tipo = 'alta_confirmada' and origen = 'backfill_0027'),
  'el backfill de 0027 sigue generando exactamente 3 altas'
);
select pg_temp.assert_true(
  (select ocurrido_en = '2026-01-01T00:00:00Z'::timestamptz
   from public.eventos_negocio
   where tipo = 'alta_confirmada'
     and usuario_ref = '10000000-0000-4000-8000-000000000001'),
  'el backfill sigue preservando creado_en como ocurrido_en, no now()'
);

-- 2. Índice único: una segunda alta manual para un usuario que ya la tiene
-- (por el backfill) sigue violando el índice único parcial de 0027.
do $dup_alta$
begin
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, origen)
    values ('alta_confirmada', '10000000-0000-4000-8000-000000000001', 'manual');
    raise exception 'una alta duplicada para el mismo usuario debió fallar';
  exception
    when unique_violation then null;
  end;
end
$dup_alta$;

-- === Columna es_prueba: default y privilegios (caso 5) =====================

select pg_temp.assert_true(
  (select es_prueba = false from public.perfiles
   where id = '10000000-0000-4000-8000-000000000001'),
  'es_prueba nace en false por default, incluso en filas sembradas antes de 0028'
);

select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.perfiles', 'nombre', 'update'),
  'control positivo: authenticated puede actualizar nombre (el grant del fixture funciona)'
);
select pg_temp.assert_true(
  not has_column_privilege('authenticated', 'public.perfiles', 'es_prueba', 'update'),
  'authenticated NO puede actualizar es_prueba: es una marca operativa de Jorge, no autoservicio'
);

set role authenticated;
do $update_denied$
begin
  begin
    update public.perfiles set es_prueba = true
    where id = '10000000-0000-4000-8000-000000000001';
    raise exception 'authenticated no debería poder actualizar es_prueba';
  exception
    when insufficient_privilege then null;
  end;
end
$update_denied$;
reset role;

-- === Caso 2: cuenta NO marcada — sin regresión de comportamiento ===========

insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-4000-8000-000000000004', 'usuario4@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('10000000-0000-4000-8000-000000000004', 'Cuatro', 'usuario');
delete from auth.users where id = '10000000-0000-4000-8000-000000000004';
select pg_temp.assert_true(
  (select count(*) = 1 from public.eventos_negocio
   where tipo = 'baja_cuenta'
     and usuario_ref = '10000000-0000-4000-8000-000000000004'
     and origen = 'cascada_perfiles'),
  'borrar una cuenta NO marcada sigue registrando su baja_cuenta como hoy (cero regresión sobre 0027)'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.eventos_negocio
   where tipo = 'alta_confirmada' and usuario_ref = '10000000-0000-4000-8000-000000000004'),
  'una cuenta NO marcada conserva también su alta_confirmada tras el borrado'
);

-- === Caso 1: cuenta marcada — el borrado limpia TODO rastro =================

insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-4000-8000-000000000005', 'usuario5@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('10000000-0000-4000-8000-000000000005', 'Cinco', 'usuario');
-- El insert de arriba ya disparó el trigger de alta (perfiles_registrar_alta):
-- esta cuenta tiene una alta_confirmada registrada antes de marcarla.
select pg_temp.assert_true(
  (select count(*) = 1 from public.eventos_negocio
   where tipo = 'alta_confirmada' and usuario_ref = '10000000-0000-4000-8000-000000000005'),
  'la cuenta 005 tiene una alta_confirmada previa, antes de marcarla como de prueba'
);

update public.perfiles set es_prueba = true
where id = '10000000-0000-4000-8000-000000000005';

delete from auth.users where id = '10000000-0000-4000-8000-000000000005';
select pg_temp.assert_true(
  (select count(*) = 0 from public.eventos_negocio
   where usuario_ref = '10000000-0000-4000-8000-000000000005'),
  'borrar una cuenta marcada es_prueba limpia TODO rastro en eventos_negocio: ni la alta vieja ni una baja nueva'
);

-- === Caso 3: camino real de delete-account (edge function + cascada) =======
-- Simula exactamente lo que hace supabase/functions/delete-account/index.ts:
-- inserta la baja_cuenta con origen='autoservicio' MIENTRAS la cuenta todavía
-- existe, y recién después borra de auth.users. En producción la edge
-- function siempre corre antes que este trigger.

insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-4000-8000-000000000006', 'usuario6@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('10000000-0000-4000-8000-000000000006', 'Seis', 'usuario');
update public.perfiles set es_prueba = true
where id = '10000000-0000-4000-8000-000000000006';

insert into public.eventos_negocio (tipo, usuario_ref, origen, datos)
values (
  'baja_cuenta',
  '10000000-0000-4000-8000-000000000006',
  'autoservicio',
  jsonb_build_object('via', 'autoservicio')
);

delete from auth.users where id = '10000000-0000-4000-8000-000000000006';
select pg_temp.assert_true(
  (select count(*) = 0 from public.eventos_negocio
   where usuario_ref = '10000000-0000-4000-8000-000000000006'),
  'la cascada también limpia la baja insertada a mano por delete-account (origen=autoservicio) para una cuenta marcada'
);

-- === Caso 4: resiliencia — un fallo real en el trigger de baja no aborta ===
-- el borrado real. Va al final porque destruye la tabla a propósito; no hay
-- limpieza que hacer después. Se re-corre también el equivalente de 0027
-- para el trigger de ALTA, para confirmar que 0028 no lo debilitó.

drop table public.eventos_negocio;

insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-4000-8000-000000000007', 'usuario7@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('10000000-0000-4000-8000-000000000007', 'Siete', 'usuario');
select pg_temp.assert_true(
  exists (select 1 from public.perfiles where id = '10000000-0000-4000-8000-000000000007'),
  'un fallo real en el trigger de alta (tabla inexistente) no aborta el insert de perfiles (sin regresión sobre 0027)'
);

delete from auth.users where id = '10000000-0000-4000-8000-000000000007';
select pg_temp.assert_true(
  not exists (select 1 from public.perfiles where id = '10000000-0000-4000-8000-000000000007'),
  'un fallo real en el trigger de baja (tabla inexistente) no aborta el delete de perfiles, rama de cuenta NO marcada'
);

-- Misma prueba, pero por la rama nueva (DELETE en vez de INSERT) que 0028
-- agrega para cuentas marcadas: también debe caer en el warning, no abortar.
insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-4000-8000-000000000008', 'usuario8@example.com', now());
insert into public.perfiles (id, nombre, rol, es_prueba) values
  ('10000000-0000-4000-8000-000000000008', 'Ocho', 'usuario', true);
delete from auth.users where id = '10000000-0000-4000-8000-000000000008';
select pg_temp.assert_true(
  not exists (select 1 from public.perfiles where id = '10000000-0000-4000-8000-000000000008'),
  'un fallo real en el trigger de baja para una cuenta marcada (rama DELETE de 0028) tampoco aborta el borrado de perfiles'
);

select '0028 cuentas de prueba: PASS' as result;
