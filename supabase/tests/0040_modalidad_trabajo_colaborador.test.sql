\set ON_ERROR_STOP on

-- Este archivo y la 0040 llevan acentos ('Híbrido'), y la migración exige
-- client_encoding UTF8 en su preflight. Se fija aquí para no depender de la
-- codificación del entorno (`PGCLIENTENCODING`), igual que el de la 0039.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
do $guard$
begin
  if current_database() <> 'taudux_modalidad_trabajo_0040_test' then
    raise exception 'Refusing to run outside taudux_modalidad_trabajo_0040_test';
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
end
$roles$;

-- Lo mínimo que la 0001 REAL necesita para cargar, copiado del armado de la
-- 0039: auth.users con el metadata del signUp y auth.uid() leyendo el mismo
-- GUC que fija PostgREST, para que las policies se ejerciten por el camino
-- real bajo `set role`.
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

\ir ../migrations/0001_crear_perfiles.sql

-- Defaults de Supabase, replicados ANTES de las migraciones nuevas.
grant usage on schema public to anon, authenticated;
grant select, insert on public.perfiles to anon, authenticated;
alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- Corre `sentencia` y exige que falle con `estado`.
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

create function pg_temp.filas(sentencia text)
returns bigint language plpgsql as $filas$
declare
  v_filas bigint;
begin
  execute sentencia;
  get diagnostics v_filas = row_count;
  return v_filas;
end
$filas$;

-- Ids legibles: cuenta(7) = 40000000-0000-4000-8000-000000000007.
create function pg_temp.cuenta(n int) returns uuid
language sql immutable as $$
  select ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- El UPDATE con el que la cuenta con sesión edita SU ficha ("Mi ficha").
create function pg_temp.editar_propia(asignacion text) returns text
language sql immutable as $$
  select 'update public.fichas_colaborador set ' || asignacion
      || ' where id = auth.uid()'
$$;

-- handle_new_user (0001) crea cada perfil desde el metadata.
insert into auth.users (id, raw_user_meta_data)
select pg_temp.cuenta(n), datos
from (values
  (1, '{"nombre": "Valeria", "apellidos": "Núñez"}'::jsonb),
  (2, '{"nombre": "Iván", "apellidos": "Soto"}'),
  (3, '{"nombre": "Begoña", "apellidos": "Ruiz"}')
) as semilla(n, datos);

\ir ../migrations/0038_colaboradores_publicos.sql

-- 1 (Valeria, con ficha), 2 (Iván, con ficha), 3 (Begoña, nunca tendrá ficha).
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(1);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(2);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(3);

\ir ../migrations/0039_fichas_colaborador.sql

-- === La forma de producción, ANTES de la 0040 ===============================
-- Dos fichas con el campo viejo. Es exactamente lo que la 0040 se va a
-- encontrar: la migración tiene que renombrar la columna y reescribir estos
-- valores, que no significan nada en Presencial/Híbrido/Remoto.

insert into public.fichas_colaborador
  (id, rol, especialidad, ubicacion, stack, disponibilidad, anio_inicio, bio)
values
  (pg_temp.cuenta(1), 'Analista', 'Fintech', 'Puebla, México',
   array['SQL', 'Python'], 'Parcial', 2021, 'Una ficha completa y válida.'),
  (pg_temp.cuenta(2), 'Docente', 'Educación', 'Guadalajara, México',
   array['R', 'Excel'], 'No disponible', 2008, 'Enseño estadística desde 2008.');

select pg_temp.assert_true(
  (select count(*) = 2 from public.fichas_colaborador),
  'premisa: dos fichas con el campo viejo antes de migrar'
);

\ir ../migrations/0040_modalidad_trabajo_colaborador.sql

-- === 1. La columna ==========================================================

select pg_temp.assert_true(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'disponibilidad'
  ),
  'disponibilidad ya no existe'
);

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'modalidad_trabajo'
      and data_type = 'text' and is_nullable = 'NO'
  ),
  'modalidad_trabajo existe, es text y sigue siendo obligatoria'
);

-- === 2. El backfill =========================================================
-- Ni 'Parcial' ni 'No disponible' se traducen a una modalidad: las dos fichas
-- quedan en el valor que la migración declara, y ninguna se pierde ni se
-- duplica por el camino.

select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(modalidad_trabajo = 'Híbrido')
   from public.fichas_colaborador),
  'las dos fichas quedaron en el valor inicial declarado por la migración'
);

select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(puesto = 'Docente' and sector = 'Educación')
   from public.fichas_colaborador where id = pg_temp.cuenta(2)),
  'el resto de la ficha sobrevive intacto al renombrado'
);

-- === 3. El CHECK rechaza ====================================================

select pg_temp.assert_raises(
  format('update public.fichas_colaborador set modalidad_trabajo = %L where id = %L',
         'presencial', pg_temp.cuenta(1)),
  '23514',
  'en minúsculas no vale'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set modalidad_trabajo = %L where id = %L',
         'Ocupado', pg_temp.cuenta(1)),
  '23514',
  'fuera de la lista no vale'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set modalidad_trabajo = %L where id = %L',
         '', pg_temp.cuenta(1)),
  '23514',
  'vacía no vale'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set modalidad_trabajo = %L where id = %L',
         'Parcial', pg_temp.cuenta(1)),
  '23514',
  'el valor viejo dejó de valer'
);

-- EL CASO QUE IMPORTA: 'Híbrido' escrito en NFD (i + U+0301) se ve idéntico en
-- pantalla y es OTRA cadena de bytes. Postgres compara bytes, así que no pasa
-- el CHECK. Si alguien guarda el .sql, el HTML o un test con el acento
-- descompuesto —los editores de Windows y el copiar/pegar desde macOS son las
-- dos fuentes típicas— el formulario responde "No se pudo guardar tu ficha"
-- sin decir por qué. Este assert es la documentación ejecutable de eso.
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set modalidad_trabajo = %L where id = %L',
         'Hi' || U&'\0301' || 'brido', pg_temp.cuenta(1)),
  '23514',
  'Híbrido en NFD no es Híbrido en NFC'
);

-- === 4. El CHECK acepta, por el camino real =================================

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;

select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$modalidad_trabajo = 'Presencial'$$)) = 1,
  'la dueña puede ponerse Presencial'
);
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$modalidad_trabajo = 'Remoto'$$)) = 1,
  'la dueña puede ponerse Remoto'
);
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$modalidad_trabajo = 'Híbrido'$$)) = 1,
  'la dueña puede ponerse Híbrido'
);

-- Las policies siguen filtrando por fila: nadie edita la ficha de al lado.
select pg_temp.assert_true(
  pg_temp.filas(
    format('update public.fichas_colaborador set modalidad_trabajo = %L where id = %L',
           'Remoto', pg_temp.cuenta(2))
  ) = 0,
  'la policy por fila sigue viva tras el renombrado'
);

reset role;
select set_config('request.jwt.claim.sub', '', false);

-- === 5. Lo guardado está en NFC =============================================

select pg_temp.assert_true(
  (select bool_and(modalidad_trabajo = normalize(modalidad_trabajo, nfc))
   from public.fichas_colaborador),
  'toda modalidad guardada está en NFC'
);

-- === 6. El bio baja a 240 ===================================================
-- El CHECK del bio es propio y con nombre, así que la 0040 lo reemplaza sin
-- tocar los demás. 240 entra; 241 ya no; el mínimo de 10 no se movió.

select pg_temp.assert_true(
  pg_temp.filas(
    format('update public.fichas_colaborador set bio = %L where id = %L',
           repeat('b', 240), pg_temp.cuenta(1))
  ) = 1,
  'una bio de 240 entra'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set bio = %L where id = %L',
         repeat('b', 241), pg_temp.cuenta(1)),
  '23514',
  'una bio de 241 ya no'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set bio = %L where id = %L',
         repeat('b', 9), pg_temp.cuenta(1)),
  '23514',
  'el mínimo de 10 sigue en pie'
);

-- Un emoji cuenta UNO para char_length, aunque sean dos unidades UTF-16. Es
-- la discrepancia que hace que `maxlength` del navegador no sirva como freno.
select pg_temp.assert_true(
  pg_temp.filas(
    format('update public.fichas_colaborador set bio = %L where id = %L',
           repeat('😀', 240), pg_temp.cuenta(1))
  ) = 1,
  '240 emojis son 240 caracteres para la base'
);

-- === 7. Privilegios por columna =============================================

select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.fichas_colaborador', 'modalidad_trabajo', 'insert')
  and has_column_privilege('authenticated', 'public.fichas_colaborador', 'modalidad_trabajo', 'update')
  and has_column_privilege('authenticated', 'public.fichas_colaborador', 'puesto', 'update')
  and has_column_privilege('authenticated', 'public.fichas_colaborador', 'sector', 'update'),
  'authenticated escribe las tres columnas nuevas'
);
select pg_temp.assert_true(
  not has_column_privilege('authenticated', 'public.fichas_colaborador', 'id', 'update'),
  'el update sigue sin incluir id'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.fichas_colaborador', 'select')
  and not has_table_privilege('anon', 'public.fichas_colaborador', 'insert')
  and not has_table_privilege('anon', 'public.fichas_colaborador', 'update'),
  'anon sigue sin tocar la tabla'
);

-- === 8. La RPC pública ======================================================

select pg_temp.assert_true(
  pg_get_function_result('public.listar_colaboradores()'::regprocedure) =
    'TABLE(nombre text, apellidos text, slug text, puesto text, sector text, '
    'ubicacion text, stack text[], modalidad_trabajo text, anio_inicio integer, '
    'bio text, linkedin text, github text, correo text)',
  'la RPC devuelve modalidad_trabajo en el lugar de disponibilidad'
);

select pg_temp.assert_true(
  (select p.prosecdef and p.provolatile = 's'
          and 'search_path=""' = any(p.proconfig)
   from pg_proc p where p.oid = 'public.listar_colaboradores()'::regprocedure),
  'sigue siendo stable, security definer y con search_path vacío'
);

-- El drop se lleva los privilegios y hay que reemitirlos a mano (la 0022 lo
-- documenta). OJO con lo que este par de asserts puede y no puede probar: el
-- armado de arriba replica el `alter default privileges ... grant execute on
-- functions to anon, authenticated` de Supabase, así que una función recién
-- creada YA sale con EXECUTE para los dos roles. Borrar el `grant execute` de
-- la migración no rompe esto —probado con un mutante— y no es un descuido del
-- test: es que en una base con esos defaults el grant explícito es un cinturón
-- sobre los tirantes.
--
-- Lo que sí es carga viva, y lo que el segundo assert vigila, es el `revoke
-- all ... from public`: sin él la función queda ejecutable por CUALQUIER rol
-- de la base, no sólo por anon y authenticated.
select pg_temp.assert_true(
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute')
  and has_function_privilege('authenticated', 'public.listar_colaboradores()', 'execute'),
  'anon y authenticated ejecutan la RPC recreada'
);
select pg_temp.assert_true(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.listar_colaboradores()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'el revoke from public sigue puesto tras recrear la función'
);

set role anon;
select pg_temp.assert_true(
  (select string_agg(k, ',' order by k collate "C")
   from (select distinct jsonb_object_keys(to_jsonb(c)) as k
         from public.listar_colaboradores() as c) as claves)
    = 'anio_inicio,apellidos,bio,correo,github,linkedin,modalidad_trabajo,'
      'nombre,puesto,sector,slug,stack,ubicacion',
  'anon ve las trece claves, con la nueva y sin la vieja'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.listar_colaboradores() as c
   where c.slug = 'begona' and c.modalidad_trabajo is null and c.puesto is null),
  'una colaboradora sin ficha sigue saliendo con los campos de ficha en null'
);
reset role;


-- === 10. puesto y sector ====================================================

select pg_temp.assert_true(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name in ('rol', 'especialidad')
  ),
  'rol y especialidad ya no existen'
);
select pg_temp.assert_true(
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name in ('puesto', 'sector')
      and data_type = 'text' and is_nullable = 'NO'),
  'puesto y sector existen, son text y siguen siendo obligatorias'
);

-- Los CHECK viajaron con la columna, con su largo intacto.
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set puesto = %L where id = %L',
         repeat('p', 61), pg_temp.cuenta(2)),
  '23514',
  'puesto conserva su tope de 60'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set sector = %L where id = %L',
         repeat('s', 81), pg_temp.cuenta(2)),
  '23514',
  'sector conserva su tope de 80'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set puesto = %L where id = %L',
         ' Analista', pg_temp.cuenta(2)),
  '23514',
  'puesto sigue sin admitir espacios en los bordes'
);

-- === 11. El slug sigue al nombre ============================================
-- Esto INVIERTE lo que la 0038 fija en su propio test ("cambiar el nombre NO
-- regenera el slug"). Aquel sigue siendo cierto de la 0038 sola; a partir de
-- la 0040, la dirección del perfil sigue al nombre.

select pg_temp.assert_true(
  (select slug = 'valeria' from public.perfiles where id = pg_temp.cuenta(1)),
  'premisa: el slug salió del nombre al marcarla como colaboradora'
);

update public.perfiles set nombre = 'Valentina' where id = pg_temp.cuenta(1);
select pg_temp.assert_true(
  (select slug = 'valentina' from public.perfiles where id = pg_temp.cuenta(1)),
  'cambiar el nombre AHORA SÍ regenera el slug'
);

-- Editar cualquier otra cosa no lo despierta: el trigger escucha sólo
-- es_colaborador, nombre y apellidos.
update public.perfiles set telefono = '5550009999' where id = pg_temp.cuenta(1);
select pg_temp.assert_true(
  (select slug = 'valentina' from public.perfiles where id = pg_temp.cuenta(1)),
  'editar otra columna no toca el slug'
);

-- Al renombrarse, el desempate por primer apellido sigue funcionando igual
-- que en el alta: 'ivan' ya es de otra cuenta, así que se prueba con el
-- apellido.
select pg_temp.assert_true(
  pg_temp.filas(
    format('update public.perfiles set nombre = %L where id = %L',
           'Iván', pg_temp.cuenta(1))
  ) = 1,
  'renombrarse a un nombre ya tomado no falla: desempata con el apellido'
);
select pg_temp.assert_true(
  (select slug = 'ivan-nunez' from public.perfiles where id = pg_temp.cuenta(1)),
  'y la dirección nueva lleva el primer apellido'
);
select pg_temp.assert_true(
  (select slug = 'ivan' from public.perfiles where id = pg_temp.cuenta(2)),
  'la cuenta que ya tenía la dirección corta la conserva'
);

-- EL ASSERT QUE MÁS IMPORTA: cuando el desempate TAMBIÉN está tomado, el
-- renombrado NO falla. Se conserva la dirección vieja y la persona puede
-- editar su nombre igual. Nadie debe quedarse sin poder cambiarse el nombre
-- por una colisión de URL.
--
-- Se arma el doble choque: la cuenta 3 se renombra a "Iván Soto" y se queda
-- con 'ivan-soto' (porque 'ivan' es de la 2). A partir de ahí, la cuenta 1
-- intentando llamarse igual no tiene salida: 'ivan' y 'ivan-soto' están las
-- dos ocupadas.
update public.perfiles set nombre = 'Iván', apellidos = 'Soto'
 where id = pg_temp.cuenta(3);
select pg_temp.assert_true(
  (select slug = 'ivan-soto' from public.perfiles where id = pg_temp.cuenta(3)),
  'premisa: la tercera cuenta ocupa el desempate'
);

select pg_temp.assert_true(
  pg_temp.filas(
    format('update public.perfiles set nombre = %L, apellidos = %L where id = %L',
           'Iván', 'Soto', pg_temp.cuenta(1))
  ) = 1,
  'renombrarse sin ninguna dirección libre NO falla'
);
select pg_temp.assert_true(
  (select nombre = 'Iván' and apellidos = 'Soto' and slug = 'ivan-nunez'
   from public.perfiles where id = pg_temp.cuenta(1)),
  'el nombre nuevo se guarda y la dirección vieja se conserva'
);

-- El alta, en cambio, conserva su fallo ruidoso: ahí sí hay alguien que puede
-- resolverlo a mano, y un colaborador sin slug rompería el CHECK cruzado.
insert into auth.users (id, raw_user_meta_data)
values (pg_temp.cuenta(4), '{"nombre": "Iván", "apellidos": ""}'::jsonb);
select pg_temp.assert_raises(
  format('update public.perfiles set es_colaborador = true where id = %L',
         pg_temp.cuenta(4)),
  'P0001',
  'dar de alta con un nombre chocado y sin apellidos sigue fallando ruidosamente'
);

-- === 9. Idempotencia ========================================================
-- Aplicarla dos veces no falla ni vuelve a pisar valores: la segunda corrida
-- no entra al bloque del renombrado, y las fichas ya tienen valores válidos.

update public.fichas_colaborador set modalidad_trabajo = 'Remoto'
 where id = pg_temp.cuenta(2);

\ir ../migrations/0040_modalidad_trabajo_colaborador.sql

select pg_temp.assert_true(
  (select modalidad_trabajo = 'Remoto' from public.fichas_colaborador
    where id = pg_temp.cuenta(2)),
  're-aplicar la 0040 NO re-escribe una modalidad ya válida'
);
select pg_temp.assert_true(
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute'),
  're-aplicarla deja los grants de la RPC en su lugar'
);

select '0040 modalidad_trabajo PASS' as result;
