-- Planes del extractor de estados de cuenta: catálogo y asignación por persona.
--
-- El extractor (Cloud Run) necesita saber cuántos documentos puede procesar cada
-- quien. Hasta ahora no lo limitaba en absoluto, y el contador vivía en la
-- memoria del proceso: con hasta 3 instancias eran tres contadores que no se
-- hablaban, y un reinicio los borraba.
--
-- EL INTERRUPTOR. Green, Silver y Gold entran con activo = false. El servidor
-- rechaza asignar un plan inactivo, así que activarlos el día de mañana es un
-- update de una columna: no se toca código ni se despliega nada. Por eso el
-- catálogo es una TABLA y no un diccionario en Python.
--
-- QUÉ NO LLEVA. Ni precios cobrados, ni datos de pago, ni nada de la pasarela:
-- `precio` es texto para mostrar ("$99/mes"), no una cifra con la que se cobre.
--
-- ADMINISTRADORES. No se crea tabla propia: el rol ya vive en
-- public.perfiles.rol = 'admin' y se consulta con public.es_admin() (0004).
-- Dos fuentes de verdad para "quién es admin" es como se pierden los permisos.
--
-- Aplicar dos veces es seguro: todo lleva `if not exists` y el catálogo se
-- inserta con `on conflict do nothing`.

begin;

do $preflight$
begin
  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0029 preflight failed: public.perfiles is required';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0029 preflight failed: public.es_admin() is required (0004)';
  end if;
end
$preflight$;

-- Catálogo. `limite` null = ilimitado; `mensual` false = una sola vez, nunca se
-- renueva (es el caso de quien no tiene cuenta).
create table if not exists public.extractor_planes (
  clave            text primary key,
  nombre           text not null,
  limite           int,
  mensual          boolean not null default true,
  lote             boolean not null default false,
  descargas        boolean not null default true,
  paneles          text[]  not null default '{}',
  activo           boolean not null default false,
  precio           text,
  caracteristicas  text[],
  aviso            text,
  orden            int not null default 0
);

comment on column public.extractor_planes.activo is
  'El interruptor: un plan inactivo no se puede asignar. Activar un nivel de '
  'pago es un update acá, sin desplegar.';
comment on column public.extractor_planes.paneles is
  'Secciones que se desbloquean. Los movimientos destacados NO van en la lista: '
  'se ven siempre, en todos los planes, porque son la prueba de que la '
  'extracción funcionó.';

-- Los dos niveles que sí se lanzan, y los tres que esperan apagados.
insert into public.extractor_planes
  (clave, nombre, limite, mensual, lote, descargas, paneles, activo, precio, aviso, orden)
values
  ('anonimo', 'Sin cuenta', 2, false, false, true,
   array['panelTabla'], true, null,
   'Tenés 2 análisis sin cuenta. Creá una para tener 3 cada mes.', 0),

  ('free', 'Gratis con cuenta', 3, true, false, false,
   array[]::text[], true, null,
   'Tu plan muestra los movimientos destacados. Los paneles completos llegan con los niveles de pago.', 1),

  ('green', 'Green', 12, true, true, true,
   array['panelTabla', 'resumen', 'panelGraficas', 'panelMsi', 'panelConceptos'],
   false, null, null, 2),

  ('silver', 'Silver', 30, true, true, true,
   array['panelTabla', 'resumen', 'panelGraficas', 'panelMsi', 'panelConceptos'],
   false, null, null, 3),

  ('gold', 'Gold', null, true, true, true,
   array['panelTabla', 'resumen', 'panelGraficas', 'panelMsi', 'panelConceptos'],
   false, null, null, 4)
on conflict (clave) do nothing;

-- Plan de cada persona, más el interruptor de pruebas. `ilimitado` está aparte
-- del plan a propósito: conceder acceso de prueba a alguien no debe obligar a
-- inventarle un nivel, ni a desactivarlo después hay que adivinar cuál tenía.
create table if not exists public.extractor_acceso (
  user_id         uuid primary key references auth.users on delete cascade,
  plan            text not null default 'free' references public.extractor_planes(clave),
  ilimitado       boolean not null default false,
  motivo          text,
  actualizado_por uuid references auth.users,
  actualizado_en  timestamptz not null default now()
);

comment on column public.extractor_acceso.motivo is
  'Por qué se concedió el acceso ("beta tester", "socio"). Sin esto, en tres '
  'meses nadie recuerda a quién se le dio ilimitado ni con qué criterio.';

-- RLS. El sitio consulta con la anon key, así que sin políticas cualquiera
-- leería el plan ajeno.
alter table public.extractor_planes enable row level security;
alter table public.extractor_acceso enable row level security;

-- El catálogo es público de lectura: la página de planes lo muestra a
-- cualquiera, incluso sin sesión. Sólo los activos — un nivel apagado todavía
-- no existe para quien mira.
drop policy if exists extractor_planes_select_activos on public.extractor_planes;
create policy extractor_planes_select_activos
  on public.extractor_planes for select
  to anon, authenticated
  using (activo);

drop policy if exists extractor_planes_select_admin on public.extractor_planes;
create policy extractor_planes_select_admin
  on public.extractor_planes for select
  to authenticated
  using ((select public.es_admin()));

-- Cada quien ve su propio acceso, y nadie más. La escritura NO se concede a
-- `authenticated`: si alguien pudiera darse Gold desde el navegador, el
-- catálogo entero sería decorativo. La asigna el servidor con service_role, o
-- administración desde el panel.
drop policy if exists extractor_acceso_select_propio on public.extractor_acceso;
create policy extractor_acceso_select_propio
  on public.extractor_acceso for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists extractor_acceso_select_admin on public.extractor_acceso;
create policy extractor_acceso_select_admin
  on public.extractor_acceso for select
  to authenticated
  using ((select public.es_admin()));

commit;
