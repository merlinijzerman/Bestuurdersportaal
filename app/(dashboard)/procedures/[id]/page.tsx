import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { templateLabel } from "@/core/lib/proces-templates";
import { isBureauRol } from "@/core/lib/bureau-gate";
import {
  DOSSIER_STATUS_LABEL,
  dossierStatusKleur,
  PERIODE_TYPE_LABEL,
  type DossierStatus,
  type PeriodeType,
} from "@/core/lib/dossier";
import DossierTijdlijn from "../_components/DossierTijdlijn";
import StapPaneel from "../_components/StapPaneel";
import FaseRail, { type FaseGroep } from "../_components/FaseRail";
import StapRequirementsPaneel from "../_components/StapRequirementsPaneel";
import VereisteToevoegen from "../_components/VereisteToevoegen";
import DecisionObjectHeader from "../_components/DecisionObjectHeader";
import ClassificatiePanel from "../_components/ClassificatiePanel";
import OnderbouwingsPaneel from "../_components/OnderbouwingsPaneel";
import StatusOvergangPaneel from "../_components/StatusOvergangPaneel";
import UitklapbaarPaneel from "../_components/UitklapbaarPaneel";
import DossierStatusStrip from "../_components/DossierStatusStrip";
import ProcedureMetadataEdit from "../_components/ProcedureMetadataEdit";
import AfschriftenPaneel from "../_components/AfschriftenPaneel";
import { auditEventLabel } from "@/core/lib/audit-labels";
import {
  buildDecisionDossierView,
  ensureDecisionForProcedure,
} from "@/core/lib/decision";
import { laadFasen } from "@/core/lib/procedure-fasen";
import {
  faseStatus,
  faseAandacht,
  bewijslastDekking,
} from "@/core/lib/procedure-fase-status";
import { haalFondsleden, weergaveNaam, initialen } from "@/core/lib/fondsleden";

// Forceer dynamische rendering: deze page leest live data uit Supabase
// (decision-state, readiness, evidence) en mag absoluut niet door de
// Next.js full-route cache lopen — anders blijven readiness-ladder en
// andere panelen op stale waarden hangen na mutaties via router.refresh().
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ProcedureDetail {
  id: string;
  fonds_id: string;
  template_code: string;
  titel: string;
  beschrijving: string | null;
  status: string;
  gestart_op: string;
  deadline: string | null;
  afgerond_op: string | null;
  periode_type: PeriodeType | null;
  periode_start: string | null;
  periode_eind: string | null;
  periode_jaar: number | null;
}

export interface Stap {
  id: string;
  procedure_id: string;
  volgorde: number;
  naam: string;
  beschrijving: string | null;
  vereist_besluit: boolean;
  geschatte_dagen: number | null;
  // Engine v2 (D6): parallel-by-default statusmodel. 'open' is de legacy-waarde
  // (bestaande sequentiële procedures); nieuwe procedures gebruiken
  // 'geblokkeerd' voor nog-niet-activeerbare stappen. 'heropend' telt als actief.
  status: "open" | "geblokkeerd" | "actief" | "afgerond" | "heropend";
  eigenaar_naam: string | null;
  deadline: string | null;
  voltooid_op: string | null;
  voltooid_door: string | null;
  // Engine v2 (D6/D8): meegesnapshot bij start.
  fase_code: string | null;
  blokkerende_afhankelijkheden: number[];
  herbevestiging_nodig: boolean;
  heropend_op: string | null;
}

export interface ChecklistItem {
  id: string;
  stap_id: string;
  volgorde: number;
  label: string;
  bewijs_vereist: boolean;
  voldaan: boolean;
  voldaan_op: string | null;
  voldaan_door_naam: string | null;
  // WO-2 (D7): herkomst — 'handmatig' voor een tijdens de looptijd toegevoegd
  // punt (zichtbaar gemaakt voor audit-transparantie).
  bron?: "template" | "handmatig";
}

export interface Bewijs {
  id: string;
  stap_id: string;
  titel: string;
  beschrijving: string | null;
  toegevoegd_op: string;
  toegevoegd_door_naam: string | null;
}

export interface Besluit {
  id: string;
  procedure_id: string;
  stap_id: string | null;
  formulering: string;
  motivering: string | null;
  datum: string;
  vastgelegd_door_naam: string | null;
  verworpen_alternatieven: string[] | null;
}

export interface KomendeVergadering {
  id: string;
  titel: string;
  datum: string;
  locatie: string | null;
}

export interface GekoppeldAgendapunt {
  id: string;
  titel: string;
  procedure_stap_id: string;
  vergadering_id: string;
  vergadering_titel: string;
  vergadering_datum: string;
}

interface LogEvent {
  id: string;
  event_type: string;
  actor_naam: string | null;
  payload: Record<string, unknown>;
  tijdstip: string;
}

function formatDatum(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
}

function formatDatumTijd(d: string) {
  return new Date(d).toLocaleString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// F2: labels voor béíde auditsporen komen nu uit core/lib/audit-labels
// (auditEventLabel), zodat UI en export dezelfde taal spreken.
interface SamengevoegdEvent {
  id: string;
  spoor: "proces" | "besluit";
  event_type: string;
  actor_naam: string | null;
  tijdstip: string;
  besluitCode: string | null;
  hash: string | null;
  proces_payload: Record<string, unknown> | null;
}

function dagenTot(deadline: string): number {
  const dl = new Date(deadline);
  const nu = new Date();
  return Math.ceil((dl.getTime() - nu.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function ProcedureDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stap?: string }>;
}) {
  const { id } = await params;
  const { stap: stapParam } = await searchParams;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: procRaw } = await supabase
    .from("procedures")
    .select("*")
    .eq("id", id)
    .single();

  if (!procRaw) notFound();
  const procedure = procRaw as ProcedureDetail;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id, rol")
    .eq("id", user.id)
    .single();
  const currentUserIsPrivileged =
    profiel?.rol === "voorzitter" || profiel?.rol === "beheerder";
  // T1 bureau-rol (§5.3): geen dissent vastleggen. UI-cosmetica; de weigering
  // staat in de dissent-routes en in de RLS-schrijfpolicy.
  const currentUserIsBureau = isBureauRol(profiel?.rol);

  const [stappenRes, eigenarenRes, logRes, besluitenRes, vergaderingenRes] =
    await Promise.all([
      supabase
        .from("procedure_stappen")
        .select("*")
        .eq("procedure_id", id)
        .order("volgorde", { ascending: true }),
      supabase
        .from("procedure_eigenaars")
        .select("gebruiker_id, gebruiker_naam")
        .eq("procedure_id", id),
      supabase
        .from("procedure_log")
        .select("id, event_type, actor_naam, payload, tijdstip")
        .eq("procedure_id", id)
        .order("tijdstip", { ascending: false }),
      supabase
        .from("procedure_besluiten")
        .select("*")
        .eq("procedure_id", id)
        .order("datum", { ascending: false }),
      supabase
        .from("vergaderingen")
        .select("id, titel, datum, locatie")
        .eq("fonds_id", profiel?.fonds_id || "")
        .gte("datum", new Date().toISOString())
        .order("datum", { ascending: true }),
    ]);

  const stappen = (stappenRes.data || []) as Stap[];
  // Weergavenaam live uit vw_fondsleden waar een account bekend is; anders de
  // bevroren snapshot (co-eigenaar zonder account, of view nog niet gemigreerd).
  const fondsleden = await haalFondsleden(supabase);
  const eigenaren = (eigenarenRes.data || []).map(
    (e: { gebruiker_id: string | null; gebruiker_naam: string }) =>
      weergaveNaam(e.gebruiker_id, e.gebruiker_naam, fondsleden)
  );
  const log = (logRes.data || []) as LogEvent[];
  const besluiten = (besluitenRes.data || []) as Besluit[];
  const komendeVergaderingen = (vergaderingenRes.data ||
    []) as KomendeVergadering[];

  // Checklist en bewijs voor alle stappen ophalen (één call elk)
  const stapIds = stappen.map((s) => s.id);
  const [checklistRes, bewijsRes] = await Promise.all([
    stapIds.length > 0
      ? supabase
          .from("procedure_checklist")
          .select("*")
          .in("stap_id", stapIds)
          .order("volgorde", { ascending: true })
      : Promise.resolve({ data: [] }),
    stapIds.length > 0
      ? supabase
          .from("procedure_bewijs")
          .select("*")
          .in("stap_id", stapIds)
          .order("toegevoegd_op", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const checklist = (checklistRes.data || []) as ChecklistItem[];
  const bewijs = (bewijsRes.data || []) as Bewijs[];

  // Effectieve dossierstatus (afgeleid uit primair Decision Object, of
  // fallback op procedures.status) + dossierbreed gekoppelde documenten.
  const [statusViewRes, dossierDocsRes] = await Promise.all([
    supabase
      .from("vw_dossier_status")
      .select("dossierstatus, sublabel, afgeleid_van_decision")
      .eq("procedure_id", id)
      .maybeSingle(),
    supabase
      .from("documenten")
      .select("id, titel")
      .eq("procesinstantie_id", id),
  ]);
  const statusView = statusViewRes.data as {
    dossierstatus: DossierStatus | null;
    sublabel: string | null;
    afgeleid_van_decision: boolean;
  } | null;
  const dossierstatus: DossierStatus | null =
    statusView?.dossierstatus ?? (procedure.status as DossierStatus);
  const dossierSublabel = statusView?.sublabel ?? null;
  const dossierDocumenten = (dossierDocsRes.data || []) as {
    id: string;
    titel: string;
  }[];
  const periodeLabel = procedure.periode_type
    ? `${PERIODE_TYPE_LABEL[procedure.periode_type]}${
        procedure.periode_jaar ? ` ${procedure.periode_jaar}` : ""
      }`
    : null;

  // Gekoppelde agendapunten ophalen (per stap), met vergadering-info erbij
  const gekoppeldeAgendapunten: GekoppeldAgendapunt[] = [];
  if (stapIds.length > 0) {
    const { data: koppelingen } = await supabase
      .from("agendapunten")
      .select("id, titel, procedure_stap_id, vergadering_id, vergaderingen(titel, datum)")
      .in("procedure_stap_id", stapIds);
    for (const a of (koppelingen || []) as Array<{
      id: string;
      titel: string;
      procedure_stap_id: string;
      vergadering_id: string;
      vergaderingen:
        | { titel: string; datum: string }
        | { titel: string; datum: string }[]
        | null;
    }>) {
      const v = Array.isArray(a.vergaderingen)
        ? a.vergaderingen[0]
        : a.vergaderingen;
      gekoppeldeAgendapunten.push({
        id: a.id,
        titel: a.titel,
        procedure_stap_id: a.procedure_stap_id,
        vergadering_id: a.vergadering_id,
        vergadering_titel: v?.titel ?? "Vergadering",
        vergadering_datum: v?.datum ?? "",
      });
    }
  }

  // D6: parallel-by-default — er kunnen meerdere stappen tegelijk actief zijn.
  // 'heropend' telt als actief (§4.3). Voor de meta-strook nemen we de eerste
  // actieve als representatief; de rail toont ze allemaal.
  const actieveStappen = stappen.filter(
    (s) => s.status === "actief" || s.status === "heropend"
  );
  const actieveStap = actieveStappen[0] ?? null;
  const afgerondAantal = stappen.filter((s) => s.status === "afgerond").length;
  const totaalStappen = stappen.length;

  // T6-1A: welke stap staat in het rechterpaneel? Selectie via ?stap=<id>
  // (server-first, past bij het force-dynamic + router.refresh()-patroon).
  // Default = de actieve stap; ontbreekt die, dan de laatst afgeronde; anders
  // de eerste stap. Alleen de actieve stap is bewerkbaar — al het andere is
  // leesmodus (inzage in afgeronde/nog niet gestarte stappen).
  const laatstAfgerondeStap = [...stappen]
    .reverse()
    .find((s) => s.status === "afgerond");
  const geselecteerdeStap =
    stappen.find((s) => s.id === stapParam) ??
    actieveStap ??
    laatstAfgerondeStap ??
    stappen[0] ??
    null;
  const geselecteerdeIsBewerkbaar =
    geselecteerdeStap != null &&
    (geselecteerdeStap.status === "actief" ||
      geselecteerdeStap.status === "heropend");
  const geselecteerdeVoltooidDoorNaam =
    geselecteerdeStap?.voltooid_door
      ? fondsleden.get(geselecteerdeStap.voltooid_door)?.naam ?? null
      : null;

  // Decision Object — lazy auto-upgrade voor procedures zonder dossier.
  // Faalt deze stap (RLS / DB-fout), dan tonen we het dossier-blok niet
  // maar blijft de rest van de pagina werken.
  let dossier:
    | Awaited<ReturnType<typeof buildDecisionDossierView>>
    | null = null;
  try {
    const { decision_id, auto_upgraded } = await ensureDecisionForProcedure(
      supabase,
      id
    );
    dossier = await buildDecisionDossierView(supabase, decision_id, {
      autoUpgraded: auto_upgraded,
    });
  } catch (e) {
    console.error("Dossier laden mislukt:", e);
  }

  // WO-2 (§7 + §7.1): procesfasen-rail. De fasen (D8) komen uit de definitie
  // met een per fonds overschrijfbare beschrijving; de fase-status, aandachts-
  // vlag en bewijslast-dekking worden UI-afgeleid uit de stap-status en de
  // evidence-unie (template + instantie, D7c) die het dossier al levert.
  const fasen = await laadFasen(supabase, procedure.template_code);
  // Evidence per stap-volgorde (leeg als het dossier niet laadde).
  const evidence = dossier?.evidence ?? [];
  const stappenPerFase = new Map<string, Stap[]>();
  const ongegroepeerdeStappen: Stap[] = [];
  for (const s of stappen) {
    if (s.fase_code && fasen.some((f) => f.fase_code === s.fase_code)) {
      const lijst = stappenPerFase.get(s.fase_code) ?? [];
      lijst.push(s);
      stappenPerFase.set(s.fase_code, lijst);
    } else {
      ongegroepeerdeStappen.push(s);
    }
  }
  const evidenceVoorStappen = (stappenInFase: Stap[]) => {
    const volgordes = new Set(stappenInFase.map((s) => s.volgorde));
    return evidence.filter((e) => volgordes.has(e.stap_volgorde));
  };
  const bouwGroep = (
    fase_code: string,
    titel: string,
    beschrijving: string | null,
    is_override: boolean,
    stappenInFase: Stap[]
  ): FaseGroep => {
    const ev = evidenceVoorStappen(stappenInFase);
    const status = faseStatus(stappenInFase);
    return {
      fase_code,
      titel,
      beschrijving,
      is_override,
      status,
      dekking: bewijslastDekking(ev),
      aandacht: faseAandacht(status, stappenInFase, ev),
      stappen: stappenInFase,
    };
  };
  const faseGroepen: FaseGroep[] = fasen
    .map((f) =>
      bouwGroep(
        f.fase_code,
        f.titel,
        f.beschrijving,
        f.is_override,
        stappenPerFase.get(f.fase_code) ?? []
      )
    )
    // Fasen zonder stappen tonen we niet (defensief; hoort niet voor te komen).
    .filter((g) => g.stappen.length > 0);
  // Stappen zonder (bekende) fase — fail-safe zichtbaar houden, niet verbergen.
  if (ongegroepeerdeStappen.length > 0) {
    faseGroepen.push(
      bouwGroep("—", "Overige stappen", null, false, ongegroepeerdeStappen)
    );
  }

  // F2: het audit-trail-paneel toont voortaan BEIDE auditsporen. procedure_log
  // (spoor 'proces') werd al getoond; governance_events (spoor 'besluit', mét
  // hash) — aannames, risico's, dissent, statusovergangen — bleef onzichtbaar.
  // Hier samengevoegd op tijdstip (aflopend) via de gedeelde labelmap.
  const auditTrail: SamengevoegdEvent[] = [
    ...log.map((e) => ({
      id: `p-${e.id}`,
      spoor: "proces" as const,
      event_type: e.event_type,
      actor_naam: e.actor_naam,
      tijdstip: e.tijdstip,
      besluitCode: null,
      hash: null,
      proces_payload: e.payload,
    })),
    ...(dossier?.events ?? []).map((e) => ({
      id: `b-${e.id}`,
      spoor: "besluit" as const,
      event_type: e.event_type,
      actor_naam: e.actor_naam,
      tijdstip: e.tijdstip,
      besluitCode: dossier?.decision.besluit_code ?? null,
      hash: e.hash,
      proces_payload: null,
    })),
  ].sort((a, b) => (a.tijdstip < b.tijdstip ? 1 : -1));

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-6">
      <Link
        href="/procedures"
        className="text-sm text-muted hover:text-ink inline-flex items-center gap-1"
      >
        ← Terug naar procedures
      </Link>

      {/* Decision Object — boven de procedure-header zodat het dossier
          duidelijk leidend is en de procedure secundair (workflow). */}
      {dossier && (
        <DecisionObjectHeader
          decision={dossier.decision}
          autoUpgraded={dossier.auto_upgraded}
        />
      )}

      {/* Compacte dossier-status-strip onder de banner: huidige status,
          eerstvolgende readiness-horde, en een knop naar het uitklapbare
          status-overgang-paneel onderin. Voorkomt dat de gebruiker eerst
          het hele dossier moet doorscrollen om te weten waar het staat. */}
      {dossier && (
        <DossierStatusStrip
          decision={dossier.decision}
          readiness={dossier.readiness}
          statusOvergangAnker="status-overgang"
          heeftSnapshot={dossier.snapshots.length > 0}
        />
      )}

      {/* Besluit 0151 — instap naar de AI-assistent in de context van dit dossier.
          Opent /ai met een module-scope (proces); de reikwijdte + fase komen als
          benoemde context mee en de gekoppelde bewijsstukken worden doorzocht. */}
      <Link
        href={`/ai?proces=${procedure.id}`}
        className="inline-flex items-center gap-2 rounded-xl border border-accent bg-accent/5 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10 transition-colors"
      >
        <span aria-hidden>✨</span>
        Bespreek dit proces met de AI
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[11px] font-medium uppercase tracking-wide text-phase-ink bg-phase-tint px-2 py-0.5 rounded">
            {templateLabel(procedure.template_code)}
          </span>
          <span
            className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${dossierStatusKleur(
              dossierstatus
            )}`}
          >
            {(dossierstatus && DOSSIER_STATUS_LABEL[dossierstatus]) ||
              procedure.status}
          </span>
          {dossierSublabel && (
            <span className="text-[11px] font-medium uppercase tracking-wide border border-warn/30 bg-warn-tint text-warn-ink px-2 py-0.5 rounded">
              {dossierSublabel}
            </span>
          )}
          {periodeLabel && (
            <span className="text-[11px] font-medium uppercase tracking-wide border border-line bg-app-bg text-ink px-2 py-0.5 rounded">
              {periodeLabel}
            </span>
          )}
          {statusView?.afgeleid_van_decision && (
            <span className="text-[11px] text-muted">
              afgeleid uit Decision Object
            </span>
          )}
        </div>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <h1 className="font-serif text-ink text-2xl font-semibold">
            {procedure.titel}
          </h1>
          <ProcedureMetadataEdit
            procedureId={procedure.id}
            titel={procedure.titel}
            beschrijving={procedure.beschrijving}
            deadline={procedure.deadline}
            status={procedure.status}
          />
        </div>
        {procedure.beschrijving && (
          <p className="text-sm text-muted mt-1.5 max-w-3xl whitespace-pre-line">
            {procedure.beschrijving}
          </p>
        )}
      </div>

      {/* Meta-strook */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white border border-line rounded-xl p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Co-eigenaars
          </div>
          {eigenaren.length === 0 ? (
            <div className="text-sm text-muted italic mt-2">
              Geen toegewezen
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex -space-x-2">
                {eigenaren.slice(0, 3).map((n: string, idx: number) => (
                  <div
                    key={idx}
                    title={n}
                    className="w-8 h-8 rounded-full bg-phase-tint text-phase-ink text-xs flex items-center justify-center font-medium border-2 border-white"
                  >
                    {initialen(n)}
                  </div>
                ))}
                {eigenaren.length > 3 && (
                  <div className="w-8 h-8 rounded-full bg-app-bg text-ink text-xs flex items-center justify-center font-medium border-2 border-white">
                    +{eigenaren.length - 3}
                  </div>
                )}
              </div>
              <span className="text-sm text-ink">
                {eigenaren.slice(0, 2).join(", ")}
                {eigenaren.length > 2 && ` +${eigenaren.length - 2}`}
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Voortgang
          </div>
          <div className="text-sm text-ink mt-2 font-medium">
            {afgerondAantal} van {totaalStappen} afgerond
          </div>
          <div className="w-full h-1.5 bg-app-bg rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full bg-accent"
              style={{
                width: `${
                  totaalStappen > 0
                    ? (afgerondAantal / totaalStappen) * 100
                    : 0
                }%`,
              }}
            />
          </div>
          {actieveStappen.length > 0 && (
            <div className="text-xs text-muted mt-1">
              {actieveStappen.length === 1
                ? "1 stap actief"
                : `${actieveStappen.length} stappen lopen parallel (${actieveStappen
                    .map((s) => s.volgorde)
                    .join("·")})`}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Deadline
          </div>
          {procedure.deadline ? (
            <>
              <div className="text-sm text-ink font-medium mt-2">
                {formatDatum(procedure.deadline)}
              </div>
              <div className="text-xs text-muted">
                {(() => {
                  const d = dagenTot(procedure.deadline);
                  if (d < 0) return `${Math.abs(d)} dagen verstreken`;
                  if (d === 0) return "Vandaag";
                  return `Nog ${d} dagen`;
                })()}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted italic mt-2">
              Geen deadline
            </div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Gestart op
          </div>
          <div className="text-sm text-ink font-medium mt-2">
            {formatDatum(procedure.gestart_op)}
          </div>
        </div>
      </div>

      {/* Dossier-tijdlijn: zes generieke fases met stappen + gekoppelde
          documenten onder de juiste fase (acceptatiecriterium 2). */}
      <DossierTijdlijn
        stappen={stappen.map((s) => ({
          id: s.id,
          volgorde: s.volgorde,
          naam: s.naam,
          // De tijdlijn kent het oudere drieluik open/actief/afgerond; map de
          // engine-v2-statussen daarop (heropend telt als actief, geblokkeerd
          // als open).
          status:
            s.status === "afgerond"
              ? ("afgerond" as const)
              : s.status === "actief" || s.status === "heropend"
                ? ("actief" as const)
                : ("open" as const),
        }))}
        bewijs={bewijs.map((b) => ({
          id: b.id,
          stap_id: b.stap_id,
          titel: b.titel,
        }))}
        dossierDocumenten={dossierDocumenten}
      />

      {/* Body */}
      <div className="grid grid-cols-12 gap-5">
        {/* Step rail */}
        <div className="col-span-12 lg:col-span-4">
          <div className="bg-white border border-line rounded-xl p-5 sticky top-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs uppercase tracking-wide text-muted font-semibold">
                Procesfasen
              </div>
              <div className="text-[11px] text-muted">
                {totaalStappen} stappen · {faseGroepen.length} fasen
              </div>
            </div>
            {actieveStappen.length > 1 && (
              <p className="text-[11px] text-muted mb-3 leading-snug">
                {actieveStappen.length} stappen lopen parallel — dit proces kent
                geen vaste volgorde; fasen kunnen tegelijk lopen.
              </p>
            )}
            {/* WO-2 (§7): fasen-rail met per-fase status-pill + bewijslast-
                dekkingsmeter en meerdere gelijktijdig actieve stappen. Elke
                stap opent in het rechterpaneel (leesmodus voor niet-actieve
                stappen). */}
            <FaseRail
              fasen={faseGroepen}
              geselecteerdeStapId={geselecteerdeStap?.id ?? null}
            />
          </div>
        </div>

        {/* Active step + log */}
        <div className="col-span-12 lg:col-span-8 space-y-5">
          {procedure.status === "afgerond" && (
            <div className="bg-ok-tint border border-ok/30 rounded-xl p-4">
              <div className="text-sm font-semibold text-ok-ink">
                Procedure is afgerond
              </div>
              <div className="text-xs text-ok-ink mt-1">
                Afgerond op{" "}
                {procedure.afgerond_op
                  ? formatDatum(procedure.afgerond_op)
                  : "(datum onbekend)"}
                . Alle stappen zijn voltooid — je bekijkt ze hieronder in
                leesmodus.
              </div>
            </div>
          )}
          {geselecteerdeStap ? (
            <StapPaneel
              procedureId={procedure.id}
              stap={geselecteerdeStap}
              alleenLezen={!geselecteerdeIsBewerkbaar}
              kanBeheren={currentUserIsPrivileged}
              voltooidDoorNaam={geselecteerdeVoltooidDoorNaam}
              checklist={checklist.filter(
                (c) => c.stap_id === geselecteerdeStap.id
              )}
              bewijs={bewijs.filter((b) => b.stap_id === geselecteerdeStap.id)}
              besluit={
                besluiten.find((b) => b.stap_id === geselecteerdeStap.id) ?? null
              }
              komendeVergaderingen={komendeVergaderingen}
              gekoppeldeAgendapunten={gekoppeldeAgendapunten.filter(
                (a) => a.procedure_stap_id === geselecteerdeStap.id
              )}
              documentRequirements={
                // 1D-4: documenttype-opties voor de bewijs-tag —
                // gederiveerd uit de procedure_requirements voor
                // deze stap_volgorde, gededupliceerd op documenttype.
                dossier
                  ? Array.from(
                      new Map(
                        dossier.evidence
                          .filter(
                            (e) =>
                              e.requirement_type === "document" &&
                              e.stap_volgorde === geselecteerdeStap.volgorde &&
                              e.documenttype !== null
                          )
                          .map((e) => [
                            e.documenttype as string,
                            { documenttype: e.documenttype as string, label: e.label },
                          ])
                      ).values()
                    )
                  : []
              }
            />
          ) : (
            <div className="bg-app-bg border border-line rounded-xl p-5 text-sm text-muted">
              Deze procedure heeft nog geen stappen.
            </div>
          )}

          {/* WO-2 (D7): vereiste bewijslast voor de geselecteerde stap
              (readiness-unie template + instantie) + de affordance om een
              instantie-vereiste toe te voegen. AI-validatie valt buiten deze
              tranche, dus aiOutputs bewust leeg. */}
          {geselecteerdeStap && dossier && (
            <div className="space-y-3">
              <StapRequirementsPaneel
                decisionId={dossier.decision.id}
                step={geselecteerdeStap}
                evidence={dossier.evidence}
                aiOutputs={[]}
              />
              {/* Toevoeg-affordance alleen bij capability (voorzitter/beheerder);
                  anders geen (lege) kaart tonen. Server-side gate blijft leidend. */}
              {currentUserIsPrivileged && (
                <div className="bg-white border border-line rounded-xl p-5">
                  <VereisteToevoegen
                    procedureId={procedure.id}
                    stapVolgorde={geselecteerdeStap.volgorde}
                    kanBeheren={currentUserIsPrivileged}
                  />
                </div>
              )}
            </div>
          )}

          {/* Besluiten — als er vastgelegd zijn */}
          {besluiten.length > 0 && (
            <div className="bg-white border border-line rounded-xl p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">
                Vastgelegde besluiten
              </h3>
              <div className="space-y-3">
                {besluiten.map((b) => (
                  <div
                    key={b.id}
                    className="border border-line rounded-lg p-3"
                  >
                    <div className="text-sm text-ink font-medium">
                      {b.formulering}
                    </div>
                    {b.motivering && (
                      <p className="text-xs text-muted mt-1 whitespace-pre-line">
                        {b.motivering}
                      </p>
                    )}
                    {b.verworpen_alternatieven &&
                      b.verworpen_alternatieven.length > 0 && (
                        <div className="text-xs text-ink mt-2 border-l-2 border-warn/30 pl-3">
                          <span className="text-[10px] uppercase tracking-wide text-warn-ink font-semibold block mb-0.5">
                            Verworpen alternatieven
                          </span>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {b.verworpen_alternatieven.map((a, idx) => (
                              <li key={idx}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    <div className="text-xs text-muted mt-2">
                      {formatDatum(b.datum)}
                      {b.vastgelegd_door_naam
                        ? ` · ${b.vastgelegd_door_naam}`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Dossier — uitklapbare panelen (status-overgang default open).
          Onder de body-grid omdat de actieve stap de primaire focus
          heeft; deze blokken zijn voor reflectie en bijwerken van het
          besluitdossier. Klik op een paneel-header om uit te klappen. */}
      {dossier && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted font-semibold mb-3">
            Dossier
          </h2>
          <div className="space-y-2">
            <UitklapbaarPaneel
              titel="Classificatie & onderbouwing"
              status={
                dossier.events.some(
                  (e) => e.event_type === "classificatie_bevestigd"
                )
                  ? "voldoet"
                  : "aandacht"
              }
              samenvatting={
                dossier.events.some(
                  (e) => e.event_type === "classificatie_bevestigd"
                )
                  ? "Bevestigd"
                  : "Nog niet bevestigd"
              }
            >
              <ClassificatiePanel decision={dossier.decision} />
            </UitklapbaarPaneel>

            {/* MVP-2A: vijf uitklapbaren (Aannames, Risico's, Voorwaarden,
                Acties, Dissent) zijn samengevoegd tot één OnderbouwingsPaneel
                met tabs. Statusovergang en Audit-trail blijven uitklapbaar
                want die zijn semantisch geen onderbouwing. */}
            <OnderbouwingsPaneel
              decisionId={dossier.decision.id}
              assumptions={dossier.assumptions}
              risks={dossier.risks}
              conditions={dossier.conditions}
              actions={dossier.actions}
              dissents={dossier.dissent}
              currentUserId={user.id}
              currentUserIsPrivileged={currentUserIsPrivileged}
              currentUserIsBureau={currentUserIsBureau}
            />

            <UitklapbaarPaneel
              titel="Statusovergang"
              ankerId="status-overgang"
              defaultOpen
              samenvatting="Door naar volgende fase, met readiness-check + override"
            >
              <StatusOvergangPaneel
                decision={dossier.decision}
                readiness={dossier.readiness}
                currentUserIsPrivileged={currentUserIsPrivileged}
              />
            </UitklapbaarPaneel>

            <UitklapbaarPaneel
              titel="Audit-trail"
              count={auditTrail.length}
              status="neutraal"
              samenvatting={`${auditTrail.length} append-only event${auditTrail.length === 1 ? "" : "s"} · proces + besluit`}
            >
              <div className="bg-white border border-line rounded-xl p-5">
                {auditTrail.length === 0 ? (
                  <div className="text-sm text-muted italic">
                    Nog geen events.
                  </div>
                ) : (
                  <ol className="space-y-3 text-sm">
                    {auditTrail.map((e) => (
                      <li key={e.id} className="flex gap-3">
                        <div
                          className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                            e.spoor === "besluit" ? "bg-ok" : "bg-app-line"
                          }`}
                          title={e.spoor === "besluit" ? "Besluitniveau" : "Procesniveau"}
                        />
                        <div className="flex-1">
                          <div className="text-ink">
                            <span className="font-medium">
                              {auditEventLabel(e.event_type)}
                            </span>
                            {e.besluitCode && (
                              <span className="text-[11px] text-ok-ink bg-ok-tint px-1.5 py-0.5 rounded ml-1.5">
                                {e.besluitCode}
                              </span>
                            )}
                            {e.proces_payload && Object.keys(e.proces_payload).length > 0 && (
                              <span className="text-muted">
                                {" "}
                                — {formatPayload(e.event_type, e.proces_payload)}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted mt-0.5">
                            {formatDatumTijd(e.tijdstip)}
                            {e.actor_naam ? ` · door ${e.actor_naam}` : ""}
                            {e.hash ? ` · ${e.hash.slice(0, 8)}` : ""}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </UitklapbaarPaneel>

            {/* T6 E1: Afschriften — direct ónder Audit-trail (het spoor en wat
                daarvan is meegegeven horen bij elkaar). */}
            <UitklapbaarPaneel
              titel="Afschriften"
              status="neutraal"
              ankerId="afschriften"
              samenvatting="Vastgelegde, downloadbare auditbundels van dit proces"
            >
              <AfschriftenPaneel
                procedureId={procedure.id}
                currentUserIsBureau={currentUserIsBureau}
              />
            </UitklapbaarPaneel>
          </div>
        </div>
      )}
    </div>
  );
}

function formatPayload(
  eventType: string,
  payload: Record<string, unknown>
): string {
  if (eventType === "stap_gestart" && payload.stap) {
    return String(payload.stap);
  }
  if (eventType === "stap_voltooid" && payload.stap) {
    return String(payload.stap);
  }
  if (eventType === "checklistitem_voldaan" && payload.item) {
    return `${payload.stap ? `${payload.stap} — ` : ""}${payload.item}`;
  }
  if (eventType === "checklistitem_geopend" && payload.item) {
    return `${payload.stap ? `${payload.stap} — ` : ""}${payload.item}`;
  }
  if (eventType === "bewijs_toegevoegd" && payload.titel) {
    return `${payload.stap ? `${payload.stap} — ` : ""}${payload.titel}`;
  }
  if (eventType === "besluit_vastgelegd" && payload.formulering) {
    return String(payload.formulering).slice(0, 100);
  }
  if (eventType === "eigenaar_toegevoegd" && payload.naam) {
    return String(payload.naam);
  }
  if (eventType === "procedure_aangemaakt" && payload.template) {
    return `template: ${payload.template}`;
  }
  return "";
}
