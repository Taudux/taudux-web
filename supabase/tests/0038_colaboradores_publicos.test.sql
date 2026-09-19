\set ON_ERROR_STOP on

-- La migración y este archivo traen letras acentuadas (la tabla de traducción
-- de slug_colaborador() y los nombres de prueba). Se fija UTF8 para que no
-- dependa de la codificación del entorno (`PGCLIENTENCODING`): con otra, las
-- letras llegarían destrozadas sin ningún error. La 0038 también lo exige en
-- su preflight.
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
do $guard$
begin
  if current_database() <> 'taudux_colaboradores_publicos_0038_test' then
    raise exception 'Refusing to run outside taudux_colaboradores_publicos_0038_test';
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

-- Lo mínimo que la 0001 REAL necesita para cargar: auth.users con el metadata
-- del signUp (handle_new_user lo lee) y auth.uid().
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Sustituto mínimo del auth.uid() de Supabase: lee el mismo GUC
-- (request.jwt.claim.sub) que PostgREST fija en cada petición, así las
-- policies de la 0001 se ejercitan por el camino real bajo `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

-- La 0001 real, no una copia: sus policies, su revoke de update y su grant
-- por columna son justamente lo que la 0038 no debe abrir.
\ir ../migrations/0001_crear_perfiles.sql

-- Defaults de Supabase que la 0001 NO revoca: SELECT e INSERT a nivel tabla
-- para anon y authenticated, y EXECUTE para ambos en cada función nueva de
-- public. Se replican ANTES de la 0038 para que (a) "anon no lee telefono"
-- quede probado por la RLS y no por un grant que aquí simplemente faltara, y
-- (b) los revoke de la 0038 tengan algo real que quitar.
grant usage on schema public to anon, authenticated;
grant select, insert on public.perfiles to anon, authenticated;
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

-- Corre `sentencia` y exige que falle con `estado`. Si se pasa `pista`, el
-- HINT del error también tiene que contenerla: un rechazo del trigger le
-- tiene que decir al operador cómo seguir, no sólo que no.
create function pg_temp.assert_raises(
  sentencia text,
  estado text,
  message text,
  pista text default null
)
returns void language plpgsql as $assert$
declare
  v_estado text;
  v_mensaje text;
  v_pista text;
begin
  begin
    execute sentencia;
  exception
    when others then
      get stacked diagnostics
        v_estado = returned_sqlstate,
        v_mensaje = message_text,
        v_pista = pg_exception_hint;
      if v_estado <> estado then
        raise exception 'assertion failed: % (esperaba %, llegó %: %)',
          message, estado, v_estado, v_mensaje;
      end if;
      if pista is not null and strpos(coalesce(v_pista, ''), pista) = 0 then
        raise exception 'assertion failed: % (el hint no dice "%": %)',
          message, pista, coalesce(v_pista, '<sin hint>');
      end if;
      return;
  end;
  raise exception 'assertion failed: % (la sentencia no falló)', message;
end
$assert$;

-- Ids legibles: cuenta(7) = 38000000-0000-4000-8000-000000000007.
create function pg_temp.cuenta(n int) returns uuid
language sql immutable as $$
  select ('38000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Sembrado ANTES de la 0038 a propósito: las filas que ya existen tienen que
-- nacer sin marcar y sin slug, y las constraints nuevas validarlas.
-- handle_new_user (0001) crea cada perfil desde el metadata.
insert into auth.users (id, raw_user_meta_data)
select pg_temp.cuenta(n), datos
from (values
  (1,  '{"nombre": "María José", "apellidos": "Pérez"}'::jsonb),
  (2,  '{"nombre": "Iván", "apellidos": "Soto"}'),
  (3,  '{"nombre": "Begoña", "apellidos": "Ruiz"}'),
  (4,  '{"nombre": "ÁNGEL", "apellidos": "Gómez"}'),
  (5,  '{"nombre": "Juan Pablo", "apellidos": "Hernández"}'),
  (6,  '{"nombre": "Diego", "apellidos": "Luna"}'),
  (7,  '{"nombre": "Diego", "apellidos": "Ramírez"}'),
  (8,  '{"nombre": "Diego", "apellidos": "de la Cruz"}'),
  (9,  '{"nombre": "Diego", "apellidos": "Ramírez López"}'),
  (10, '{"nombre": "Diego"}'),
  (11, '{}'),
  (12, '{"nombre": "   ", "apellidos": "Blanco"}'),
  (13, '{"nombre": "Iván", "apellidos": "Mora"}'),
  (14, '{"nombre": "Luis", "apellidos": "Paz"}'),
  (15, '{"nombre": "Norma", "apellidos": "Común"}'),
  (16, '{"nombre": "Sofía", "apellidos": "Vega"}'),
  (17, '{"nombre": "Begoña", "apellidos": "Ortiz"}')
) as semilla(n, datos);

-- Todos con teléfono: es el dato que la página pública jamás debe mostrar, y
-- sin él las aserciones de "anon no lo ve" no probarían nada.
update public.perfiles set telefono = '5550001234';

\ir ../migrations/0038_colaboradores_publicos.sql

-- === Estado inicial =========================================================

select pg_temp.assert_true(
  (select count(*) = 17 from public.perfiles
   where not es_colaborador and slug is null and telefono is not null),
  'las 17 filas previas a la 0038 nacen sin marcar, sin slug y con teléfono'
);

-- === Función de slug (paridad con la regla del JS) ==========================

select pg_temp.assert_true(
  public.slug_colaborador('ÁÉÍÓÚÜÑ áéíóúüñ') = 'aeiouun-aeiouun',
  'acentos del español en mayúscula y minúscula se traducen sin depender del locale'
);
select pg_temp.assert_true(
  public.slug_colaborador('ÀÈÌÒÙ âêîôû ÄËÏÖ ç ÃÕ') = 'aeiou-aeiou-aeio-c-ao',
  'graves, circunflejos, diéresis, cedilla y tildes de la tabla también se traducen'
);
select pg_temp.assert_true(
  public.slug_colaborador('  ¡Hola,   Mundo! 2026 ') = 'hola-mundo-2026',
  'todo lo que no es [a-z0-9] colapsa en un solo guion y se recortan los de los bordes'
);
select pg_temp.assert_true(
  public.slug_colaborador('¿?') is null and public.slug_colaborador(null) is null,
  'sin letras ni dígitos no hay slug: null, nunca cadena vacía'
);

-- === 1. Marcar llena el slug con el nombre, sin apellidos ===================

update public.perfiles set es_colaborador = true
where id in (pg_temp.cuenta(1), pg_temp.cuenta(2), pg_temp.cuenta(3),
             pg_temp.cuenta(4), pg_temp.cuenta(5));

select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(1)) = 'maria-jose',
  '"María José" se marca como maria-jose: sin acentos, espacio a guion, sin apellidos'
);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(2)) = 'ivan',
  '"Iván" se marca como ivan'
);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(3)) = 'begona',
  '"Begoña" se marca como begona: la ñ se traduce, no se vuelve guion'
);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(4)) = 'angel',
  '"ÁNGEL" se marca como angel: la Á mayúscula se traduce antes de bajar a minúsculas'
);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(5)) = 'juan-pablo',
  '"Juan Pablo" se marca como juan-pablo'
);

-- === 2. Choque: se agrega el primer apellido ================================
-- Una cuenta por update, como indica la cabecera de la 0038.

update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(6);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(7);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(8);

select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(6)) = 'diego',
  'el primer Diego se queda con diego'
);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(7)) = 'diego-ramirez',
  'el segundo Diego choca con diego y recibe su primer apellido: diego-ramirez'
);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(8)) = 'diego-de-la-cruz',
  '"de la Cruz" es UN apellido: las partículas viajan con él (diego-de-la-cruz)'
);

-- === Re-run: aplicar la 0038 otra vez, con datos vivos ======================
-- Más exigente que cargarla dos veces en vacío: las constraints se vuelven a
-- validar contra filas marcadas y nada de lo marcado puede perderse.

\ir ../migrations/0038_colaboradores_publicos.sql

select pg_temp.assert_true(
  (select string_agg(slug, ',' order by slug collate "C")
   from public.perfiles where es_colaborador)
    = 'angel,begona,diego,diego-de-la-cruz,diego-ramirez,ivan,juan-pablo,maria-jose',
  'aplicar la 0038 por segunda vez conserva las marcas y los slugs ya asignados'
);
select pg_temp.assert_true(
  (select count(*) = 1 from pg_trigger
   where tgrelid = 'public.perfiles'::regclass
     and tgname = 'perfiles_asignar_slug_colaborador'),
  'el re-run deja un solo trigger de slug, no dos'
);

-- === 3. Sin salida automática: falla y pide slug a mano =====================

select pg_temp.assert_raises(
  format('update public.perfiles set es_colaborador = true where id = %L',
         pg_temp.cuenta(9)),
  'P0001',
  'otro Diego Ramírez: diego y diego-ramirez están tomados y no hay sufijo numérico',
  'set es_colaborador = true, slug ='
);
select pg_temp.assert_true(
  (select not es_colaborador and slug is null
   from public.perfiles where id = pg_temp.cuenta(9)),
  'un marcado rechazado no deja la cuenta a medio marcar'
);
select pg_temp.assert_raises(
  format('update public.perfiles set es_colaborador = true where id = %L',
         pg_temp.cuenta(10)),
  'P0001',
  'un Diego sin apellidos choca con diego y no tiene con qué desempatar',
  'set es_colaborador = true, slug ='
);
select pg_temp.assert_raises(
  format('update public.perfiles set es_colaborador = true where id = %L',
         pg_temp.cuenta(11)),
  'P0001',
  'una cuenta sin nombre no tiene de dónde sacar su slug',
  'set es_colaborador = true, slug ='
);
select pg_temp.assert_raises(
  format('update public.perfiles set es_colaborador = true where id = %L',
         pg_temp.cuenta(12)),
  'P0001',
  'un nombre en blanco cuenta como sin nombre',
  'set es_colaborador = true, slug ='
);

-- === 4. Slug a mano ==========================================================

update public.perfiles set es_colaborador = true, slug = 'profe-ivan'
where id = pg_temp.cuenta(13);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(13)) = 'profe-ivan',
  'un slug dado a mano en el mismo update gana sobre el automático'
);

select pg_temp.assert_raises(
  format('update public.perfiles set es_colaborador = true, slug = %L where id = %L',
         'Mal Slug', pg_temp.cuenta(14)),
  '23514',
  'un slug a mano con mayúsculas y espacios viola el formato'
);
select pg_temp.assert_raises(
  format('update public.perfiles set es_colaborador = true, slug = %L where id = %L',
         'diego', pg_temp.cuenta(14)),
  '23505',
  'un slug a mano que ya es de otra cuenta viola la unicidad'
);
select pg_temp.assert_raises(
  format('update public.perfiles set slug = null where id = %L', pg_temp.cuenta(2)),
  '23514',
  'una cuenta marcada no puede quedarse sin slug'
);

-- === 5. El slug es fijo ======================================================

update public.perfiles set nombre = 'Iván Alejandro' where id = pg_temp.cuenta(2);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(2)) = 'ivan',
  'cambiar el nombre NO regenera el slug: un enlace compartido no se rompe'
);

update public.perfiles set es_colaborador = false where id = pg_temp.cuenta(3);
select pg_temp.assert_true(
  not exists (select 1 from public.listar_colaboradores() where slug = 'begona'),
  'desmarcar saca a la cuenta de la lista pública'
);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(3)) = 'begona',
  'desmarcar conserva el slug'
);

update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(17);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(17)) = 'begona-ortiz',
  'un slug conservado por una cuenta desmarcada sigue reservado: otra Begoña recibe begona-ortiz'
);

update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(3);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(3)) = 'begona'
  and exists (select 1 from public.listar_colaboradores() where slug = 'begona'),
  'volver a marcar reutiliza el mismo slug y la cuenta vuelve a la lista'
);

-- El trigger también cubre INSERT: una fila que nace marcada recibe su slug.
delete from public.perfiles where id = pg_temp.cuenta(16);
insert into public.perfiles (id, nombre, apellidos, telefono, es_colaborador)
values (pg_temp.cuenta(16), 'Sofía', 'Vega', '5550001234', true);
select pg_temp.assert_true(
  (select slug from public.perfiles where id = pg_temp.cuenta(16)) = 'sofia',
  'un perfil insertado ya marcado recibe su slug igual que al marcarlo con update'
);

-- === 6. Forma de la RPC ======================================================

select pg_temp.assert_true(
  pg_get_function_result('public.listar_colaboradores()'::regprocedure)
    = 'TABLE(nombre text, apellidos text, slug text)',
  'listar_colaboradores() devuelve exactamente nombre, apellidos y slug'
);
select pg_temp.assert_true(
  (select prosecdef from pg_proc
   where oid = 'public.listar_colaboradores()'::regprocedure),
  'listar_colaboradores() es security definer: lee la tabla como su dueño'
);
select pg_temp.assert_true(
  (select 'search_path=""' = any(proconfig) from pg_proc
   where oid = 'public.listar_colaboradores()'::regprocedure),
  'listar_colaboradores() fija search_path vacío'
);
select pg_temp.assert_true(
  (select l.lanname = 'sql' and p.provolatile = 's'
   from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = 'public.listar_colaboradores()'::regprocedure),
  'listar_colaboradores() es language sql y stable'
);
select pg_temp.assert_true(
  (select p.provolatile = 'i' and 'search_path=""' = any(p.proconfig)
   from pg_proc p where p.oid = 'public.slug_colaborador(text)'::regprocedure),
  'slug_colaborador() es immutable y fija search_path vacío'
);
select pg_temp.assert_true(
  (select 'search_path=""' = any(p.proconfig)
   from pg_proc p where p.oid = 'public.asignar_slug_colaborador()'::regprocedure),
  'asignar_slug_colaborador() fija search_path vacío'
);

-- === 7. Lo que ve anon, y lo que no ==========================================

select pg_temp.assert_true(
  has_table_privilege('anon', 'public.perfiles', 'select'),
  'control: anon SÍ tiene el SELECT de tabla de Supabase; lo que lo frena es la RLS'
);

set role anon;
select
  count(*) as anon_filas,
  coalesce(string_agg(c.slug, ',' order by c.n), '') as anon_orden,
  coalesce(string_agg(c.slug, ',' order by c.slug collate "C"), '') as anon_slugs
from public.listar_colaboradores() with ordinality as c(nombre, apellidos, slug, n) \gset
select coalesce(string_agg(distinct k, ',' order by k), '') as anon_columnas
from (
  select jsonb_object_keys(to_jsonb(c)) as k
  from public.listar_colaboradores() as c
) as claves \gset
select coalesce(
  (select nombre || '|' || apellidos
   from public.listar_colaboradores() where slug = 'maria-jose'),
  '<ninguna>'
) as anon_maria \gset
select count(*) as anon_telefonos from (select telefono from public.perfiles) as t \gset
reset role;

select pg_temp.assert_true(
  :'anon_slugs' = 'angel,begona,begona-ortiz,diego,diego-de-la-cruz,diego-ramirez,ivan,juan-pablo,maria-jose,profe-ivan,sofia',
  'anon recibe exactamente las cuentas marcadas, ni una más'
);
select pg_temp.assert_true(
  :anon_filas = (select count(*) from public.perfiles where es_colaborador),
  'anon recibe una fila por cuenta marcada'
);
select pg_temp.assert_true(
  :'anon_orden' = (select string_agg(slug, ',' order by slug)
                   from public.perfiles where es_colaborador),
  'la lista sale ordenada por slug'
);
select pg_temp.assert_true(
  :'anon_columnas' = 'apellidos,nombre,slug',
  'anon recibe sólo nombre, apellidos y slug: ni id, ni telefono, ni rol, ni es_prueba, ni fechas'
);
select pg_temp.assert_true(
  :'anon_maria' = 'María José|Pérez',
  'la lista trae el nombre para mostrar tal cual, con acentos'
);
select pg_temp.assert_true(
  :anon_telefonos = 0,
  'anon leyendo perfiles directo no ve ninguna fila: la 0038 no abrió la tabla'
);

-- Una cuenta con sesión sigue viendo sólo su fila (0001), aunque la otra
-- sea colaboradora.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(15)::text, false);
set role authenticated;
select count(*) as ajena_visible from public.perfiles where id = pg_temp.cuenta(1) \gset
select count(*) as propia_visible from public.perfiles where id = pg_temp.cuenta(15) \gset

-- === 8. authenticated no puede marcarse ni elegirse slug =====================

select pg_temp.assert_raises(
  'update public.perfiles set es_colaborador = true where id = auth.uid()',
  '42501',
  'authenticated no puede marcarse como colaborador: es una marca operativa hecha a mano'
);
select pg_temp.assert_raises(
  'update public.perfiles set slug = ''x'' where id = auth.uid()',
  '42501',
  'authenticated no puede elegirse slug'
);
-- El INSERT no tiene grant revocado: lo cierra que 0001 no define policy de
-- INSERT. Si una migración futura la agrega sin excluir estas columnas, esto
-- falla. El slug va escrito a propósito: sin él, el trigger llamaría a
-- slug_colaborador(), que authenticated no puede ejecutar, y ese 42501
-- escondería una policy de INSERT abierta.
select pg_temp.assert_raises(
  'insert into public.perfiles (id, nombre, es_colaborador, slug) values (gen_random_uuid(), ''Intrusa'', true, ''intrusa'')',
  '42501',
  'authenticated no puede darse de alta como colaborador por INSERT'
);
update public.perfiles set telefono = '5559999999' where id = auth.uid();
reset role;

set role anon;
select pg_temp.assert_raises(
  'insert into public.perfiles (id, nombre, es_colaborador, slug) values (gen_random_uuid(), ''Intrusa'', true, ''intrusa'')',
  '42501',
  'anon no puede darse de alta como colaborador por INSERT'
);
reset role;

select pg_temp.assert_true(
  :propia_visible = 1,
  'control: con su claim, authenticated sí ve su propia fila'
);
select pg_temp.assert_true(
  :ajena_visible = 0,
  'authenticated no ve la fila de una cuenta colaboradora ajena'
);
select pg_temp.assert_true(
  (select telefono = '5559999999' from public.perfiles where id = pg_temp.cuenta(15)),
  'control: authenticated sí puede editar su teléfono; el 42501 es por las columnas nuevas'
);

-- === 9. Privilegios de ejecución =============================================

select pg_temp.assert_true(
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute'),
  'anon puede ejecutar listar_colaboradores()'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.listar_colaboradores()', 'execute'),
  'authenticated puede ejecutar listar_colaboradores()'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.slug_colaborador(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.slug_colaborador(text)', 'execute'),
  'ni anon ni authenticated ejecutan slug_colaborador(): es interna del trigger'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.asignar_slug_colaborador()', 'execute')
  and not has_function_privilege('authenticated', 'public.asignar_slug_colaborador()', 'execute'),
  'ni anon ni authenticated ejecutan asignar_slug_colaborador()'
);

set role anon;
select pg_temp.assert_raises(
  'select public.slug_colaborador(''x'')',
  '42501',
  'anon que llama slug_colaborador() directo recibe permiso denegado'
);
reset role;

select '0038 colaboradores_publicos PASS' as result;
