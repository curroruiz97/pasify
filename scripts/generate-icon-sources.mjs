// Genera assets/icon-only.png, icon-foreground.png, icon-background.png
// per @capacitor/assets. Render Pasify wordmark con sharp (rasterizza SVG).
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SIZE = 1024;
const TERRACOTA = "#E8542A";
const CREAM = "#F4EEE2";

// Background pieno terracota (per adaptive icon Android)
const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${TERRACOTA}"/>
</svg>`;

// Helper: "P" Pasify centrata + dot accent. Usa Arial Black (universale,
// stesso glifo su Win/Mac/Linux via metric-compatible fonts) e font-size 900
// per riempire la safe zone (66% di 1024 = 676). La P di Arial Black ha
// cap-height ~0.72 × font-size = ~648 → riempie quasi tutta la safe zone.
const pasifyMark = (textColor) => `
  <text x="512" y="780"
        font-family="'Arial Black', 'Helvetica Black', Arial, sans-serif"
        font-weight="900"
        font-size="900"
        text-anchor="middle"
        fill="${textColor}"
        letter-spacing="-0.04em">P</text>
  <circle cx="760" cy="270" r="55" fill="${textColor}"/>
`;

// Foreground (adaptive icon): solo "P" cream su trasparente, content nella safe zone
const fgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${pasifyMark(CREAM)}
</svg>`;

// Icon-only (legacy + iOS): rounded square terracota + "P" cream
const iconOnlySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="200" fill="${TERRACOTA}"/>
  ${pasifyMark(CREAM)}
</svg>`;

const out = (name) => resolve("assets", name);

await mkdir("assets", { recursive: true });

const writePng = async (svg, name) => {
  const buf = await sharp(Buffer.from(svg)).png().resize(SIZE, SIZE).toBuffer();
  await writeFile(out(name), buf);
  console.log(`✓ assets/${name}`);
};

await writePng(bgSvg, "icon-background.png");
await writePng(fgSvg, "icon-foreground.png");
await writePng(iconOnlySvg, "icon-only.png");
console.log("Done.");
