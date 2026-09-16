import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  // Emit dist/cli.js (package is "type": "module") instead of cli.mjs.
  fixedExtension: false,
  clean: true,
  // The --init and --doctor templates are read at runtime beside the bundle.
  copy: ["src/INIT_INSTRUCTIONS.md", "src/DOCTOR_INSTRUCTIONS.md"],
  // Dependencies stay external (the default), so dist/cli.js still needs
  // node_modules; mvdan-sh is a 1.4 MB GopherJS bundle not worth inlining.
});
