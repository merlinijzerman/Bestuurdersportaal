import { COHORTEN } from "@/lib/klantbeeld-data";
import { KlantbeeldHeader } from "../_components/KlantbeeldHeader";
import { DeelnemersSubTabs } from "../_components/SubTabs";
import MaandOntwikkelingClient from "./_components/MaandOntwikkelingClient";

interface Props {
  searchParams: Promise<{ cohort?: string }>;
}

export default async function DeelnemersOntwikkelingPage({ searchParams }: Props) {
  const params = await searchParams;
  const initialAge = params.cohort ? parseInt(params.cohort, 10) : 45;
  const safeAge = Number.isFinite(initialAge) && initialAge >= 18 && initialAge <= 68 ? initialAge : 45;

  return (
    <div className="p-7">
      <KlantbeeldHeader />
      <div className="space-y-6">
        <DeelnemersSubTabs />
        <MaandOntwikkelingClient cohorten={COHORTEN} initialAge={safeAge} />
      </div>
    </div>
  );
}
