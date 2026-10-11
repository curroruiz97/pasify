# Comparador v1 / v2

Un selector flotante para saltar entre **v1** (la web antes de los cambios del 11 de octubre de 2026) y **v2** (la web actual) en la misma pantalla y con la misma ruta, y ver a ojo qué cambió en el front.

- **v1** es la web en el commit `75e951e`, tal como estaba antes de los 17 PR de ese día.
- **v2** es la web actual.
- La landing (`/` y `public/landing/`) no se tocó ese día: se ve igual en las dos versiones.

## Cómo se usa

El selector solo aparece en las **vistas previas de Vercel** (cada PR y cada rama que no sea `main`). Abre la URL de la vista previa y verás abajo a la izquierda una pastilla `v1 | v2`.

- Pulsa `v1` o `v2` para cambiar. La ruta se conserva (`/#/login?aviso=contrasena` pasa a `/v1/#/login?aviso=contrasena`).
- `Alt+V` cambia de versión desde el teclado.
- El botón `–` la minimiza a una ficha pequeña con la versión actual.
- v1 vive en `/v1/` dentro del mismo despliegue y v2 en `/`.

En local: `PASIFY_COMPARE=1 npm run build && npx vite preview`.

## Qué mirar

Cada fila es una pantalla que cambió el 11 de octubre. Se llega a ella con la ruta o el paso indicado y se alterna con el selector.

| Pantalla | Cómo llegar | v1 | v2 |
|---|---|---|---|
| Aviso tras cambiar la contraseña | `/#/login?aviso=contrasena` | sin aviso | aviso verde «Contraseña cambiada» |
| Enlace de recuperación | `/#/update-password?token_hash=x&type=recovery` | valida el enlace nada más cargar | tarjeta «Enlace de recuperación» con Continuar y Cancelar |
| Reembolsos del admin | Admin → Reembolsos → Aprobar | se ejecuta al primer clic | diálogo de confirmación con el importe |
| Liquidaciones del admin | Admin → Liquidaciones → desplegar un local | aviso de descontar Connect a mano | «Neto − Cobrado por Connect − Liquidado = Pendiente» |
| Informes del local | Panel del local → Métricas | hasta 1.000 filas, hora del navegador | completo, hora de Madrid, avisos de informe incompleto o parcial |
| Editor de eventos | Panel del local → Nuevo evento | acepta cupos, precios y horas inválidos | valida cada campo, avisa de horas dudosas y confirma publicar con fecha pasada |
| Cancelar un evento | Mis eventos → Cancelar | cuenta también las entradas ya escaneadas | cuenta entradas y euros a devolver y las que ya entraron |
| Compra | Evento → Conseguir entradas → pagar, con red lenta | puede quedarse en «Preparando el pago…» | avisa a los 25 s y libera el botón |
| Transferencia cerrada | `/#/transferencia?token=…` de una ya aceptada o cancelada | «Inténtalo de nuevo» en bucle | muestra su estado real |
| QR que no se genera | Mis entradas → QR | carga sin fin | aviso, código de puerta y Reintentar |
| Escáner de puerta | `/#/door` con mala cobertura | un reintento da «Entrada ya usada» | el reintento devuelve el éxito original |
| Landing | `/` | igual | igual |

## Qué comparten v1 y v2

Solo cambia el código del navegador. Las dos versiones usan **la misma base de datos, las mismas edge functions y la misma sesión** (mismo origen, mismo `localStorage`). Por eso:

- Pantallas que dependen de cambios de base de datos o de funciones del 11 de octubre pueden comportarse en v1 distinto de como lo hacía entonces. Por ejemplo, un plan en pausa deja a v1 cargando, porque `claim_partner_free_plan` ya no lo reactiva.
- Los retornos de Stripe y los enlaces de los correos apuntan a la raíz (v2).
- Si cambias de versión con la sesión abierta, sigues dentro de la misma cuenta.

## Por qué no está en producción

v1 contiene los fallos que se cerraron ese día (por ejemplo, la recuperación de contraseña que abre sesión sin pedir confirmación). Servirlo en el dominio real los reabriría para cualquiera que conozca la URL. Por eso `scripts/compare-plugin.mjs` y `scripts/build-v1.mjs` solo actúan si:

| Variable | Efecto |
|---|---|
| `VERCEL_ENV=preview` (lo pone Vercel) | activado |
| `PASIFY_COMPARE=1` | activado, también en local o en producción (no hacerlo en producción) |
| `PASIFY_COMPARE=0` | desactivado, también en vistas previas |
| `VERCEL_ENV=production` | desactivado |

Con el comparador desactivado, `npm run build` produce exactamente lo de antes. La única diferencia es que el service worker deja pasar `/v1/` al servidor.

## Cómo funciona

1. `compare/v1/files/` guarda la versión antigua de los 38 ficheros de `src/` e `index.html` que cambiaron (631 KiB). `compare/v1/manifest.json` lista esos ficheros y los 4 que v1 no tiene.
2. `npm run build` hace `vite build` (v2, en `dist/`) y después `node scripts/build-v1.mjs`.
3. `scripts/build-v1.mjs` copia `src/` a `.v1/src`, quita los ficheros que v1 no tiene, pisa los 38 con su versión antigua y compila esa copia con la misma toolchain en `dist/v1`: `base=/v1/`, sin service worker, con las variables de entorno del build. `.v1/` es temporal y se borra al terminar.
4. `scripts/compare-plugin.mjs` añade a los dos `index.html` las etiquetas `pasify-variant` y `pasify-sha` y el script `/compare-switcher.<hash>.js`: la copia de `scripts/compare-switcher.js` (sin dependencias, en Shadow DOM) con el hash de su contenido en el nombre, porque `vercel.json` cachea los `.js` un año.
5. Si v1 no se pudo construir en una vista previa, el despliegue sigue sin v1 y el selector deja su botón apagado. Con `PASIFY_COMPARE=1` el fallo corta el build.

## Mantenimiento

- v1 = la web actual **sin** los cambios entre dos commits. Si `src/` evoluciona y un fichero antiguo deja de encajar, el build de v1 falla (y avisa). Para otra comparación: `node scripts/compare-snapshot.mjs <commit-base> [commit-final]`.
- Es una herramienta temporal. Para quitarla: borrar `compare/`, `scripts/compare-*`, `scripts/build-v1.mjs`; volver `build` a `vite build`; y quitar de `vite.config.ts` el plugin y `/^\/v1\//` del denylist, de `eslint.config.js` los dos `ignores` y de `.gitignore` la línea `.v1/`.
