import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { kitRoutes } from "vite-plugin-kit-routes";
import resolve from "vite-plugin-resolve";

export default defineConfig({
  plugins: [
    kitRoutes(),
    sveltekit(),
    resolve({
      util: "export const inspect = {}",
    }),
  ],
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["@noir-lang/noirc_abi", "@noir-lang/acvm_js"],
    esbuildOptions: {
      target: "esnext",
    },
  },
  ssr: {
    // These are Node.js-only modules used by @repo/contracts/sdk
    // They should only be bundled for SSR, not for client
    external: [
      "@aztec/foundation",
      "@aztec/stdlib",
      "@aztec/kv-store",
      "@aztec/merkle-tree",
    ],
  },
});
