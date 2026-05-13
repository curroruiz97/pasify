#!/usr/bin/env node
/**
 * Pasify · fix-i18n-mojibake (Fase 4.2)
 *
 * Corrige double-encoding UTF-8 → Latin-1 → UTF-8 en todos los locales
 * (`src/i18n/locales/*.json`). El bug se origina cuando un archivo guardado
 * como UTF-8 se re-abre y guarda como Latin-1/Windows-1252 — cada carácter
 * acentuado (2 bytes en UTF-8) se interpreta como 2 chars Latin-1 y se
 * re-encoda en UTF-8, produciendo secuencias como `Ã©` en lugar de `é`.
 *
 * Estrategia:
 *  - Match `[U+00C2|U+00C3](char)` y recompone el codepoint original:
 *    `((b1 & 0x1F) << 6) | (b2 & 0x3F)`.
 *  - Para el segundo char, soporta tanto Latin-1 directo (U+0080-U+00FF)
 *    como Windows-1252 specials (`€`, `‰`, `Ÿ`, `š`, `œ`, etc.) mapeándolos
 *    a sus bytes 0x80-0x9F equivalentes.
 *  - Idempotente: si vuelves a correrlo sobre archivos limpios, no hace nada.
 *
 * Uso:
 *   node scripts/fix-i18n-mojibake.mjs           # arregla y escribe
 *   node scripts/fix-i18n-mojibake.mjs --check   # falla si encuentra restos
 *
 * Ejecutar en CI vía `npm run i18n:check` (script añadido a package.json).
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, "..", "src", "i18n", "locales");

// Windows-1252 chars 0x80-0x9F que no coinciden con Latin-1.
// Cuando se ven en el archivo, son el segundo byte de una secuencia mojibake;
// los mapeamos al byte físico original.
const W1252_REVERSE = {
  "€": 0x80, // €
  "‚": 0x82, // ‚
  "ƒ": 0x83, // ƒ
  "„": 0x84, // „
  "…": 0x85, // …
  "†": 0x86, // †
  "‡": 0x87, // ‡
  "ˆ": 0x88, // ˆ
  "‰": 0x89, // ‰
  "Š": 0x8A, // Š
  "‹": 0x8B, // ‹
  "Œ": 0x8C, // Œ
  "Ž": 0x8E, // Ž
  "‘": 0x91, // '
  "’": 0x92, // '
  "“": 0x93, // "
  "”": 0x94, // "
  "•": 0x95, // •
  "–": 0x96, // –
  "—": 0x97, // —
  "˜": 0x98, // ˜
  "™": 0x99, // ™
  "š": 0x9A, // š
  "›": 0x9B, // ›
  "œ": 0x9C, // œ
  "ž": 0x9E, // ž
  "Ÿ": 0x9F, // Ÿ
};

/** Detecta sequencias `U+00C2|U+00C3 + (0x80..0xFF | Win1252 special)`. */
const MOJIBAKE_RE = /[ÂÃ]([-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ])/g;

export function fixMojibake(s) {
  return s.replace(MOJIBAKE_RE, (m, second) => {
    const b1 = m.charCodeAt(0);
    const code = second.charCodeAt(0);
    const b2 = code >= 0x80 && code <= 0xFF ? code : W1252_REVERSE[second];
    if (b2 == null || b2 < 0x80) return m;
    const codepoint = ((b1 & 0x1F) << 6) | (b2 & 0x3F);
    if (codepoint < 0x80 || codepoint > 0x7FF) return m;
    return String.fromCodePoint(codepoint);
  });
}

/** Patrones invariantes que NUNCA deben aparecer en archivos limpios. */
export const FORBIDDEN_PATTERNS = [
  /[Ã][-¿]/g, // Ãx
  /[Â][-¿]/g, // Âx
  /[Ã](€|‰|Ÿ|š|„|œ|–|ˆ|‡|Ž|Œ|‚|ƒ|…|†|˜|™|ž|Š|‹|”|“|’|‘|•|—|›)/g, // ÃŸ, Ã‰, etc.
];

export function findRemainingMojibake(s) {
  const hits = [];
  for (const re of FORBIDDEN_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      hits.push({
        index: m.index,
        match: m[0],
        codepoints: [...m[0]].map((c) => "U+" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("+"),
      });
    }
  }
  return hits;
}

const CHECK_ONLY = process.argv.includes("--check");

function main() {
  const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
  let totalFixed = 0;
  let totalFiles = 0;
  let totalRemaining = 0;

  for (const f of files) {
    const path = join(LOCALES_DIR, f);
    const original = readFileSync(path, "utf8");
    const fixed = fixMojibake(original);
    const remaining = findRemainingMojibake(fixed);
    const changed = original !== fixed;
    const diffCount = changed
      ? original.length - fixed.length // mojibake is 2 chars → 1, so length drops
      : 0;

    if (changed && !CHECK_ONLY) {
      writeFileSync(path, fixed, "utf8");
      console.log(`✓ ${f}: fixed (${diffCount} chars collapsed, ${remaining.length} remaining)`);
      totalFiles++;
    } else if (changed && CHECK_ONLY) {
      console.error(`✗ ${f}: ${diffCount} mojibake chars present (run without --check to fix)`);
      totalFixed += diffCount;
    } else if (remaining.length > 0) {
      console.error(`✗ ${f}: ${remaining.length} unknown mojibake patterns remain:`);
      for (const h of remaining.slice(0, 5)) console.error(`    ${h.codepoints} '${h.match}'`);
      totalRemaining += remaining.length;
    } else {
      console.log(`✓ ${f}: clean`);
    }
  }

  if (CHECK_ONLY) {
    if (totalFixed > 0 || totalRemaining > 0) {
      console.error(`\n✗ FAIL: ${totalFixed} fixable + ${totalRemaining} unknown mojibake chars across locales`);
      process.exit(1);
    }
    console.log("\n✓ PASS: all locales are clean UTF-8");
  } else {
    console.log(`\n✓ Done. ${totalFiles} files updated.`);
    if (totalRemaining > 0) {
      console.error(`⚠ ${totalRemaining} unknown patterns remain — inspect manually.`);
      process.exit(1);
    }
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
    fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
