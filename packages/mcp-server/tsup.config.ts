import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  shims: true,
  // Bundle @keyflare/shared inline — it's private and not published separately.
  noExternal: ["@keyflare/shared"],
});
