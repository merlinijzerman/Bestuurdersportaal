import Link from "next/link";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { templateLabel } from "@/core/lib/proces-templates";
import {
  DOSSIER_STATUS_LABEL,
  dossierStatusKleur,
  PERIODE_TYPE_LABEL,
  type DossierStatus,
  type PeriodeType,
} from "@/core/lib/dossier";
import {
  READINESS_LABEL,
  READINESS_VOLGORDE,
  type StapStatus,
} from "@/core/lib/decision-view";
import { buildDecisionDossierView } from "@/core/lib/decision";
import { laadFasen, type FaseWeergave } from "@/core/lib/procedure-fasen";
import {
  faseStatus,
  faseAandacht,
  bewijslastDekking,
  aggregeerPortfolio,
  type ProcesSamenvatting,
  type PortfolioAggregaat,
} from "@/core/lib/procedure-fase-status";
import { haalFondsleden, weergaveNaam } from "@/core/lib/fondsleden";
import PortfolioTegels from "./_components/PortfolioTegels";
import FaseStrip, { type FaseSegment } from "./_components/FaseStrip";
import ProcesStatusregel, {
  type Aandachtspunt,
} from "./_components/ProcesStatusregel";

// Deze pagina leidt de fase-status per proces UI-side af (§7.1) uit de
// stap-status en de evidence-unie die het dossier levert. Voor de lopende
// procedures wordt daarvoor per proces het dossier gebouwd — geen server-side
// aggregatie (OB-E5, latere optimalisatie). Live data → geen route-cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ProcedureRij {
  id: string;
  template_code: string;
  titel: string;
  beschrijving: string | null;
  status: string;
  gestart_op: string;
  deadline: string | null;
  periode_type: PeriodeType | null;
  periode_jaar: number | null;
  decision_id: string | null;
}

interface DossierStatusInfo {
  dossierstatus: DossierStatus | null;
  sublabel: string | null;
}

interface StapRij {
  procedure_id: string;
  volgorde: number;
  naam: string;
  status: StapStatus;
  fase_code: string | null;
  herbevestiging_nodig: boolean;
}

// Afgeleide weergave per proces (§7.1).
interface ProcesAfleiding {
  fasen: FaseSegment[];
  stappenAfgerond: number;
  stappenTotaal: number;
  bewijslastPct: number | null;
  aandachtspunten: Aandachtspunt[];
  hordeLabel: string;
  hordeBereikt: boolean;
  samenvatting: ProcesSamenvatting;
}

function formatDatum(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initialen(naam: string): string {
  return naam
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function ProceduresPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id")
    .eq("id", user.id)
    .single();

  const { data: procedures } = await supabase
    .from("procedures")
    .select(
      "id, template_code, titel, beschrijving, status, gestart_op, deadline, periode_type, periode_jaar, decision_id"
    )
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("gestart_op", { ascending: false });

  const lijst = (procedures || []) as ProcedureRij[];

  // Effectieve dossierstatus + sublabel uit de view (afgeleid uit het primaire
  // Decision Object, fallback op procedures.status).
  const statusPerProc = new Map<string, DossierStatusInfo>();
  if (lijst.length > 0) {
    const { data: statusRijen } = await supabase
      .from("vw_dossier_status")
      .select("procedure_id, dossierstatus, sublabel")
      .in(
        "procedure_id",
        lijst.map((p) => p.id)
      );
    for (const r of (statusRijen || []) as Array<
      { procedure_id: string } & DossierStatusInfo
    >) {
      statusPerProc.set(r.procedure_id, {
        dossierstatus: r.dossierstatus,
        sublabel: r.sublabel,
      });
    }
  }
  const effectieveStatus = (id: string): DossierStatus | null =>
    statusPerProc.get(id)?.dossierstatus ?? null;

  // Stappen per procedure (incl. engine-v2-velden: fase_code + herbevestiging).
  const stappenPerProc = new Map<string, StapRij[]>();
  if (lijst.length > 0) {
    const { data: stappen } = await supabase
      .from("procedure_stappen")
      .select(
        "procedure_id, volgorde, naam, status, fase_code, herbevestiging_nodig"
      )
      .in(
        "procedure_id",
        lijst.map((p) => p.id)
      )
      .order("volgorde", { ascending: true });
    for (const s of (stappen || []) as StapRij[]) {
      const lijstS = stappenPerProc.get(s.procedure_id) ?? [];
      lijstS.push(s);
      stappenPerProc.set(s.procedure_id, lijstS);
    }
  }

  // Co-eigenaren (weergavenaam live uit vw_fondsleden, anders de snapshot).
  const eigenarenPerProc = new Map<string, string[]>();
  if (lijst.length > 0) {
    const [{ data: eigenaren }, fondsleden] = await Promise.all([
      supabase
        .from("procedure_eigenaars")
        .select("procedure_id, gebruiker_id, gebruiker_naam")
        .in(
          "procedure_id",
          lijst.map((p) => p.id)
        ),
      haalFondsleden(supabase),
    ]);
    for (const e of (eigenaren || []) as {
      procedure_id: string;
      gebruiker_id: string | null;
      gebruiker_naam: string;
    }[]) {
      const lijstE = eigenarenPerProc.get(e.procedure_id) ?? [];
      lijstE.push(weergaveNaam(e.gebruiker_id, e.gebruiker_naam, fondsleden));
      eigenarenPerProc.set(e.procedure_id, lijstE);
    }
  }

  const isAfgerond = (p: ProcedureRij) => {
    const s = effectieveStatus(p.id) ?? p.status;
    return s === "afgerond" || s === "gearchiveerd";
  };
  const lopend = lijst.filter((p) => !isAfgerond(p));
  const afgerond = lijst.filter((p) => isAfgerond(p));

  // Fasen per (distinct) template van de lopende procedures — de per fonds
  // overschrijfbare titels/beschrijvingen (D8). Fonds-scoping via RLS.
  const templateCodes = Array.from(
    new Set(lopend.map((p) => p.template_code))
  );
  const fasenPerTemplate = new Map<string, FaseWeergave[]>();
  await Promise.all(
    templateCodes.map(async (code) => {
      fasenPerTemplate.set(code, await laadFasen(supabase, code));
    })
  );

  // Per lopend proces met een dossier: evidence + readiness voor de UI-afleiding
  // (§7.1). Dit is de OB-E5-kostenpost — bewust UI-afgeleid, per proces. Faalt
  // een build, dan degradeert de kaart (fase-status blijft uit de stap-status).
  type Dossier = Awaited<ReturnType<typeof buildDecisionDossierView>>;
  const dossierPerProc = new Map<string, Dossier>();
  await Promise.all(
    lopend
      .filter((p) => p.decision_id)
      .map(async (p) => {
        try {
          const d = await buildDecisionDossierView(
            supabase,
            p.decision_id as string
          );
          dossierPerProc.set(p.id, d);
        } catch (e) {
          console.error(`Dossier-afleiding mislukt voor ${p.id}:`, e);
        }
      })
  );

  const afleidingPerProc = new Map<string, ProcesAfleiding>();
  for (const p of lopend) {
    afleidingPerProc.set(
      p.id,
      afleidProces(
        stappenPerProc.get(p.id) ?? [],
        fasenPerTemplate.get(p.template_code) ?? [],
        dossierPerProc.get(p.id) ?? null
      )
    );
  }

  // Portfolio-aggregatie over alle procedures (afgerond telt niet als lopend).
  const samenvattingen: ProcesSamenvatting[] = lijst.map((p) => {
    if (isAfgerond(p)) {
      return {
        isAfgerond: true,
        heeftAandacht: false,
        heeftRood: false,
        besluitrijp: false,
      };
    }
    return (
      afleidingPerProc.get(p.id)?.samenvatting ?? {
        isAfgerond: false,
        heeftAandacht: false,
        heeftRood: false,
        besluitrijp: false,
      }
    );
  });
  const aggregaat: PortfolioAggregaat = aggregeerPortfolio(samenvattingen);

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-ink text-xl font-bold">Processen</h1>
          <p className="text-muted text-sm mt-0.5 max-w-2xl">
            Status per fase is <b>afgeleid</b> uit de onderliggende stappen en
            bewijslast — niet uit een volgorde. Processen lopen parallel: fasen
            kunnen tegelijk lopen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/procedures/nieuw"
            className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent-ink"
          >
            + Nieuwe procedure
          </Link>
        </div>
      </div>

      <PortfolioTegels aggregaat={aggregaat} />

      {/* Legenda fase-status (kleur + woord + vorm). */}
      <div className="flex items-center gap-4 flex-wrap text-[11px] text-muted">
        <span className="uppercase tracking-wide font-semibold">
          Fase-status:
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-ok" /> Afgerond
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-accent" /> In behandeling
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-app-bg border border-line" /> Nog
          niet begonnen
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="relative w-3 h-2 rounded-sm bg-accent">
            <span className="absolute -top-1 right-0 w-2 h-2 rounded-full bg-warn ring-1 ring-white" />
          </span>
          Aandacht
        </span>
      </div>

      <section>
        <div className="text-xs font-bold text-muted uppercase tracking-wider mb-3">
          Lopend ({lopend.length})
        </div>
        {lopend.length === 0 ? (
          <div className="bg-white border border-dashed border-app-line-strong rounded-xl p-8 text-center text-sm text-muted">
            Nog geen lopende procedures. Start hierboven een nieuwe.
          </div>
        ) : (
          <div className="space-y-2">
            {lopend.map((p) => (
              <ProcedureKaart
                key={p.id}
                p={p}
                statusInfo={statusPerProc.get(p.id)}
                eigenaren={eigenarenPerProc.get(p.id) ?? []}
                afleiding={afleidingPerProc.get(p.id) ?? null}
              />
            ))}
          </div>
        )}
      </section>

      {afgerond.length > 0 && (
        <section>
          <div className="text-xs font-bold text-muted uppercase tracking-wider mb-3">
            Afgerond ({afgerond.length})
          </div>
          <div className="space-y-2">
            {afgerond.slice(0, 10).map((p) => (
              <ProcedureKaart
                key={p.id}
                p={p}
                statusInfo={statusPerProc.get(p.id)}
                eigenaren={eigenarenPerProc.get(p.id) ?? []}
                afleiding={null}
                variant="afgerond"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Afleiding (§7.1) ────────────────────────────────────────────────────────

type EvidenceKern = {
  stap_volgorde: number;
  verplicht: boolean;
  blokkerend: boolean;
  vervuld: boolean;
};

function afleidProces(
  stappen: StapRij[],
  fasen: FaseWeergave[],
  dossier: Awaited<ReturnType<typeof buildDecisionDossierView>> | null
): ProcesAfleiding {
  const evidence: EvidenceKern[] = dossier?.evidence ?? [];
  const heeftDossier = dossier !== null;

  // Fase-segmenten in template-volgorde; alleen fasen mét stappen.
  const segmenten: FaseSegment[] = [];
  const segmentVoor = (
    fase_code: string,
    titel: string,
    stappenInFase: StapRij[]
  ): FaseSegment => {
    const volgordes = new Set(stappenInFase.map((s) => s.volgorde));
    const ev = evidence.filter((e) => volgordes.has(e.stap_volgorde));
    const status = faseStatus(stappenInFase);
    return {
      fase_code,
      titel,
      status,
      aandacht: faseAandacht(status, stappenInFase, ev),
    };
  };
  const bekendeCodes = new Set(fasen.map((f) => f.fase_code));
  for (const f of fasen) {
    const stappenInFase = stappen.filter((s) => s.fase_code === f.fase_code);
    if (stappenInFase.length === 0) continue;
    segmenten.push(segmentVoor(f.fase_code, f.titel, stappenInFase));
  }
  // Fail-safe: stappen zonder (bekende) fase tellen ook mee in de aandacht-
  // aggregatie (consistent met de detailpagina's "Overige stappen"-groep).
  const ongegroepeerd = stappen.filter(
    (s) => !s.fase_code || !bekendeCodes.has(s.fase_code)
  );
  if (ongegroepeerd.length > 0) {
    segmenten.push(segmentVoor("—", "Overig", ongegroepeerd));
  }

  const stappenAfgerond = stappen.filter((s) => s.status === "afgerond").length;
  const stappenTotaal = stappen.length;
  const dekking = bewijslastDekking(evidence);
  const bewijslastPct = heeftDossier ? dekking.pct : null;

  // Readiness-horde + besluitrijp.
  let hordeLabel = "Readiness onbekend";
  let hordeBereikt = false;
  let besluitrijp = false;
  if (dossier) {
    const r = dossier.readiness;
    besluitrijp = r.besluitrijp.voldoet;
    if (besluitrijp) {
      hordeLabel = "Besluitrijp ✓";
      hordeBereikt = true;
    } else {
      const eerste = READINESS_VOLGORDE.find((t) => !r[t].voldoet);
      hordeLabel = eerste
        ? `Volgende horde: ${READINESS_LABEL[eerste]}`
        : "Alle niveaus voldoen";
      hordeBereikt = !eerste;
    }
  }

  // Aandachtspunten (§7.1) — heropend/herbevestiging + bewijslast + besluitrijp.
  const aandachtspunten: Aandachtspunt[] = [];
  for (const s of stappen) {
    if (s.status === "heropend") {
      aandachtspunten.push({
        niveau: "oranje",
        tekst: `Stap ${s.volgorde} heropend`,
      });
    } else if (s.herbevestiging_nodig) {
      aandachtspunten.push({
        niveau: "oranje",
        tekst: `Stap ${s.volgorde}: herbevestiging nodig`,
      });
    }
  }
  const heeftRood = segmenten.some((f) => f.aandacht === "rood");
  if (besluitrijp) {
    aandachtspunten.push({ niveau: "ok", tekst: "Klaar voor bestuursbesluit" });
  } else if (heeftRood) {
    aandachtspunten.push({
      niveau: "rood",
      tekst: "Blokkerende bewijslast ontbreekt",
    });
  } else if (bewijslastPct !== null && bewijslastPct < 100) {
    aandachtspunten.push({
      niveau: "oranje",
      tekst: "Verplichte bewijslast ontbreekt",
    });
  }

  const heeftAandacht = segmenten.some((f) => f.aandacht !== "geen");

  return {
    fasen: segmenten,
    stappenAfgerond,
    stappenTotaal,
    bewijslastPct,
    aandachtspunten: aandachtspunten.slice(0, 3),
    hordeLabel,
    hordeBereikt,
    samenvatting: {
      isAfgerond: false,
      heeftAandacht,
      heeftRood,
      besluitrijp,
    },
  };
}

// ── Kaart ───────────────────────────────────────────────────────────────────

function ProcedureKaart({
  p,
  statusInfo,
  eigenaren,
  afleiding,
  variant,
}: {
  p: ProcedureRij;
  statusInfo?: DossierStatusInfo;
  eigenaren: string[];
  afleiding: ProcesAfleiding | null;
  variant?: "afgerond";
}) {
  const dossierstatus =
    statusInfo?.dossierstatus ?? (p.status as DossierStatus);
  const statusLabel = DOSSIER_STATUS_LABEL[dossierstatus] || p.status;
  const sublabel = statusInfo?.sublabel ?? null;
  const periodeLabel = p.periode_type
    ? `${PERIODE_TYPE_LABEL[p.periode_type]}${
        p.periode_jaar ? ` ${p.periode_jaar}` : ""
      }`
    : null;

  return (
    <Link
      href={`/procedures/${p.id}`}
      className={`block bg-white border border-line rounded-xl p-4 hover:border-accent transition-colors ${
        variant === "afgerond" ? "opacity-80" : ""
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-wide text-phase-ink bg-phase-tint px-2 py-0.5 rounded">
              {templateLabel(p.template_code)}
            </span>
            <span
              className={`text-[10px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${dossierStatusKleur(
                dossierstatus
              )}`}
            >
              {statusLabel}
            </span>
            {sublabel && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-warn-tint text-warn-ink border border-warn/30">
                {sublabel}
              </span>
            )}
            {periodeLabel && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-app-bg text-ink border border-line">
                {periodeLabel}
              </span>
            )}
          </div>
          <div className="font-semibold text-ink text-sm">{p.titel}</div>
          {p.beschrijving && (
            <p className="text-xs text-muted mt-0.5 line-clamp-1">
              {p.beschrijving}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {eigenaren.length > 0 && (
            <div className="flex -space-x-2">
              {eigenaren.slice(0, 3).map((n, idx) => (
                <div
                  key={`${p.id}-eigenaar-${idx}`}
                  title={n}
                  className="w-7 h-7 rounded-full bg-phase-tint text-phase-ink text-[10px] flex items-center justify-center font-medium border-2 border-white"
                >
                  {initialen(n)}
                </div>
              ))}
              {eigenaren.length > 3 && (
                <div className="w-7 h-7 rounded-full bg-app-bg text-ink text-[10px] flex items-center justify-center font-medium border-2 border-white">
                  +{eigenaren.length - 3}
                </div>
              )}
            </div>
          )}
          {/* Readiness-horde (§7.1). */}
          {afleiding && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">
                Readiness
              </div>
              <div
                className={`text-xs font-semibold ${
                  afleiding.hordeBereikt ? "text-ok-ink" : "text-accent-ink"
                }`}
              >
                {afleiding.hordeLabel}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fasestrip + tellerregel (§7.1) — alleen op lopende kaarten. */}
      {afleiding && afleiding.fasen.length > 0 && (
        <div className="mt-3 space-y-2">
          <FaseStrip fasen={afleiding.fasen} />
          <ProcesStatusregel
            stappenAfgerond={afleiding.stappenAfgerond}
            stappenTotaal={afleiding.stappenTotaal}
            bewijslastPct={afleiding.bewijslastPct}
            aandachtspunten={afleiding.aandachtspunten}
          />
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted flex-wrap">
        {p.deadline && <span>Deadline {formatDatum(p.deadline)}</span>}
        {p.deadline && <span aria-hidden>·</span>}
        <span>Gestart {formatDatum(p.gestart_op)}</span>
      </div>
    </Link>
  );
}
