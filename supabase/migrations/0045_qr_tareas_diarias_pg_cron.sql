-- Las dos tareas diarias del generador de QR, en pg_cron (mismo motivo que
-- 0019: el cron de GitHub Actions se salteaba ~7 de cada 8 corridas).
--
-- 1. qr_purga_diaria: borra lo eliminado o vencido hace más de 90 días y retira
--    sus códigos (public.qr_purgar(), 0044). Corre dentro de la base: no
--    necesita red ni secretos.
--
-- 2. qr_revision_diaria: llama a la edge function revisar-qr, que vuelve a
--    pasar por Google Web Risk los QR activos. Un link sano al crearse puede
--    volverse malicioso después; si Web Risk lo marca, se bloquea.
--
-- Igual que 0019, sólo una de las dos cabeceras de la llamada es secreta:
--
-- * x-taudux-qr-secret autoriza la revisión (revisar-qr/index.ts, comparada en
--   tiempo constante). NO vive en este archivo —el repositorio es público—:
--   se carga aparte en Supabase Vault con el nombre `qr_cron_secret` y se
--   resuelve en cada ejecución desde vault.decrypted_secrets. El mismo valor
--   va como secret QR_CRON_SECRET de la edge function.
-- * La anon key del Authorization no es secreta: ya se sirve a cada visitante
--   en src/app/core/supabase/supabase-client.js, y sólo satisface el chequeo
--   de JWT de la plataforma.
--
-- Verificar que el proyecto destino es yqkvgfqplmbbcebrivpt antes de correr
-- este archivo.
--
-- Aplicar dos veces es seguro: cada job se desprograma por nombre antes de
-- volver a programarse.

begin;

do $preflight$
begin
  if to_regprocedure('public.qr_purgar()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0045 preflight failed: 0044 must be applied first';
  end if;

  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0045 preflight failed: pg_cron extension is required';
  end if;

  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0045 preflight failed: pg_net extension is required';
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'qr_cron_secret'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0045 preflight failed: vault secret qr_cron_secret is required';
  end if;
end
$preflight$;

-- Por jobid y no con cron.unschedule(text): algunas versiones de pg_cron fallan
-- si el nombre todavía no existe, y eso rompería la primera aplicación (0019).
select cron.unschedule(jobid)
from cron.job
where jobname in ('qr_purga_diaria', 'qr_revision_diaria');

-- 09:15 UTC = 03:15 en la Ciudad de México: la hora de menos escaneos.
select cron.schedule(
  'qr_purga_diaria',
  '15 9 * * *',
  $cron$ select public.qr_purgar(); $cron$
);

-- Media hora después de la purga, para no revisar lo que está por borrarse.
select cron.schedule(
  'qr_revision_diaria',
  '45 9 * * *',
  $cron$
  select net.http_post(
    url := 'https://yqkvgfqplmbbcebrivpt.supabase.co/functions/v1/revisar-qr',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Public anon key, matches src/app/core/supabase/supabase-client.js.
      -- Satisfies the platform JWT check only; grants no authorization.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxa3ZnZnFwbG1iYmNlYnJpdnB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODgxOTEsImV4cCI6MjEwMDA2NDE5MX0.wU-ylZ6agwkochwmOGe-7BROByw1qsvYpmqT5xDvF1Y',
      'x-taudux-qr-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'qr_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    -- revisar-qr consulta Web Risk QR por QR; 60 s cubren varios cientos.
    timeout_milliseconds := 60000
  );
  $cron$
);

commit;
