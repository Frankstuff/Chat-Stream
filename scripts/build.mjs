import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/renderer", { recursive: true });
await build({
  entryPoints: ["src/main/index.ts", "src/preload.ts"],
  outbase: "src",
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron", "@grpc/grpc-js", "@grpc/proto-loader", "ws"],
});
await build({
  entryPoints: ["src/renderer/app.ts"],
  outfile: "dist/renderer/app.js",
  bundle: true,
  platform: "browser",
  target: "chrome140",
});
for (const name of ["index.html", "style.css"])
  await copyFile(`src/renderer/${name}`, `dist/renderer/${name}`);
