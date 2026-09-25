-- Pasify · resultado nuevo del escáner de puerta: pago de prueba
--
-- scan_ticket (migración siguiente) rechaza con 'test_payment' las entradas
-- de pedidos pagados en modo prueba de Stripe (ticket_orders.livemode =
-- false) mientras el ajuste require_live_payments esté activo.
--
-- Va en su propia migración porque un valor añadido a un enum no se puede
-- usar dentro de la misma transacción que lo crea.

ALTER TYPE public.scan_result_t ADD VALUE IF NOT EXISTS 'test_payment';
