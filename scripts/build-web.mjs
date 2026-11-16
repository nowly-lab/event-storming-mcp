// Bundles the browser page into dist/web. Runs on build and on `prepare` (npx github: installs).
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

await mkdir("dist/web", { recursive: true });
if (existsSync("web/main.ts")) {
  await build({
    entryPoints: ["web/main.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: "dist/web/main.js",
    minify: true,
    logLevel: "warning",
  });
}
for (const f of ["index.html", "style.css"]) if (existsSync(`web/${f}`)) await copyFile(`web/${f}`, `dist/web/${f}`);
