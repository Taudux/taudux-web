-- Cuentas de prueba: Jorge usa cuentas propias para probar el sitio y no
-- quiere que sus altas/bajas ensucien las estadísticas agregadas de
-- eventos_negocio (0027). Se marca la cuenta con public.perfiles.es_prueba
-- (mismo patrón de columna que avisos_curso_nuevo, 0015) y se enseña a
-- registrar_baja_cuenta() a, si la cuenta borrada estaba marcada, borrar TODO
-- rastro suyo de eventos_negocio en vez de registrar la baja.
--
-- Aplicar dos veces NO es seguro (alter table add column sin guard), pero no
-- hay estado mutable aparte de la columna nueva: un reintento tras un fallo a
-- mitad de camino sobre una base que nunca llegó a tener la columna es un
-- re-run limpio.

begin;

do $preflight$
begin
  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0028 preflight failed: public.perfiles is required';
  end if;

  if to_regclass('public.eventos_negocio') is null then
    raise exception using
      errcode = 'P0001',
      message = '0028 preflight failed: public.eventos_negocio is required';
  end if;
end
$preflight$;

alter table public.perfiles
  add column es_prueba boolean not null default false;

-- Sin grant update (es_prueba) a authenticated, a propósito, a diferencia de
-- avisos_curso_nuevo (0015): esto es una marca operativa que sólo Jorge pone
-- desde el SQL Editor con service_role/superusuario. Si un authenticated
-- pudiera marcarse a sí mismo, podría sacar su propia cuenta de las métricas.
-- revoke all on public.perfiles from ... ya cubre esta columna (0001:26); no
-- hace falta un revoke explícito adicional, sólo NO otorgar el grant.

-- Mismo cuerpo que 0027, con una rama nueva: si la cuenta borrada estaba
-- marcada como de prueba, no queremos ni siquiera su alta vieja contaminando
-- las estadísticas, así que se borra TODO rastro suyo en vez de agregar una
-- baja. El if/else vive DENTRO del bloque begin/exception (no un `return
-- null` temprano antes de la excepción): así, si el delete de más abajo
-- falla de verdad, cae en el warning en vez de, por accidente, seguir de
-- largo e insertar la baja igual para una cuenta marcada.
create or replace function public.registrar_baja_cuenta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Mismo motivo que registrar_alta_confirmada(): un fallo no previsto acá
  -- no debe poder abortar el borrado real de una cuenta.
  begin
    -- OLD sigue disponible en un trigger AFTER DELETE aunque la fila física
    -- ya no exista: es un snapshot de los valores de la fila borrada, no una
    -- fila viva en la tabla, así que old.es_prueba es seguro de leer acá.
    if old.es_prueba then
      -- Borra por usuario_ref, no sólo tipo='baja_cuenta': cubre tanto una
      -- alta vieja (trigger_perfiles o backfill) como una baja que la edge
      -- function delete-account ya haya insertado antes de que corra esta
      -- cascada (origen='autoservicio') — por el índice único de 0027, esa
      -- escritura gana la carrera contra este trigger si llega primero, y
      -- este delete la limpia igual.
      delete from public.eventos_negocio where usuario_ref = old.id;
    else
      insert into public.eventos_negocio (tipo, usuario_ref, origen)
      values ('baja_cuenta', old.id, 'cascada_perfiles')
      on conflict do nothing;
    end if;
  exception
    when others then
      raise warning 'registrar_baja_cuenta failed for %: %', old.id, sqlerrm;
  end;
  return null;
end
$function$;

commit;
