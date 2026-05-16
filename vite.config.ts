import { defineConfig } from "vite-plus";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {},
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
});
