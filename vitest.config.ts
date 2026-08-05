import { defineConfig } from "vitest/config";

// convex-test roda as functions num ambiente que imita o runtime do Convex.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
  },
});
