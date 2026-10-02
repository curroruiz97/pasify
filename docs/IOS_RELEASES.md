# Pasify iOS — versiones y cómo subir

## Estado (2-oct-2026)

| Versión | Build | Estado en App Store Connect |
|---|---|---|
| 1.1.5 | 13 | Enviada a revisión el 2-oct a las 11:41: «Pendiente de revisión» |
| 1.1 | 12 | Publicada desde el 28-sep: «Listo para distribución» |

- 1.1.5 (13) se compiló desde el commit `18c1836` de `main` y se firmó con el equipo AVENUE DIGITAL GROUP SL (`C9TS27GA48`).
- Novedades puestas en App Store Connect: «Nueva imagen de Pasify con el logo renovado. Inicio de sesión más fiable: ya no falla si el teclado añade un espacio o una mayúscula al correo. Corregido un fallo por el que el panel del local podía quedarse en negro al entrar. Correcciones y mejoras de rendimiento.»
- Capturas de 6,5": las 6 llevan ya el icono nuevo (01-hero, 02-descubrir, 03-tickets, 04-favoritos, 05-eventos, 06-finanzas). En el Mac: `~/repos/capturas-pasify/logo-nuevo/`. Las originales están en `~/repos/capturas-pasify/`.

## Historial de builds (Organizer de Xcode)

| Versión | Build | Fecha | Nota |
|---|---|---|---|
| 1.0 | 1–9 | ago–sep 2026 | Revisiones de la primera versión (ver `APP_REVIEW_BUILD9.md`) |
| 1.0 | 10 | — | Falló |
| 1.1 | 10 | 4-sep | |
| 1.1 | 12 | 28-sep | Versión publicada |
| 1.1.5 | 13 | 2-oct | En revisión |

**La próxima compilación tiene que ser la 14 o mayor.** Hay que subir `CURRENT_PROJECT_VERSION` y `MARKETING_VERSION` aquí, en `ios/App/App.xcodeproj/project.pbxproj` (en Debug y en Release). No basta con cambiarlos solo en Xcode del Mac.

## Cómo se sube (Mac de la oficina)

- El repo está en `~/repos/pasify`. Herramientas instaladas: Xcode 26.6, Homebrew, Node 22, CocoaPods 1.17 y git.
- No hace falta traer ningún `.env`: `.env.production` está en el repo y lleva lo necesario.
- Desde el Mac no se hacen commits. Los cambios se suben desde otro equipo.

Pasos:

1. `cd ~/repos/pasify && git checkout main && git pull`
2. `npm install && npm run build`
3. `npx cap copy ios`. **Nunca `npx cap sync`**: vuelve a meter el pod de Google en el Podfile y Apple rechaza el binario (ITMS-91061). Ver el comentario del `ios/App/Podfile`.
4. `cd ios/App && pod install`. Comprobar que GoogleAuth solo aparece en comentarios.
5. Abrir `ios/App/App.xcworkspace`, el `.xcworkspace` y no el `.xcodeproj`.
6. Product > Archive con «Any iOS Device (arm64)», y después Distribute App > App Store Connect.
7. En App Store Connect: crear la versión nueva con «+», elegir la build, poner las novedades y enviar a revisión. Cuentas demo para el revisor: `cliente@pasify.es` y `partner@pasify.es`.

Recomendado antes del paso 6: probar en el simulador. Con la 1.1.5 no se hizo.

## Notas del 2-oct

- La carpeta del Mac tenía 3 commits locales que nunca se subieron: `c243ffc` (icono App Store), `4a7af58` (build 10) y `cdbc474` (versión 1.1). Hay copia en `~/repos/pasify-copia-v1.1` y la carpeta quedó igual que `origin/main`. Lo del icono ya lo cubre `012bff1` (logo nuevo).
- Se borró un icono suelto que no estaba en git: `ios/App/App/Assets.xcassets/AppIcon.appiconset/pasify_icon_1024.png`.
