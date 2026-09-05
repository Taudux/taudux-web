-- Uso del extractor: lo que se cuenta para la cuota, y lo que se mide del
-- funcionamiento. Son DOS tablas y no una, y esa separación es el punto.
--
-- LA PROPIEDAD QUE PROTEGE ESTA MIGRACIÓN
--
-- `extractor_uso` sabe QUIÉN analizó y cuándo, pero NO de qué banco.
-- `extractor_metrica_banco` sabe DE QUÉ BANCO y cómo salió, pero NO quién.
--
-- Juntas responden "cuántos análisis van este mes" y "qué tan bien lee BBVA",
-- que es todo lo que hace falta. Lo que NO se puede responder, a propósito, es
-- "en qué banco tiene cuenta esta persona" — un dato que nadie nos dio para
-- eso. Una sola tabla con las dos cosas lo respondería con un select trivial.
--
-- Por eso no hay forma de cruzarlas: `extractor_metrica_banco` no guarda
-- user_id, ni sesión, ni IP, ni marca de tiempo más fina que el día. Si alguna
-- vez alguien necesita cruzarlas, la respuesta correcta es preguntar por qué,
-- no agregar la columna.
--
-- LAS DOS SIN CUENTA. `sesion_anon` es un identificador opaco que genera el
-- servidor para contar los 2 análisis de quien no inició sesión. No es un
-- perfil ni sobrevive a un borrado de datos del navegador; es deliberadamente
-- débil, porque su trabajo es frenar el uso casual, no perseguir a nadie.
--
-- Aplicar dos veces es seguro: todo lleva `if not exists`.

begin;

do $preflight$
begin
  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0030 preflight failed: public.es_admin() is required (0004)';
  end if;

  if to_regclass('public.extractor_planes') is null then
    raise exception using
      errcode = 'P0001',
      message = '0030 preflight failed: 0029 must be applied first';
  end if;
end
$preflight$;

-- Quién y cuándo. Sin banco, sin nombre de archivo, sin nada del contenido.
create table if not exists public.extractor_uso (
  id          bigserial primary key,
  user_id     uuid references auth.users on delete cascade,
  sesion_anon text,
  creado_en   timestamptz not null default now(),
  exito       boolean not null default true,
  cuadra      boolean,
  constraint extractor_uso_tiene_sujeto
    check (user_id is not null or sesion_anon is not null)
);

comment on table public.extractor_uso is
  'Conteo para la cuota. NO lleva banco: eso vive en extractor_metrica_banco, '
  'separado a propósito para que nadie pueda cruzar quién con de qué banco.';
comment on column public.extractor_uso.cuadra is
  'Si los totales cotejaron contra los que imprime el banco. null = el PDF no '
  'traía totales de control, que no es lo mismo que fallar.';

create index if not exists extractor_uso_user_fecha
  on public.extractor_uso (user_id, creado_en);
create index if not exists extractor_uso_anon_fecha
  on public.extractor_uso (sesion_anon, creado_en);

-- De qué banco y cómo salió. Sin identidad de ninguna clase. `dia` y no
-- timestamp: la hora exacta, cruzada con extractor_uso, volvería a identificar
-- a la persona — que es justo lo que estas dos tablas separadas evitan.
create table if not exists public.extractor_metrica_banco (
  id        bigserial primary key,
  dia       date not null default current_date,
  banco     text not null,
  resultado text not null,
  cuadra    boolean
);

comment on table public.extractor_metrica_banco is
  'Telemetría agregada por banco. NO lleva user_id, sesión ni IP, y la fecha es '
  'por día y no por instante: con la hora exacta se podría volver a cruzar '
  'contra extractor_uso e identificar a quien subió el documento.';

create index if not exists extractor_metrica_banco_dia
  on public.extractor_metrica_banco (dia, banco);

-- RLS. Las dos las escribe el servidor con service_role, que salta la RLS; acá
-- sólo se decide quién puede LEER.
alter table public.extractor_uso enable row level security;
alter table public.extractor_metrica_banco enable row level security;

-- Cada quien ve su propio uso: es su dato y le sirve para saber cuánto le
-- queda. Las filas anónimas no las ve nadie desde el cliente — no tienen dueño
-- a quien mostrárselas.
drop policy if exists extractor_uso_select_propio on public.extractor_uso;
create policy extractor_uso_select_propio
  on public.extractor_uso for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists extractor_uso_select_admin on public.extractor_uso;
create policy extractor_uso_select_admin
  on public.extractor_uso for select
  to authenticated
  using ((select public.es_admin()));

-- La métrica por banco es agregada y no identifica a nadie, pero igual se
-- restringe a administración: publicar el volumen por banco es información de
-- negocio, no del usuario.
drop policy if exists extractor_metrica_banco_select_admin on public.extractor_metrica_banco;
create policy extractor_metrica_banco_select_admin
  on public.extractor_metrica_banco for select
  to authenticated
  using ((select public.es_admin()));

commit;
