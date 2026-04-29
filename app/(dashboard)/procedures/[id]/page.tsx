import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  templateLabel,
  PROCEDURE_STATUS_LABEL,
} from "@/lib/proces-templates";
import ActieveStapPaneel from "../_components/ActieveStapPaneel";

interface ProcedureDetail {
  id: string;
  fonds_id: string;
  template_code: string;
  titel: string;
  beschrijving: string | null;
  status: "in_uitvoering" | "wacht_op_besluit" | "afgerond";
  gestart_op: string;
  deadline: string | null;
  afgerond_op: string | null;
}

export interface Stap {
  id: string;
  procedure_id: string;
  volgorde: number;
  naam: string;
  beschrijving: string | null;
  vereist_besluit: boolean;
  geschatte_dagen: number | null;
  status: "open" | "actief" | "afgerond";
  eigenaar_naam: string | null;
  deadline: string | null;
  voltooid_op: string | null;
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

const EVENT_LABEL: Record<string, string> = {
  procedure_aangemaakt: "Procedure aangemaakt",
  eigenaar_toegevoegd: "Co-eigenaar toegevoegd",
  stap_gestart: "Stap gestart",
  stap_voltooid: "Stap voltooid",
  checklistitem_voldaan: "Checklist-item afgevinkt",
  checklistitem_geopend: "Checklist-item ongedaan gemaakt",
  bewijs_toegevoegd: "Bewijsstuk toegevoegd",
  besluit_vastgelegd: "Besluit vastgelegd",
};

function dagenTot(deadline: string): number {
  const dl = new Date(deadline);
  const nu = new Date();
  return Math.ceil((dl.getTime() - nu.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function ProcedureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const [stappenRes, eigenarenRes, logRes, besluitenRes] = await Promise.all([
    supabase
      .from("procedure_stappen")
      .select("*")
      .eq("procedure_id", id)
      .order("volgorde", { ascending: true }),
    supabase
      .from("procedure_eigenaars")
      .select("gebruiker_naam")
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
  ]);

  const stappen = (stappenRes.data || []) as Stap[];
  const eigenaren = (eigenarenRes.data || []).map(
    (e: { gebruiker_naam: string }) => e.gebruiker_naam
  );
  const log = (logRes.data || []) as LogEvent[];
  const besluiten = (besluitenRes.data || []) as Besluit[];

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

  const actieveStap = stappen.find((s) => s.status === "actief");
  const afgerondAantal = stappen.filter((s) => s.status === "afgerond").length;
  const totaalStappen = stappen.length;

  return (
    <div className="p-7 space-y-6">
      <Link
        href="/procedures"
        className="text-sm text-gray-500 hover:text-[#0F2744] inline-flex items-center gap-1"
      >
        ← Terug naar procedures
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[11px] font-medium uppercase tracking-wide text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
            {templateLabel(procedure.template_code)}
          </span>
          <span
            className={`text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${
              procedure.status === "afgerond"
                ? "bg-gray-100 text-gray-700"
                : procedure.status === "wacht_op_besluit"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-blue-50 text-blue-700"
            }`}
          >
            {PROCEDURE_STATUS_LABEL[procedure.status] || procedure.status}
          </span>
        </div>
        <h1 className="text-[#0F2744] text-2xl font-semibold">
          {procedure.titel}
        </h1>
        {procedure.beschrijving && (
          <p className="text-sm text-gray-600 mt-1.5 max-w-3xl whitespace-pre-line">
            {procedure.beschrijving}
          </p>
        )}
      </div>

      {/* Meta-strook */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white border border-gray-200 rounded-xl p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Co-eigenaars
          </div>
          {eigenaren.length === 0 ? (
            <div className="text-sm text-gray-400 italic mt-2">
              Geen toegewezen
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex -space-x-2">
                {eigenaren.slice(0, 3).map((n: string, idx: number) => (
                  <div
                    key={idx}
                    title={n}
                    className="w-8 h-8 rounded-full bg-purple-200 text-purple-900 text-xs flex items-center justify-center font-medium border-2 border-white"
                  >
                    {n
                      .split(/\s+/)
                      .map((w: string) => w[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                ))}
                {eigenaren.length > 3 && (
                  <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-700 text-xs flex items-center justify-center font-medium border-2 border-white">
                    +{eigenaren.length - 3}
                  </div>
                )}
              </div>
              <span className="text-sm text-gray-700">
                {eigenaren.slice(0, 2).join(", ")}
                {eigenaren.length > 2 && ` +${eigenaren.length - 2}`}
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Voortgang
          </div>
          <div className="text-sm text-gray-900 mt-2 font-medium">
            Stap{" "}
            {Math.min(afgerondAantal + (actieveStap ? 1 : 0), totaalStappen)} van{" "}
            {totaalStappen}
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full bg-[#C9A84C]"
              style={{
                width: `${
                  totaalStappen > 0
                    ? (afgerondAantal / totaalStappen) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Deadline
          </div>
          {procedure.deadline ? (
            <>
              <div className="text-sm text-gray-900 font-medium mt-2">
                {formatDatum(procedure.deadline)}
              </div>
              <div className="text-xs text-gray-500">
                {(() => {
                  const d = dagenTot(procedure.deadline);
                  if (d < 0) return `${Math.abs(d)} dagen verstreken`;
                  if (d === 0) return "Vandaag";
                  return `Nog ${d} dagen`;
                })()}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 italic mt-2">
              Geen deadline
            </div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Gestart op
          </div>
          <div className="text-sm text-gray-900 font-medium mt-2">
            {formatDatum(procedure.gestart_op)}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-12 gap-5">
        {/* Step rail */}
        <div className="col-span-12 lg:col-span-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 sticky top-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-4">
              Procesfasen
            </div>
            <ol className="space-y-1">
              {stappen.map((s, idx) => {
                const isLast = idx === stappen.length - 1;
                if (s.status === "afgerond") {
                  return (
                    <li key={s.id} className="relative pl-9 py-2.5">
                      <div className="absolute left-0 top-3 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">
                        ✓
                      </div>
                      {!isLast && (
                        <div className="absolute left-3 top-9 bottom-0 w-px bg-emerald-300" />
                      )}
                      <div className="text-sm font-medium text-gray-900">
                        {s.naam}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {s.voltooid_op
                          ? `Afgerond ${formatDatumKort(s.voltooid_op)}`
                          : "Afgerond"}
                      </div>
                    </li>
                  );
                }
                if (s.status === "actief") {
                  return (
                    <li
                      key={s.id}
                      className="relative pl-9 py-2.5 bg-amber-50/40 -mx-3 px-3 rounded-lg"
                    >
                      <div className="absolute left-3 top-3 w-6 h-6 rounded-full bg-[#C9A84C] border-2 border-[#C9A84C] text-[#0F2744] flex items-center justify-center text-xs font-bold ring-4 ring-amber-100">
                        {s.volgorde}
                      </div>
                      {!isLast && (
                        <div className="absolute left-6 top-9 bottom-0 w-px bg-gray-200" />
                      )}
                      <div className="text-sm font-semibold text-[#0F2744] ml-6">
                        {s.naam}
                      </div>
                      <div className="text-xs text-amber-700 font-medium mt-0.5 ml-6">
                        Actief
                        {s.deadline
                          ? ` — deadline ${formatDatumKort(s.deadline)}`
                          : ""}
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={s.id} className="relative pl-9 py-2.5">
                    <div className="absolute left-0 top-3 w-6 h-6 rounded-full bg-gray-100 border-2 border-gray-300 text-gray-500 flex items-center justify-center text-xs font-medium">
                      {s.volgorde}
                    </div>
                    {!isLast && (
                      <div className="absolute left-3 top-9 bottom-0 w-px bg-gray-200" />
                    )}
                    <div className="text-sm font-medium text-gray-500">
                      {s.naam}
                    </div>
                    {s.vereist_besluit && (
                      <div className="text-xs text-amber-700 mt-0.5">
                        Vereist formeel besluit
                      </div>
                    )}
                    {!s.vereist_besluit && s.geschatte_dagen && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Geschat {s.geschatte_dagen} dagen
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Active step + log */}
        <div className="col-span-12 lg:col-span-8 space-y-5">
          {actieveStap ? (
            <ActieveStapPaneel
              procedureId={procedure.id}
              stap={actieveStap}
              checklist={checklist.filter((c) => c.stap_id === actieveStap.id)}
              bewijs={bewijs.filter((b) => b.stap_id === actieveStap.id)}
              besluit={
                besluiten.find((b) => b.stap_id === actieveStap.id) ?? null
              }
            />
          ) : procedure.status === "afgerond" ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
              <div className="text-sm font-semibold text-emerald-800">
                Procedure is afgerond
              </div>
              <div className="text-xs text-emerald-700 mt-1">
                Afgerond op{" "}
                {procedure.afgerond_op
                  ? formatDatum(procedure.afgerond_op)
                  : "(datum onbekend)"}
                . Alle stappen zijn voltooid.
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-600">
              Geen actieve stap. Markeer een open stap als actief om door te
              gaan.
            </div>
          )}

          {/* Besluiten — als er vastgelegd zijn */}
          {besluiten.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[#0F2744] mb-3">
                Vastgelegde besluiten
              </h3>
              <div className="space-y-3">
                {besluiten.map((b) => (
                  <div
                    key={b.id}
                    className="border border-gray-200 rounded-lg p-3"
                  >
                    <div className="text-sm text-gray-900 font-medium">
                      {b.formulering}
                    </div>
                    {b.motivering && (
                      <p className="text-xs text-gray-600 mt-1 whitespace-pre-line">
                        {b.motivering}
                      </p>
                    )}
                    <div className="text-xs text-gray-500 mt-2">
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

          {/* Audit log */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#0F2744]">
                Audit-trail
              </h3>
              <span className="text-xs text-gray-500">
                Append-only · {log.length} events
              </span>
            </div>
            {log.length === 0 ? (
              <div className="text-sm text-gray-400 italic">
                Nog geen events.
              </div>
            ) : (
              <ol className="space-y-3 text-sm">
                {log.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-gray-900">
                        <span className="font-medium">
                          {EVENT_LABEL[e.event_type] || e.event_type}
                        </span>
                        {e.payload && Object.keys(e.payload).length > 0 && (
                          <span className="text-gray-600">
                            {" "}
                            — {formatPayload(e.event_type, e.payload)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatDatumTijd(e.tijdstip)}
                        {e.actor_naam ? ` · door ${e.actor_naam}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
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
