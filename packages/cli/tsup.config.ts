import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  shims: true,
  // Bundle @keyflare/shared inline — it's private and not published separately.
  // All other dependencies are kept external (installed by the user/npm).
  noExternal: ["@keyflare/shared"],
});
