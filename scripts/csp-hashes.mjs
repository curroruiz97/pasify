#!/usr/bin/env node
/**
 * Hashes de los <script> en línea de las páginas HTML que sirve Vercel
 * (dist/**\/*.html) y su comprobación contra el `script-src` de la cabecera
 * Content-Security-Policy-Report-Only de vercel.json.
 *
 * La política no admite 'unsafe-inline' en los scripts: cada script en línea
 * (index.html, 404.html y las páginas de public/landing/) entra por su hash.
 * Si se cambia uno de esos scripts, su hash cambia y hay que actualizar el
 * `script-src` de vercel.json; mientras la política sea solo un informe, un
 * hash viejo solo deja un aviso en la consola del navegador.
 *
 *   npm run build
 *   node scripts/csp-hashes.mjs           # lista los hashes y en qué ficheros están
 *   node scripts/csp-hashes.mjs --check   # exit 1 si algún script en línea no tiene su hash en vercel.json
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(raiz, "dist");
const comprobar = process.argv.includes("--check");

if (!fs.existsSync(dist)) {
  console.error("No existe dist/: ejecuta `npm run build` antes.");
  process.exit(2);
}

function* htmls(dir) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* htmls(ruta);
    else if (entrada.name.endsWith(".html")) yield ruta;
  }
}

/** Scripts en línea que el navegador ejecuta (sin `src` y de tipo JavaScript). */
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const EJECUTABLE = /^(|module|text\/javascript|application\/javascript)$/i;

const encontrados = new Map(); // 'sha256-…' -> ficheros
for (const fichero of htmls(dist)) {
  const html = fs.readFileSync(fichero, "utf8");
  for (const [, atributos, cuerpo] of html.matchAll(SCRIPT)) {
    if (/\bsrc\s*=/i.test(atributos)) continue;
    const tipo = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(atributos)?.[1] ?? "";
    if (!EJECUTABLE.test(tipo)) continue;
    // El analizador de HTML cuenta los saltos de línea como \n: el hash se calcula así.
    const hash = `sha256-${createHash("sha256").update(cuerpo.replace(/\r\n?/g, "\n"), "utf8").digest("base64")}`;
    const donde = path.relative(dist, fichero);
    encontrados.set(hash, [...(encontrados.get(hash) ?? []), donde]);
  }
}

const config = JSON.parse(fs.readFileSync(path.join(raiz, "vercel.json"), "utf8"));
const csp = (config.headers ?? [])
  .flatMap((h) => h.headers ?? [])
  .find((h) => /^content-security-policy(-report-only)?$/i.test(h.key));
const scriptSrc =
  csp?.value
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src ")) ?? "";
const enPolitica = new Set([...scriptSrc.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]));

for (const [hash, ficheros] of encontrados) {
  console.log(`'${hash}'  ${enPolitica.has(hash) ? "ok     " : "FALTA  "} ${[...new Set(ficheros)].join(", ")}`);
}
const sobran = [...enPolitica].filter((h) => !encontrados.has(h));
for (const hash of sobran) console.log(`'${hash}'  SOBRA   (ningún script en línea de dist/ lo usa)`);

const faltan = [...encontrados.keys()].filter((h) => !enPolitica.has(h));
if (comprobar && faltan.length > 0) {
  console.error(`\n${faltan.length} script(s) en línea sin su hash en el script-src de vercel.json.`);
  process.exit(1);
}
if (comprobar) console.log(`\nOK: ${encontrados.size} hash(es) y todos están en vercel.json${sobran.length ? ` (${sobran.length} de más)` : ""}.`);
