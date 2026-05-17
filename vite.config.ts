import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  test: {
    exclude: ["src/.**/**/*", "node_modules/**/*"],
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
});
