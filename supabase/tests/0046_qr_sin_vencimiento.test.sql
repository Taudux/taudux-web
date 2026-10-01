\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_qr_sin_vencimiento_0046_test' then
    raise exception 'Refusing to run outside taudux_qr_sin_vencimiento_0046_test';
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
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz
);

-- Mismo stand-in de auth.uid() que 0027.test: lee el GUC que PostgREST fija por
-- request, así las policies corren por el camino real bajo `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  apellidos text,
  rol text not null default 'usuario'
);

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

-- u1/u2: cuentas normales · u3: admin · u4: acceso ilimitado · u5: sin
-- confirmar (no tiene perfil) · u6: techo diario · u7: cuenta que se borra.
insert into auth.users (id, email, email_confirmed_at) values
  ('46000000-0000-4000-8000-000000000001', 'uno@example.com', now()),
  ('46000000-0000-4000-8000-000000000002', 'dos@example.com', now()),
  ('46000000-0000-4000-8000-000000000003', 'admin@example.com', now()),
  ('46000000-0000-4000-8000-000000000004', 'ilimitado@example.com', now()),
  ('46000000-0000-4000-8000-000000000005', 'sinconfirmar@example.com', null),
  ('46000000-0000-4000-8000-000000000006', 'seis@example.com', now()),
  ('46000000-0000-4000-8000-000000000007', 'siete@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('46000000-0000-4000-8000-000000000001', 'Uno', 'usuario'),
  ('46000000-0000-4000-8000-000000000002', 'Dos', 'usuario'),
  ('46000000-0000-4000-8000-000000000003', 'Admin', 'admin'),
  ('46000000-0000-4000-8000-000000000004', 'Ilimitado', 'usuario'),
  ('46000000-0000-4000-8000-000000000006', 'Seis', 'usuario'),
  ('46000000-0000-4000-8000-000000000007', 'Siete', 'usuario');

-- 0044 deja el esquema QR. 0045 (pg_cron/pg_net/vault) se omite a propósito:
-- 0046 no depende de ella y esas extensiones no existen en la base desechable.
\ir ../migrations/0044_qr_codigos.sql
\ir ../migrations/0046_qr_sin_vencimiento.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- Prepara: u1 dueño con 3 QR (A vigente, B vencido, C eliminado).
select (public.qr_crear('46000000-0000-4000-8000-000000000001', 'https://forms.gle/a', 'A', true, true)).codigo;
select (public.qr_crear('46000000-0000-4000-8000-000000000001', 'https://forms.gle/b', 'B', true, true)).codigo;
select (public.qr_crear('46000000-0000-4000-8000-000000000001', 'https://forms.gle/c', 'C', true, true)).codigo;
update public.qr_codigos set vence_en = now() - interval '1 day' where titulo = 'B';
update public.qr_codigos set eliminado_en = now(), eliminado_por = 'usuario' where titulo = 'C';

-- 1. Privilegios: anon no ejecuta; un usuario normal entra pero es rechazado.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $anon$
begin
  begin
    perform public.qr_cambiar_vencimiento(1, true);
    raise exception 'anon no debió poder ejecutar';
  exception
    when insufficient_privilege then null;
  end;
end
$anon$;
reset role;

select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000002', false);
set role authenticated;
do $no_admin$
begin
  begin
    perform public.qr_cambiar_vencimiento(1, true);
    raise exception 'un usuario normal no cambia vencimientos';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'qr_solo_admin' then raise; end if;
  end;
end
$no_admin$;
reset role;
select pg_temp.assert_true(
  (select vence_en is not null from public.qr_codigos where titulo = 'A'),
  'el intento de un no admin no cambió nada'
);

-- 2. Admin: quitar y devolver el vencimiento.
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000003', false);
set role authenticated;
do $admin$
declare
  v public.qr_codigos%rowtype;
  v_a bigint;
  v_b bigint;
  v_c bigint;
begin
  select id into v_a from public.qr_codigos where titulo = 'A';
  select id into v_b from public.qr_codigos where titulo = 'B';
  select id into v_c from public.qr_codigos where titulo = 'C';

  v := public.qr_cambiar_vencimiento(v_a, true);
  if v.vence_en is not null or v.id <> v_a then
    raise exception 'quitar el vencimiento deja vence_en en null y devuelve la fila';
  end if;

  v := public.qr_cambiar_vencimiento(v_a, false);
  if v.vence_en is null
     or v.vence_en not between now() + interval '7 days' - interval '1 minute'
                           and now() + interval '7 days' + interval '1 minute' then
    raise exception 'devolverlo vuelve a vencer en 7 días (plan free), hubo %', v.vence_en;
  end if;

  begin
    perform public.qr_cambiar_vencimiento(v_c, true);
    raise exception 'un QR eliminado no se modifica';
  exception
    when raise_exception then
      if sqlerrm <> 'qr_eliminado' then raise; end if;
  end;

  begin
    perform public.qr_cambiar_vencimiento(-1, true);
    raise exception 'un id inexistente no se modifica';
  exception
    when raise_exception then
      if sqlerrm <> 'qr_no_existe' then raise; end if;
  end;

  -- El vencido, al quitarle el vencimiento, vuelve a activo.
  perform public.qr_cambiar_vencimiento(v_b, true);
end
$admin$;
reset role;

select pg_temp.assert_true(
  (select vence_en is null from public.qr_codigos where titulo = 'B'),
  'el QR vencido quedó sin vencimiento'
);
select pg_temp.assert_true(
  (select vence_en is not null from public.qr_codigos where titulo = 'C'),
  'el eliminado conserva su vencimiento'
);

set role service_role;
select pg_temp.assert_true(
  (select estado = 'activo' from public.qr_resolver(
     (select codigo from public.qr_codigos where titulo = 'B'))),
  'un QR vencido al que se le quitó el vencimiento resuelve como activo'
);
reset role;

-- Y devolverle el vencimiento a un vencido lo revive por 7 días desde ahora.
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000003', false);
select public.qr_cambiar_vencimiento((select id from public.qr_codigos where titulo = 'B'), false);
select pg_temp.assert_true(
  (select vence_en > now() + interval '6 days' from public.qr_codigos where titulo = 'B'),
  'devolver el vencimiento recalcula desde ahora'
);
select set_config('request.jwt.claim.sub', '', false);

\echo 'OK 0046_qr_sin_vencimiento'
