\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_qr_reportes_0046_test' then
    raise exception 'Refusing to run outside taudux_qr_reportes_0046_test';
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

-- Lo que Supabase concede por su cuenta (ver 0044.test).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default pg_catalog.gen_random_uuid(), email text);
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  rol text not null default 'usuario'
);

create function public.es_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

insert into auth.users (id, email) values
  ('46000000-0000-4000-8000-000000000001', 'duena@example.com'),
  ('46000000-0000-4000-8000-000000000002', 'admin@example.com');
insert into public.perfiles (id, nombre, rol) values
  ('46000000-0000-4000-8000-000000000001', 'Dueña', 'usuario'),
  ('46000000-0000-4000-8000-000000000002', 'Admin', 'admin');

\ir ../migrations/0044_qr_codigos.sql
\ir ../migrations/0046_qr_reportes.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

insert into public.qr_codigos (codigo, destino, usuario_id, dominio_confiable) values
  ('abcdef', 'https://sitio-raro.mx/login', '46000000-0000-4000-8000-000000000001', false),
  ('bcdefg', 'https://forms.gle/x', '46000000-0000-4000-8000-000000000001', true);

-- 1. Cualquiera reporta, sin cuenta, y el código se normaliza.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $anon$
begin
  if public.qr_reportar('  ABCDEF ', 'phishing', '  Me pidió la clave del banco  ', 'yo@correo.mx') <> 'ok' then
    raise exception 'anon debe poder reportar';
  end if;
  perform public.qr_reportar('abcdef', 'otro');
end
$anon$;
reset role;
select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(reportado_por is null) from public.qr_reportes),
  'dos reportes sin cuenta, sin reportado_por'
);
select pg_temp.assert_true(
  (select detalle = 'Me pidió la clave del banco' and contacto = 'yo@correo.mx'
     from public.qr_reportes where motivo = 'phishing'),
  'detalle recortado y contacto guardados'
);
select pg_temp.assert_true(
  (select detalle is null and contacto is null from public.qr_reportes where motivo = 'otro'),
  'sin detalle ni contacto quedan null'
);

-- 2. Con sesión queda quién reportó.
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', false);
set role authenticated;
do $con_sesion$
begin
  perform public.qr_reportar('bcdefg', 'fraude', null, null);
end
$con_sesion$;
reset role;
select pg_temp.assert_true(
  (select reportado_por = '46000000-0000-4000-8000-000000000001' from public.qr_reportes where motivo = 'fraude'),
  'el reporte con sesión guarda quién lo hizo'
);

-- 3. Lo inválido se rechaza con códigos que la página traduce.
do $invalidos$
begin
  begin
    perform public.qr_reportar('zzzzzz', 'phishing');
    raise exception 'un código inexistente debió fallar';
  exception when raise_exception then
    if sqlerrm <> 'qr_no_existe' then raise; end if;
  end;
  begin
    perform public.qr_reportar('abcdef', 'me cae mal');
    raise exception 'un motivo fuera de la lista debió fallar';
  exception when raise_exception then
    if sqlerrm <> 'qr_motivo_invalido' then raise; end if;
  end;
end
$invalidos$;

-- 4. Un QR eliminado se puede reportar: para eso se conserva el registro.
update public.qr_codigos set eliminado_en = now(), eliminado_por = 'usuario' where codigo = 'bcdefg';
select pg_temp.assert_true(public.qr_reportar('bcdefg', 'malware') = 'ok', 'un QR eliminado se puede reportar');

-- 5. Nadie más que administración lee los reportes; nadie escribe la tabla directo.
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', false);
set role authenticated;
do $duena$
begin
  if exists (select 1 from public.qr_reportes) then
    raise exception 'la dueña del QR no ve los reportes (traen contactos)';
  end if;
  begin
    insert into public.qr_reportes (qr_id, motivo) values (1, 'otro');
    raise exception 'nadie inserta directo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.qr_atender_reporte(1);
    raise exception 'sólo administración atiende reportes';
  exception when insufficient_privilege then null;
  end;
end
$duena$;
reset role;
set role anon;
do $anon_lee$
begin
  begin
    perform 1 from public.qr_reportes;
    raise exception 'anon no lee reportes';
  exception when insufficient_privilege then null;
  end;
end
$anon_lee$;
reset role;

select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000002', false);
set role authenticated;
do $admin$
declare
  v_id bigint;
begin
  if (select count(*) from public.qr_reportes where atendido_en is null) <> 4 then
    raise exception 'administración ve los 4 reportes pendientes';
  end if;
  select min(id) into v_id from public.qr_reportes;
  if not public.qr_atender_reporte(v_id) then
    raise exception 'atender un reporte pendiente devuelve true';
  end if;
  if public.qr_atender_reporte(v_id) then
    raise exception 'atenderlo dos veces no cambia nada';
  end if;
  if (select atendido_por from public.qr_reportes where id = v_id) <> '46000000-0000-4000-8000-000000000002' then
    raise exception 'queda quién lo atendió';
  end if;
end
$admin$;
reset role;

-- 6. Techo por QR: 20 al día.
do $techo$
begin
  -- 2 del inicio + 18 = 20, el techo; el siguiente es el 21.
  for i in 1..18 loop
    perform public.qr_reportar('abcdef', 'otro');
  end loop;
  begin
    perform public.qr_reportar('abcdef', 'otro');
    raise exception 'el reporte 21 del día debió frenarse';
  exception when raise_exception then
    if sqlerrm <> 'qr_demasiados_reportes' then raise; end if;
  end;
end
$techo$;

-- 7. Los reportes se van con su QR (la purga de 0044 borra en cascada).
delete from public.qr_codigos where codigo = 'bcdefg';
select pg_temp.assert_true(
  not exists (select 1 from public.qr_reportes r where not exists
    (select 1 from public.qr_codigos c where c.id = r.qr_id)),
  'no quedan reportes huérfanos'
);

select '0046 qr_reportes: PASS' as result;
