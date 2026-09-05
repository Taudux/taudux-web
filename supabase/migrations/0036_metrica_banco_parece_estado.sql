-- Para que el conteo de fallos se pueda creer.
--
-- EL PROBLEMA QUE RESUELVE
--
-- `resultado = 'no_reconocido'` mezcla hoy dos cosas que piden acciones
-- OPUESTAS:
--
--   · un estado de cuenta real de un banco que todavía no cubrimos — la señal
--     que decide qué construir después;
--   · un PDF que nunca fue un estado de cuenta (un currículum, una receta,
--     alguien probando).
--
-- Contados juntos, inflan la tasa de fallo y apuntan el roadmap a una demanda
-- que no existe. Es la pregunta exacta que abrió este cambio: *"¿cómo sé que no
-- es un falso positivo?"*.
--
-- QUÉ GUARDA, Y QUÉ NO
--
-- Un BOOLEANO: si el PDF traía el RFC de un titular. `identidad_titular()` ya
-- descarta el RFC del propio banco, así que uno encontrado es el de una
-- persona — y un documento que trae RFC de persona es casi con certeza
-- financiero.
--
-- **El RFC NO se guarda, ni acá ni en ningún lado.** Es un dato personal, y
-- esta tabla existe justamente para medir sin identificar: la `0030` dejó
-- escrito que ni siquiera guarda la hora exacta, para que no se pueda cruzar
-- contra `extractor_uso` y volver a saber quién subió el documento. Guardar el
-- RFC tiraría esa separación por la ventana.
--
-- Es el mismo movimiento que `con_sesion` en la `0034`: alcanza para partir el
-- conteo en dos y no alcanza para señalar a nadie.
--
-- POR QUÉ ES NULLABLE Y NO `not null default false`
--
-- Porque hay TRES estados y el tercero es el que hace honesto al número:
--
--   · `true`   trae RFC de titular, o el banco se detectó — es un estado real
--   · `false`  se pudo leer el texto y no había RFC — probablemente no lo era
--   · `null`   NO SE PUDO AVERIGUAR
--
-- Un PDF escaneado no tiene capa de texto donde buscar. Eso no es "no parece un
-- estado de cuenta": es "no se sabe". Un `default false` afirmaría lo primero y
-- ensuciaría de entrada la única cifra que esta columna existe para limpiar —
-- sin que nada fallara.
--
-- Es el mismo criterio con el que `cuadra` ya es nullable en esta tabla, y con
-- el que `_visitas_del_mes()` distingue cero de `None`.
--
-- Y las filas viejas: no hay ninguna. La tabla estuvo vacía desde la `0030`
-- porque nada la escribía (`_registrar_banco()` sólo tocaba una lista en
-- memoria). Este cambio y el del servidor van juntos.
--
-- Aplicar dos veces es seguro: `if not exists`.

begin;

do $preflight$
begin
  if to_regclass('public.extractor_metrica_banco') is null then
    raise exception using
      errcode = 'P0001',
      message = '0036 preflight failed: public.extractor_metrica_banco is required (0030)';
  end if;
end
$preflight$;

alter table public.extractor_metrica_banco
  add column if not exists parece_estado boolean;

comment on column public.extractor_metrica_banco.parece_estado is
  'Si el PDF parecía un estado de cuenta real: true cuando se detectó el banco '
  'o se encontró el RFC de un titular, false cuando se leyó el texto y no lo '
  'había, y NULL cuando no se pudo averiguar (un escaneo no tiene dónde '
  'buscar). Separa "un banco que no cubrimos" de "esto ni era un estado de '
  'cuenta". Se guarda el booleano, NUNCA el RFC.';

commit;
