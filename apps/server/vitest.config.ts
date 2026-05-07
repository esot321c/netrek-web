import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    root: "./",
    include: ["src/**/*.spec.ts", "src/**/*.test.ts"],
    setupFiles: [],
    testTimeout: 15000,
    fileParallelism: false,
  },
  resolve: {},
  esbuild: false,
  oxc: false,
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: {
          decoratorMetadata: true,
          legacyDecorator: true,
        },
      },
    }),
  ],
});
