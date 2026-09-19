\set ON_ERROR_STOP on

-- La 0039 exige client_encoding UTF8 en su preflight (sus `comment on` llevan
-- acentos) y este archivo trae nombres y fichas con acentos. Se fija aquí para
-- no depender de la codificación del entorno (`PGCLIENTENCODING`).
\encoding UTF8

-- Destructivo a propósito: sólo corre en la base aislada de abajo.
do $guard$
begin
  if current_database() <> 'taudux_fichas_colaborador_0039_test' then
    raise exception 'Refusing to run outside taudux_fichas_colaborador_0039_test';
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
-- policies se ejercitan por el camino real bajo `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

\ir ../migrations/0001_crear_perfiles.sql

-- Defaults de Supabase, replicados ANTES de las migraciones nuevas: SELECT e
-- INSERT sobre perfiles, TODO sobre cada tabla nueva de public y EXECUTE sobre
-- cada función nueva, para anon y authenticated. Sin esto, "anon no lee la
-- tabla" o "authenticated no inserta creado_en" pasarían por un grant que aquí
-- simplemente faltara, y no por los revoke de la 0039.
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

-- Corre `sentencia` y devuelve cuántas filas tocó. Un UPDATE que la RLS filtra
-- no falla: simplemente no toca nada, y eso es lo que hay que medir.
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

-- Ids legibles: cuenta(7) = 39000000-0000-4000-8000-000000000007.
create function pg_temp.cuenta(n int) returns uuid
language sql immutable as $$
  select ('39000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- El UPDATE con el que la cuenta con sesión edita SU ficha ("Mi ficha").
create function pg_temp.editar_propia(asignacion text) returns text
language sql immutable as $$
  select 'update public.fichas_colaborador set ' || asignacion
      || ' where id = auth.uid()'
$$;

-- Un INSERT de ficha completa y válida para `p_id`: si falla, falla por quién
-- lo corre o para quién es, nunca por los datos.
create function pg_temp.insertar_ficha(p_id uuid) returns text
language sql immutable as $$
  select format(
    'insert into public.fichas_colaborador '
    '(id, rol, especialidad, ubicacion, stack, disponibilidad, anio_inicio, bio) '
    'values (%L, %L, %L, %L, %L, %L, %s, %L)',
    p_id, 'Analista', 'Datos abiertos', 'Puebla, México', '{SQL,Python}',
    'Parcial', 2021, 'Una ficha completa y válida.'
  )
$$;

-- handle_new_user (0001) crea cada perfil desde el metadata.
insert into auth.users (id, raw_user_meta_data)
select pg_temp.cuenta(n), datos
from (values
  (1, '{"nombre": "Valeria", "apellidos": "Núñez"}'::jsonb),
  (2, '{"nombre": "Iván", "apellidos": "Soto"}'),
  (3, '{"nombre": "Begoña", "apellidos": "Ruiz"}'),
  (4, '{"nombre": "Luis", "apellidos": "Paz"}'),
  (5, '{"nombre": "Sofía", "apellidos": "Vega"}')
) as semilla(n, datos);

-- Todos con teléfono: es el dato que la página pública jamás debe mostrar, y
-- sin él la aserción de "la RPC no lo entrega" no probaría nada.
update public.perfiles set telefono = '5550001234';

\ir ../migrations/0038_colaboradores_publicos.sql

-- Colaboradores: 1 (Valeria), 2 (Iván), 3 (Begoña, nunca tendrá ficha) y 5
-- (Sofía, ficha cargada por la administración). La 4 (Luis) NO colabora.
-- Una cuenta por update, como pide la cabecera de la 0038.
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(1);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(2);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(3);
update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(5);

\ir ../migrations/0039_fichas_colaborador.sql

-- === Re-run: aplicar la 0039 otra vez, con datos vivos ======================
-- La administración carga una ficha a mano (superusuario, como el SQL Editor)
-- y la migración se vuelve a aplicar: los CHECK se re-validan contra esa fila
-- y la RPC se borra y se recrea sin perder nada.

insert into public.fichas_colaborador
  (id, rol, especialidad, ubicacion, stack, disponibilidad, anio_inicio, bio)
values
  (pg_temp.cuenta(5), 'Docente', 'Estadística aplicada', 'Guadalajara, México',
   array['R', 'Excel'], 'No disponible', 2008, 'Enseño estadística desde 2008.');

\ir ../migrations/0039_fichas_colaborador.sql

select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(rol = 'Docente')
   from public.fichas_colaborador where id = pg_temp.cuenta(5)),
  'aplicar la 0039 por segunda vez conserva las fichas ya guardadas'
);
select pg_temp.assert_true(
  (select count(*) = 1 from pg_trigger
   where tgrelid = 'public.fichas_colaborador'::regclass
     and tgname = 'fichas_colaborador_set_actualizado_en'),
  'el re-run deja un solo trigger de actualizado_en, no dos'
);
select pg_temp.assert_true(
  (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'),
                     ',' order by policyname collate "C")
   from pg_policies
   where schemaname = 'public' and tablename = 'fichas_colaborador')
    = 'fichas_colaborador_insert_propia:INSERT:authenticated,'
      'fichas_colaborador_select_propia:SELECT:authenticated,'
      'fichas_colaborador_update_propia:UPDATE:authenticated',
  'tres policies para authenticated (select, insert, update) y ninguna de delete'
);

-- === Estructura: RLS y privilegios ==========================================

select pg_temp.assert_true(
  (select relrowsecurity and not relforcerowsecurity
   from pg_class where oid = 'public.fichas_colaborador'::regclass),
  'RLS activa pero NO forzada: el dueño de la tabla (SQL Editor) corrige fichas a mano'
);
select pg_temp.assert_true(
  not has_any_column_privilege('anon', 'public.fichas_colaborador',
                               'select, insert, update, references')
  and not has_table_privilege('anon', 'public.fichas_colaborador',
                              'delete, truncate, trigger'),
  'anon no tiene ningún privilegio sobre la tabla: lee las fichas sólo por la RPC'
);
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.fichas_colaborador', 'select'),
  'authenticated puede leer la tabla (la RLS decide qué filas)'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.fichas_colaborador',
                          'insert, update, delete, truncate, references, trigger'),
  'authenticated no tiene INSERT/UPDATE de tabla completa, ni DELETE, TRUNCATE, REFERENCES o TRIGGER'
);
select pg_temp.assert_true(
  (select bool_and(has_column_privilege('authenticated', 'public.fichas_colaborador',
                                        columna, 'insert'))
   from unnest(array['id', 'rol', 'especialidad', 'ubicacion', 'stack',
                     'disponibilidad', 'anio_inicio', 'bio', 'linkedin',
                     'github', 'correo']) as columna),
  'authenticated inserta id y todos los campos de la ficha'
);
select pg_temp.assert_true(
  (select bool_and(has_column_privilege('authenticated', 'public.fichas_colaborador',
                                        columna, 'update'))
   from unnest(array['rol', 'especialidad', 'ubicacion', 'stack',
                     'disponibilidad', 'anio_inicio', 'bio', 'linkedin',
                     'github', 'correo']) as columna),
  'authenticated actualiza todos los campos de la ficha'
);
select pg_temp.assert_true(
  not has_column_privilege('authenticated', 'public.fichas_colaborador', 'creado_en', 'insert')
  and not has_column_privilege('authenticated', 'public.fichas_colaborador', 'actualizado_en', 'insert')
  and not has_column_privilege('authenticated', 'public.fichas_colaborador', 'id', 'update')
  and not has_column_privilege('authenticated', 'public.fichas_colaborador', 'creado_en', 'update')
  and not has_column_privilege('authenticated', 'public.fichas_colaborador', 'actualizado_en', 'update'),
  'authenticated no escribe las fechas ni cambia el id de una ficha'
);

-- === 1. La dueña colaboradora crea, lee y edita su ficha ====================

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;

insert into public.fichas_colaborador
  (id, rol, especialidad, ubicacion, stack, disponibilidad, anio_inicio, bio,
   linkedin, github, correo)
values
  (pg_temp.cuenta(1), 'Ingeniera de datos', 'Pipelines y analítica',
   'Monterrey, México', array['SQL', 'Python', 'dbt'], 'Disponible', 2016,
   E'Construyo pipelines de datos.\nDoy clases de SQL.',
   'https://www.linkedin.com/in/valeria-nunez', 'https://github.com/valeria',
   'valeria.nunez+taudux@correo.mx');

reset role;
select set_config('request.jwt.claim.sub', pg_temp.cuenta(2)::text, false);
set role authenticated;

insert into public.fichas_colaborador
  (id, rol, especialidad, ubicacion, stack, disponibilidad, anio_inicio, bio,
   linkedin, github, correo)
values
  (pg_temp.cuenta(2), 'Desarrollador backend', 'APIs y bases de datos',
   'Ciudad de México', array['Go', 'PostgreSQL'], 'Disponible', 2019,
   'Diseño APIs y doy clases de bases de datos.', null,
   'https://github.com/ivan-soto', null);

reset role;
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;

select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(id = pg_temp.cuenta(1))
   from public.fichas_colaborador),
  'la colaboradora ve sólo su propia ficha, aunque haya otras tres guardadas'
);

select creado_en as creado_antes, actualizado_en as actualizado_antes
from public.fichas_colaborador where id = pg_temp.cuenta(1) \gset
select pg_sleep(0.02);

select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$
    rol = 'Arquitecta de datos', disponibilidad = 'Parcial',
    stack = array['SQL', 'Python', 'dbt', 'Airflow'], linkedin = null
  $$)) = 1,
  'la dueña edita su ficha: el update toca exactamente su fila'
);
select pg_temp.assert_true(
  (select rol = 'Arquitecta de datos' and disponibilidad = 'Parcial'
          and stack = array['SQL', 'Python', 'dbt', 'Airflow'] and linkedin is null
          and github = 'https://github.com/valeria'
   from public.fichas_colaborador where id = pg_temp.cuenta(1)),
  'la edición guarda los campos nuevos y deja intactos los demás'
);
select pg_temp.assert_true(
  (select actualizado_en > :'actualizado_antes'::timestamptz
          and creado_en = :'creado_antes'::timestamptz
   from public.fichas_colaborador where id = pg_temp.cuenta(1)),
  'editar avanza actualizado_en y conserva creado_en'
);

-- === 2. Nadie toca la ficha de otro =========================================

select pg_temp.assert_raises(
  pg_temp.insertar_ficha(pg_temp.cuenta(3)),
  '42501',
  'una colaboradora no crea la ficha de otra cuenta, aunque sea colaboradora y no tenga ficha'
);
select pg_temp.assert_true(
  pg_temp.filas(format(
    'update public.fichas_colaborador set rol = %L where id = %L',
    'Intruso', pg_temp.cuenta(2))) = 0,
  'editar la ficha de otra cuenta no toca ninguna fila'
);
select pg_temp.assert_true(
  pg_temp.filas('update public.fichas_colaborador set disponibilidad = ''Parcial''') = 1,
  'un update sin where sólo alcanza la ficha propia'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.fichas_colaborador where id = pg_temp.cuenta(2)),
  'leer la ficha de otra cuenta no devuelve ninguna fila'
);

reset role;

select pg_temp.assert_true(
  (select rol = 'Desarrollador backend' and disponibilidad = 'Disponible'
   from public.fichas_colaborador where id = pg_temp.cuenta(2)),
  'la ficha ajena sigue intacta tras los intentos de la otra cuenta'
);
select pg_temp.assert_true(
  not exists (select 1 from public.fichas_colaborador where id = pg_temp.cuenta(3)),
  'el insert rechazado no dejó ficha para la cuenta 3'
);

-- === 3. Una cuenta que no colabora no tiene ficha ============================

select set_config('request.jwt.claim.sub', pg_temp.cuenta(4)::text, false);
set role authenticated;

select pg_temp.assert_raises(
  pg_temp.insertar_ficha(pg_temp.cuenta(4)),
  '42501',
  'una cuenta que no es colaboradora no puede crear su propia ficha'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.fichas_colaborador),
  'una cuenta que no es colaboradora no ve ninguna ficha'
);

reset role;

-- Sin sesión (claim vacío), authenticated tampoco ve nada: auth.uid() es null.
select set_config('request.jwt.claim.sub', '', false);
set role authenticated;
select pg_temp.assert_true(
  (select count(*) = 0 from public.fichas_colaborador),
  'authenticated sin claim no ve ninguna ficha'
);
reset role;

-- === 4. Columnas y operaciones cerradas ======================================

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;

select pg_temp.assert_raises(
  pg_temp.editar_propia(format('id = %L', pg_temp.cuenta(3))),
  '42501',
  'la dueña no puede cambiar el id de su ficha (ni pasársela a otra cuenta)'
);
select pg_temp.assert_raises(
  pg_temp.editar_propia($$creado_en = now() - interval '1 year'$$),
  '42501',
  'la dueña no puede reescribir creado_en'
);
select pg_temp.assert_raises(
  pg_temp.editar_propia($$actualizado_en = now() - interval '1 year'$$),
  '42501',
  'la dueña no puede reescribir actualizado_en'
);
select pg_temp.assert_raises(
  format(
    'insert into public.fichas_colaborador '
    '(id, rol, especialidad, ubicacion, stack, disponibilidad, anio_inicio, bio, creado_en) '
    'values (%L, %L, %L, %L, %L, %L, %s, %L, %L)',
    pg_temp.cuenta(1), 'Analista', 'Datos abiertos', 'Puebla, México', '{SQL}',
    'Parcial', 2021, 'Una ficha completa y válida.', '2000-01-01'),
  '42501',
  'insertar con creado_en explícito está denegado: las fechas las pone la base'
);
select pg_temp.assert_raises(
  'delete from public.fichas_colaborador where id = auth.uid()',
  '42501',
  'la dueña no puede borrar su ficha desde el navegador (lo hace la administración)'
);
select pg_temp.assert_raises(
  'truncate public.fichas_colaborador',
  '42501',
  'authenticated no puede vaciar la tabla'
);

reset role;
set role anon;

select pg_temp.assert_raises(
  'select * from public.fichas_colaborador',
  '42501',
  'anon leyendo la tabla directo recibe permiso denegado'
);
select pg_temp.assert_raises(
  pg_temp.insertar_ficha(pg_temp.cuenta(3)),
  '42501',
  'anon no puede crear fichas'
);

reset role;

-- === 5. Los CHECK ============================================================
-- Por el camino real: la dueña editando su propia ficha como authenticated.
-- Así la función del CHECK del stack también corre con sus privilegios.

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;

-- rol: 2..60, sin espacios en los bordes ni caracteres de control
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = ' Ingeniera'$$),
  '23514', 'rol con espacio al inicio');
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = 'Ingeniera '$$),
  '23514', 'rol con espacio al final');
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = 'I'$$),
  '23514', 'rol de un solo carácter');
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = ''$$),
  '23514', 'rol vacío');
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = repeat('r', 61)$$),
  '23514', 'rol de 61 caracteres');
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = E'Inge\tniera'$$),
  '23514', 'rol con tabulador');
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = null$$),
  '23502', 'rol null: una ficha guardada es una ficha completa');

-- especialidad: 2..80
select pg_temp.assert_raises(pg_temp.editar_propia($$especialidad = '   '$$),
  '23514', 'especialidad en blanco');
select pg_temp.assert_raises(pg_temp.editar_propia($$especialidad = 'E'$$),
  '23514', 'especialidad de un solo carácter');
select pg_temp.assert_raises(pg_temp.editar_propia($$especialidad = repeat('e', 81)$$),
  '23514', 'especialidad de 81 caracteres');
select pg_temp.assert_raises(pg_temp.editar_propia($$especialidad = E'Datos'$$),
  '23514', 'especialidad con un carácter de control');

-- ubicacion: 2..80, una sola línea
select pg_temp.assert_raises(pg_temp.editar_propia($$ubicacion = 'M'$$),
  '23514', 'ubicación de un solo carácter');
select pg_temp.assert_raises(pg_temp.editar_propia($$ubicacion = repeat('u', 81)$$),
  '23514', 'ubicación de 81 caracteres');
select pg_temp.assert_raises(pg_temp.editar_propia($$ubicacion = E'Monterrey\nMéxico'$$),
  '23514', 'ubicación con salto de línea: sólo la bio los admite');
select pg_temp.assert_raises(pg_temp.editar_propia($$ubicacion = ' Monterrey'$$),
  '23514', 'ubicación con espacio al inicio');

-- stack: 1..12 elementos de 1..40, sin null ni bordes ni control, 1 dimensión
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = '{}'$$),
  '23514', 'stack vacío');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array_fill('x'::text, array[13])$$),
  '23514', 'stack de 13 elementos');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array[' SQL']$$),
  '23514', 'elemento del stack con espacio al inicio');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array['SQL ']$$),
  '23514', 'elemento del stack con espacio al final');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array['SQL', '']$$),
  '23514', 'elemento del stack vacío');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array[repeat('s', 41)]$$),
  '23514', 'elemento del stack de 41 caracteres');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array['SQL', null]$$),
  '23514', 'elemento del stack null');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array[E'SQL\tPython']$$),
  '23514', 'elemento del stack con tabulador');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = '{{SQL,dbt},{Go,Rust}}'$$),
  '23514', 'stack de dos dimensiones');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = null$$),
  '23502', 'stack null');

-- disponibilidad: lista cerrada
select pg_temp.assert_raises(pg_temp.editar_propia($$disponibilidad = 'disponible'$$),
  '23514', 'disponibilidad en minúsculas');
select pg_temp.assert_raises(pg_temp.editar_propia($$disponibilidad = 'Ocupado'$$),
  '23514', 'disponibilidad fuera de la lista');
select pg_temp.assert_raises(pg_temp.editar_propia($$disponibilidad = ''$$),
  '23514', 'disponibilidad vacía');

-- anio_inicio: 1950..2100
select pg_temp.assert_raises(pg_temp.editar_propia($$anio_inicio = 1949$$),
  '23514', 'año de inicio 1949');
select pg_temp.assert_raises(pg_temp.editar_propia($$anio_inicio = 2101$$),
  '23514', 'año de inicio 2101');

-- bio: 10..600, saltos de línea sí, otros caracteres de control no
select pg_temp.assert_raises(pg_temp.editar_propia($$bio = 'nueve let'$$),
  '23514', 'bio de 9 caracteres');
select pg_temp.assert_raises(pg_temp.editar_propia($$bio = repeat('b', 601)$$),
  '23514', 'bio de 601 caracteres');
select pg_temp.assert_raises(pg_temp.editar_propia($$bio = ' Bio con espacio inicial'$$),
  '23514', 'bio con espacio al inicio');
select pg_temp.assert_raises(pg_temp.editar_propia($$bio = E'Bio que termina en salto\n'$$),
  '23514', 'bio con salto de línea al final');
select pg_temp.assert_raises(pg_temp.editar_propia($$bio = E'Bio con\ttabulador'$$),
  '23514', 'bio con tabulador');
select pg_temp.assert_raises(pg_temp.editar_propia($$bio = E'Bio con retorno\r\nde carro'$$),
  '23514', 'bio con retorno de carro: el salto válido es sólo \n');

-- Formato bidireccional (categoría Cf): pasa `[[:cntrl:]]` y `btrim` no lo
-- quita, pero pondría el texto al revés en la página pública.
select pg_temp.assert_raises(pg_temp.editar_propia($$rol = E'Datos ‮sotad'$$),
  '23514', 'rol con U+202E (RIGHT-TO-LEFT OVERRIDE)');
select pg_temp.assert_raises(pg_temp.editar_propia($$especialidad = E'Datos‏'$$),
  '23514', 'especialidad con U+200F (RIGHT-TO-LEFT MARK)');
select pg_temp.assert_raises(pg_temp.editar_propia($$ubicacion = E'⁦Monterrey'$$),
  '23514', 'ubicación con U+2066 (LEFT-TO-RIGHT ISOLATE)');
select pg_temp.assert_raises(pg_temp.editar_propia($$stack = array[E'SQL‪']$$),
  '23514', 'elemento del stack con U+202A (LEFT-TO-RIGHT EMBEDDING)');
select pg_temp.assert_raises(pg_temp.editar_propia($$bio = E'Bio que se ve⁩ al revés'$$),
  '23514', 'bio con U+2069 (POP DIRECTIONAL ISOLATE)');

-- linkedin: https y linkedin.com (con subdominio opcional), sin espacios, <= 200
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'http://www.linkedin.com/in/valeria'$$),
  '23514', 'linkedin por http');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'https://evil.com/in/valeria'$$),
  '23514', 'linkedin que no es linkedin.com');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'https://linkedin.com.evil.com/in/valeria'$$),
  '23514', 'linkedin.com como subdominio de otro host');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'https://evillinkedin.com/in/valeria'$$),
  '23514', 'host que sólo termina en linkedin.com');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'https://linkedin.com@evil.com/in/valeria'$$),
  '23514', 'linkedin.com como usuario de otra URL');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'https://linkedin.com/'$$),
  '23514', 'linkedin sin ruta de perfil');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'https://linkedin.com/in/con espacio'$$),
  '23514', 'linkedin con espacio');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'javascript:alert(1)'$$),
  '23514', 'linkedin con javascript:');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = ''$$),
  '23514', 'linkedin vacío: el enlace ausente es null, no cadena vacía');
select pg_temp.assert_raises(pg_temp.editar_propia($$linkedin = 'https://linkedin.com/' || repeat('l', 180)$$),
  '23514', 'linkedin de 201 caracteres');

-- github: https y github.com (o www.github.com), <= 200
select pg_temp.assert_raises(pg_temp.editar_propia($$github = 'https://gitlab.com/valeria'$$),
  '23514', 'github que no es github.com');
select pg_temp.assert_raises(pg_temp.editar_propia($$github = 'http://github.com/valeria'$$),
  '23514', 'github por http');
select pg_temp.assert_raises(pg_temp.editar_propia($$github = 'https://github.com.evil.com/valeria'$$),
  '23514', 'github.com como subdominio de otro host');
select pg_temp.assert_raises(pg_temp.editar_propia($$github = 'https://gist.github.com/valeria'$$),
  '23514', 'github con un subdominio distinto de www');
select pg_temp.assert_raises(pg_temp.editar_propia($$github = ''$$),
  '23514', 'github vacío');
select pg_temp.assert_raises(pg_temp.editar_propia($$github = 'https://github.com/' || repeat('g', 182)$$),
  '23514', 'github de 201 caracteres');

-- correo: la misma lista blanca que el front, <= 254
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = 'valeria'$$),
  '23514', 'correo sin arroba');
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = 'valeria@correo'$$),
  '23514', 'correo sin dominio de nivel superior');
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = 'valeria@correo.m'$$),
  '23514', 'correo con dominio de nivel superior de una letra');
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = 'a@b.com?bcc=otro@x.com'$$),
  '23514', 'correo con cabeceras de mailto: pondría a un tercero en copia oculta');
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = 'mailto:a@b.com'$$),
  '23514', 'correo con esquema mailto:');
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = 'val eria@correo.mx'$$),
  '23514', 'correo con espacio');
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = ''$$),
  '23514', 'correo vacío');
select pg_temp.assert_raises(pg_temp.editar_propia($$correo = repeat('c', 245) || '@correo.mx'$$),
  '23514', 'correo de 255 caracteres');

-- Los bordes aceptados, en dos tandas: si el CHECK se pasara de estricto,
-- aquí fallaría la sentencia entera.
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$
    rol = 'QA', especialidad = repeat('e', 80), ubicacion = repeat('u', 80),
    stack = array_fill('x'::text, array[12]), disponibilidad = 'No disponible',
    anio_inicio = 1950, bio = repeat('b', 600),
    linkedin = 'https://mx.linkedin.com/in/valeria',
    github = 'https://www.github.com/valeria',
    correo = repeat('c', 244) || '@correo.mx'
  $$)) = 1,
  'se aceptan: rol de 2, textos de 80, 12 elementos, 1950, bio de 600, subdominios válidos y correo de 254'
);
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$
    rol = repeat('r', 60), especialidad = 'EE', ubicacion = 'MX',
    stack = array[repeat('s', 40), 'C'], anio_inicio = 2100,
    bio = 'diez letra',
    linkedin = 'https://linkedin.com/' || repeat('l', 179),
    github = 'https://github.com/' || repeat('g', 181),
    correo = 'a@b.co'
  $$)) = 1,
  'se aceptan: rol de 60, textos de 2, elementos de 40 y de 1, 2100, bio de 10 y enlaces de 200'
);
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$
    bio = E'Primer párrafo.\n\nSegundo párrafo.', linkedin = null, github = null,
    correo = null
  $$)) = 1,
  'se acepta una bio con saltos de línea, y los tres enlaces son opcionales'
);

reset role;

-- Falta un campo obligatorio al crear: una ficha a medias no se guarda.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(3)::text, false);
set role authenticated;
select pg_temp.assert_raises(
  format(
    'insert into public.fichas_colaborador '
    '(id, rol, especialidad, ubicacion, stack, disponibilidad, anio_inicio) '
    'values (%L, %L, %L, %L, %L, %L, %s)',
    pg_temp.cuenta(3), 'Analista', 'Datos abiertos', 'Puebla, México', '{SQL}',
    'Parcial', 2021),
  '23502',
  'crear una ficha sin bio falla: no hay borradores'
);
reset role;

-- La dueña deja su ficha en su versión final, la que verá la página pública.
select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$
    rol = 'Arquitecta de datos', especialidad = 'Pipelines y analítica',
    ubicacion = 'Monterrey, México', stack = array['SQL', 'Python', 'dbt', 'Airflow'],
    disponibilidad = 'Parcial', anio_inicio = 2016,
    bio = E'Construyo pipelines de datos.\nDoy clases de SQL.',
    linkedin = 'https://www.linkedin.com/in/valeria-nunez',
    github = 'https://github.com/valeria',
    correo = 'valeria.nunez+taudux@correo.mx'
  $$)) = 1,
  'la dueña guarda la versión final de su ficha'
);
reset role;

-- === 6. Forma de la RPC ======================================================

select pg_temp.assert_true(
  pg_get_function_result('public.listar_colaboradores()'::regprocedure)
    = 'TABLE(nombre text, apellidos text, slug text, rol text, especialidad text, '
      'ubicacion text, stack text[], disponibilidad text, anio_inicio integer, '
      'bio text, linkedin text, github text, correo text)',
  'listar_colaboradores() devuelve nombre, apellidos, slug y los campos de la ficha, en ese orden'
);
select pg_temp.assert_true(
  (select prosecdef from pg_proc
   where oid = 'public.listar_colaboradores()'::regprocedure),
  'listar_colaboradores() es security definer: lee las tablas como su dueño'
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
  has_function_privilege('anon', 'public.listar_colaboradores()', 'execute')
  and has_function_privilege('authenticated', 'public.listar_colaboradores()', 'execute'),
  'anon y authenticated siguen pudiendo ejecutar listar_colaboradores() tras recrearla'
);

-- === 7. Lo que ve anon =======================================================

set role anon;

-- Se cuentan filas además de juntar slugs: Luis nunca fue marcado, su slug es
-- null, y string_agg lo saltaría en silencio.
select pg_temp.assert_true(
  (select count(*) = 4
          and count(*) filter (where nombre = 'Luis') = 0
          and string_agg(slug, ',' order by slug collate "C") = 'begona,ivan,sofia,valeria'
   from public.listar_colaboradores()),
  'anon recibe exactamente las cuentas colaboradoras: nunca a Luis, que no colabora'
);
select pg_temp.assert_true(
  (select string_agg(k, ',' order by k collate "C")
   from (select distinct jsonb_object_keys(to_jsonb(c)) as k
         from public.listar_colaboradores() as c) as claves)
    = 'anio_inicio,apellidos,bio,correo,disponibilidad,especialidad,github,'
      'linkedin,nombre,rol,slug,stack,ubicacion',
  'anon recibe sólo los 13 campos públicos: ni id, ni telefono, ni rol de cuenta, ni fechas'
);
select pg_temp.assert_true(
  (select to_jsonb(c) = jsonb_build_object(
            'nombre', 'Valeria', 'apellidos', 'Núñez', 'slug', 'valeria',
            'rol', 'Arquitecta de datos', 'especialidad', 'Pipelines y analítica',
            'ubicacion', 'Monterrey, México',
            'stack', to_jsonb(array['SQL', 'Python', 'dbt', 'Airflow']),
            'disponibilidad', 'Parcial', 'anio_inicio', 2016,
            'bio', E'Construyo pipelines de datos.\nDoy clases de SQL.',
            'linkedin', 'https://www.linkedin.com/in/valeria-nunez',
            'github', 'https://github.com/valeria',
            'correo', 'valeria.nunez+taudux@correo.mx')
   from public.listar_colaboradores() as c where c.slug = 'valeria'),
  'la ficha de una colaboradora sale completa y tal cual la guardó'
);
select pg_temp.assert_true(
  (select c.nombre = 'Begoña'
          and (c.rol, c.especialidad, c.ubicacion, c.stack, c.disponibilidad,
               c.anio_inicio, c.bio, c.linkedin, c.github, c.correo) is null
   from public.listar_colaboradores() as c where c.slug = 'begona'),
  'una colaboradora sin ficha sale con su nombre y todos los campos de ficha en null'
);
select pg_temp.assert_true(
  (select c.rol = 'Docente' and c.linkedin is null
   from public.listar_colaboradores() as c where c.slug = 'sofia'),
  'una ficha cargada por la administración también sale en la lista'
);

reset role;

-- === 8. Desmarcar oculta y bloquea, pero conserva ============================

update public.perfiles set es_colaborador = false where id = pg_temp.cuenta(2);

set role anon;
select pg_temp.assert_true(
  not exists (select 1 from public.listar_colaboradores() where slug = 'ivan'),
  'desmarcar saca a la cuenta, y a su ficha, de la lista pública'
);
reset role;

select set_config('request.jwt.claim.sub', pg_temp.cuenta(2)::text, false);
set role authenticated;
select pg_temp.assert_true(
  pg_temp.filas(pg_temp.editar_propia($$rol = 'Ya no colaboro'$$)) = 0,
  'una cuenta desmarcada ya no puede editar su ficha'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.fichas_colaborador),
  'una cuenta desmarcada ya no ve su ficha'
);
reset role;

select pg_temp.assert_true(
  (select rol = 'Desarrollador backend'
   from public.fichas_colaborador where id = pg_temp.cuenta(2)),
  'desmarcar conserva la fila de la ficha, intacta'
);

update public.perfiles set es_colaborador = true where id = pg_temp.cuenta(2);

set role anon;
select pg_temp.assert_true(
  (select c.rol = 'Desarrollador backend'
          and c.github = 'https://github.com/ivan-soto'
   from public.listar_colaboradores() as c where c.slug = 'ivan'),
  'volver a marcar devuelve la ficha a la lista, tal como estaba'
);
reset role;

-- === 9. Funciones auxiliares =================================================

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.es_colaborador()', 'execute')
  and not has_function_privilege('anon', 'public.es_colaborador()', 'execute'),
  'es_colaborador(): la ejecuta authenticated (las policies la llaman como el usuario), anon no'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.stack_colaborador_valido(text[])', 'execute')
  and not has_function_privilege('anon', 'public.stack_colaborador_valido(text[])', 'execute'),
  'stack_colaborador_valido(): la ejecuta authenticated (el CHECK corre como quien guarda), anon no'
);
select pg_temp.assert_true(
  (select p.prosecdef and p.provolatile = 's' and 'search_path=""' = any(p.proconfig)
   from pg_proc p where p.oid = 'public.es_colaborador()'::regprocedure),
  'es_colaborador() es security definer, stable y con search_path vacío'
);
select pg_temp.assert_true(
  (select not p.prosecdef and p.provolatile = 'i' and 'search_path=""' = any(p.proconfig)
   from pg_proc p where p.oid = 'public.stack_colaborador_valido(text[])'::regprocedure),
  'stack_colaborador_valido() es invoker, immutable y con search_path vacío'
);

select set_config('request.jwt.claim.sub', pg_temp.cuenta(1)::text, false);
set role authenticated;
select public.es_colaborador() as colaboradora_dice \gset
reset role;
select set_config('request.jwt.claim.sub', pg_temp.cuenta(4)::text, false);
set role authenticated;
select public.es_colaborador() as no_colaborador_dice \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role authenticated;
select public.es_colaborador() as sin_claim_dice \gset
reset role;

select pg_temp.assert_true(:'colaboradora_dice'::boolean,
  'es_colaborador() responde true para una cuenta marcada');
select pg_temp.assert_true(not :'no_colaborador_dice'::boolean,
  'es_colaborador() responde false para una cuenta sin marcar');
select pg_temp.assert_true(not :'sin_claim_dice'::boolean,
  'es_colaborador() responde false, no null, sin sesión');

set role anon;
select pg_temp.assert_raises('select public.es_colaborador()', '42501',
  'anon que llama es_colaborador() recibe permiso denegado');
select pg_temp.assert_raises('select public.stack_colaborador_valido(array[''SQL''])', '42501',
  'anon que llama stack_colaborador_valido() recibe permiso denegado');
reset role;

-- === 10. La administración, a mano ===========================================
-- Superusuario, como el SQL Editor: la RLS no lo alcanza, los CHECK sí.

select pg_temp.assert_true(
  pg_temp.filas(format(
    'update public.fichas_colaborador set bio = %L where id = %L',
    'Bio corregida por la administración.', pg_temp.cuenta(2))) = 1,
  'la administración corrige la ficha de otra cuenta desde el SQL Editor'
);
select pg_temp.assert_raises(
  format('update public.fichas_colaborador set correo = %L where id = %L',
         'no-es-un-correo', pg_temp.cuenta(2)),
  '23514',
  'los CHECK también alcanzan a la administración'
);

-- Retiro de consentimiento: se borra la fila, la cuenta sigue marcada.
delete from public.fichas_colaborador where id = pg_temp.cuenta(5);
select pg_temp.assert_true(
  (select c.rol is null from public.listar_colaboradores() as c where c.slug = 'sofia'),
  'borrar la ficha la saca de la página; la cuenta sigue en la lista sólo con su nombre'
);

-- Borrar la cuenta borra su ficha (auth.users → perfiles → fichas).
delete from auth.users where id = pg_temp.cuenta(2);
select pg_temp.assert_true(
  not exists (select 1 from public.fichas_colaborador where id = pg_temp.cuenta(2)),
  'borrar la cuenta borra su ficha en cascada'
);

select '0039 fichas_colaborador PASS' as result;
