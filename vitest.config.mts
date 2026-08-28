import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: [
      "core/lib/redirect-veilig.test.ts",
      "core/lib/vraagtype.test.ts",
      "core/lib/provider-fout.test.ts",
      "platform/lib/aqlab-checks.test.ts",
      "tests/karakterisering/audit-inventaris.test.ts",
    ],
    reporters: [
      "default",
      ["json", { outputFile: "coverage/vitest-results.json" }],
    ],
    pool: "threads",
    maxWorkers: 5,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "json", "json-summary", "lcov"],
      include: [
        "core/lib/redirect-veilig.ts",
        "core/lib/vraagtype.ts",
        "core/lib/provider-fout.ts",
        "platform/lib/aqlab/checks/auto-checks.ts",
        "platform/lib/aqlab/evaluation-engine.ts",
        "platform/lib/aqlab/judge.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.sanity.ts",
        "**/*.d.ts",
        "**/fixtures/**",
        "**/snapshots/**",
      ],
    },
  },
});
