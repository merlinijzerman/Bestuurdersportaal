// ============================================================================
//  Scherm 5a — Ad-hoc vraag opslaan als officiële testcase (promotie).
//  Toont de verplichte velden en blokkeert VOORAF wat nog ontbreekt (UX-principe
//  "maak vereisten expliciet"). De bron-run zelf telt niet met terugwerkende
//  kracht mee. Alleen platform-console (platform.aqlab.operate).
// ============================================================================

import Link from "next/link";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { haalPromoveerbareRuns, haalTestsets } from "@/platform/lib/aqlab/console-lees";
import { promoveerActie } from "../acties";

export const dynamic = "force-dynamic";
const CAP = "platform.aqlab.operate";

export default async function PromoveerPagina({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; ontbreekt?: string; fout?: string }>;
}) {
  const { run, ontbreekt, fout } = await searchParams;
  const identiteit = await huidigePlatformIdentiteit();
  if (!(identiteit?.capabilities ?? []).includes(CAP)) {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-sm text-ink/70">Geen toegang. Vereist: <code className="font-mono text-xs">{CAP}</code>.</p>
      </div>
    );
  }

  const svc = createServiceSupabase();
  const [runs, testsets] = await Promise.all([haalPromoveerbareRuns(svc), haalTestsets(svc)]);
  const geselecteerd = run ?? runs[0]?.id ?? "";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/aqlab" className="text-sm text-accent hover:underline">← Terug naar het Lab</Link>
        <h1 className="mt-1 font-serif text-2xl font-bold">Opslaan als testcase</h1>
        <p className="mt-1 text-sm text-ink/70">
          Promoveer een ad-hoc vraag tot een reproduceerbare, formeel meetellende testcase. De oorspronkelijke
          ad-hoc run blijft indicatief en telt zelf niet met terugwerkende kracht mee.
        </p>
      </div>

      {ontbreekt && (
        <p className="rounded-lg border border-warn-tint bg-warn-tint/30 p-3 text-sm text-warn-ink">
          Nog niet compleet — vul eerst: {decodeURIComponent(ontbreekt)}.
        </p>
      )}
      {fout && <p className="rounded-lg border border-err-tint bg-err-tint/30 p-3 text-sm text-err-ink">Fout: {decodeURIComponent(fout)}</p>}

      {runs.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-5 text-sm text-ink/70">
          Geen promoveerbare ad-hoc runs (alleen gepersisteerde, nog niet gepromoveerde ad-hoc runs met een
          opgeslagen vraag komen in aanmerking).
        </p>
      ) : (
        <section className="rounded-xl border border-line bg-white p-5">
          <form action={promoveerActie} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-ink/70">Bron-run (ad-hoc)</span>
              <select name="bron_run_id" defaultValue={geselecteerd} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id.slice(0, 8)} — {(r.ad_hoc_question ?? "").slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Bestaande testset</span>
              <select name="test_set_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
                <option value="">— of maak een nieuwe hieronder —</option>
                {testsets.map((t) => (
                  <option key={t.id} value={t.id}>{t.naam} ({t.code})</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label>
                <span className="mb-1 block text-ink/70">Nieuwe testset-code</span>
                <input name="nieuwe_testset_code" className="w-full rounded-lg border border-line bg-white px-2 py-2 text-sm" placeholder="bijv. BS" />
              </label>
              <label>
                <span className="mb-1 block text-ink/70">Nieuwe testset-naam</span>
                <input name="nieuwe_testset_naam" className="w-full rounded-lg border border-line bg-white px-2 py-2 text-sm" />
              </label>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Testcase-code *</span>
              <input name="code" required className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder="bijv. BS-09" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Titel *</span>
              <input name="titel" required className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Kritikaliteit</span>
              <select name="kritikaliteit" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
                <option value="middel">middel</option>
                <option value="hoog">hoog</option>
                <option value="kritiek">kritiek</option>
                <option value="laag">laag</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Minimale acceptatiescore *</span>
              <input name="minimale_acceptatiescore" type="number" min={0} max={100} defaultValue={80} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="review_verplicht" className="rounded border-line" />
              <span className="text-ink/70">Review verplicht</span>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-ink/70">Verwachte outputvorm *</span>
              <input name="verwachte_outputvorm" required className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder="bijv. aanleiding + voorstel + bronvermelding" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-ink/70">Verplichte onderdelen * (één per regel)</span>
              <textarea name="verplichte_onderdelen" rows={3} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder={"aanleiding\nvoorstel"} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-ink/70">Blokkadecriteria * (criterium-codes, komma-gescheiden)</span>
              <input name="blokkadecriteria" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder="source_id_exists, injection_not_followed" />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                Opslaan als testcase
              </button>
              <p className="mt-2 text-xs text-ink/50">Velden met * zijn verplicht; ontbrekende velden worden vóór opslaan gemeld.</p>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
