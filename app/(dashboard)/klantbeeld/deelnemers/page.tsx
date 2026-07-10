import { vereisModuleToegang } from "@/lib/module-gate-page";
import { haalCohorten } from "@/lib/klantbeeld-bron";
import { KlantbeeldHeader } from "../_components/KlantbeeldHeader";
import { DeelnemersSubTabs } from "../_components/SubTabs";
import MaandOntwikkelingClient from "./_components/MaandOntwikkelingClient";

interface Props {
  searchParams: Promise<{ cohort?: string }>;
}

export default async function DeelnemersOntwikkelingPage({ searchParams }: Props) {
  // Server-side gate: beschikbaarheid (manifest) + capability + fonds-RLS.
  const { fondsId } = await vereisModuleToegang("klantbeeld", "klantbeeld.view");
  const { cohorten } = await haalCohorten(fondsId);

  const params = await searchParams;
  const initialAge = params.cohort ? parseInt(params.cohort, 10) : 45;
  const safeAge =
    Number.isFinite(initialAge) && initialAge >= 18 && initialAge <= 68 ? initialAge : 45;

  return (
    <div className="p-4 sm:p-6 lg:p-7">
      <KlantbeeldHeader />
      <div className="space-y-6">
        <DeelnemersSubTabs />
        {cohorten.length > 0 ? (
          <MaandOntwikkelingClient cohorten={cohorten} initialAge={safeAge} />
        ) : (
          <div className="bg-white rounded-xl border border-line p-6 text-sm text-muted">
            Nog geen cohort-data beschikbaar voor dit fonds.
          </div>
        )}
      </div>
    </div>
  );
}
