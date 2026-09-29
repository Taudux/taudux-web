\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_qr_codigos_0044_test' then
    raise exception 'Refusing to run outside taudux_qr_codigos_0044_test';
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
  ('44000000-0000-4000-8000-000000000001', 'uno@example.com', now()),
  ('44000000-0000-4000-8000-000000000002', 'dos@example.com', now()),
  ('44000000-0000-4000-8000-000000000003', 'admin@example.com', now()),
  ('44000000-0000-4000-8000-000000000004', 'ilimitado@example.com', now()),
  ('44000000-0000-4000-8000-000000000005', 'sinconfirmar@example.com', null),
  ('44000000-0000-4000-8000-000000000006', 'seis@example.com', now()),
  ('44000000-0000-4000-8000-000000000007', 'siete@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('44000000-0000-4000-8000-000000000001', 'Uno', 'usuario'),
  ('44000000-0000-4000-8000-000000000002', 'Dos', 'usuario'),
  ('44000000-0000-4000-8000-000000000003', 'Admin', 'admin'),
  ('44000000-0000-4000-8000-000000000004', 'Ilimitado', 'usuario'),
  ('44000000-0000-4000-8000-000000000006', 'Seis', 'usuario'),
  ('44000000-0000-4000-8000-000000000007', 'Siete', 'usuario');

\ir ../migrations/0044_qr_codigos.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- Crea un QR como lo hace crear-qr. Devuelve el código.
create function pg_temp.crear(usuario uuid, destino text default 'https://forms.gle/abc')
returns text language sql as $crear$
  select (public.qr_crear(usuario, destino, 'Encuesta', true, true)).codigo
$crear$;

-- 1. El código: 6 caracteres del alfabeto sin 0/o/1/l/i, y variado.
select pg_temp.assert_true(
  (select bool_and(c ~ '^[2-9a-hjkmnp-z]{6}$') and count(distinct c) > 1990
     from (select public.qr_generar_codigo() as c from generate_series(1, 2000)) muestra),
  '2000 códigos generados cumplen el formato y casi no se repiten'
);

-- 2. Sin perfil (correo sin confirmar) no se crea nada.
select pg_temp.assert_true(
  public.qr_motivo_rechazo('44000000-0000-4000-8000-000000000005') = 'qr_sin_cuenta',
  'una cuenta sin confirmar no puede crear QR'
);
do $sin_cuenta$
begin
  begin
    perform public.qr_crear('44000000-0000-4000-8000-000000000005', 'https://forms.gle/x', null, true, true);
    raise exception 'qr_crear sin perfil debió fallar';
  exception
    when raise_exception then
      if sqlerrm <> 'qr_sin_cuenta' then raise; end if;
  end;
end
$sin_cuenta$;

-- 3. Alta normal: vence en 7 días y guarda cómo se revisó el link.
select pg_temp.crear('44000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(
  (select vence_en between now() + interval '7 days' - interval '1 minute'
                       and now() + interval '7 days' + interval '1 minute'
      and dominio_confiable and web_risk_revisado_en is not null
      and titulo = 'Encuesta' and eliminado_en is null and bloqueado_en is null
     from public.qr_codigos
    where usuario_id = '44000000-0000-4000-8000-000000000001'),
  'un QR gratis vence a los 7 días y registra la revisión'
);
select pg_temp.assert_true(
  (select web_risk_revisado_en is null and not dominio_confiable and titulo is null
     from public.qr_crear('44000000-0000-4000-8000-000000000002', 'https://ejemplo.mx', '   ', false, false)),
  'sin revisión de Web Risk queda null, y un título en blanco se guarda como null'
);

-- 4. Cinco activos es el techo del plan gratis.
select pg_temp.crear('44000000-0000-4000-8000-000000000001') from generate_series(1, 4);
select pg_temp.assert_true(
  public.qr_motivo_rechazo('44000000-0000-4000-8000-000000000001') = 'qr_limite_alcanzado',
  'con 5 activos la cuenta ya no puede crear'
);
do $sexto$
begin
  begin
    perform pg_temp.crear('44000000-0000-4000-8000-000000000001');
    raise exception 'el sexto QR debió fallar';
  exception
    when raise_exception then
      if sqlerrm <> 'qr_limite_alcanzado' then raise; end if;
  end;
end
$sexto$;

-- 5. Un vencido libera su lugar (decisión del 2026-09-28).
update public.qr_codigos set vence_en = now() - interval '1 second'
 where id = (select min(id) from public.qr_codigos
              where usuario_id = '44000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(
  public.qr_motivo_rechazo('44000000-0000-4000-8000-000000000001') is null,
  'al vencer uno, la cuenta vuelve a tener lugar'
);
select pg_temp.crear('44000000-0000-4000-8000-000000000001');

-- 6. Lo que ve cada quien, y lo que NO puede hacer desde el navegador.
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', false);
set role authenticated;

do $vista_propia$
begin
  if (select count(*) from public.qr_codigos) <> 6 then
    raise exception 'el dueño debe ver sus 6 QR (5 vigentes + 1 vencido)';
  end if;
  if exists (select 1 from public.qr_codigos
              where usuario_id <> '44000000-0000-4000-8000-000000000001') then
    raise exception 'el dueño no debe ver QR ajenos';
  end if;
  if exists (select 1 from public.qr_acceso) then
    raise exception 'sin fila propia en qr_acceso no se ve nada';
  end if;
  if (select count(*) from public.qr_planes) <> 1 then
    raise exception 'el catálogo activo es legible';
  end if;
end
$vista_propia$;

do $sin_escritura$
declare
  intentos text[] := array[
    $i$insert into public.qr_codigos (codigo, destino, usuario_id, dominio_confiable)
       values ('abcdef', 'https://malo.example', '44000000-0000-4000-8000-000000000001', true)$i$,
    $i$update public.qr_codigos set vence_en = null$i$,
    $i$update public.qr_codigos set destino = 'https://malo.example'$i$,
    $i$delete from public.qr_codigos$i$,
    $i$insert into public.qr_acceso (user_id, ilimitado) values ('44000000-0000-4000-8000-000000000001', true)$i$,
    $i$select public.qr_crear('44000000-0000-4000-8000-000000000001', 'https://malo.example', null, true, true)$i$,
    $i$select public.qr_resolver('abcdef')$i$,
    $i$select public.qr_purgar()$i$,
    $i$select public.qr_generar_codigo()$i$,
    $i$select * from public.qr_codigos_retirados$i$
  ];
  intento text;
begin
  foreach intento in array intentos loop
    begin
      execute intento;
      raise exception 'authenticated no debió poder: %', intento;
    exception
      when insufficient_privilege then null;
    end;
  end loop;
end
$sin_escritura$;

-- Eliminar: sólo lo propio, y deja de verse.
do $eliminar$
declare
  v_id bigint;
begin
  select id into v_id from public.qr_codigos order by id desc limit 1;
  if not public.qr_eliminar(v_id) then
    raise exception 'el dueño debe poder eliminar su QR';
  end if;
  if exists (select 1 from public.qr_codigos where id = v_id) then
    raise exception 'un QR eliminado ya no se ve';
  end if;
  if public.qr_eliminar(v_id) then
    raise exception 'eliminar dos veces no cambia nada';
  end if;
end
$eliminar$;

reset role;

select set_config('request.jwt.claim.sub', '', false);
select pg_temp.assert_true(
  not public.qr_eliminar((select min(id) from public.qr_codigos
                           where usuario_id = '44000000-0000-4000-8000-000000000001')),
  'sin sesión (auth.uid() null) no se elimina nada'
);
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000002', false);
set role authenticated;
do $eliminar_ajeno$
begin
  if public.qr_eliminar((select min(id) from public.qr_codigos
                          where usuario_id = '44000000-0000-4000-8000-000000000001')) then
    raise exception 'nadie elimina el QR de otro';
  end if;
end
$eliminar_ajeno$;
reset role;
select pg_temp.assert_true(
  (select eliminado_en is null from public.qr_codigos
    where id = (select min(id) from public.qr_codigos
                 where usuario_id = '44000000-0000-4000-8000-000000000001')),
  'el QR de uno sigue vivo después del intento de dos'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.qr_codigos
    where usuario_id = '44000000-0000-4000-8000-000000000001'
      and eliminado_por = 'usuario'),
  'el eliminado se conserva con eliminado_por = usuario (rastro para abuso)'
);

-- 7. El redireccionador.
set role service_role;
do $resolver$
declare
  v_activo text;
  v_fila record;
begin
  select codigo into v_activo from public.qr_codigos
   where usuario_id = '44000000-0000-4000-8000-000000000001'
     and eliminado_en is null and vence_en > now()
   order by id limit 1;

  select * into v_fila from public.qr_resolver(upper(v_activo), 'mx', 'movil');
  if v_fila.estado <> 'activo' or v_fila.destino <> 'https://forms.gle/abc' then
    raise exception 'un QR activo resuelve a su destino, aun con el código en mayúsculas';
  end if;
  if not exists (select 1 from public.qr_escaneos e join public.qr_codigos c on c.id = e.qr_id
                  where c.codigo = v_activo and e.pais = 'MX' and e.dispositivo = 'movil') then
    raise exception 'el escaneo se registra con país en mayúsculas y dispositivo';
  end if;

  perform public.qr_resolver(v_activo, 'MEX', '<script>');
  if not exists (select 1 from public.qr_escaneos e join public.qr_codigos c on c.id = e.qr_id
                  where c.codigo = v_activo and e.pais is null and e.dispositivo = 'otro') then
    raise exception 'un país o dispositivo inválido se guarda como null / otro';
  end if;

  select * into v_fila from public.qr_resolver(
    (select codigo from public.qr_codigos where vence_en < now() limit 1));
  if v_fila.estado <> 'vencido' or v_fila.destino is not null then
    raise exception 'un QR vencido no revela su destino';
  end if;

  select * into v_fila from public.qr_resolver(
    (select codigo from public.qr_codigos where eliminado_en is not null limit 1));
  if v_fila.estado <> 'inexistente' then
    raise exception 'un QR eliminado se ve como inexistente';
  end if;

  select * into v_fila from public.qr_resolver('zzzzzz');
  if v_fila.estado <> 'inexistente' then
    raise exception 'un código desconocido es inexistente';
  end if;
end
$resolver$;
reset role;

select pg_temp.assert_true(
  (select count(*) = 2 from public.qr_escaneos),
  'vencido, eliminado e inexistente no suman escaneos'
);

select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000002', false);
set role authenticated;
do $escaneos_ajenos$
begin
  if exists (select 1 from public.qr_escaneos) then
    raise exception 'nadie ve los escaneos de QR ajenos';
  end if;
end
$escaneos_ajenos$;
reset role;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', false);
set role authenticated;
do $escaneos_propios$
begin
  if (select count(*) from public.qr_escaneos) <> 2 then
    raise exception 'el dueño ve los escaneos de sus QR';
  end if;
end
$escaneos_propios$;
reset role;

-- 8. Moderación.
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000002', false);
set role authenticated;
do $no_admin$
begin
  begin
    perform public.qr_moderar(1, true, 'spam');
    raise exception 'un usuario normal no modera';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.qr_moderar_cuenta('44000000-0000-4000-8000-000000000001', true, 'spam');
    raise exception 'un usuario normal no bloquea cuentas';
  exception
    when insufficient_privilege then null;
  end;
end
$no_admin$;
reset role;

select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000003', false);
set role authenticated;
do $admin$
declare
  v_uno_individual bigint;
  v_fila public.qr_codigos%rowtype;
  v_cambiados int;
begin
  -- uno: 6 (5 vigentes, 1 vencido) incluido el que eliminó · dos: 1.
  if (select count(*) from public.qr_codigos) <> 7 then
    raise exception 'administración ve todos los QR, eliminados incluidos';
  end if;

  begin
    perform public.qr_moderar(1, true, '   ');
    raise exception 'bloquear sin motivo debió fallar';
  exception
    when raise_exception then
      if sqlerrm <> 'qr_motivo_requerido' then raise; end if;
  end;

  select min(id) into v_uno_individual from public.qr_codigos
   where usuario_id = '44000000-0000-4000-8000-000000000001'
     and eliminado_en is null and vence_en > now();
  v_fila := public.qr_moderar(v_uno_individual, true, 'Reporte de phishing');
  if v_fila.bloqueado_por <> 'administracion' or v_fila.bloqueo_motivo <> 'Reporte de phishing' then
    raise exception 'el bloqueo individual queda registrado';
  end if;

  -- De los 5 no eliminados de uno, uno ya está bloqueado a mano: quedan 4,
  -- el vencido incluido (apagarlo no cambia nada, y no hace falta distinguirlo).
  v_cambiados := public.qr_moderar_cuenta('44000000-0000-4000-8000-000000000001', true, 'Abuso');
  if v_cambiados <> 4 then
    raise exception 'bloquear la cuenta apaga sus 4 QR aún sin bloquear (hubo %)', v_cambiados;
  end if;
  if not exists (select 1 from public.qr_acceso
                  where user_id = '44000000-0000-4000-8000-000000000001'
                    and bloqueado and bloqueo_motivo = 'Abuso'
                    and actualizado_por = '44000000-0000-4000-8000-000000000003') then
    raise exception 'el bloqueo de cuenta queda en qr_acceso, con motivo y autor';
  end if;
  if (select bloqueado_por from public.qr_codigos where id = v_uno_individual) <> 'administracion' then
    raise exception 'el bloqueo individual previo no se pisa con el de la cuenta';
  end if;

  v_cambiados := public.qr_moderar_cuenta('44000000-0000-4000-8000-000000000001', false);
  if v_cambiados <> 4 then
    raise exception 'desbloquear la cuenta restaura sólo los 4 que apagó el bloqueo de cuenta';
  end if;
  if exists (select 1 from public.qr_acceso
              where user_id = '44000000-0000-4000-8000-000000000001' and bloqueado) then
    raise exception 'desbloquear la cuenta la marca como no bloqueada';
  end if;
  if (select bloqueado_por from public.qr_codigos where id = v_uno_individual) <> 'administracion' then
    raise exception 'desbloquear la cuenta no deshace un bloqueo individual';
  end if;

  v_fila := public.qr_moderar(v_uno_individual, false);
  if v_fila.bloqueado_en is not null or v_fila.bloqueo_motivo is not null then
    raise exception 'desbloquear un QR limpia el bloqueo';
  end if;

  begin
    perform public.qr_moderar_cuenta('44000000-0000-4000-8000-00000000ffff', true, 'x');
    raise exception 'una cuenta inexistente no se bloquea';
  exception
    when raise_exception then
      if sqlerrm <> 'qr_cuenta_inexistente' then raise; end if;
  end;
end
$admin$;
reset role;


-- Bloquear la cuenta es lo que frena el alta (la verificación que corre crear-qr).
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000003', false);
select public.qr_moderar_cuenta('44000000-0000-4000-8000-000000000002', true, 'Spam');
select pg_temp.assert_true(
  public.qr_motivo_rechazo('44000000-0000-4000-8000-000000000002') = 'qr_cuenta_bloqueada',
  'una cuenta bloqueada no puede crear'
);
select pg_temp.assert_true(
  (select bool_and(bloqueado_por = 'cuenta' and bloqueo_motivo = 'Cuenta bloqueada: Spam')
     from public.qr_codigos where usuario_id = '44000000-0000-4000-8000-000000000002'),
  'sus QR se apagan con el motivo del bloqueo de cuenta'
);
select public.qr_moderar_cuenta('44000000-0000-4000-8000-000000000002', false);
select pg_temp.assert_true(
  public.qr_motivo_rechazo('44000000-0000-4000-8000-000000000002') is null,
  'desbloqueada, la cuenta vuelve a poder crear'
);
select set_config('request.jwt.claim.sub', '', false);

-- 9. Acceso ilimitado: sin techo y sin vencimiento.
insert into public.qr_acceso (user_id, ilimitado, motivo)
values ('44000000-0000-4000-8000-000000000004', true, 'QR de eventos de Taudux');
select pg_temp.crear('44000000-0000-4000-8000-000000000004') from generate_series(1, 7);
select pg_temp.assert_true(
  (select count(*) = 7 and bool_and(vence_en is null) from public.qr_codigos
    where usuario_id = '44000000-0000-4000-8000-000000000004'),
  'una cuenta ilimitada pasa de 5 y sus QR no vencen'
);

-- Un plan inactivo asignado por error no regala nada: rige free.
insert into public.qr_planes (clave, nombre, limite, duracion, activo)
values ('pro', 'Pro', null, null, false);
insert into public.qr_acceso (user_id, plan) values ('44000000-0000-4000-8000-000000000006', 'pro');
select pg_temp.assert_true(
  (select clave = 'free' from public.qr_plan_de('44000000-0000-4000-8000-000000000006')),
  'un plan inactivo cae a free'
);
update public.qr_planes set activo = true where clave = 'pro';
select pg_temp.assert_true(
  (select clave = 'pro' from public.qr_plan_de('44000000-0000-4000-8000-000000000006')),
  'encender el plan es un update, sin desplegar'
);
update public.qr_planes set activo = false where clave = 'pro';

-- 10. Techo diario: crear y eliminar en ciclo tiene límite.
do $techo$
declare
  v_codigo text;
begin
  for i in 1..20 loop
    v_codigo := pg_temp.crear('44000000-0000-4000-8000-000000000006');
    update public.qr_codigos set eliminado_en = now(), eliminado_por = 'usuario' where codigo = v_codigo;
  end loop;
  if public.qr_motivo_rechazo('44000000-0000-4000-8000-000000000006') <> 'qr_demasiados_hoy' then
    raise exception 'tras 20 altas en un día la cuenta frena, aunque las haya eliminado';
  end if;
end
$techo$;

-- 11. Revisión diaria.
do $revision$
declare
  v_id bigint;
begin
  select id into v_id from public.qr_codigos
   where usuario_id = '44000000-0000-4000-8000-000000000004' order by id limit 1;
  update public.qr_codigos set web_risk_revisado_en = null where id = v_id;
  if not exists (select 1 from public.qr_pendientes_revision(500) where id = v_id) then
    raise exception 'un QR activo sin revisar está pendiente';
  end if;
  perform public.qr_registrar_revision(v_id, '{}');
  if exists (select 1 from public.qr_pendientes_revision(500) where id = v_id) then
    raise exception 'recién revisado ya no está pendiente';
  end if;
  update public.qr_codigos set web_risk_revisado_en = now() - interval '21 hours' where id = v_id;
  perform public.qr_registrar_revision(v_id, array['SOCIAL_ENGINEERING']);
  if (select bloqueado_por <> 'revision_automatica'
          or bloqueo_motivo <> 'Google Web Risk: SOCIAL_ENGINEERING'
        from public.qr_codigos where id = v_id) then
    raise exception 'una amenaza de Web Risk bloquea el QR con su motivo';
  end if;
  if exists (select 1 from public.qr_pendientes_revision(500) where id = v_id) then
    raise exception 'un QR bloqueado sale de la revisión';
  end if;
end
$revision$;

-- 12. Borrar la cuenta apaga sus QR al instante, sin abortar el borrado.
select pg_temp.crear('44000000-0000-4000-8000-000000000007');
delete from auth.users where id = '44000000-0000-4000-8000-000000000007';
select pg_temp.assert_true(
  (select bool_and(eliminado_por = 'cuenta_eliminada') from public.qr_codigos
    where usuario_id = '44000000-0000-4000-8000-000000000007'),
  'los QR de una cuenta borrada quedan eliminados, con el rastro conservado'
);

-- 13. Un código nunca se reutiliza: retirados y ocupados se saltan. Se
-- reemplaza el sorteo por uno predecible para forzar las dos colisiones.
create sequence pg_temp.sorteo;
create or replace function public.qr_generar_codigo()
returns text language sql volatile set search_path = '' as $sorteo$
  select (array['aaaaaa', 'bbbbbb', 'cccccc'])[pg_catalog.nextval('pg_temp.sorteo')]
$sorteo$;
insert into public.qr_codigos_retirados (codigo) values ('aaaaaa');
insert into public.qr_codigos (codigo, destino, usuario_id, dominio_confiable)
values ('bbbbbb', 'https://forms.gle/ocupado', '44000000-0000-4000-8000-000000000004', true);
select pg_temp.assert_true(
  pg_temp.crear('44000000-0000-4000-8000-000000000004') = 'cccccc',
  'qr_crear salta un código retirado y uno ocupado'
);

-- 14. Purga: lo eliminado o vencido hace más de 90 días se va con sus
-- escaneos, y su código queda retirado. Lo reciente no se toca.
do $purga$
declare
  v_con_escaneos text;
  v_esperados int;
  v_purgados int;
begin
  select c.codigo into v_con_escaneos
    from public.qr_codigos c join public.qr_escaneos e on e.qr_id = c.id limit 1;
  update public.qr_codigos set vence_en = now() - interval '91 days' where codigo = v_con_escaneos;
  update public.qr_codigos set eliminado_en = now() - interval '91 days' where eliminado_en is not null;

  select count(*) into v_esperados from public.qr_codigos
   where eliminado_en is not null or vence_en < now() - interval '90 days';
  v_purgados := public.qr_purgar();

  if v_purgados <> v_esperados or v_purgados < 23 then
    raise exception 'qr_purgar devuelve cuántos purgó (% de %)', v_purgados, v_esperados;
  end if;
  if exists (select 1 from public.qr_codigos
              where eliminado_en is not null or vence_en < now() - interval '90 days') then
    raise exception 'no quedan eliminados ni vencidos viejos';
  end if;
  if exists (select 1 from public.qr_escaneos) then
    raise exception 'los escaneos se van con su QR';
  end if;
  if not exists (select 1 from public.qr_codigos_retirados where codigo = v_con_escaneos) then
    raise exception 'el código purgado queda retirado';
  end if;
  if not exists (select 1 from public.qr_codigos where vence_en > now()) then
    raise exception 'lo vigente no se purga';
  end if;
end
$purga$;

select '0044 qr_codigos: PASS' as result;
