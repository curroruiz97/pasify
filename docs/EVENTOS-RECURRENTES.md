# Eventos de varios días y recurrentes

Una **serie** es un grupo de **sesiones** y cada sesión es un evento de verdad (una fila de `events`). Es la
decisión de diseño que lo explica todo: pedidos, pagos de Stripe, QR y control de puerta, cancelación con
reembolso, informes, liquidaciones y el límite de 10 entradas por persona y evento siguen funcionando **por
sesión y sin cambios**. Una compra es de una sesión, el aforo de una fecha no resta de otra y cancelar una
fecha no toca las demás.

No hay (todavía) un abono de una sola entrada válido para varios días: cada día tiene sus propios tipos de
entrada. Si hiciera falta, sería un tipo de entrada válido en varias sesiones y pide su propio diseño.

## Datos

| Qué | Dónde | Notas |
| --- | --- | --- |
| La serie | `event_series` | Tipo (`multi_day` o `recurring`), la regla **tal como la escribió el local** (`rule`, JSON con `v: 1`), la zona horaria y las horas locales de inicio y fin. La regla solo sirve para enseñarla («Todos los viernes · 4 fechas»); **lo que cuenta son las sesiones**. |
| La sesión | `events.series_id`, `series_date`, `series_exception` | A qué serie pertenece, el día de la serie (hora local; no cambia si la sesión se mueve) y si se editó por separado (las ediciones de toda la serie la respetan salvo que se pida). |

Invariantes que garantiza la base de datos (migración `20261013130000_eventos_recurrentes.sql`):

- **Sin duplicados**: una sola sesión por día de serie (índice único; las canceladas también cuentan, así una fecha
  cancelada no vuelve a salir).
- **Sin choques**: las sesiones vivas de una serie no se solapan (trigger; mismo fin por defecto que la venta de
  entradas: 12 h después de empezar).
- La serie de un evento **no se cambia desde la API**: ni mover un evento a otra serie ni colgar uno de la serie de
  otro local.
- Tope de **100 sesiones** por serie y, al publicar, **sin fechas pasadas**.
- Cuando se cancela la última sesión viva, la serie queda cancelada.

## RPC

Todas con `REVOKE … FROM PUBLIC, anon`; solo `authenticated` y `service_role`. Las tres primeras son
`SECURITY INVOKER`: las escrituras pasan por la RLS y los triggers de siempre (quién puede crear y publicar,
tenant, mínimo de 0,50 €, aforo por tipos…), igual que si el editor las hiciera una a una.

| Función | Qué hace |
| --- | --- |
| `create_event_series(_request_id, _kind, _rule, _time_zone, _event, _tiers, _sessions)` | La serie con todas sus sesiones y los tipos de entrada de cada una, **en una transacción e idempotente** (clave por intento: un doble clic o un reintento tras un corte no crea dos series). |
| `update_event_series(_series_id, _from, _patch, _include_exceptions)` | Cambios comunes (título, descripción, imagen, categoría, lugar, horas) a las sesiones por celebrar: de una fecha en adelante o todas. Salta las editadas por separado, las pasadas y las canceladas. Las horas son de reloj en la zona de la serie (el cambio de hora lo resuelve Postgres). |
| `apply_event_tiers_to_series(_event_id, _scope)` | Copia los tipos de entrada de una sesión a las demás **que no tienen entradas ni reservas**; las otras se saltan y se cuentan. |
| `cancel_event_series(_series_id, _from, _reason)` | `SECURITY DEFINER` con comprobación de permiso explícita. Cancela de una vez las sesiones **sin ventas** y devuelve las que sí las tienen, para que el panel las cancele una a una con `partner-cancel-event` (que es quien reembolsa en Stripe). Así el límite de 30 llamadas/hora de esa función solo cuenta las sesiones con ventas. |

Errores propios (mensaje = código): `not_authenticated`, `series_invalid_*`, `series_no_sessions`,
`series_too_many_sessions`, `series_duplicate_dates`, `series_invalid_session_times`, `series_session_in_past`,
`series_title_required`, `series_city_required`, `series_sessions_overlap`, `series_not_found`,
`cancel_reason_required`. `describeSeriesError` (`src/lib/eventSeriesApi.ts`) los traduce.

## Front

- **Motor de recurrencia** — `src/lib/recurrence.ts` (puro, probado en `tests/e2e/recurrencia.spec.ts`): a partir de
  la regla da las fechas exactas, las sesiones con su hora **de reloj en la zona del local** (una sesión de las
  23:30 sigue a las 23:30 aunque cambie la hora de verano a invierno a mitad de la serie) y la frase que se enseña.
  El editor y el envío usan la misma cuenta: lo que se previsualiza es lo que se crea.
- **Editor** — `EventScheduleSection` («Una fecha / Varios días / Se repite»), vista previa de las fechas con
  quitar y volver a poner, aviso de las que ya pasaron. Solo al crear o duplicar; al editar, cada fecha se edita
  sola y, si es de una serie, se pregunta a qué fechas se aplica el cambio común.
- **Mis eventos** — una fila por serie con sus cifras, que se abre para ver cada fecha; menú de la serie
  (publicar las fechas en borrador de una vez, cancelar) y cancelar con alcance (esta fecha / esta y las
  siguientes / toda la serie).
- **Público** — calendario, home y ficha del local: una tarjeta por serie con «N fechas · ver todas» (diálogo con
  cada fecha, su precio y si está agotada); la página del evento enseña cómo se repite y todas las fechas. La vista
  de mes enseña cada fecha en su día.
- **Tolerancia a una BD sin la migración** — las lecturas piden `series_id`/`series_date` con `leerConSeries` y, si el
  servidor no las tiene, repiten la consulta sin ellas: el front nuevo puede salir antes que la migración. Crear una
  serie sí la necesita.

## Pruebas

- `tests/db/o6_eventos_recurrentes.sql` — crear, idempotencia, datos malos, duplicados y solapes, tope, fechas
  pasadas, seguridad entre locales y `anon`, cambio de hora, edición con alcance y excepciones, tipos con ventas,
  ventas independientes por sesión, cancelar una fecha y la serie, visibilidad pública.
- `tests/e2e/recurrencia.spec.ts` (motor), `series-editor.spec.ts` (crear), `series-gestion.spec.ts` (gestionar),
  `series-publico.spec.ts` (lo que ve el público). Todo con Supabase simulado: sin pagos reales.

## Despliegue

La migración debe ir **después** de las anteriores (`db push` va sin `--include-all`: se aplican en orden de marca
de tiempo). Es compatible hacia atrás: no cambia ninguna columna existente y las funciones nuevas no las llama nadie
hasta que sale el front que las usa.
