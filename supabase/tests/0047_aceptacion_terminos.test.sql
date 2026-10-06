\set ON_ERROR_STOP on

-- La migración y este archivo llevan acentos. Se fija UTF8 para que no dependa
-- de la codificación del entorno.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
--
--   createdb taudux_aceptacion_terminos_0047_test
--   psql -d taudux_aceptacion_terminos_0047_test -f supabase/tests/0047_aceptacion_terminos.test.sql
do $guard$
begin
  if current_database() <> 'taudux_aceptacion_terminos_0047_test' then
    raise exception 'Refusing to run outside taudux_aceptacion_terminos_0047_test';
  end if;
end
$guard$;

-- Los tres roles de Supabase. service_role salta la RLS, como en producción.
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

grant usage on schema public to anon, authenticated, service_role;
-- Lo que Supabase concede por defecto a las tablas nuevas: la migración tiene
-- que retirarlo, y este test comprueba que lo hizo.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- es_admin() controlable desde el test.
create function public.es_admin()
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('test.es_admin', true), ''), 'false')::boolean
$$;
grant execute on function public.es_admin() to anon, authenticated, service_role;

\ir ../migrations/0047_aceptacion_terminos.sql
-- Idempotente: aplicarla dos veces no debe fallar ni duplicar nada.
\ir ../migrations/0047_aceptacion_terminos.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

create function pg_temp.assert_raises(sentencia text, estado text, message text)
returns void language plpgsql as $assert$
declare
  v_estado text;
  v_mensaje text;
begin
  begin
    execute sentencia;
  exception
    when others then
      get stacked diagnostics
        v_estado = returned_sqlstate,
        v_mensaje = message_text;
      if v_estado <> estado then
        raise exception 'assertion failed: % (esperaba %, llegó %: %)',
          message, estado, v_estado, v_mensaje;
      end if;
      return;
  end;
  raise exception 'assertion failed: % (la sentencia no falló)', message;
end
$assert$;

-- Sujetos de prueba.
\set anon1 '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set anon2 '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''
\set anon3 '''cccccccccccccccccccccccccccccccc'''
\set user1 '''10000000-0000-4000-8000-000000000001'''

-- 1. UNA ACEPTACIÓN VALE PARA SU VERSIÓN, Y SÓLO PARA ESA -------------------
insert into public.aceptacion_terminos (sesion_anon, version, frase, ip, navegador)
values (:anon1, '1.0', 'Acepto términos y condiciones.', '203.0.113.7', 'Mozilla/5.0');

select pg_temp.assert_true(public.terminos_aceptados(null, :anon1, '1.0'),
  'quien aceptó la 1.0 tiene aceptada la 1.0');
select pg_temp.assert_true(not public.terminos_aceptados(null, :anon1, '2.0'),
  'aceptar la 1.0 no es aceptar la 2.0');
select pg_temp.assert_true(not public.terminos_aceptados(null, :anon2, '1.0'),
  'quien nunca aceptó no tiene nada aceptado');
select pg_temp.assert_true(not public.terminos_aceptados(null, null, '1.0'),
  'sin sujeto no hay aceptación');

-- 2. LAS RESTRICCIONES --------------------------------------------------------
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (user_id, sesion_anon, version, frase) values
  ('10000000-0000-4000-8000-000000000009', 'dddddddddddddddddddddddddddddddd', '1.0', 'x')$$,
  '23514', 'una fila no puede ser de una cuenta Y de una visita');
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (version, frase) values ('1.0', 'x')$$,
  '23514', 'una fila tiene que ser de alguien');
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (sesion_anon, version, evento) values ('dddddddddddddddddddddddddddddddd', '1.0', 'borrado')$$,
  '23514', 'sólo existen los eventos aceptacion y revocacion');
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (sesion_anon, version, frase) values ('dddddddddddddddddddddddddddddddd', 'v1', 'x')$$,
  '23514', 'la versión tiene formato numérico: "v1" es una errata');
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (sesion_anon, version, frase) values ('NO-ES-HEX', '1.0', 'x')$$,
  '23514', 'la sesión anónima tiene el formato del header X-Sesion-Anon');
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (sesion_anon, version) values ('dddddddddddddddddddddddddddddddd', '1.0')$$,
  '23514', 'una aceptación sin frase no es una aceptación');
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (sesion_anon, version, evento, frase) values
  ('dddddddddddddddddddddddddddddddd', '1.0', 'revocacion', 'x')$$,
  '23514', 'una revocación no lleva frase');

-- 3. SÓLO SE AGREGAN FILAS: nadie edita ni borra, ni service_role ------------
select pg_temp.assert_raises($$update public.aceptacion_terminos set version = '9.9'$$,
  'P0001', 'la evidencia no se edita');
select pg_temp.assert_raises($$delete from public.aceptacion_terminos$$,
  'P0001', 'la evidencia no se borra');
select pg_temp.assert_raises($$truncate public.aceptacion_terminos$$,
  'P0001', 'la evidencia no se vacía');
-- service_role recibió TODO por los privilegios por defecto de Supabase (ver
-- arriba); la migración le retira editar y borrar. Si algún día alguien se lo
-- devuelve, el trigger sigue ahí: lo prueba el superusuario de arriba, que
-- ignora privilegios y aun así no pudo.
set role service_role;
select pg_temp.assert_raises($$delete from public.aceptacion_terminos$$,
  '42501', 'la API no puede borrar evidencia');
select pg_temp.assert_raises($$update public.aceptacion_terminos set version = '9.9'$$,
  '42501', 'ni editarla');
reset role;
select pg_temp.assert_true((select count(*) = 1 from public.aceptacion_terminos),
  'después de todos los intentos, la aceptación sigue ahí');

-- 4. REVOCAR Y VOLVER A ACEPTAR ------------------------------------------------
insert into public.aceptacion_terminos (sesion_anon, version, evento, ocurrido_en)
values (:anon1, '1.0', 'revocacion', now() + interval '1 second');
select pg_temp.assert_true(not public.terminos_aceptados(null, :anon1, '1.0'),
  'una revocación posterior anula la aceptación');
insert into public.aceptacion_terminos (sesion_anon, version, frase, ocurrido_en)
values (:anon1, '1.0', 'acepto terminos y condiciones', now() + interval '2 seconds');
select pg_temp.assert_true(public.terminos_aceptados(null, :anon1, '1.0'),
  'volver a aceptar la restablece');
select pg_temp.assert_true((select count(*) = 3 from public.aceptacion_terminos where sesion_anon = :anon1),
  'la historia completa se conserva: aceptó, revocó, volvió a aceptar');

-- 5. VERSIÓN NUEVA: HAY QUE ACEPTAR DE NUEVO -----------------------------------
insert into public.aceptacion_terminos (user_id, version, frase)
values (:user1, '1.0', 'acepto terminos y condiciones');
select pg_temp.assert_true(public.terminos_aceptados(:user1, null, '1.0'), 'la cuenta aceptó la 1.0');
select pg_temp.assert_true(not public.terminos_aceptados(:user1, null, '1.1'),
  'al publicar la 1.1, la aceptación de la 1.0 ya no basta');
insert into public.aceptacion_terminos (user_id, version, frase, ocurrido_en)
values (:user1, '1.1', 'acepto terminos y condiciones', now() + interval '1 second');
select pg_temp.assert_true(public.terminos_aceptados(:user1, null, '1.1'), 'aceptó la 1.1');

-- 6. CON CUENTA, LA SESIÓN ANÓNIMA NO CUENTA -----------------------------------
select pg_temp.assert_true(not public.terminos_aceptados(
    '10000000-0000-4000-8000-000000000002', :anon1, '1.0'),
  'una cuenta nueva no hereda lo que aceptó su navegador sin cuenta');

-- 7. PERMISOS -------------------------------------------------------------------
set role anon;
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (sesion_anon, version, frase) values ('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '1.0', 'x')$$,
  '42501', 'desde el navegador sin cuenta no se puede fabricar una aceptación');
select pg_temp.assert_raises($$select * from public.aceptacion_terminos$$,
  '42501', 'ni leerlas');
select pg_temp.assert_raises($$select public.terminos_aceptados(null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '1.0')$$,
  '42501', 'ni consultar la de otros');
reset role;

set role authenticated;
select pg_temp.assert_raises($$insert into public.aceptacion_terminos
  (user_id, version, frase) values ('10000000-0000-4000-8000-000000000003', '1.0', 'x')$$,
  '42501', 'con cuenta tampoco se escribe directo: sólo el servidor');
select pg_temp.assert_true((select count(*) = 0 from public.aceptacion_terminos),
  'un usuario común no ve ninguna fila (RLS)');
select pg_temp.assert_raises($$select public.purgar_aceptaciones_terminos(now() - interval '1 year')$$,
  '42501', 'la purga no la puede llamar un usuario');
set test.es_admin = 'true';
select pg_temp.assert_true((select count(*) > 0 from public.aceptacion_terminos),
  'administración sí las ve, para auditar o atender una solicitud ARCO');
reset test.es_admin;
reset role;

set role service_role;
insert into public.aceptacion_terminos (sesion_anon, version, frase)
values (:anon2, '1.0', 'acepto terminos y condiciones');
select pg_temp.assert_true(public.terminos_aceptados(null, :anon2, '1.0'),
  'el servidor escribe y consulta');
reset role;

-- 8. LA PURGA: sólo sujetos inactivos, y con freno ------------------------------
insert into public.aceptacion_terminos (sesion_anon, version, frase, ocurrido_en)
values (:anon3, '1.0', 'acepto terminos y condiciones', now() - interval '800 days');
-- anon2 tiene una fila vieja Y una reciente: sigue activo.
insert into public.aceptacion_terminos (sesion_anon, version, frase, ocurrido_en)
values (:anon2, '0.9', 'acepto terminos y condiciones', now() - interval '800 days');

select pg_temp.assert_raises($$select public.purgar_aceptaciones_terminos(now())$$,
  'P0001', 'un plazo de cero días es una errata, no una política');
select pg_temp.assert_raises($$select public.purgar_aceptaciones_terminos(null)$$,
  'P0001', 'sin plazo no se purga');

set role service_role;
select pg_temp.assert_true(
  (select public.purgar_aceptaciones_terminos(now() - interval '2 years') = 1),
  'purga exactamente la fila del sujeto inactivo');
reset role;

select pg_temp.assert_true(
  (select count(*) = 0 from public.aceptacion_terminos where sesion_anon = :anon3),
  'el sujeto inactivo desaparece');
select pg_temp.assert_true(
  (select count(*) = 2 from public.aceptacion_terminos where sesion_anon = :anon2),
  'a un sujeto activo no se le toca ni su historia vieja');
select pg_temp.assert_raises($$delete from public.aceptacion_terminos$$,
  'P0001', 'terminada la purga, la puerta se vuelve a cerrar');

\echo 'OK 0047_aceptacion_terminos'
