-- Cuánto tiempo ACTIVO pasa alguien en el extractor, para saber si la
-- herramienta se resuelve rápido o hace perder el rato.
--
-- LO QUE ESTA MIGRACIÓN NO AGREGA, Y ES EL PUNTO
--
-- No hay `user_id`, no hay `sesion_anon`, no hay IP y no la va a haber. Una
-- visita se CUENTA, no se atribuye. En su lugar va `con_sesion`, un booleano:
-- alcanza para partir el histograma en las dos series que el panel ya habla y
-- no alcanza para señalar a nadie.
--
-- El 2026-08-28 se retiró del panel la sección "Quién lo usa y cuánto" porque
-- cruzaba identidad con horario, y eso es un perfil de uso. Guardar la
-- permanencia POR PERSONA sería lo mismo con otro eje. Si algún día alguien
-- necesita ese cruce, la respuesta correcta es preguntar por qué, no agregar
-- la columna.
--
-- POR QUÉ `dia` Y NO UN TIMESTAMP
--
-- Mismo criterio que `extractor_metrica_banco` (0030): con la hora exacta,
-- cruzar esta tabla contra `extractor_uso` volvería a identificar a la persona
-- que estuvo esos minutos. El grano se detiene en el día, que es todo lo que
-- un histograma necesita.
--
-- POR QUÉ EL RANGO ES UN `check` Y NO UNA SUGERENCIA
--
-- El endpoint que escribe acá NO lleva autenticación: una visita anónima
-- también cuenta, y pedir sesión dejaría fuera justo la mitad que interesa
-- medir. El navegador ya descarta lo implausible, pero esa criba se salta con
-- la consola abierta. Ésta no. Tres capas: el módulo del front, la validación
-- del servidor y este `check` — la última es la única que no se puede evitar.
--
-- QUÉ SIGNIFICA `extrajo`
--
-- Si la visita llegó a producir una tabla. De ahí sale la tasa de completitud
-- del panel: de las visitas que empezaron, cuántas terminaron en algo. Se
-- resuelve sin tocar F41 (los intentos fallidos no dejan fila en
-- `extractor_uso`, y `exito` hoy siempre vale true).
--
-- LO QUE ESTA MEDICIÓN SUBCUENTA, DICHO ACÁ TAMBIÉN
--
-- El tiempo se entrega UNA vez por visita, al salir. Quien se va a otra
-- pestaña y vuelve a trabajar no suma ese segundo tramo, y cerrar la tapa o
-- matar el navegador no avisa a nadie. Los números de esta tabla son un PISO,
-- no una medida exacta, y el panel lo declara en pantalla.
--
-- LEGAL (LFPDPPP)
--
-- Sin identidad no hay dato personal que asociar, pero la recolección se
-- declara igual en el aviso: lo que obliga a declarar es medir, no identificar.
--
-- Aplicar dos veces es seguro: todo lleva `if not exists`.

begin;

do $preflight$
begin
  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0034 preflight failed: public.es_admin() is required (0004)';
  end if;
end
$preflight$;

create table if not exists public.extractor_visita (
  id         bigserial primary key,
  dia        date not null default current_date,
  con_sesion boolean not null,
  segundos   integer not null,
  extrajo    boolean not null default false,
  constraint extractor_visita_segundos_plausibles
    check (segundos >= 3 and segundos <= 14400)
);

comment on table public.extractor_visita is
  'Permanencia por visita, SIN identidad. No lleva user_id, sesion_anon ni IP, '
  'y la fecha es por día: con la hora exacta se podría cruzar contra '
  'extractor_uso y volver a identificar a la persona.';
comment on column public.extractor_visita.con_sesion is
  'Si quien visitó tenía sesión iniciada. Un booleano, no un nombre: parte el '
  'histograma en dos series sin decir de quién es cada fila.';
comment on column public.extractor_visita.segundos is
  'Tiempo ACTIVO: se pausa cuando la pestaña deja de estar a la vista. Una '
  'pestaña abierta toda la noche no son ocho horas de uso.';
comment on column public.extractor_visita.extrajo is
  'Si la visita llegó a producir una tabla. Separa "entró y se fue" de "entró '
  'y resolvió", que es la tasa de completitud del panel.';

create index if not exists extractor_visita_dia
  on public.extractor_visita (dia);

-- RLS. La escribe el servidor con service_role, que salta la RLS; acá sólo se
-- decide quién puede LEER. Es información de negocio, no del usuario: nadie
-- tiene una fila propia que reclamar, porque las filas no tienen dueño.
alter table public.extractor_visita enable row level security;

drop policy if exists extractor_visita_select_admin on public.extractor_visita;
create policy extractor_visita_select_admin
  on public.extractor_visita for select
  to authenticated
  using ((select public.es_admin()));

commit;
