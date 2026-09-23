-- Pasify · resultados nuevos del escáner de puerta
--
-- scan_ticket v2 (migración siguiente) distingue dos casos que antes daban
-- "Acceso permitido": una entrada fuera de la ventana horaria de su evento y
-- una entrada de un evento cancelado.
--
-- Va en su propia migración porque un valor añadido a un enum no se puede
-- usar dentro de la misma transacción que lo crea.

ALTER TYPE public.scan_result_t ADD VALUE IF NOT EXISTS 'outside_window';
ALTER TYPE public.scan_result_t ADD VALUE IF NOT EXISTS 'event_cancelled';
