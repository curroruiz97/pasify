#!/usr/bin/env node
// Construye en dist/v1 la web de ANTES de los cambios del 11 de octubre de 2026
// («v1»), para compararla con la actual («v2») con el selector v1/v2.
// Ver compare/README.md.
//
// Va encadenado a `npm run build` y solo hace algo cuando el comparador está
// activado: vista previa de Vercel (VERCEL_ENV=preview) o PASIFY_COMPARE=1.
// En producción sale sin tocar nada.
//
// Cómo se construye v1: se copia `src/` a `.v1/src`, se borran los ficheros que
// nacieron después y se pisan los 38 que cambiaron con su versión antigua
// (compare/v1/files). Esa copia se compila con la misma toolchain, con
// `base: /v1/` y sin service worker, usando las variables de entorno del build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareEnabled, comparePlugin } from "./compare-plugin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!compareEnabled()) {
  console.log("[v1] Omitido: solo se construye en vistas previas de Vercel o con PASIFY_COMPARE=1.");
  process.exit(0);
}

// Con PASIFY_COMPARE=1 (a mano) un fallo corta el build. En una vista previa de
// Vercel solo avisa y el despliegue sigue sin v1: el selector deja su botón apagado.
const estricto = process.env.PASIFY_COMPARE === "1";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "compare", "v1", "manifest.json"), "utf8"));
const trabajo = path.join(root, ".v1");
const salida = path.join(root, "dist", "v1");

function contarFicheros(dir) {
  let n = 0;
  let bytes = 0;
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      const sub = contarFicheros(ruta);
      n += sub.n;
      bytes += sub.bytes;
    } else {
      n += 1;
      bytes += fs.statSync(ruta).size;
    }
  }
  return { n, bytes };
}

try {
  fs.rmSync(trabajo, { recursive: true, force: true });
  fs.mkdirSync(trabajo, { recursive: true });

  fs.cpSync(path.join(root, "src"), path.join(trabajo, "src"), { recursive: true });
  fs.copyFileSync(path.join(root, "index.html"), path.join(trabajo, "index.html"));
  for (const f of manifest.addedInV2) fs.rmSync(path.join(trabajo, f), { force: true });
  for (const f of manifest.modified) {
    const destino = path.join(trabajo, f);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(path.join(root, "compare", "v1", "files", f), destino);
  }
  for (const f of ["tailwind.config.ts", "postcss.config.js", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"]) {
    fs.copyFileSync(path.join(root, f), path.join(trabajo, f));
  }
  // La web de v1 no registra service worker: el de la raíz (v2) no debe cachearla.
  fs.writeFileSync(
    path.join(trabajo, "pwa-register-stub.js"),
    "export function registerSW() { return () => Promise.resolve(); }\n",
  );

  const { build } = await import("vite");
  const react = (await import("@vitejs/plugin-react-swc")).default;

  // Tailwind lee su `content` relativo al directorio actual: hay que escanear
  // `.v1/src` (con los ficheros antiguos), no `src`.
  process.chdir(trabajo);
  await build({
    configFile: false,
    root: trabajo,
    envDir: root,
    mode: "production",
    base: "/v1/",
    publicDir: false,
    define: { __PASIFY_RELEASE__: JSON.stringify(`pasify@v1-${manifest.baselineShort}`) },
    plugins: [react(), comparePlugin({ variant: "v1", root, sha: manifest.baselineShort })],
    resolve: {
      alias: {
        "@": path.join(trabajo, "src"),
        "virtual:pwa-register": path.join(trabajo, "pwa-register-stub.js"),
      },
    },
    optimizeDeps: { entries: ["index.html"] },
    build: { outDir: salida, emptyOutDir: true },
  });
  process.chdir(root);

  const { n, bytes } = contarFicheros(salida);
  console.log(`[v1] Listo: dist/v1 (${n} ficheros, ${(bytes / 1024).toFixed(0)} KiB), base ${manifest.baselineShort}.`);
} catch (err) {
  process.chdir(root);
  fs.rmSync(salida, { recursive: true, force: true });
  console.error(`[v1] ${estricto ? "ERROR" : "AVISO"}: no se pudo construir v1.`, err);
  if (estricto) process.exitCode = 1;
} finally {
  if (process.env.PASIFY_KEEP_V1 !== "1") fs.rmSync(trabajo, { recursive: true, force: true });
}
