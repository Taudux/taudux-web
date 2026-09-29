-- Reportes de QR: cualquiera que escanee un QR de Taudux puede avisar que lo
-- llevó a un sitio engañoso o peligroso, sin cuenta. Los reportes llegan a la
-- moderación (qr/admin.html), donde un admin decide si bloquea el QR.
--
-- POR QUÉ SIN CUENTA: quien cae en un phishing casi nunca tiene cuenta de
-- Taudux, y pedírsela es garantizar que no reporte. El costo es el spam, y se
-- acota con techos (por QR y globales) en vez de con identidad.
--
-- QUÉ SE GUARDA de quien reporta: el motivo, lo que quiera contar y, SÓLO si
-- lo escribe, un contacto para responderle. Nunca la IP. Si tenía sesión, su
-- id (sin FK, mismo criterio que qr_codigos.usuario_id). Los reportes se van
-- con su QR: la purga de 0044 los borra en cascada.
--
-- NO SE BLOQUEA SOLO: un QR con muchos reportes no se apaga automáticamente.
-- Sería regalarle a cualquiera un botón para tirar el QR de otro; decide una
-- persona.
--
-- Aplicar dos veces NO es seguro (create table sin if not exists); sin estado
-- mutable previo, un reintento sobre una base sin la tabla es un re-run limpio.

begin;

do $preflight$
begin
  if to_regclass('public.qr_codigos') is null then
    raise exception using
      errcode = 'P0001',
      message = '0046 preflight failed: 0044_qr_codigos must be applied first';
  end if;
end
$preflight$;

create table public.qr_reportes (
  id            bigint generated always as identity primary key,
  qr_id         bigint not null references public.qr_codigos (id) on delete cascade,
  -- Mismos valores que el <select> de qr/reportar.html (lo fija un test).
  motivo        text not null,
  detalle       text,
  contacto      text,
  reportado_por uuid,
  creado_en     timestamptz not null default now(),
  atendido_en   timestamptz,
  atendido_por  uuid,
  constraint qr_reportes_motivo_valido
    check (motivo in ('phishing', 'malware', 'fraude', 'suplantacion', 'contenido_ilegal', 'otro')),
  constraint qr_reportes_detalle_acotado
    check (detalle is null or char_length(detalle) between 1 and 1000),
  constraint qr_reportes_contacto_acotado
    check (contacto is null or char_length(contacto) between 3 and 200),
  constraint qr_reportes_atencion_completa
    check ((atendido_en is null) = (atendido_por is null))
);

create index qr_reportes_qr_idx on public.qr_reportes (qr_id, creado_en desc);
create index qr_reportes_pendientes_idx on public.qr_reportes (creado_en desc) where atendido_en is null;

alter table public.qr_reportes enable row level security;
revoke all on public.qr_reportes from anon, authenticated;
grant select on public.qr_reportes to authenticated;

-- Sólo administración lee los reportes: traen contactos y acusaciones.
create policy qr_reportes_select_admin
  on public.qr_reportes for select
  to authenticated
  using ((select public.es_admin()));

-- Reportar. Acepta el código de cualquier QR que exista, eliminado incluido:
-- quien abusa puede borrar su QR para esconderse, y justo para eso se conserva
-- el registro 90 días. Devuelve 'ok' o lanza un código que la página traduce.
create or replace function public.qr_reportar(
  p_codigo   text,
  p_motivo   text,
  p_detalle  text default null,
  p_contacto text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Techos contra el spam: por QR y en todo el sitio, por día.
  v_maximo_por_qr constant int := 20;
  v_maximo_global constant int := 500;
  v_qr_id bigint;
begin
  select id into v_qr_id
    from public.qr_codigos
   where codigo = pg_catalog.lower(pg_catalog.btrim(p_codigo));
  if v_qr_id is null then
    raise exception using errcode = 'P0001', message = 'qr_no_existe';
  end if;

  if p_motivo is null or p_motivo not in
     ('phishing', 'malware', 'fraude', 'suplantacion', 'contenido_ilegal', 'otro') then
    raise exception using errcode = 'P0001', message = 'qr_motivo_invalido';
  end if;

  if (select count(*) from public.qr_reportes
       where qr_id = v_qr_id and creado_en > now() - interval '1 day') >= v_maximo_por_qr
     or (select count(*) from public.qr_reportes
          where creado_en > now() - interval '1 day') >= v_maximo_global then
    raise exception using errcode = 'P0001', message = 'qr_demasiados_reportes';
  end if;

  insert into public.qr_reportes (qr_id, motivo, detalle, contacto, reportado_por)
  values (
    v_qr_id,
    p_motivo,
    pg_catalog.left(nullif(pg_catalog.btrim(p_detalle), ''), 1000),
    pg_catalog.left(nullif(pg_catalog.btrim(p_contacto), ''), 200),
    (select auth.uid())
  );
  return 'ok';
end;
$$;

-- Un admin da por atendido un reporte (haya bloqueado el QR o no).
create or replace function public.qr_atender_reporte(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception using errcode = '42501', message = 'qr_solo_admin';
  end if;
  update public.qr_reportes
     set atendido_en = now(),
         atendido_por = (select auth.uid())
   where id = p_id
     and atendido_en is null;
  return found;
end;
$$;

revoke all on function public.qr_reportar(text, text, text, text) from public, anon, authenticated;
revoke all on function public.qr_atender_reporte(bigint) from public, anon, authenticated;

-- Reportar es público a propósito (ver el encabezado); atender, sólo admin
-- (lo verifica la función).
grant execute on function public.qr_reportar(text, text, text, text) to anon, authenticated;
grant execute on function public.qr_atender_reporte(bigint) to authenticated;

commit;
