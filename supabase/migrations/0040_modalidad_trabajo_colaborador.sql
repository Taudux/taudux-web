-- Modalidad de trabajo: reemplaza a `disponibilidad` en fichas_colaborador, y
-- de paso baja el tope del bio de 600 a 240.
--
-- POR QUÉ SE REEMPLAZA Y NO CONVIVEN
--
-- "Disponible / Parcial / No disponible" es un semáforo: dice si conviene o no
-- escribirle a esa persona, y envejece solo, porque nadie vuelve a "Mi ficha"
-- a apagarlo. Una ficha que dice "Disponible" desde hace ocho meses miente.
-- "Presencial / Híbrido / Remoto" dice un hecho estable de cómo trabaja esa
-- persona y sigue siendo cierto sin que nadie lo toque. No son el mismo dato
-- con otros nombres, así que no hay migración de valores posible: ver EL
-- BACKFILL, abajo.
--
-- POR QUÉ `modalidad_trabajo` Y NO `modalidad`
--
-- `cursos.modalidad` (0006) ya existe y guarda 'presencial' | 'en_linea', otra
-- lista y otra tabla. Dos columnas `modalidad` con listas distintas en la
-- misma base se confunden al leer cualquier consulta.
--
-- POR QUÉ TEXTO VISIBLE CON ACENTO Y NO UN CÓDIGO
--
-- Las columnas vecinas (rol, especialidad, ubicacion, bio, cada elemento de
-- stack) guardan el texto que la página escribe tal cual, y el front de
-- colaboradores no tiene ningún mapa código→etiqueta: meter uno obligaría a
-- inventarlo por duplicado (el roster y "Mi ficha" llevan copias deliberadas
-- de la lista) sólo para tres textos. `cursos.modalidad` usa códigos porque
-- así nació; la coherencia que manda acá es la de esta tabla.
--
-- CUIDADO CON EL ACENTO: 'Híbrido' se guarda en NFC (í = U+00ED, un punto de
-- código). Postgres compara BYTES, así que el mismo texto en NFD (i + U+0301)
-- NO pasa el CHECK de abajo, aunque en pantalla se vea idéntico. Este archivo,
-- el HTML de "Mi ficha" y los tests tienen que estar en UTF-8 NFC; el
-- preflight exige client_encoding UTF8 igual que la 0039, y
-- supabase/tests/0040_*.test.sql prueba el caso NFD explícitamente.
--
-- EL BACKFILL (DECISIÓN VISIBLE, NO AUTOMÁTICA)
--
-- No hay traducción de 'Parcial' a ninguna modalidad. La migración aplica UN
-- valor, declarado abajo en `v_modalidad_inicial`, a toda fila que traiga un
-- valor viejo, e imprime por `raise notice` qué filas tocó y qué decían antes:
-- ése es el único rastro del valor original, que después del backfill no
-- existe en ningún lado. Cambiá esa línea antes de aplicar si ya sabés cuál
-- corresponde y, en cualquier caso, quien tenga ficha tiene que entrar a "Mi
-- ficha" y confirmarlo: la base no puede saberlo por ella.
--
-- QUÉ LE QUITA A LA 0039
--
-- La columna `disponibilidad` y su CHECK, el CHECK del bio (que pasa de 600 a
-- 240 caracteres) y la forma de `listar_colaboradores()`. Todo lo demás de la
-- 0039 sigue siendo la fuente: los otros largos, las expresiones de los
-- enlaces, las policies y los triggers. Los tests de Node que comparan el
-- front contra el SQL leen este archivo para la lista de modalidades y para el
-- largo del bio, y siguen leyendo la 0039 para el resto.
--
-- DESPUÉS DE ESTA, LA 0039 YA NO SE PUEDE RE-APLICAR SOLA: su CHECK, sus
-- grants por columna y su `listar_colaboradores()` nombran `disponibilidad`,
-- que acá deja de existir. Re-aplicar la 0039 obliga a re-aplicar la 0040
-- detrás, en la misma corrida. Es el mismo costo que la 0039 le cobró a la
-- 0038.

begin;

do $preflight$
begin
  if to_regclass('public.fichas_colaborador') is null then
    raise exception using
      errcode = 'P0001',
      message = '0040 preflight failed: public.fichas_colaborador is required (0039)';
  end if;

  if to_regprocedure('public.listar_colaboradores()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0040 preflight failed: public.listar_colaboradores() is required (0038/0039)';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name in ('disponibilidad', 'modalidad_trabajo')
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0040 preflight failed: fichas_colaborador no tiene ni disponibilidad ni modalidad_trabajo';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0040 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- === 1. La columna ==========================================================

-- Idempotente al molde de la 0032 (`lote`, de boolean a entero): se consulta
-- information_schema ANTES de tocar nada, así una segunda corrida no hace
-- trabajo ni falla.
--
-- `rename` y no `add`+backfill+`drop`: con la columna NOT NULL y sin DEFAULT
-- (la 0039 se lo negó a propósito), un `add column ... not null` falla de
-- entrada sobre una tabla con filas, y la vuelta larga (add nullable →
-- backfill → set not null → drop la vieja) son cuatro pasos donde el rename es
-- uno, deja un atributo muerto para siempre y obliga a reconstruir los grants
-- por columna. El rename es sólo catálogo: conserva NOT NULL, la PK, el
-- trigger set_actualizado_en y el ACL por columna. Lo único que `add`+`drop`
-- sabría hacer de más —un mapeo distinto por cada valor viejo— acá no hace
-- falta, porque no hay mapeo.
--
-- El CHECK viejo se suelta ANTES del rename, y no es opcional: la expresión de
-- un constraint SIGUE a la columna renombrada, así que sin soltarlo primero
-- quedaría `modalidad_trabajo in ('Disponible', …)` y el UPDATE de abajo
-- chocaría contra él con 23514.
do $renombrar_disponibilidad$
declare
  -- DECISIÓN: el valor con el que arrancan las fichas que ya existían.
  -- Cambiá esta línea antes de aplicar si sabés cuál corresponde.
  v_modalidad_inicial constant text := 'Híbrido';
  v_anteriores text;
  v_filas integer;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'disponibilidad'
  ) then
    select string_agg(format('%s=%L', id, disponibilidad), ', ' order by id)
      into v_anteriores
      from public.fichas_colaborador;

    alter table public.fichas_colaborador
      drop constraint if exists fichas_colaborador_disponibilidad_valida;

    alter table public.fichas_colaborador
      rename column disponibilidad to modalidad_trabajo;

    update public.fichas_colaborador
       set modalidad_trabajo = v_modalidad_inicial
     where modalidad_trabajo not in ('Presencial', 'Híbrido', 'Remoto');
    get diagnostics v_filas = row_count;

    raise notice '0040: % ficha(s) pasaron a %. Valores anteriores: %. '
                 'Quien tenga ficha DEBE confirmarlo desde "Mi ficha".',
                 v_filas, v_modalidad_inicial, coalesce(v_anteriores, '(ninguna)');
  end if;
end
$renombrar_disponibilidad$;

-- `rol` pasa a `puesto` y `especialidad` a `sector`: los nombres con los que
-- la ficha se lee en pantalla. Sin backfill —lo guardado sigue valiendo tal
-- cual— y con la misma mecánica: soltar el CHECK, renombrar, y más abajo
-- agregarlo otra vez con el nombre nuevo.
--
-- OJO con `sector`: la columna se llama distinto Y pide otra cosa. Antes era
-- la especialidad técnica ("Bases de datos"); ahora es la industria
-- ("Fintech", "Salud"). Lo guardado NO se traduce solo, así que las fichas
-- que ya existían van a mostrar una especialidad bajo una etiqueta que dice
-- sector hasta que su dueño la reescriba.
do $renombrar_rol_y_especialidad$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'rol'
  ) then
    alter table public.fichas_colaborador
      drop constraint if exists fichas_colaborador_rol_valido;
    alter table public.fichas_colaborador rename column rol to puesto;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'especialidad'
  ) then
    alter table public.fichas_colaborador
      drop constraint if exists fichas_colaborador_especialidad_valida;
    alter table public.fichas_colaborador rename column especialidad to sector;
  end if;
end
$renombrar_rol_y_especialidad$;

-- === 2. Los CHECK ===========================================================

-- Los dos de abajo van FUERA del bloque `do` y con la lista y el rango en una
-- sola línea, a propósito: los tests de Node leen este archivo con una
-- expresión regular para comparar los valores y los largos contra los del
-- front. SQL dinámico, o partido en varias líneas, los rompería en silencio.
--
-- Se sueltan y se vuelven a crear en cada corrida, como los de la 0039: así
-- una versión nueva de este archivo los actualiza y se re-validan contra las
-- filas vivas.
alter table public.fichas_colaborador
  drop constraint if exists fichas_colaborador_disponibilidad_valida,
  drop constraint if exists fichas_colaborador_modalidad_trabajo_valida,
  drop constraint if exists fichas_colaborador_rol_valido,
  drop constraint if exists fichas_colaborador_puesto_valido,
  drop constraint if exists fichas_colaborador_especialidad_valida,
  drop constraint if exists fichas_colaborador_sector_valido,
  drop constraint if exists fichas_colaborador_bio_valida;

alter table public.fichas_colaborador
  -- Los dos de abajo salen byte a byte de la 0039, con la columna
  -- renombrada: llevan los mismos bidi crudos dentro de una clase.
  add constraint fichas_colaborador_puesto_valido check (
    puesto = btrim(puesto)
    and char_length(puesto) between 2 and 60
    and puesto !~ '[[:cntrl:]]'
    and puesto !~ '[‎‏‪-‮⁦-⁩]'
  ),
  add constraint fichas_colaborador_sector_valido check (
    sector = btrim(sector)
    and char_length(sector) between 2 and 80
    and sector !~ '[[:cntrl:]]'
    and sector !~ '[‎‏‪-‮⁦-⁩]'
  ),
  add constraint fichas_colaborador_modalidad_trabajo_valida check (
    modalidad_trabajo in ('Presencial', 'Híbrido', 'Remoto')
  ),
  -- Copiado tal cual de la 0039 salvo el tope: sus expresiones llevan
  -- caracteres bidireccionales crudos dentro de una clase, y reescribirlas a
  -- mano es como se rompen sin que se note. 600 daban para un currículum
  -- entero y la ficha es una presentación; el salto de línea sigue siendo
  -- el único carácter de control admitido.
  add constraint fichas_colaborador_bio_valida check (
    bio = btrim(bio, E' \n')
    and char_length(bio) between 10 and 240
    and replace(bio, E'\n', '') !~ '[[:cntrl:]]'
    and bio !~ '[‎‏‪-‮⁦-⁩]'
  );

comment on column public.fichas_colaborador.modalidad_trabajo is
  'Modalidad de trabajo: Presencial, Híbrido o Remoto. Texto visible, tal cual '
  'sale en la página; "Híbrido" va en NFC.';

comment on column public.fichas_colaborador.puesto is
  'El puesto de la persona, de 2 a 60 caracteres. Antes se llamaba rol.';

comment on column public.fichas_colaborador.sector is
  'La industria en la que trabaja, de 2 a 80 caracteres. Antes se llamaba '
  'especialidad y pedía la especialidad técnica: lo guardado no se tradujo.';

comment on column public.fichas_colaborador.bio is
  'Presentación de 10 a 240 caracteres. Admite saltos de línea.';

-- === 5. El slug sigue al nombre =============================================

-- La 0038 congelaba el slug a propósito: "cambiar el nombre no lo regenera,
-- porque romper un enlace ya compartido es peor que un slug desactualizado".
-- ESA DECISIÓN SE INVIERTE ACÁ, a pedido, con la consecuencia asumida: un
-- enlace a un perfil deja de valer en cuanto esa persona edite su nombre.
--
-- La cabecera y el test de la 0038 NO se tocan: siguen describiendo a la
-- 0038, que por sí sola hace lo que dice.
--
-- Cambian dos cosas del cuerpo, y nada más:
--   1. La guarda de entrada, que antes cortaba ante cualquier slug ya puesto.
--   2. Los tres caminos de fallo. Al DAR DE ALTA siguen fallando ruidosamente
--      y pidiendo un slug a mano, que es lo correcto en un alta administrada.
--      Al RENOMBRARSE no: nadie debería quedarse sin poder editar su propio
--      nombre porque la dirección derivada ya es de otra cuenta. Ese camino
--      conserva el slug viejo y sigue.
--
-- Lo que NO cambia: slug_colaborador(), la unicidad, el formato, el CHECK
-- cruzado con es_colaborador, y el desempate por primer apellido.
--
-- POR QUÉ SECURITY DEFINER DESDE ACÁ (y no INVOKER, el default que Postgres
-- le asigna a todo atributo que un `create or replace function` no nombra)
--
-- El trigger ahora también despierta al editar `nombre`/`apellidos`, columnas
-- que sí escribe `authenticated`. Su cuerpo llama a `public.slug_colaborador()`,
-- cuyo EXECUTE la 0038 le revocó a `authenticated`: sin definer, ese llamado
-- aborta el UPDATE entero con 42501 y se pierde la fila completa, no sólo el
-- nombre. Es seguro declararlo acá porque la función ya trae
-- `set search_path = ''` —la condición que hace segura a una definer, porque
-- fija el esquema de cada objeto que toca y no deja que un `search_path`
-- hostil sustituya `slug_colaborador` por otro—, sólo lee `public.perfiles` y
-- no le devuelve nada a quien la invoca. Nombrarlo acá, y no sólo con un
-- `alter function` aparte, importa: sin esta línea, CUALQUIER reaplicación de
-- este archivo vuelve la función a SECURITY INVOKER en silencio y reabre el
-- mismo 42501. Ver la 0043 para el historial completo del defecto y su vía de
-- actualización para bases que ya corrieron esta migración sin el atributo.

create or replace function public.asignar_slug_colaborador()
returns trigger
language plpgsql
set search_path = ''
security definer
as $function$
declare
  v_base text;
  v_apellido text;
  v_candidato text;
  v_pista text;
begin
  -- Se calcula al marcar sin slug, y AHORA TAMBIÉN cuando cambia el nombre o
  -- los apellidos de quien ya colabora: la dirección del perfil sigue al
  -- nombre en vez de congelarse.
  if not new.es_colaborador then
    return new;
  end if;
  if new.slug is not null and not (
    tg_op = 'UPDATE'
    and (new.nombre is distinct from old.nombre
         or new.apellidos is distinct from old.apellidos)
  ) then
    return new;
  end if;

  v_pista := format(
    'Asígnale un slug a mano en el mismo update: '
    'update public.perfiles set es_colaborador = true, slug = ''nombre-apellido'' '
    'where id = %L returning slug;',
    new.id
  );

  v_base := public.slug_colaborador(new.nombre);
  if v_base is null then
    -- Renombrarse no puede fallar por una dirección ocupada: se conserva la
    -- que ya se tenía. El fallo ruidoso se reserva para el alta, que es
    -- administrada y donde alguien puede resolverlo a mano.
    if new.slug is not null then
      return new;
    end if;
    raise exception using
      errcode = 'P0001',
      message = format(
        'La cuenta %s no tiene nombre del que sacar su slug de colaborador.',
        new.id),
      hint = v_pista;
  end if;

  if not exists (
    select 1 from public.perfiles p
    where p.slug = v_base and p.id <> new.id
  ) then
    new.slug := v_base;
    return new;
  end if;

  -- Primer apellido con sus partículas: "de la Cruz" es UN apellido. Los
  -- grupos son no capturantes a propósito: con un grupo capturante,
  -- `substring(... from ...)` devolvería sólo ese grupo y no el match entero.
  v_apellido := substring(
    public.slug_colaborador(new.apellidos)
    from '^(?:(?:de|del|la|las|los|y)-)*[a-z0-9]+'
  );
  if v_apellido is null then
    -- Renombrarse no puede fallar por una dirección ocupada: se conserva la
    -- que ya se tenía. El fallo ruidoso se reserva para el alta, que es
    -- administrada y donde alguien puede resolverlo a mano.
    if new.slug is not null then
      return new;
    end if;
    raise exception using
      errcode = 'P0001',
      message = format(
        'El slug "%s" ya es de otra cuenta y la cuenta %s no tiene apellidos '
        'con los que desempatar.',
        v_base, new.id),
      hint = v_pista;
  end if;

  v_candidato := v_base || '-' || v_apellido;
  if exists (
    select 1 from public.perfiles p
    where p.slug = v_candidato and p.id <> new.id
  ) then
    -- Renombrarse no puede fallar por una dirección ocupada: se conserva la
    -- que ya se tenía. El fallo ruidoso se reserva para el alta, que es
    -- administrada y donde alguien puede resolverlo a mano.
    if new.slug is not null then
      return new;
    end if;
    raise exception using
      errcode = 'P0001',
      message = format(
        'Los slugs "%s" y "%s" ya son de otras cuentas; no se agregan sufijos '
        'numéricos.',
        v_base, v_candidato),
      hint = v_pista;
  end if;

  new.slug := v_candidato;
  return new;
end
$function$;

-- El trigger se recrea porque cambia su lista de columnas: ahora también
-- despierta cuando se edita el nombre o los apellidos.
drop trigger if exists perfiles_asignar_slug_colaborador on public.perfiles;
create trigger perfiles_asignar_slug_colaborador
  before insert or update of es_colaborador, nombre, apellidos on public.perfiles
  for each row execute function public.asignar_slug_colaborador();

-- === 3. Privilegios por columna =============================================

-- El rename conserva el ACL (vive por attnum), así que esto no corrige nada:
-- reemite la forma final para que la sentencia del repo diga la verdad y para
-- que una base reconstruida desde cero quede igual. `disponibilidad` ya no
-- existe: no queda ningún grant colgado que revocar.
grant insert (id, puesto, sector, ubicacion, stack, modalidad_trabajo,
              anio_inicio, bio, linkedin, github, correo)
  on table public.fichas_colaborador to authenticated;
grant update (puesto, sector, ubicacion, stack, modalidad_trabajo,
              anio_inicio, bio, linkedin, github, correo)
  on table public.fichas_colaborador to authenticated;

-- Las policies NO se tocan: las tres filtran sólo por fila
-- (`id = auth.uid() and es_colaborador()`) y ninguna nombra una columna.

-- === 4. La RPC pública ======================================================

-- Cambia una columna del RETURNS TABLE, y `create or replace` no puede
-- ("cannot change return type of existing function"): drop + create, como la
-- 0039 con esta misma función y la 0022 con claim_curso_anuncio(). EL DROP SE
-- LLEVA LOS GRANTS: se repiten abajo, sin excepción.
drop function if exists public.listar_colaboradores();

create function public.listar_colaboradores()
returns table (
  nombre text,
  apellidos text,
  slug text,
  puesto text,
  sector text,
  ubicacion text,
  stack text[],
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
    f.puesto, f.sector, f.ubicacion, f.stack, f.modalidad_trabajo,
    f.anio_inicio, f.bio, f.linkedin, f.github, f.correo
  from public.perfiles p
  left join public.fichas_colaborador f on f.id = p.id
  where p.es_colaborador
  order by p.slug
$function$;

revoke all on function public.listar_colaboradores() from public;
grant execute on function public.listar_colaboradores() to anon, authenticated;

commit;
