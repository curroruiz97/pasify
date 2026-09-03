# Respuesta a App Review — Pasify 1.0 (build 9)

Submission rechazada: `14204a0e-90da-43d1-b420-2a76956de94d`

---

## Texto para "App Review Information → Notes" (copiar y pegar)

```
Thank you for the detailed feedback. All three issues have been addressed in build 9.

GUIDELINE 2.1(a) — "Edit Profile" unresponsive
Root cause found and fixed: the "Edit Profile" button in the Settings panel had no
action attached to it, so tapping it did nothing at all. Build 9 adds the actual
edit screen (first name, last name, phone), which loads the current values and saves
them to the account. We also hardened every network and native-storage call behind an
explicit timeout, so a slow or stalled connection now shows an actionable message
instead of leaving the screen on a spinner. We additionally audited the whole customer
surface for any other control without an action and fixed the four we found (save set,
indoor "take me there", photo upload, "see all").

How to verify:
1. Sign in > open the side menu > Settings.
2. Tap "Editar perfil" (Edit profile): the edit form opens immediately.
3. Change any field and tap "Guardar" (Save): a confirmation appears and the values
   persist after reopening the screen.

GUIDELINE 5.1.1(v) — Account required for non-account features
The login screen now includes a clear "Explorar eventos sin cuenta" ("Browse events
without an account") entry point. Browsing the event calendar and viewing venue pages
require no registration. An account is only required for genuinely account-based
features: buying/holding tickets, joining an event, favourites, loyalty and the
personal profile.

How to verify:
1. Launch the app without signing in.
2. On the login screen tap "Explorar eventos sin cuenta".
3. The public event calendar opens and venue detail pages can be browsed freely.

GUIDELINE 2.3.6 — Age rating
The age rating has been updated: "Alcohol, Tobacco, or Drug Use or References" is now
set to Frequent/Intense, reflecting that the app lists bars and nightlife venues.
```

---

## Checklist de subida

- [x] `npm run build` + `npx cap copy ios` (bundle web actualizado en el proyecto iOS)
- [x] Build number 8 -> 9 (`CURRENT_PROJECT_VERSION`)
- [x] Cambios commiteados en `main`
- [ ] `git push origin main` (requiere tus credenciales de GitHub)
- [ ] Xcode: Product > Archive
- [ ] Organizer: Distribute App > App Store Connect > Upload
- [ ] App Store Connect: Age Rating -> Alcohol/Tobacco/Drug = Frequent/Intense
- [ ] App Store Connect: seleccionar build 9 y enviar a revision
- [ ] Confirmar que la cuenta demo para el revisor sigue activa y con datos

## Datos de la build

| Campo | Valor |
|---|---|
| Bundle ID | `es.pasify.app` |
| Version | 1.0 |
| Build | 9 |
| Supabase | `ixkyfwzkknehvsqpopof.supabase.co` (verificado en el bundle de produccion) |

## Verificacion automatizada ejecutada (Playwright sobre el bundle compilado)

| Suite | Checks | Resultado |
|---|---|---|
| Editar perfil — apertura y estado | 7 | OK |
| Editar perfil — cargar, editar y guardar | 7 | OK |
| Anti-congelacion con red colgada | 4 | OK |
| Acceso sin cuenta (5.1.1(v)) | 6 | OK |
| Controles de "En vivo" | 15 | OK |
| Utilidad de timeout | 4 | OK |
| **Total** | **43** | **43 OK / 0 fallos** |
