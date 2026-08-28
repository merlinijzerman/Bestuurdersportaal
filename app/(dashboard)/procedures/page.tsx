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
import { type StapStatus } from "@/core/lib/decision-view";
import { buildDecisionDossierView } from "@/core/lib/decision";
import { laadFasen, type FaseWeergave } from "@/core/lib/procedure-fasen";
import {
  faseStatus,
  faseAandacht,
  bewijslastDekking,
} from "@/core/lib/procedure-fase-status";
import { type FaseSegment } from "./_components/FaseStrip";
import ProcessenOverzicht, {
  type ProcesKaartVM,
  type Aandachtspunt,
} from "./_components/ProcessenOverzicht";

// Deze pagina leidt de fase-status per proces UI-side af (§7.1) uit de
// stap-status en de evidence-unie die het dossier levert. Voor de lopende
// procedures wordt daarvoor per proces het dossier gebouwd — geen server-side
// aggregatie (OB-E5, latere optimalisatie). Live data → geen route-cache.
//
// P1a (#165): de tegels + de twee vaste secties zijn vervangen door één lijst.
// De server bouwt hier een serialiseerbaar view-model per proces; het
// interactieve overzicht (filters, chips, zoek) leeft in ProcessenOverzicht.
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

// Afgeleide weergave per proces (§7.1) — de kaartvelden. Readiness (horde,
// besluitrijp) is bewust uit het overzicht (P1a); de ladder in het dossier
// blijft tot #168.
interface ProcesAfleiding {
  fasen: FaseSegment[];
  stappenAfgerond: number;
  stappenTotaal: number;
  bewijslastPct: number | null;
  aandachtspunten: Aandachtspunt[];
  heeftAandacht: boolean;
  heeftRood: boolean;
}

function formatDatum(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

  const isAfgerond = (p: ProcedureRij) => {
    const s = effectieveStatus(p.id) ?? p.status;
    return s === "afgerond" || s === "gearchiveerd";
  };
  const lopend = lijst.filter((p) => !isAfgerond(p));

  // Fasen per (distinct) template van álle procedures — de per fonds
  // overschrijfbare titels/beschrijvingen (D8). Fonds-scoping via RLS. Ook
  // afgeronde processen krijgen zo hun (groene) fasestrip, zonder dossier-build.
  const templateCodes = Array.from(new Set(lijst.map((p) => p.template_code)));
  const fasenPerTemplate = new Map<string, FaseWeergave[]>();
  await Promise.all(
    templateCodes.map(async (code) => {
      fasenPerTemplate.set(code, await laadFasen(supabase, code));
    })
  );

  // Per lopend proces met een dossier: evidence + bewijslast voor de UI-afleiding
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
  for (const p of lijst) {
    afleidingPerProc.set(
      p.id,
      afleidProces(
        stappenPerProc.get(p.id) ?? [],
        fasenPerTemplate.get(p.template_code) ?? [],
        dossierPerProc.get(p.id) ?? null
      )
    );
  }

  // Serialiseerbaar view-model per proces (server → client).
  const kaarten: ProcesKaartVM[] = lijst.map((p) => {
    const info = statusPerProc.get(p.id);
    const dossierstatus = info?.dossierstatus ?? (p.status as DossierStatus);
    const afl = afleidingPerProc.get(p.id) ?? null;
    return {
      id: p.id,
      templateCode: p.template_code,
      templateLabel: templateLabel(p.template_code),
      titel: p.titel,
      beschrijving: p.beschrijving,
      statusLabel: DOSSIER_STATUS_LABEL[dossierstatus] || p.status,
      statusKleur: dossierStatusKleur(dossierstatus),
      sublabel: info?.sublabel ?? null,
      periodeLabel: p.periode_type
        ? `${PERIODE_TYPE_LABEL[p.periode_type]}${
            p.periode_jaar ? ` ${p.periode_jaar}` : ""
          }`
        : null,
      isAfgerond: isAfgerond(p),
      fasen: afl?.fasen ?? [],
      stappenAfgerond: afl?.stappenAfgerond ?? 0,
      stappenTotaal: afl?.stappenTotaal ?? 0,
      deadlineIso: p.deadline,
      deadlineLabel: p.deadline ? formatDatum(p.deadline) : null,
      gestartLabel: formatDatum(p.gestart_op),
      heeftAandacht: afl?.heeftAandacht ?? false,
      heeftRood: afl?.heeftRood ?? false,
      aandachtspunten: afl?.aandachtspunten ?? [],
    };
  });

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

      <ProcessenOverzicht processen={kaarten} />
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
  const heeftRood = segmenten.some((f) => f.aandacht === "rood");

  // Aandachtspunten (§7.1) — vaste prioriteitsvolgorde, max 3. Eerst de
  // bewijslast (kritiek/vereist; migratieregel blokkerend→kritiek, verplicht→
  // vereist), dan "besloten met openstaande vereisten" (§12 signaal 3, #168), dan
  // heropend/herbevestiging. Readiness/besluitrijp is uit het overzicht (P1a).
  const aandachtspunten: Aandachtspunt[] = [];
  if (heeftRood) {
    aandachtspunten.push({
      niveau: "rood",
      tekst: "Kritieke bewijslast ontbreekt",
    });
  } else if (bewijslastPct !== null && bewijslastPct < 100) {
    aandachtspunten.push({
      niveau: "oranje",
      tekst: "Vereiste bewijslast ontbreekt",
    });
  }
  // Signaal 3 (§12, Q2/0193): dit besluit is genomen terwijl er vereisten
  // openstonden. Bij de brede besluitbevoegdheid is deze zichtbaarheid achteraf
  // het tegenwicht dat vooraf ontbreekt — daarom óók op het overzicht.
  if (
    dossier?.events.some(
      (e) => e.event_type === "besluit_genomen_met_openstaande_vereisten"
    )
  ) {
    aandachtspunten.push({
      niveau: "oranje",
      tekst: "Besloten met openstaande vereisten",
    });
  }
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

  const heeftAandacht = segmenten.some((f) => f.aandacht !== "geen");

  return {
    fasen: segmenten,
    stappenAfgerond,
    stappenTotaal,
    bewijslastPct,
    aandachtspunten: aandachtspunten.slice(0, 3),
    heeftAandacht,
    heeftRood,
  };
}
