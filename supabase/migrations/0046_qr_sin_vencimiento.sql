-- Quitar (o devolver) el vencimiento de UN QR desde el panel de moderación.
--
-- Por qué: el plan gratis hace vencer cada QR a los 7 días (qr_planes.duracion,
-- fijada por qr_crear en 0044) y ninguna columna es escribible desde el
-- navegador, así que hoy un QR de Taudux impreso (un evento, un cartel) sólo se
-- salva con un acceso ilimitado a toda la cuenta. Esto es la excepción por QR:
-- administración decide que ESTE no venza.
--
-- Mismo patrón que qr_moderar (0044): security definer, es_admin() se comprueba
-- adentro porque la RLS no protege una función definer, y execute sólo para
-- authenticated. No agrega columnas: "sin vencimiento" ya es vence_en = null,
-- que es lo que usan las cuentas ilimitadas y lo que entienden qr_resolver y
-- el conteo del plan. Tampoco pide motivo: no restringe nada, sólo amplía.
--
-- Aplicar dos veces es seguro (create or replace).

begin;

do $preflight$
begin
  if to_regclass('public.qr_codigos') is null then
    raise exception using
      errcode = 'P0001',
      message = '0046 preflight failed: public.qr_codigos is required (apply 0044 first)';
  end if;

  if to_regprocedure('public.qr_plan_de(uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0046 preflight failed: public.qr_plan_de(uuid) is required (apply 0044 first)';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0046 preflight failed: public.es_admin() is required (apply 0044 first)';
  end if;
end
$preflight$;

-- p_sin_vencimiento = true  → vence_en = null.
-- p_sin_vencimiento = false → vuelve a regir el plan del dueño: vence_en =
--   now() + duración. Si el plan no tiene duración (null), vence_en queda null:
--   ese plan tampoco vence, y es lo correcto.
-- Funciona también sobre un QR ya vencido: lo revive (en ambos sentidos el
-- vencimiento se recalcula desde ahora). Un QR eliminado no se toca.
create or replace function public.qr_cambiar_vencimiento(
  p_id              bigint,
  p_sin_vencimiento boolean
)
returns public.qr_codigos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.qr_codigos%rowtype;
begin
  if not public.es_admin() then
    raise exception using errcode = '42501', message = 'qr_solo_admin';
  end if;

  select * into v from public.qr_codigos where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'qr_no_existe';
  end if;
  if v.eliminado_en is not null then
    raise exception using errcode = 'P0001', message = 'qr_eliminado';
  end if;

  if p_sin_vencimiento then
    update public.qr_codigos set vence_en = null
     where id = p_id
    returning * into v;
  else
    update public.qr_codigos
       set vence_en = now() + (public.qr_plan_de(v.usuario_id)).duracion
     where id = p_id
    returning * into v;
  end if;

  return v;
end;
$$;

revoke all on function public.qr_cambiar_vencimiento(bigint, boolean) from public, anon, authenticated;
-- La función misma verifica es_admin().
grant execute on function public.qr_cambiar_vencimiento(bigint, boolean) to authenticated;

commit;
