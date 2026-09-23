#!/usr/bin/env node
/**
 * Pasify · typecheck con baseline
 *
 * `tsconfig.json` es un solution config (`"files": []` + `references`), asi
 * que `tsc --noEmit` a secas no comprueba ningun fichero y siempre sale verde.
 * Por ahi se colo 2b3b079: `seccionActiva` usada fuera de su ambito dentro de
 * PartnerDrawer, `ReferenceError` nada mas entrar al panel de local.
 *
 * Este script pasa `tsc --noEmit -p` por cada tsconfig real y compara los
 * errores con `scripts/typecheck-baseline.json`, la deuda que ya existia
 * (sobre todo codigo legacy de Students Life). Falla solo si aparece un error
 * que no esta en el baseline.
 *
 * Cada error se identifica por fichero + codigo + mensaje, sin linea ni
 * columna, y se cuenta cuantas veces aparece: mover codigo dentro de un
 * fichero no da falsos positivos, y una copia mas de un error ya conocido si
 * cuenta como nueva.
 *
 * Uso:
 *   node scripts/typecheck-baseline.mjs            # comprueba (npm run typecheck, CI)
 *   node scripts/typecheck-baseline.mjs --update   # reescribe el baseline (npm run typecheck:baseline)
 *
 * `--update` sirve para bajar el liston despues de arreglar errores, no para
 * aceptar errores nuevos: lo que anada queda a la vista en el diff del JSON.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = resolve(ROOT, "scripts", "typecheck-baseline.json");
const CONFIGS = ["tsconfig.app.json", "tsconfig.node.json"];
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const UPDATE = process.argv.includes("--update");

// El chequeo completo de la app usa ~3,6 GB de heap (los tipos generados de
// Supabase disparan las instanciaciones). En un runner de GitHub con 7 GB de
// RAM el limite por defecto de Node se queda en ~1,75 GB y tsc moriria sin
// memoria, asi que se lo subimos.
const HEAP_MB = 6144;

// `src/foo.tsx(12,5): error TS2304: Cannot find name 'x'.`, o sin fichero
// (`error TS5058: ...`) cuando lo que falla es el propio tsconfig.
const ERROR_RE = /^(?:(.+?)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;

// Fuera rutas absolutas: el repo pasa a `.` y cualquier node_modules se corta
// en `node_modules/` (en un worktree vive en el repo padre). Asi Windows y el
// CI de Linux generan las mismas claves.
const ROOT_RE = new RegExp(ROOT.replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
const NODE_MODULES_RE = /[^\s"'`(]*\/node_modules\//g;
// tsc resume las uniones largas con "... 80 more ...": cada RPC o tabla nueva
// cambiaria el numero y con el la clave de errores ya conocidos.
const MORE_RE = /\.\.\. \d+ more \.\.\./g;
const normalize = (s) =>
  s.replace(ROOT_RE, ".").replace(NODE_MODULES_RE, "node_modules/").replace(MORE_RE, "... N more ...");

function runTsc(config) {
  console.log(`tsc --noEmit -p ${config} ...`);
  const r = spawnSync(
    process.execPath,
    [`--max-old-space-size=${HEAP_MB}`, TSC, "--noEmit", "-p", config, "--pretty", "false"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.error) throw r.error;

  const errors = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = ERROR_RE.exec(line);
    if (!m) continue;
    const [, file, , , code, message] = m;
    errors.push({
      line,
      file: file ? normalize(file.replace(/\\/g, "/")) : `(${config})`,
      key: `${code}: ${normalize(message)}`,
    });
  }

  // tsc ha fallado sin ningun error reconocible (crash, sin memoria...):
  // eso nunca se da por bueno en silencio.
  if (r.status !== 0 && errors.length === 0) {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    throw new Error(`tsc -p ${config} termino con ${r.status ?? r.signal} sin errores reconocibles`);
  }
  return errors;
}

/** { fichero: { "TSxxxx: mensaje": veces } } con las claves ordenadas. */
function tally(errors) {
  const byFile = {};
  for (const { file, key } of errors) {
    byFile[file] ??= {};
    byFile[file][key] = (byFile[file][key] ?? 0) + 1;
  }
  const sorted = {};
  for (const file of Object.keys(byFile).sort()) {
    sorted[file] = {};
    for (const key of Object.keys(byFile[file]).sort()) sorted[file][key] = byFile[file][key];
  }
  return sorted;
}

/** Aplica `normalize` a las claves de un baseline guardado con una version anterior del script. */
function normalizeBaseline(raw) {
  const out = {};
  for (const [file, keys] of Object.entries(raw)) {
    out[file] = {};
    for (const [key, count] of Object.entries(keys)) {
      const k = key.replace(MORE_RE, "... N more ...");
      out[file][k] = (out[file][k] ?? 0) + count;
    }
  }
  return out;
}

/** Entradas de `a` que aparecen mas veces que en `b` (`from` = veces en b, `to` = veces en a). */
function excess(a, b) {
  const out = [];
  for (const [file, keys] of Object.entries(a)) {
    for (const [key, to] of Object.entries(keys)) {
      const from = b[file]?.[key] ?? 0;
      if (to > from) out.push({ file, key, from, to });
    }
  }
  return out;
}

const sum = (entries) => entries.reduce((s, e) => s + e.to - e.from, 0);

function main() {
  const errors = CONFIGS.flatMap(runTsc);
  const current = tally(errors);
  const hasBaseline = existsSync(BASELINE);
  const baseline = hasBaseline ? normalizeBaseline(JSON.parse(readFileSync(BASELINE, "utf8"))) : {};

  const added = excess(current, baseline);
  const fixedCount = sum(excess(baseline, current));

  if (UPDATE) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n", "utf8");
    console.log(
      `\n✓ Baseline actualizado: ${errors.length} errores en ${Object.keys(current).length} ficheros` +
        ` (${fixedCount} resueltos, ${sum(added)} anadidos respecto al anterior)`,
    );
    if (hasBaseline && added.length > 0) {
      console.warn(`⚠ Se han anadido ${sum(added)} errores al baseline: revisa el diff de scripts/typecheck-baseline.json antes de commitear.`);
    }
    return;
  }

  if (!hasBaseline) {
    console.error("\n✗ FAIL: no existe scripts/typecheck-baseline.json. Generalo con `npm run typecheck:baseline`.");
    process.exitCode = 1;
    return;
  }

  if (added.length > 0) {
    const newLines = new Map();
    for (const e of errors) {
      const id = `${e.file}\n${e.key}`;
      if (!newLines.has(id)) newLines.set(id, []);
      newLines.get(id).push(e.line);
    }
    console.error("\n✗ Errores TypeScript nuevos (no estan en scripts/typecheck-baseline.json):\n");
    for (const { file, key, from, to } of added) {
      // Si el mismo error ya estaba en el baseline no se sabe cual de las
      // apariciones es la nueva: se listan todas.
      if (from > 0) console.error(`  ${file}: ${key} (baseline ${from}, ahora ${to})`);
      for (const line of newLines.get(`${file}\n${key}`)) console.error(`  ${from > 0 ? "  " : ""}${line}`);
    }
    const n = sum(added);
    console.error(`\n✗ FAIL: ${n} error${n === 1 ? "" : "es"} TypeScript nuevo${n === 1 ? "" : "s"}. \`npm run typecheck:full\` lista todos los errores.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n✓ PASS: ningun error TypeScript nuevo (${errors.length} conocidos en scripts/typecheck-baseline.json)`);
  if (fixedCount > 0) {
    console.log(`✓ ${fixedCount} errores del baseline ya no aparecen: ejecuta \`npm run typecheck:baseline\` para bajar el liston.`);
  }
}

try {
  main();
} catch (err) {
  console.error(`\n✗ FAIL: ${err.message}`);
  process.exitCode = 1;
}
