#!/usr/bin/env node
// Genera compare/v1/: la versión antigua («v1») de los ficheros del front que
// cambiaron entre dos commits. scripts/build-v1.mjs los pone encima de `src/`
// para reconstruir la web tal como era antes de esos cambios.
//
//   node scripts/compare-snapshot.mjs <commit-base> [commit-final=HEAD]
//
// Ejemplo (los cambios del 11 de octubre de 2026):
//   node scripts/compare-snapshot.mjs 75e951e 3b83273
//
// Solo se miran `src/` e `index.html`. `src/integrations/supabase/types.ts` se
// deja fuera: son tipos generados y no cambian lo que ejecuta el navegador.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [baseArg, headArg = "HEAD"] = process.argv.slice(2);
if (!baseArg) {
  console.error("Uso: node scripts/compare-snapshot.mjs <commit-base> [commit-final=HEAD]");
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
const text = (...args) => git(...args).toString("utf8").trim();

const base = text("rev-parse", baseArg);
const head = text("rev-parse", headArg);
const EXCLUIDOS = new Set(["src/integrations/supabase/types.ts"]);

const modified = []; // existían en la base: se restaura su versión antigua (M y D)
const addedInV2 = []; // nacieron después: no existen en v1
const lineas = text("diff", "--no-renames", "--name-status", base, head, "--", "src", "index.html")
  .split("\n")
  .filter(Boolean);
for (const linea of lineas) {
  const [estado, fichero] = linea.split("\t");
  if (EXCLUIDOS.has(fichero)) continue;
  if (estado === "A") addedInV2.push(fichero);
  else modified.push(fichero);
}

const out = path.join(root, "compare", "v1");
fs.rmSync(path.join(out, "files"), { recursive: true, force: true });
let bytes = 0;
for (const f of modified) {
  const contenido = git("show", `${base}:${f}`);
  bytes += contenido.length;
  const destino = path.join(out, "files", f);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      baseline: base,
      baselineShort: base.slice(0, 7),
      generatedAgainst: head,
      modified: modified.sort(),
      addedInV2: addedInV2.sort(),
    },
    null,
    2,
  ) + "\n",
);

console.log(`Base ${base.slice(0, 7)} → ${head.slice(0, 7)}`);
console.log(`  ${modified.length} ficheros con su versión antigua (${(bytes / 1024).toFixed(0)} KiB)`);
console.log(`  ${addedInV2.length} ficheros que v1 no tiene: ${addedInV2.join(", ") || "ninguno"}`);
