import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  test: {},
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
});
