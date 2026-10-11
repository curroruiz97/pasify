// Plugin de Vite del comparador v1/v2 (ver compare/README.md).
//
// Solo actúa cuando el comparador está activado (vista previa de Vercel o
// PASIFY_COMPARE=1). En producción no añade nada al bundle ni a index.html.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * ¿Está activado el comparador? Mantener igual que `scripts/build-v1.mjs`.
 *   PASIFY_COMPARE=1  → sí (también en local)
 *   PASIFY_COMPARE=0  → no, aunque sea una vista previa
 *   sin definir       → sí solo en vistas previas de Vercel (VERCEL_ENV=preview)
 * La producción (VERCEL_ENV=production) queda fuera a propósito: v1 tiene los
 * fallos que se cerraron el 11 de octubre y no debe servirse en el dominio real.
 */
export function compareEnabled(env = process.env) {
  if (env.PASIFY_COMPARE === "0") return false;
  if (env.PASIFY_COMPARE === "1") return true;
  return env.VERCEL_ENV === "preview";
}

/**
 * Inyecta en index.html el selector v1/v2 y las etiquetas que lo identifican.
 * La build de la raíz (v2) además emite `compare-switcher.<hash>.js`; la de v1
 * solo lo referencia (se sirve desde la raíz). El nombre lleva el hash del
 * contenido porque vercel.json cachea los .js un año como inmutables: así un
 * cambio del selector llega a todos los navegadores.
 */
export function comparePlugin({ variant, root, sha, emitScript = false }) {
  if (!compareEnabled()) return null;
  const source = fs.readFileSync(path.join(root, "scripts", "compare-switcher.js"), "utf8");
  const fileName = `compare-switcher.${crypto.createHash("sha256").update(source).digest("hex").slice(0, 8)}.js`;
  return {
    name: "pasify-compare",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler() {
        const tags = [
          { tag: "meta", attrs: { name: "pasify-variant", content: variant }, injectTo: "head-prepend" },
          { tag: "meta", attrs: { name: "pasify-sha", content: sha }, injectTo: "head-prepend" },
        ];
        if (variant === "v1") {
          tags.push({ tag: "meta", attrs: { name: "robots", content: "noindex" }, injectTo: "head-prepend" });
        }
        tags.push({ tag: "script", attrs: { src: `/${fileName}`, defer: true }, injectTo: "body" });
        return tags;
      },
    },
    generateBundle() {
      if (!emitScript) return;
      this.emitFile({ type: "asset", fileName, source });
    },
  };
}
