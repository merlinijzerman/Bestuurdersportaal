"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  berekenUitslag,
  isDefaultAlternatieven,
  DEFAULT_ALTERNATIEVEN,
  type Alternatief,
  type Uitslag,
  type StemRij,
  type VereisteMeerderheid,
} from "@/core/lib/stemming";

export interface StemData {
  id: string;
  stemgerechtigde_id: string;
  stemgerechtigde_naam: string | null;
  uitgebracht_door: string;
  uitgebracht_door_naam: string | null;
  keuze: string;
  motivering: string | null;
  is_volmacht: boolean;
  volmacht_toelichting: string | null;
}

export interface StemmingData {
  id: string;
  agendapunt_id: string;
  decision_id: string | null;
  vraag: string;
  alternatieven: Alternatief[];
  vereist_quorum: number | null;
  vereiste_meerderheid: VereisteMeerderheid | null;
  status: "open" | "gesloten" | "ingetrokken";
  uitslag: Uitslag | null;
  ingetrokken_reden: string | null;
  geopend_door: string;
}

export interface Bestuurslid {
  id: string;
  naam: string | null;
}

interface Props {
  agendapuntId: string;
  decisionGekoppeld: boolean; // heeft het agendapunt een procedure-stap?
  besluitvraagDefault: string; // pre-fill voor de vraag (uit Decision Object of agendapunt-titel)
  stemming: StemmingData | null;
  stemmen: StemData[];
  huidigeGebruikerId: string;
  magStarten: boolean; // voorzitter/beheerder/aanmaker
  magSluiten: boolean; // starter/voorzitter/beheerder — server toetst opnieuw
  /** T1 bureau-rol (§5.3): `bestuursbureau` neemt niet deel aan de besluitvorming
   *  en brengt dus geen stem uit — ook niet bij volmacht, en daarmee ook geen
   *  dissent (de dissent-dialoog hangt aan een uitgebrachte tegenstem). De ronde,
   *  de voortgang en de uitslag blijven wél zichtbaar: dat is bestuurlijke
   *  informatie die in de notulen belandt en die het bureau nodig heeft.
   *  Default `true`, zodat bestaande aanroepers ongewijzigd blijven werken.
   *  Server toetst opnieuw (POST /api/stemmingen/[id]/stemmen), en RLS hard. */
  magStemmen?: boolean;
  bestuursleden: Bestuurslid[];
  totaalBestuursleden: number;
}

export default function StemrondeBlok({
  agendapuntId,
  decisionGekoppeld,
  besluitvraagDefault,
  stemming,
  stemmen,
  huidigeGebruikerId,
  magStarten,
  magSluiten,
  magStemmen = true,
  bestuursleden,
  totaalBestuursleden,
}: Props) {
  const router = useRouter();
  const [startOpen, setStartOpen] = useState(false);

  return (
    <div className="border border-accent/30 bg-accent-tint rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-ink uppercase tracking-wide flex items-center gap-2">
          <span>🗳</span> Besluitvorming — stemronde
        </div>
        {!stemming && magStarten && (
          <button
            onClick={() => setStartOpen(true)}
            className="bg-accent text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-accent-ink"
          >
            Stemronde starten
          </button>
        )}
      </div>

      {!stemming && (
        <p className="text-xs text-muted">
          {magStarten
            ? "Nog geen stemronde. Start er een om de uitslag formeel vast te leggen."
            : "Nog geen stemronde geopend op dit agendapunt."}
        </p>
      )}

      {stemming?.status === "open" && (
        <StemPaneel
          stemming={stemming}
          stemmen={stemmen}
          huidigeGebruikerId={huidigeGebruikerId}
          magSluiten={magSluiten}
          magStemmen={magStemmen}
          bestuursleden={bestuursleden}
          totaalBestuursleden={totaalBestuursleden}
        />
      )}

      {stemming?.status === "gesloten" && (
        <StemUitslagWeergave
          stemming={stemming}
          decisionGekoppeld={decisionGekoppeld}
          magStemmen={magStemmen}
        />
      )}

      {stemming?.status === "ingetrokken" && (
        <div className="text-xs text-muted italic">
          Deze stemronde is ingetrokken
          {stemming.ingetrokken_reden ? `: ${stemming.ingetrokken_reden}` : "."}
          {magStarten && (
            <button
              onClick={() => setStartOpen(true)}
              className="ml-2 text-ink not-italic font-medium hover:underline"
            >
              Nieuwe stemronde starten
            </button>
          )}
        </div>
      )}

      {startOpen && (
        <StemStartenModal
          agendapuntId={agendapuntId}
          besluitvraagDefault={besluitvraagDefault}
          onClose={() => setStartOpen(false)}
          onGestart={() => {
            setStartOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Stem-paneel (open stemming): stem uitbrengen + live totalen
// ─────────────────────────────────────────────────────────────
function StemPaneel({
  stemming,
  stemmen,
  huidigeGebruikerId,
  magSluiten,
  magStemmen,
  bestuursleden,
  totaalBestuursleden,
}: {
  stemming: StemmingData;
  stemmen: StemData[];
  huidigeGebruikerId: string;
  magSluiten: boolean;
  magStemmen: boolean;
  bestuursleden: Bestuurslid[];
  totaalBestuursleden: number;
}) {
  const router = useRouter();
  const eigenStem = stemmen.find(
    (s) => s.stemgerechtigde_id === huidigeGebruikerId
  );
  const [keuze, setKeuze] = useState<string>(eigenStem?.keuze ?? "");
  const [motivering, setMotivering] = useState(eigenStem?.motivering ?? "");
  const [volmachtModus, setVolmachtModus] = useState(false);
  const [volmachtVoor, setVolmachtVoor] = useState("");
  const [volmachtBevestigd, setVolmachtBevestigd] = useState(false);
  const [volmachtToelichting, setVolmachtToelichting] = useState("");
  const [volmachtKeuze, setVolmachtKeuze] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [sluitBezig, setSluitBezig] = useState(false);
  const [intrekModus, setIntrekModus] = useState(false);
  const [intrekReden, setIntrekReden] = useState("");

  // Live totalen
  const liveUitslag = berekenUitslag(
    stemming.alternatieven,
    stemmen.map<StemRij>((s) => ({
      stemgerechtigde_id: s.stemgerechtigde_id,
      stemgerechtigde_naam: s.stemgerechtigde_naam,
      uitgebracht_door: s.uitgebracht_door,
      uitgebracht_door_naam: s.uitgebracht_door_naam,
      keuze: s.keuze,
      motivering: s.motivering,
      is_volmacht: s.is_volmacht,
      volmacht_toelichting: s.volmacht_toelichting,
    })),
    totaalBestuursleden,
    stemming.vereist_quorum,
    stemming.vereiste_meerderheid
  );

  // Bestuursleden die nog niet hebben gestemd (voor volmacht-dropdown)
  const reedsGestemd = new Set(stemmen.map((s) => s.stemgerechtigde_id));
  const beschikbareVolmachtgevers = bestuursleden.filter(
    (b) => b.id !== huidigeGebruikerId && !reedsGestemd.has(b.id)
  );

  const [dissentPromptOpen, setDissentPromptOpen] = useState(false);

  async function stem() {
    if (!keuze || bezig) return;
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/stemmingen/${stemming.id}/stemmen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keuze, motivering: motivering.trim() || null }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Stem uitbrengen mislukt");
      }
      // Dissent-prompt alleen bij tegen-stem met motivering op default-alternatieven
      // én een gekoppeld Decision Object (anders is er geen dossier om in vast te leggen).
      if (
        keuze === "tegen" &&
        motivering.trim().length > 0 &&
        isDefaultAlternatieven(stemming.alternatieven) &&
        stemming.decision_id
      ) {
        setDissentPromptOpen(true);
        setBezig(false);
        return; // refresh ná de prompt
      }
      router.refresh();
    } catch (e: unknown) {
      setFout(e instanceof Error ? e.message : "Stem uitbrengen mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function volmachtStem() {
    if (!volmachtVoor || !volmachtKeuze || !volmachtBevestigd || bezig) return;
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/stemmingen/${stemming.id}/stemmen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keuze: volmachtKeuze,
          stemgerechtigde_id: volmachtVoor,
          volmacht_bevestigd: true,
          volmacht_toelichting: volmachtToelichting.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Volmachtstem mislukt");
      }
      setVolmachtModus(false);
      setVolmachtVoor("");
      setVolmachtKeuze("");
      setVolmachtBevestigd(false);
      setVolmachtToelichting("");
      router.refresh();
    } catch (e: unknown) {
      setFout(e instanceof Error ? e.message : "Volmachtstem mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function sluit() {
    if (sluitBezig) return;
    if (!confirm("Stemronde sluiten en de uitslag definitief maken?")) return;
    setSluitBezig(true);
    try {
      const res = await fetch(`/api/stemmingen/${stemming.id}/sluiten`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        alert(d.error || "Sluiten mislukt");
        return;
      }
      router.refresh();
    } catch {
      alert("Verbindingsfout");
    } finally {
      setSluitBezig(false);
    }
  }

  async function trekIn() {
    if (intrekReden.trim().length < 10) {
      setFout("Reden verplicht (minimaal 10 tekens)");
      return;
    }
    setSluitBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/stemmingen/${stemming.id}/intrekken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reden: intrekReden.trim() }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setFout(d.error || "Intrekken mislukt");
        return;
      }
      router.refresh();
    } catch {
      setFout("Verbindingsfout");
    } finally {
      setSluitBezig(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-ink">{stemming.vraag}</div>

      {/* T1 bureau-rol (§5.3, FR-6/FR-7): geen stem, en geen zicht op individueel
          stemgedrag of de tussenstand — `stem_uitbrengingen` is voor deze rol
          RLS-afgeschermd, dus de live totalen zouden hier 0 tonen en daarmee
          actief misleiden. De uitslag ná sluiting komt uit `stemmingen` en blijft
          wél zichtbaar (StemUitslagWeergave). */}
      {!magStemmen && (
        <div className="bg-white border border-line rounded-lg p-3 text-xs text-muted leading-relaxed">
          Deze stemronde loopt. Het bestuursbureau neemt niet deel aan de
          besluitvorming; individueel stemgedrag en de tussenstand zijn daarom niet
          zichtbaar. De uitslag verschijnt zodra de stemronde is gesloten.
        </div>
      )}

      {/* Eigen stem */}
      {magStemmen && (
        <div className="bg-white border border-line rounded-lg p-3 space-y-2">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">
            {eigenStem ? "Uw stem (wijzigbaar tot sluiting)" : "Breng uw stem uit"}
          </div>
          <div className="flex flex-wrap gap-2">
            {stemming.alternatieven.map((a) => (
              <button
                key={a.code}
                onClick={() => setKeuze(a.code)}
                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                  keuze === a.code
                    ? "bg-accent text-white border-accent"
                    : "bg-white text-ink border-app-line-strong hover:border-accent"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={motivering}
            onChange={(e) => setMotivering(e.target.value)}
            placeholder="Optionele motivering…"
            className="w-full text-xs border border-line rounded px-2 py-1.5 focus:border-accent outline-none resize-none bg-app-bg"
          />
          <div className="flex justify-end">
            <button
              onClick={stem}
              disabled={!keuze || bezig}
              className="bg-accent text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-accent-ink disabled:opacity-40"
            >
              {bezig ? "Bezig…" : eigenStem ? "Stem bijwerken" : "Stem uitbrengen"}
            </button>
          </div>
        </div>
      )}

      {/* Volmacht */}
      {magStemmen && (!volmachtModus ? (
        beschikbareVolmachtgevers.length > 0 && (
          <button
            onClick={() => setVolmachtModus(true)}
            className="text-xs text-ink hover:underline"
          >
            + Stem namens iemand anders (volmacht)
          </button>
        )
      ) : (
        <div className="bg-white border border-warn/30 rounded-lg p-3 space-y-2">
          <div className="text-[11px] font-semibold text-warn-ink uppercase tracking-wide">
            Volmachtstem
          </div>
          <select
            value={volmachtVoor}
            onChange={(e) => setVolmachtVoor(e.target.value)}
            className="w-full text-sm border border-line rounded px-2 py-1.5 bg-white outline-none focus:border-accent"
          >
            <option value="">— kies bestuurslid —</option>
            {beschikbareVolmachtgevers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.naam || "Onbekend"}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            {stemming.alternatieven.map((a) => (
              <button
                key={a.code}
                onClick={() => setVolmachtKeuze(a.code)}
                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                  volmachtKeuze === a.code
                    ? "bg-warn text-white border-warn/30"
                    : "bg-white text-ink border-app-line-strong hover:border-warn/30"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={volmachtToelichting}
            onChange={(e) => setVolmachtToelichting(e.target.value)}
            placeholder="Hoe is de volmacht verleend? (optioneel)"
            className="w-full text-xs border border-line rounded px-2 py-1.5 focus:border-accent outline-none"
          />
          <label className="flex items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={volmachtBevestigd}
              onChange={(e) => setVolmachtBevestigd(e.target.checked)}
              className="mt-0.5"
            />
            Ik bevestig dat ik gemachtigd ben om namens deze persoon te stemmen.
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setVolmachtModus(false)}
              className="text-xs text-muted hover:text-ink px-2 py-1"
            >
              Annuleren
            </button>
            <button
              onClick={volmachtStem}
              disabled={!volmachtVoor || !volmachtKeuze || !volmachtBevestigd || bezig}
              className="bg-warn text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-warn disabled:opacity-40"
            >
              {bezig ? "Bezig…" : "Volmachtstem registreren"}
            </button>
          </div>
        </div>
      ))}

      {/* Live totalen */}
      {magStemmen && (
        <LiveTotalen uitslag={liveUitslag} alternatieven={stemming.alternatieven} />
      )}

      {/* Uitgebrachte stemmen (open = transparant) */}
      {magStemmen && stemmen.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer font-medium hover:text-ink">
            Uitgebrachte stemmen ({stemmen.length})
          </summary>
          <div className="mt-2 space-y-1">
            {stemmen.map((s) => (
              <div key={s.id} className="flex items-baseline gap-2">
                <span className="font-medium text-ink">
                  {s.stemgerechtigde_naam || "Onbekend"}
                </span>
                {s.is_volmacht && (
                  <span className="text-[10px] text-warn-ink">
                    (volmacht via {s.uitgebracht_door_naam || "?"})
                  </span>
                )}
                <span className="text-muted">
                  {stemming.alternatieven.find((a) => a.code === s.keuze)?.label ?? s.keuze}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {fout && (
        <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded px-2 py-1.5">
          {fout}
        </div>
      )}

      {dissentPromptOpen && stemming.decision_id && (
        <DissentPromptDialog
          decisionId={stemming.decision_id}
          stemmingId={stemming.id}
          standpunt={motivering.trim()}
          onKlaar={() => {
            setDissentPromptOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Sluiten / intrekken */}
      {magSluiten && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-accent/30">
          {!intrekModus ? (
            <>
              <button
                onClick={() => setIntrekModus(true)}
                className="text-xs text-muted hover:text-err-ink"
              >
                Intrekken…
              </button>
              <button
                onClick={sluit}
                disabled={sluitBezig}
                className="bg-ok text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-ok disabled:opacity-40"
              >
                {sluitBezig ? "Sluiten…" : "Stemronde sluiten"}
              </button>
            </>
          ) : (
            <div className="w-full space-y-2">
              <textarea
                rows={2}
                value={intrekReden}
                onChange={(e) => setIntrekReden(e.target.value)}
                placeholder="Reden voor intrekken (minimaal 10 tekens)…"
                className="w-full text-xs border border-line rounded px-2 py-1.5 outline-none focus:border-accent resize-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIntrekModus(false)}
                  className="text-xs text-muted hover:text-ink px-2 py-1"
                >
                  Annuleren
                </button>
                <button
                  onClick={trekIn}
                  disabled={intrekReden.trim().length < 10 || sluitBezig}
                  className="bg-err text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-err disabled:opacity-40"
                >
                  {sluitBezig ? "Bezig…" : "Definitief intrekken"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveTotalen({
  uitslag,
  alternatieven,
}: {
  uitslag: Uitslag;
  alternatieven: Alternatief[];
}) {
  const max = Math.max(1, ...Object.values(uitslag.totalen));
  return (
    <div className="bg-white border border-line rounded-lg p-3 space-y-1.5">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">
        Stand ({uitslag.totaal_stemmen} van {uitslag.totaal_bestuursleden})
      </div>
      {alternatieven.map((a) => {
        const n = uitslag.totalen[a.code] ?? 0;
        return (
          <div key={a.code} className="flex items-center gap-2">
            <span className="text-xs text-ink w-24 truncate">{a.label}</span>
            <div className="flex-1 bg-app-bg rounded h-3 overflow-hidden">
              <div
                className="bg-accent h-3 rounded"
                style={{ width: `${(n / max) * 100}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted w-6 text-right">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Uitslag-weergave (gesloten stemming)
// ─────────────────────────────────────────────────────────────
function StemUitslagWeergave({
  stemming,
  decisionGekoppeld,
  magStemmen,
}: {
  stemming: StemmingData;
  decisionGekoppeld: boolean;
  /** T1 bureau-rol: `false` verbergt het per-persoonsblok. De uitslag zelf
   *  (totalen, quorum, meerderheid, winnaar) blijft zichtbaar — dat is de
   *  bestuurlijke informatie die in de notulen belandt. */
  magStemmen: boolean;
}) {
  const uitslag = stemming.uitslag;
  if (!uitslag) {
    return <div className="text-xs text-muted">Geen uitslag beschikbaar.</div>;
  }
  const winnaarLabel = uitslag.winnend_alternatief
    ? stemming.alternatieven.find((a) => a.code === uitslag.winnend_alternatief)?.label ??
      uitslag.winnend_alternatief
    : "geen eenduidige uitslag";

  const advies = uitslag.besluitregistratie_advies;

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-ink">{stemming.vraag}</div>

      <div className="bg-white border border-line rounded-lg p-3">
        <div className="text-sm font-semibold text-ink mb-1">
          Uitslag: {winnaarLabel}
        </div>
        <LiveTotalen uitslag={uitslag} alternatieven={stemming.alternatieven} />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <StatusPill label="Quorum" status={uitslag.quorum_status} />
        <StatusPill label="Meerderheid" status={uitslag.meerderheid_status} />
      </div>

      {advies === "waarschuwing" && (
        <div className="text-xs text-warn-ink bg-warn-tint border border-warn/30 rounded-lg px-3 py-2">
          Quorum of meerderheid is niet gehaald. Registratie als besluit is mogelijk,
          maar overweeg of dit bestuurlijk verantwoord is.
        </div>
      )}
      {advies === "niet_mogelijk" && (
        <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded-lg px-3 py-2">
          Geen eenduidige uitslag — registratie als besluit wordt afgeraden.
        </div>
      )}

      {/* Per-persoon. T1 bureau-rol (FR-4/G9): `stemmingen.uitslag` bevat een
          BEVROREN kopie van het individuele stemgedrag (naam, keuze, motivering),
          en die tabel is voor het bureau bewust leesbaar omdat de uitslag in de
          notulen hoort. Deze gate haalt het per-persoonsblok weg. LET OP: dit is
          klasse D (UI), geen klasse H — de jsonb blijft via PostgREST leesbaar met
          de eigen anon-key. De structurele afscherming is een openstaand punt
          (OP-T1-7); zie decisions/0128. */}
      {magStemmen && uitslag.per_stemgerechtigde.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer font-medium hover:text-ink">
            Stemmen per bestuurslid ({uitslag.per_stemgerechtigde.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {uitslag.per_stemgerechtigde.map((p, i) => (
              <div key={i} className="border-l-2 border-line pl-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-ink">{p.naam || "Onbekend"}</span>
                  {p.is_volmacht && (
                    <span className="text-[10px] text-warn-ink">
                      (volmacht via {p.uitgebracht_door_naam || "?"})
                    </span>
                  )}
                  <span className="text-muted">
                    {stemming.alternatieven.find((a) => a.code === p.keuze)?.label ?? p.keuze}
                  </span>
                </div>
                {p.motivering && (
                  <div className="text-muted italic mt-0.5">{p.motivering}</div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {decisionGekoppeld && advies !== "niet_mogelijk" && (
        <div className="text-[11px] text-muted">
          Stemverslag is automatisch als bewijsstuk aan de gekoppelde procedure-stap toegevoegd.
        </div>
      )}

      <p className="text-[10px] text-muted leading-relaxed">
        Het systeem rapporteert de ingevoerde quorum- en meerderheidstoets; formele
        rechtsgeldigheid wordt niet zelfstandig vastgesteld. De bestuurlijke beoordeling
        van de uitslag blijft bij het bestuur.
      </p>
    </div>
  );
}

function StatusPill({
  label,
  status,
}: {
  label: string;
  status: string;
}) {
  const kleur =
    status === "gehaald"
      ? "bg-ok-tint text-ok-ink border-ok/30"
      : status === "niet_gehaald"
        ? "bg-err-tint text-err-ink border-err/30"
        : "bg-app-bg text-muted border-line";
  const tekst =
    status === "gehaald"
      ? "gehaald"
      : status === "niet_gehaald"
        ? "niet gehaald"
        : "niet ingesteld";
  return (
    <span className={`px-2 py-0.5 rounded-full border font-medium ${kleur}`}>
      {label}: {tekst}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
//  Start-modal
// ─────────────────────────────────────────────────────────────
function StemStartenModal({
  agendapuntId,
  besluitvraagDefault,
  onClose,
  onGestart,
}: {
  agendapuntId: string;
  besluitvraagDefault: string;
  onClose: () => void;
  onGestart: () => void;
}) {
  const [vraag, setVraag] = useState(besluitvraagDefault);
  const [customMode, setCustomMode] = useState(false);
  const [customAlt, setCustomAlt] = useState<{ code: string; label: string }[]>([
    { code: "varA", label: "Variant A" },
    { code: "varB", label: "Variant B" },
  ]);
  const [quorum, setQuorum] = useState("");
  const [meerderheid, setMeerderheid] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function start() {
    if (!vraag.trim() || bezig) return;
    setBezig(true);
    setFout(null);
    try {
      const body: Record<string, unknown> = {
        agendapunt_id: agendapuntId,
        vraag: vraag.trim(),
      };
      if (customMode) {
        body.alternatieven = customAlt
          .filter((a) => a.code.trim() && a.label.trim())
          .map((a) => ({ code: a.code.trim(), label: a.label.trim() }));
      } else {
        body.alternatieven = DEFAULT_ALTERNATIEVEN;
      }
      if (quorum) body.vereist_quorum = Number(quorum);
      if (meerderheid) body.vereiste_meerderheid = meerderheid;

      const res = await fetch("/api/stemmingen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Stemronde starten mislukt");
      }
      onGestart();
    } catch (e: unknown) {
      setFout(e instanceof Error ? e.message : "Stemronde starten mislukt");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4 my-8">
        <div className="flex items-start justify-between">
          <div className="text-sm font-semibold text-ink">Stemronde starten</div>
          <button onClick={onClose} className="text-muted text-sm hover:text-ink">
            ✕
          </button>
        </div>

        <label className="block">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
            Stemvraag
          </span>
          <textarea
            rows={2}
            value={vraag}
            onChange={(e) => setVraag(e.target.value)}
            className="mt-1 w-full text-sm border border-line rounded px-3 py-2 focus:border-accent outline-none resize-none"
          />
        </label>

        <div>
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">
            Alternatieven
          </div>
          <div className="flex gap-2 text-xs mb-2">
            <button
              onClick={() => setCustomMode(false)}
              className={`px-2 py-1 rounded border ${
                !customMode ? "bg-accent text-white border-accent" : "border-app-line-strong"
              }`}
            >
              Voor / Tegen / Onthouden
            </button>
            <button
              onClick={() => setCustomMode(true)}
              className={`px-2 py-1 rounded border ${
                customMode ? "bg-accent text-white border-accent" : "border-app-line-strong"
              }`}
            >
              Eigen alternatieven
            </button>
          </div>
          {customMode && (
            <div className="space-y-1.5">
              {customAlt.map((a, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    type="text"
                    value={a.label}
                    onChange={(e) => {
                      const next = [...customAlt];
                      next[i] = {
                        label: e.target.value,
                        code: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20) || `opt${i}`,
                      };
                      setCustomAlt(next);
                    }}
                    placeholder={`Alternatief ${i + 1}`}
                    className="flex-1 text-sm border border-line rounded px-2 py-1.5 outline-none focus:border-accent"
                  />
                  {customAlt.length > 2 && (
                    <button
                      onClick={() => setCustomAlt(customAlt.filter((_, j) => j !== i))}
                      className="text-muted hover:text-err-ink px-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setCustomAlt([...customAlt, { code: "", label: "" }])}
                className="text-xs text-ink hover:underline"
              >
                + Alternatief toevoegen
              </button>
              <p className="text-[10px] text-warn-ink">
                Let op: bij eigen alternatieven verschijnt geen automatische dissent-prompt.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              Quorum (optioneel)
            </span>
            <input
              type="number"
              min={1}
              value={quorum}
              onChange={(e) => setQuorum(e.target.value)}
              placeholder="—"
              className="mt-1 w-full text-sm border border-line rounded px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              Meerderheid (optioneel)
            </span>
            <select
              value={meerderheid}
              onChange={(e) => setMeerderheid(e.target.value)}
              className="mt-1 w-full text-sm border border-line rounded px-3 py-2 outline-none focus:border-accent bg-white"
            >
              <option value="">— geen —</option>
              <option value="gewone">Gewone</option>
              <option value="gekwalificeerd_twee_derde">Twee derde</option>
              <option value="unaniem">Unaniem</option>
            </select>
          </label>
        </div>

        {fout && (
          <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded px-3 py-2">
            {fout}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-xs text-muted hover:text-ink px-3 py-1.5">
            Annuleren
          </button>
          <button
            onClick={start}
            disabled={!vraag.trim() || bezig}
            className="bg-accent text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-accent-ink disabled:opacity-40"
          >
            {bezig ? "Starten…" : "Stemronde openen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Dissent-prompt — verschijnt na een tegen-stem (met motivering) op
//  default-alternatieven. Schrijft een decision_dissent gekoppeld aan
//  de stem. Custom alternatieven zijn bewust uitgesloten (§7.5).
// ─────────────────────────────────────────────────────────────
const ZICHTBAARHEID_OPTIES: { code: string; label: string; hint: string }[] = [
  { code: "prive", label: "Privé", hint: "alleen voor uzelf" },
  { code: "gedeelde_zorg", label: "Gedeelde zorg", hint: "zichtbaar voor voorzitter/beheerder" },
  { code: "formele_dissent", label: "Formele dissent", hint: "in het besluitdossier, voor alle bestuurders" },
];

function DissentPromptDialog({
  decisionId,
  stemmingId,
  standpunt,
  onKlaar,
}: {
  decisionId: string;
  stemmingId: string;
  standpunt: string;
  onKlaar: () => void;
}) {
  const [zichtbaarheid, setZichtbaarheid] = useState("gedeelde_zorg");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function leg_vast() {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/dissent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standpunt,
          zichtbaarheid,
          stemming_id: stemmingId,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Dissent vastleggen mislukt");
      }
      onKlaar();
    } catch (e: unknown) {
      setFout(e instanceof Error ? e.message : "Dissent vastleggen mislukt");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
        <div className="text-sm font-semibold text-ink">
          Wilt u dit als dissent vastleggen?
        </div>
        <p className="text-xs text-ink leading-relaxed">
          U stemde tegen met motivering. U kunt dit standpunt vastleggen in het
          besluitdossier zodat het bij de verantwoording hoort.
        </p>
        <div className="bg-app-bg border border-line rounded p-2 text-xs text-ink italic">
          {standpunt}
        </div>
        <div className="space-y-1.5">
          {ZICHTBAARHEID_OPTIES.map((o) => (
            <label key={o.code} className="flex items-start gap-2 text-sm text-ink">
              <input
                type="radio"
                name="zichtbaarheid"
                value={o.code}
                checked={zichtbaarheid === o.code}
                onChange={(e) => setZichtbaarheid(e.target.value)}
                className="mt-0.5"
              />
              <span>
                {o.label}{" "}
                <span className="text-[11px] text-muted">— {o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[10px] text-muted">
          Minderheidsnotitie kan alleen door voorzitter of beheerder worden vastgesteld.
        </p>
        {fout && (
          <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded px-2 py-1.5">
            {fout}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onKlaar}
            className="text-xs text-muted hover:text-ink px-3 py-1.5"
          >
            Niet vastleggen
          </button>
          <button
            onClick={leg_vast}
            disabled={bezig}
            className="bg-accent text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-accent-ink disabled:opacity-40"
          >
            {bezig ? "Vastleggen…" : "Dissent vastleggen"}
          </button>
        </div>
      </div>
    </div>
  );
}
