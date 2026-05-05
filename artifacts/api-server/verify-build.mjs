import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await esbuild({
  entryPoints: [path.resolve(artifactDir, "verify.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: path.resolve(artifactDir, "dist-verify"),
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
  external: ["*.node", "sharp", "pg-native"],
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: {
    js: `import { createRequire as __cr } from 'node:module'; import __p from 'node:path'; import __u from 'node:url'; globalThis.require = __cr(import.meta.url); globalThis.__filename = __u.fileURLToPath(import.meta.url); globalThis.__dirname = __p.dirname(globalThis.__filename);`,
  },
});
console.log("verify built");
