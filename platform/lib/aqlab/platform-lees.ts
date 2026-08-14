// ============================================================================
//  AQLab platform-leespaden — één geaudite service-role-poort.
// ----------------------------------------------------------------------------
//  De aqlab_*-tabellen zijn deny-by-default voor gewone sessies. Daarom zijn de
//  console-reads service-role-reads, maar nooit rechtstreeks vanuit een pagina:
//  elke read loopt via withPlatformRead (actieve identiteit + live AAL2 +
//  capability + result-audit). Effectmetadata bevat alleen aantallen/scope.
// ============================================================================

import "server-only";
import { withPlatformRead } from "@/platform/lib/platform-wrapper";
import {
  haalFixtures,
  haalProductieBaseline,
  haalPromoveerbareRuns,
  haalRunDetail,
  haalRunPerformance,
  haalTestcases,
  haalTestsets,
  haalTestsetTellingen,
  haalVergelijking,
  lijstRuns,
  type ProductieBaselineInfo,
} from "@/platform/lib/aqlab/console-lees";
import { haalKwaliteitDashboard } from "@/platform/lib/aqlab/dashboard-lees";
import { haalReleaseConsole } from "@/platform/lib/aqlab/release";

const CAP = "platform.aqlab.operate" as const;

export async function leesAqlabConsole() {
  return withPlatformRead(
    {
      capability: CAP,
      handeling: "aqlab.console.read",
      doelObject: "aqlab",
    },
    async (svc) => {
      const [runs, testsets, testcases, testsetTellingen, fixtures] = await Promise.all([
        lijstRuns(svc),
        haalTestsets(svc),
        haalTestcases(svc),
        haalTestsetTellingen(svc),
        haalFixtures(svc),
      ]);

      const baselineParen = await Promise.all(
        testsets.map(async (t) => [t.id, await haalProductieBaseline(svc, t.id)] as const)
      );
      const baselines: Record<string, ProductieBaselineInfo> = {};
      for (const [id, baseline] of baselineParen) {
        if (baseline) baselines[id] = baseline;
      }

      return {
        resultaat: { runs, testsets, testcases, testsetTellingen, fixtures, baselines },
        effect: {
          runs: runs.length,
          testsets: testsets.length,
          testcases: testcases.length,
          fixtures: fixtures.length,
        },
      };
    }
  );
}

export async function leesAqlabDashboard() {
  return withPlatformRead(
    {
      capability: CAP,
      handeling: "aqlab.dashboard.read",
      doelObject: "aqlab-dashboard",
    },
    async (svc) => {
      const rijen = await haalKwaliteitDashboard(svc);
      return {
        resultaat: rijen,
        effect: { features: rijen.length },
      };
    }
  );
}

export async function leesAqlabPromotie() {
  return withPlatformRead(
    {
      capability: CAP,
      handeling: "aqlab.promotie.read",
      doelObject: "aqlab-promotie",
    },
    async (svc) => {
      const [runs, testsets] = await Promise.all([
        haalPromoveerbareRuns(svc),
        haalTestsets(svc),
      ]);
      return {
        resultaat: { runs, testsets },
        effect: { runs: runs.length, testsets: testsets.length },
      };
    }
  );
}

export async function leesAqlabRun(runId: string) {
  return withPlatformRead(
    {
      capability: CAP,
      handeling: "aqlab.run.read",
      doelObject: runId,
    },
    async (svc, { identiteit }) => {
      const detail = await haalRunDetail(svc, runId);
      const vergelijking = detail.run?.baseline_run_id
        ? await haalVergelijking(svc, runId)
        : null;
      const baselinePerformance = detail.run?.baseline_run_id
        ? await haalRunPerformance(svc, detail.run.baseline_run_id)
        : null;
      const releaseContext = detail.run ? await haalReleaseConsole(svc, runId) : null;

      return {
        resultaat: {
          ...detail,
          vergelijking,
          baselinePerformance,
          releaseContext,
          capabilities: identiteit.capabilities,
        },
        effect: {
          run_gevonden: Boolean(detail.run),
          outputs: detail.outputs.length,
          vergelijking_paren: vergelijking?.paren.length ?? 0,
        },
      };
    }
  );
}
