// @ts-check
import { defineConfig } from "@vscode/test-cli";

process.env.NODE_ENV = "test";

export default defineConfig({
  files: "out/test/**/*.test.js",
  version: "1.146.0",
  srcDir: "src",
  mocha: {
    ui: "tdd",
    timeout: 20000,
    forbidOnly: !!process.env.CI,
    color: true,
  },
});
