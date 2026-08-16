#!/usr/bin/env node
/**
 * Invoca el wrapper de Gradle del proyecto Android desde npm, en cualquier SO.
 *
 * Los scripts android:* usaban `cd android && ./gradlew <tarea>`. Eso solo
 * funciona en shells POSIX: en Windows los npm scripts corren bajo cmd.exe,
 * que no entiende `./gradlew` y responde
 *
 *   "." no se reconoce como un comando interno o externo
 *
 * justo despues de que vite y cap sync hayan terminado bien — asi que parecia
 * que el build habia ido, pero no se generaba ningun AAB.
 *
 * Uso:  node scripts/gradle.mjs bundleRelease
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");
const isWindows = process.platform === "win32";
const wrapper = isWindows ? "gradlew.bat" : "./gradlew";

const tasks = process.argv.slice(2);
if (tasks.length === 0) {
  console.error("Uso: node scripts/gradle.mjs <tarea-de-gradle> [...]");
  process.exit(1);
}

// El AAB/APK de release se firma con el keystore referenciado en
// android/keystore.properties, que esta en .gitignore. Si falta, Gradle NO
// falla: el bloque `if (keystorePropertiesFile.exists())` de build.gradle se
// salta en silencio y sale un binario sin firmar que Play Console rechaza al
// subirlo. Avisamos antes de gastar el build.
const necesitaFirma = tasks.some((t) => /Release$/.test(t));
const keystoreProps = path.join(androidDir, "keystore.properties");
if (necesitaFirma && !fs.existsSync(keystoreProps)) {
  console.error(
    [
      "",
      "  ✖ Falta android/keystore.properties · el binario saldria SIN FIRMAR.",
      "",
      "    Play Console rechaza los AAB sin firmar, y ademas hay que usar",
      "    exactamente la misma upload key con la que se subio la primera",
      "    version de es.pasify.app — una nueva no vale.",
      "",
      "    Crea android/keystore.properties con:",
      "      storeFile=<ruta al .jks>",
      "      storePassword=<...>",
      "      keyAlias=<...>",
      "      keyPassword=<...>",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const res = spawnSync(wrapper, tasks, {
  cwd: androidDir,
  stdio: "inherit",
  shell: isWindows,
});

process.exit(res.status ?? 1);
