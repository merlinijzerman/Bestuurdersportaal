import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nodeTestbestanden = [
  "core/lib/redirect-veilig.test.ts",
  "core/lib/vraagtype.test.ts",
  "core/lib/provider-fout.test.ts",
  "core/lib/ai-gateway/gateway.test.ts",
  "core/lib/ai-gateway/secrets.test.ts",
  "platform/lib/aqlab-checks.test.ts",
  "tests/karakterisering/audit-inventaris.test.ts",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          globals: false,
          include: nodeTestbestanden,
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          globals: false,
          include: ["tests/component/**/*.component.test.tsx"],
          setupFiles: ["tests/component/setup.tsx"],
        },
      },
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
        "core/components/AutoGrowTextarea.tsx",
        "core/components/DocumentUploadModal.tsx",
        "core/components/Sidebar.tsx",
        "app/**/_components/Startpunt.tsx",
        "app/**/_components/OnderbouwingPaneel.tsx",
        "app/**/_components/Voortgang.tsx",
        "app/**/_components/StatusOvergangPaneel.tsx",
        "app/**/_components/StapRequirementsPaneel.tsx",
        "app/**/_components/StemrondeBlok.tsx",
        "app/**/_components/BalansInvoerTabel.tsx",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.sanity.ts",
        "**/*.d.ts",
        "**/fixtures/**",
        "**/snapshots/**",
      ],
    },
  },
});
