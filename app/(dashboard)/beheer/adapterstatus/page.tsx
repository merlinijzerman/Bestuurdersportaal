import { redirect } from "next/navigation";
import { requireCapability } from "@/core/lib/capabilities";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { createServerSupabase } from "@/core/lib/supabase-server";
import type { AdapterBeheerregel } from "@/core/lib/retrieval/adaptermeta-beheer";
import {
  ADAPTERSTATUS_LIMIET,
  leesAdapterstand,
  type MetaBron,
} from "@/core/lib/retrieval/adapterstatus-lezer";

// ============================================================================
//  /beheer/adapterstatus — #434 T4-F, de DAADWERKELIJKE beheerweergave.
// ----------------------------------------------------------------------------
//  De API-route alleen was geen beheerstand: zonder scherm is er niemand die
//  hem leest, en dan bestaat de diagnostiek wel maar ziet niemand haar.
//
//  Deze pagina gebruikt HETZELFDE leespad als de route — `leesAdapterstand()` —
//  en dus dezelfde capabilitypoort, hetzelfde expliciete fondsfilter en dezelfde
//  leeslimiet. Geen tweede implementatie: twee leespaden naast elkaar is precies
//  hoe een scherm iets anders gaat tonen dan de API teruggeeft.
//
//  DE DEKKING STAAT BOVENAAN, NIET ONDERAAN. Is de stand niet volledig, dan zijn
//  de cijfers een ondergrens. Dat moet je zien vóórdat je de tabel leest, niet
//  erna. Hetzelfde geldt voor de REIKWIJDTE: als het fondsbrede leespad niet
//  beschikbaar is, toont deze pagina alleen de eigen beurten van de kijker, en
//  dan mag zij zich geen fondsstand noemen.
// ============================================================================
export const dynamic = "force-dynamic";

/** Alles behalve `naam`; die staat als eerste kolom apart. */
type Telkolom = Exclude<keyof AdapterBeheerregel, "naam">;

const KOLOMMEN: { sleutel: Telkolom; kop: string }[] = [
  { sleutel: "beurten", kop: "Beurten" },
  { sleutel: "treffers", kop: "Treffers" },
  { sleutel: "leeg", kop: "Leeg" },
  { sleutel: "niet_geraadpleegd", kop: "Niet geraadpleegd" },
  { sleutel: "netwerkpogingen", kop: "Netwerkpogingen" },
  { sleutel: "latency_ms", kop: "Latency (ms)" },
  { sleutel: "downloads", kop: "Downloads" },
  { sleutel: "bytes", kop: "Bytes" },
  { sleutel: "throttles", kop: "Throttles" },
  { sleutel: "retries", kop: "Retries" },
  { sleutel: "afwijzingen_totaal", kop: "Afwijzingen" },
  { sleutel: "opgenomen_passages", kop: "Opgenomen passages" },
];

export default async function AdapterstatusPagina() {
  const sessie = await vereisModuleToegang("beheer", "catalog.manage");
  if (!(await requireCapability(sessie.userId, "fonds.config.manage"))) redirect("/beheer");

  const supabase = await createServerSupabase();
  const uitkomst = await leesAdapterstand({
    gebruikerId: sessie.userId,
    fondsId: sessie.fondsId,
    magBeheren: (gebruikerId) => requireCapability(gebruikerId, "fonds.config.manage"),
    bron: supabase as unknown as MetaBron,
  });

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-ink">Adapterstand — retrieval</h1>
        <p className="text-muted text-sm mt-1">
          Wat de bronadapters in de laatste {ADAPTERSTATUS_LIMIET} vastgelegde beurten hebben
          gedaan. Dit is het AUDITSPOOR, niet de stand van nu: er wordt geen bron bevraagd om
          deze pagina te tonen. Er staat geen documentinhoud, geen bestandsnaam en geen
          identifier in — alleen tellingen.
        </p>
      </div>

      {uitkomst.status !== 200 ? (
        <p className="rounded-xl border border-line bg-white px-5 py-4 text-sm text-ink">
          {uitkomst.fout}
        </p>
      ) : (
        <>
          {uitkomst.stand.reikwijdte === "eigen_beurten" && (
            <div role="status" className="mb-6 rounded-xl border border-line bg-white px-5 py-4">
              <div className="font-semibold text-ink">Alleen uw eigen beurten</div>
              <p className="text-sm text-muted mt-0.5">
                Het fondsbrede leespad is op deze omgeving niet beschikbaar. U ziet uitsluitend
                de beurten die u zelf hebt gedaan — beurten van collega&apos;s ontbreken. Dit is
                dus geen fondsstand. Het auditinzagerecht op de volledige logregels
                (<code>governance_audit_read</code>) staat hier bewust los van en is met deze
                pagina niet te verkrijgen.
              </p>
            </div>
          )}

          {!uitkomst.stand.volledig && (
            <div
              role="status"
              className="mb-6 rounded-xl border border-line bg-white px-5 py-4"
            >
              <div className="font-semibold text-ink">Deze stand is niet volledig</div>
              <p className="text-sm text-muted mt-0.5">
                {uitkomst.stand.dekking.metarijen_overgeslagen} logregel(s) en{" "}
                {uitkomst.stand.dekking.adapterrijen_overgeslagen} adapterrij(en) waren niet in
                de vastgelegde vorm leesbaar en zijn overgeslagen. Ze zijn NIET met nullen
                aangevuld — dat zou een werkelijkheid tonen die er niet was. Lees de cijfers
                hieronder daarom als een ondergrens.
              </p>
            </div>
          )}

          <p className="text-sm text-muted mb-4">
            Reikwijdte:{" "}
            {uitkomst.stand.reikwijdte === "fonds" ? "alle beurten van dit fonds" : "alleen uw eigen beurten"}
            {" "}· gelezen: {uitkomst.stand.dekking.metarijen_gelezen} logregel(s) met
            adapterdiagnostiek
            {uitkomst.stand.dekking.metarijen_zonder_adapters > 0 && (
              <>
                {" "}· {uitkomst.stand.dekking.metarijen_zonder_adapters} beurt(en) met één
                adapter (die kennen de sleutel niet en ontbreken dus terecht)
              </>
            )}
            .
          </p>

          {uitkomst.stand.regels.length === 0 ? (
            <p className="rounded-xl border border-line bg-white px-5 py-4 text-sm text-muted">
              Nog geen beurt met meer dan één bronadapter vastgelegd.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-4 py-3 text-left font-semibold text-ink">Adapter</th>
                    {KOLOMMEN.map((k) => (
                      <th
                        key={k.sleutel}
                        className="px-4 py-3 text-right font-semibold text-ink whitespace-nowrap"
                      >
                        {k.kop}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uitkomst.stand.regels.map((regel) => (
                    <tr key={regel.naam} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 text-ink whitespace-nowrap">{regel.naam}</td>
                      {KOLOMMEN.map((k) => (
                        <td key={k.sleutel} className="px-4 py-3 text-right text-muted tabular-nums">
                          {regel[k.sleutel]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
