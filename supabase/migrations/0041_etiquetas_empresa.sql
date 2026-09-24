-- Etiquetas y empresa: `stack` pasa a `herramientas`, nacen `habilidades` e
-- `idiomas`, y la ficha gana dónde trabaja su dueño.
--
-- POR QUÉ SE PARTE EL STACK
--
-- En un solo campo convivían cosas distintas: "JavaScript" y "Supabase" son
-- herramientas, y lo que alguien sabe hacer —REST API, TDD, arquitectura— no
-- cabía en ningún lado. Son dos preguntas y ahora son dos listas.
--
-- EL CONTENIDO SIGUE A LA COLUMNA VIEJA
--
-- `stack` se renombra a `herramientas` y no hay backfill que mueva nada: lo
-- guardado SON herramientas. `habilidades` e `idiomas` nacen vacías. Al revés
-- —renombrar a habilidades— cada ficha existente publicaría sus herramientas
-- bajo una etiqueta que no les corresponde hasta que su dueño las moviera a
-- mano, que es exactamente lo que pasó con `sector` en la 0040.
--
-- OPCIONAL NO ES NULLABLE
--
-- `habilidades` e `idiomas` son `not null default '{}'`. Con nullable habría
-- DOS maneras de decir "ninguna" (null y '{}') y cada capa tendría que
-- tratarlas igual a mano: camposDeMiFicha() manda `ficha[columna] ?? null`, o
-- sea que una ficha sin habilidades volvería como null y el front tendría que
-- acordarse de coalescerla en cada lectura. Con NOT NULL DEFAULT, "vacío"
-- tiene una sola forma en todo el sistema. `add column ... not null default`
-- no reescribe la tabla desde PG11: el default vive en el catálogo.
--
-- CUIDADO CON EL `coalesce` DE LOS CHECK DE LISTA OPCIONAL
--
-- `array_ndims('{}'::text[])` devuelve NULL, no 1: un arreglo vacío tiene CERO
-- dimensiones. Sin el coalesce, el `when` de la guarda da NULL, cae al `else`
-- y el CHECK rechaza el DEFAULT de su propia columna — el primer insert
-- fallaría con un 23514 incomprensible. `herramientas` no lo necesita porque
-- su mínimo de 1 rechaza el vacío igual, por el camino que sea.
--
-- DESPUÉS DE ESTA, LA 0039 Y LA 0040 YA NO SE PUEDEN RE-APLICAR SOLAS: las dos
-- nombran `stack` y la 0039 nombra `stack_colaborador_valido()`, que dejan de
-- existir. Re-aplicar cualquiera de ellas obliga a re-aplicar la cola hasta
-- acá, en la misma corrida.
--
-- LA 0043 QUEDA FUERA DE ESTA CADENA: no toca ninguna columna ni función que
-- esta migración declare, así que reaplicar la 0041 (o la 0040, que ya trae
-- `security definer` desde su propio `create or replace function`) no la
-- obliga, y la 0043 sigue siendo segura de reaplicar en cualquier momento,
-- antes o después de esta.

begin;

do $preflight$
begin
  if to_regclass('public.fichas_colaborador') is null then
    raise exception using
      errcode = 'P0001',
      message = '0041 preflight failed: public.fichas_colaborador is required (0039)';
  end if;

  if to_regprocedure('public.listar_colaboradores()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0041 preflight failed: public.listar_colaboradores() is required (0038/0039/0040)';
  end if;

  -- Esta migración reescribe la RPC de la 0040 y no tiene sentido sin ella.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'modalidad_trabajo'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0041 preflight failed: falta modalidad_trabajo (0040)';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name in ('stack', 'herramientas')
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0041 preflight failed: fichas_colaborador no tiene ni stack ni herramientas';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0041 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- === 1. Las columnas ========================================================

-- Idempotente al molde de la 0032 y la 0040: se consulta information_schema
-- ANTES de tocar nada, así una segunda corrida no hace trabajo ni falla.
--
-- El CHECK se suelta ANTES del rename por dos razones: la expresión de un
-- constraint sigue a la columna renombrada, y además ese constraint es lo que
-- ata la función vieja por OID y bloquearía su `drop function` más abajo.
do $renombrar_stack$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'stack'
  ) then
    alter table public.fichas_colaborador
      drop constraint if exists fichas_colaborador_stack_valido;
    alter table public.fichas_colaborador rename column stack to herramientas;
  end if;
end
$renombrar_stack$;

alter table public.fichas_colaborador
  add column if not exists habilidades text[] not null default '{}'::text[],
  add column if not exists idiomas text[] not null default '{}'::text[],
  add column if not exists empresa text,
  add column if not exists empresa_enlace text;

-- === 2. La función por elemento =============================================

-- `stack_colaborador_valido` pasa a `etiquetas_colaborador_validas`: la misma
-- regla juzga ahora tres columnas, y un nombre que dice "stack" cuando ya no
-- hay stack miente.
--
-- Por qué drop+create y no `alter function ... rename to`: el rename es gratis
-- y el CHECK lo seguiría (la dependencia es por OID), pero deja el PARÁMETRO
-- llamándose `stack` para siempre — `create or replace` no puede cambiar
-- nombres de parámetros, y `drop function` está bloqueado mientras un CHECK
-- dependa de ella. El bloque de arriba ya soltó ese CHECK, así que la ventana
-- está abierta. EL DROP SE LLEVA LOS GRANTS: se repiten abajo.
-- Los CHECK dependen de la función por OID, así que hay que soltarlos ANTES
-- de borrarla. En la primera corrida sólo existe el de `stack` (que el bloque
-- de arriba ya soltó); en una segunda, existen los de esta misma migración, y
-- sin este paso el `drop function` de abajo falla con 2BP01.
alter table public.fichas_colaborador
  drop constraint if exists fichas_colaborador_stack_valido,
  drop constraint if exists fichas_colaborador_herramientas_validas,
  drop constraint if exists fichas_colaborador_habilidades_validas,
  drop constraint if exists fichas_colaborador_idiomas_validos,
  drop constraint if exists fichas_colaborador_empresa_valida,
  drop constraint if exists fichas_colaborador_empresa_enlace_valido,
  drop constraint if exists fichas_colaborador_empresa_enlace_con_nombre;

drop function if exists public.stack_colaborador_valido(text[]);
drop function if exists public.etiquetas_colaborador_validas(text[]);

create function public.etiquetas_colaborador_validas(etiquetas text[])
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    bool_and(
      elemento is not null
      and elemento = btrim(elemento)
      and char_length(elemento) between 1 and 40
      and elemento !~ '[[:cntrl:]]'
      and elemento !~ '[‎‏‪-‮⁦-⁩]'
    ),
    true
  )
  from unnest(etiquetas) as elemento
$function$;

-- Igual que la 0039: la corre quien guarda la ficha, y anon no guarda fichas.
-- Los privilegios por defecto de Supabase conceden EXECUTE a anon
-- directamente, no sólo vía public: hay que nombrarlo.
revoke all on function public.etiquetas_colaborador_validas(text[]) from public, anon;
grant execute on function public.etiquetas_colaborador_validas(text[]) to authenticated;

-- === 3. Los CHECK ===========================================================

-- Se soltaron más arriba, junto con la función de la que dependen. Van fuera
-- de los bloques `do` y con los rangos en una sola línea: los tests de Node
-- los leen con expresiones regulares.
alter table public.fichas_colaborador
  -- El de la 0039 con la columna renombrada. `array_position` falla (con
  -- 0A000, no con 23514) ante un arreglo de más de una dimensión, y el orden
  -- de evaluación de un `and` no está garantizado: el `case` asegura que la
  -- dimensión se revise primero.
  add constraint fichas_colaborador_herramientas_validas check (
    case
      when array_ndims(herramientas) = 1 then
        cardinality(herramientas) between 1 and 12
        and array_position(herramientas, null::text) is null
        and public.etiquetas_colaborador_validas(herramientas)
      else false
    end
  ),
  -- OJO CON EL `coalesce`, y no lo quites: array_ndims de un arreglo vacío es
  -- NULL, no 1. Sin él, este CHECK rechaza el DEFAULT de su propia columna.
  add constraint fichas_colaborador_habilidades_validas check (
    case
      when coalesce(array_ndims(habilidades), 1) = 1 then
        cardinality(habilidades) between 0 and 12
        and array_position(habilidades, null::text) is null
        and public.etiquetas_colaborador_validas(habilidades)
      else false
    end
  ),
  -- Mismo caso que habilidades: el coalesce es lo que deja pasar el vacío.
  add constraint fichas_colaborador_idiomas_validos check (
    case
      when coalesce(array_ndims(idiomas), 1) = 1 then
        cardinality(idiomas) between 0 and 12
        and array_position(idiomas, null::text) is null
        and public.etiquetas_colaborador_validas(idiomas)
      else false
    end
  ),
  -- Molde de puesto y sector. Nulo pasa (un CHECK con null da `unknown`, no
  -- `false`); la cadena vacía no pasa, porque char_length 0 no entra en el
  -- rango. O sea: la ausencia se escribe null, nunca ''.
  add constraint fichas_colaborador_empresa_valida check (
    empresa = btrim(empresa)
    and char_length(empresa) between 2 and 80
    and empresa !~ '[[:cntrl:]]'
    and empresa !~ '[‎‏‪-‮⁦-⁩]'
  ),
  -- A diferencia de linkedin y github, acá NO se fija el host: la empresa vive
  -- donde vive. Lo que se fija es el esquema —https y nada más, porque este
  -- texto termina en un href y un `javascript:` ahí sería una puerta abierta—
  -- y que la autoridad tenga un punto, para que "https://intranet" no se
  -- guarde como enlace público.
  add constraint fichas_colaborador_empresa_enlace_valido check (
    empresa_enlace ~ '^https://[^[:space:]/?#]+\.[^[:space:]/?#]+([/?#][^[:space:]]*)?$'
    and char_length(empresa_enlace) <= 200
  ),
  -- Cruzado, al molde de `perfiles_colaborador_con_slug` (0038). La asimetría
  -- es deliberada: un nombre sin enlace es un estado útil —se muestra como
  -- texto—, pero un enlace sin nombre es un dato que la página no puede pintar
  -- (sin nombre la fila no aparece) y quedaría guardado e invisible para
  -- siempre. Esta expresión nunca da NULL: siempre true o false.
  add constraint fichas_colaborador_empresa_enlace_con_nombre check (
    empresa_enlace is null or empresa is not null
  );

comment on column public.fichas_colaborador.herramientas is
  'Lenguajes, frameworks y productos con los que trabaja (Python, Docker, '
  'Figma). De 1 a 12. Antes se llamaba stack.';
comment on column public.fichas_colaborador.habilidades is
  'Capacidades y disciplinas (REST API, TDD, arquitectura). De 0 a 12: '
  'opcional, y el vacío se escribe ''{}'', nunca null.';
comment on column public.fichas_colaborador.idiomas is
  'Idiomas que habla, sin nivel. De 0 a 12: opcional, y el vacío se escribe '
  '''{}'', nunca null.';
comment on column public.fichas_colaborador.empresa is
  'Nombre de la empresa donde trabaja. Opcional.';
comment on column public.fichas_colaborador.empresa_enlace is
  'Enlace https de la empresa; con él, el nombre es clicable en el perfil '
  'público. Opcional, y no puede existir sin empresa.';

-- === 4. Privilegios por columna =============================================

-- El rename conserva el ACL (vive por attnum), así que el grant de `stack` ya
-- es el de `herramientas`. Lo que esto sí agrega son las cuatro columnas
-- nuevas, que nacen sin ningún grant; se reemite la sentencia entera para que
-- el repo diga la verdad y para que una base reconstruida quede igual.
grant insert (id, puesto, sector, ubicacion, herramientas, habilidades, idiomas,
              empresa, empresa_enlace, modalidad_trabajo, anio_inicio, bio,
              linkedin, github, correo)
  on table public.fichas_colaborador to authenticated;
grant update (puesto, sector, ubicacion, herramientas, habilidades, idiomas,
              empresa, empresa_enlace, modalidad_trabajo, anio_inicio, bio,
              linkedin, github, correo)
  on table public.fichas_colaborador to authenticated;

-- Las policies NO se tocan: las tres filtran sólo por fila y ninguna nombra
-- una columna.

-- === 5. La RPC pública ======================================================

-- Cambia el RETURNS TABLE y `create or replace` no puede: drop + create, como
-- la 0039 y la 0040. EL DROP SE LLEVA LOS GRANTS: se repiten abajo.
drop function if exists public.listar_colaboradores();

create function public.listar_colaboradores()
returns table (
  nombre text,
  apellidos text,
  slug text,
  puesto text,
  sector text,
  ubicacion text,
  herramientas text[],
  habilidades text[],
  idiomas text[],
  empresa text,
  empresa_enlace text,
  modalidad_trabajo text,
  anio_inicio integer,
  bio text,
  linkedin text,
  github text,
  correo text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.nombre, p.apellidos, p.slug,
    f.puesto, f.sector, f.ubicacion,
    f.herramientas, f.habilidades, f.idiomas,
    f.empresa, f.empresa_enlace,
    f.modalidad_trabajo, f.anio_inicio, f.bio, f.linkedin, f.github, f.correo
  from public.perfiles p
  left join public.fichas_colaborador f on f.id = p.id
  where p.es_colaborador
  order by p.slug
$function$;

revoke all on function public.listar_colaboradores() from public;
grant execute on function public.listar_colaboradores() to anon, authenticated;

commit;
