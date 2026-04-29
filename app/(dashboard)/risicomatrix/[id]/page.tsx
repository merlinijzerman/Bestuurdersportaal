import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  CategorieSlug,
  MaatregelStatus,
  NiveauSlug,
  TypeRisicoSlug,
  KANS_LABELS,
  IMPACT_LABELS,
  NIVEAU_KLEUREN,
  NIVEAU_LABEL,
  TYPE_LABEL,
  categorieLabel,
} from "@/lib/risico-config";
import MaatregelenBlok from "../_components/MaatregelenBlok";
import RisicoActies from "../_components/RisicoActies";

interface RisicoDetail {
  id: string;
  fonds_id: string;
  categorie: CategorieSlug;
  titel: string;
  toelichting: string | null;
  kans: number;
  impact: number;
  niveau: NiveauSlug;
  niveau_handmatig: boolean;
  type_risico: TypeRisicoSlug;
  status: "actief" | "gesloten";
  eigenaar_naam: string | null;
  volgende_beoordeling: string | null;
  aangemaakt: string;
  gesloten_op: string | null;
  sluit_motivering: string | null;
}

export interface Maatregel {
  id: string;
  beschrijving: string;
  status: MaatregelStatus;
  verantwoordelijke: string | null;
  volgorde: number;
  aangemaakt: string;
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
  risico_aangemaakt: "Risico aangemaakt",
  niveau_gewijzigd: "Risiconiveau gewijzigd",
  maatregel_toegevoegd: "Maatregel toegevoegd",
  maatregel_status_gewijzigd: "Maatregelstatus gewijzigd",
  risico_gesloten: "Risico gesloten",
};

export default async function RisicoDetailPage({
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

  const { data: risicoRaw } = await supabase
    .from("risicos")
    .select("*")
    .eq("id", id)
    .single();

  if (!risicoRaw) notFound();
  const risico = risicoRaw as RisicoDetail;

  const { data: maatregelen } = await supabase
    .from("risico_maatregelen")
    .select("id, beschrijving, status, verantwoordelijke, volgorde, aangemaakt")
    .eq("risico_id", id)
    .order("volgorde", { ascending: true });

  const { data: log } = await supabase
    .from("risico_log")
    .select("id, event_type, actor_naam, payload, tijdstip")
    .eq("risico_id", id)
    .order("tijdstip", { ascending: false });

  const niveauKleur = NIVEAU_KLEUREN[risico.niveau];
  const isGesloten = risico.status === "gesloten";

  return (
    <div className="p-7 space-y-6">
      <Link
        href="/risicomatrix"
        className="text-sm text-gray-500 hover:text-[#0F2744] inline-flex items-center gap-1"
      >
        ← Terug naar matrix
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
              {categorieLabel(risico.categorie)}
            </span>
            <span
              className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${niveauKleur.pillBg} ${niveauKleur.pillText}`}
            >
              {NIVEAU_LABEL[risico.niveau]}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-[#0F2744] bg-[#0F2744]/5 px-2 py-0.5 rounded">
              {TYPE_LABEL[risico.type_risico]}
            </span>
            <span
              className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${
                isGesloten
                  ? "bg-gray-100 text-gray-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {isGesloten ? "Gesloten" : "Actief"}
            </span>
          </div>
          <h1 className="text-[#0F2744] text-2xl font-semibold">{risico.titel}</h1>
          {risico.toelichting && (
            <p className="text-sm text-gray-600 mt-1.5 max-w-3xl whitespace-pre-line">
              {risico.toelichting}
            </p>
          )}
        </div>

        {!isGesloten && <RisicoActies risicoId={risico.id} />}
      </div>

      {/* K/I/niveau strook */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Kans
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <div className="text-2xl font-semibold text-[#0F2744]">
              {risico.kans}
            </div>
            <div className="text-sm text-gray-600">
              — {KANS_LABELS[risico.kans]}
            </div>
          </div>
          <div className="flex gap-1 mt-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={`k-bar-${n}`}
                className={`h-1.5 flex-1 rounded-full ${
                  n <= risico.kans ? "bg-[#0F2744]" : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Impact
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <div className="text-2xl font-semibold text-[#0F2744]">
              {risico.impact}
            </div>
            <div className="text-sm text-gray-600">
              — {IMPACT_LABELS[risico.impact]}
            </div>
          </div>
          <div className="flex gap-1 mt-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={`i-bar-${n}`}
                className={`h-1.5 flex-1 rounded-full ${
                  n <= risico.impact ? "bg-[#0F2744]" : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>

        <div
          className={`border-2 rounded-xl p-5 ${niveauKleur.cellBg} ${niveauKleur.cellBorder}`}
        >
          <div
            className={`text-xs uppercase tracking-wide font-semibold ${niveauKleur.pillText}`}
          >
            Risiconiveau
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <div
              className={`text-2xl font-semibold ${niveauKleur.pillText}`}
            >
              {NIVEAU_LABEL[risico.niveau]}
            </div>
            <div className="text-sm text-gray-600">
              (K + I = {risico.kans + risico.impact})
            </div>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            {risico.niveau_handmatig
              ? "Niveau is handmatig overschreven."
              : "Niveau afgeleid uit Kans + Impact."}
          </div>
        </div>
      </div>

      {isGesloten && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Gesloten
              </div>
              <div className="text-sm text-gray-700 mt-1">
                {risico.gesloten_op
                  ? formatDatum(risico.gesloten_op)
                  : "Datum onbekend"}
              </div>
            </div>
            {risico.sluit_motivering && (
              <div className="max-w-2xl text-sm text-gray-700 italic">
                &ldquo;{risico.sluit_motivering}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-8 space-y-5">
          {/* Maatregelen */}
          <MaatregelenBlok
            risicoId={risico.id}
            initieel={(maatregelen || []) as Maatregel[]}
            readonly={isGesloten}
          />

          {/* Logboek */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#0F2744]">Logboek</h3>
              <span className="text-xs text-gray-500">
                Append-only · {(log || []).length} events
              </span>
            </div>
            {(log || []).length === 0 ? (
              <div className="text-sm text-gray-400 italic">
                Nog geen events.
              </div>
            ) : (
              <ol className="space-y-3 text-sm">
                {((log || []) as LogEvent[]).map((e) => (
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

        <aside className="col-span-12 lg:col-span-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
              Eigenschappen
            </h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Eigenaar</dt>
                <dd className="text-gray-900 mt-0.5">
                  {risico.eigenaar_naam || (
                    <span className="text-gray-400 italic">
                      Geen eigenaar toegewezen
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Aangemaakt</dt>
                <dd className="text-gray-900 mt-0.5">
                  {formatDatum(risico.aangemaakt)}
                </dd>
              </div>
              {risico.volgende_beoordeling && (
                <div>
                  <dt className="text-xs text-gray-500">Volgende beoordeling</dt>
                  <dd className="text-gray-900 mt-0.5">
                    {formatDatum(risico.volgende_beoordeling)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-500">Type</dt>
                <dd className="text-gray-900 mt-0.5">
                  {TYPE_LABEL[risico.type_risico]}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatPayload(eventType: string, payload: Record<string, unknown>): string {
  if (eventType === "niveau_gewijzigd" && payload.van && payload.naar) {
    const motivering = payload.motivering ? ` — ${payload.motivering}` : "";
    return `van ${payload.van} naar ${payload.naar}${motivering}`;
  }
  if (eventType === "maatregel_toegevoegd" && payload.beschrijving) {
    return String(payload.beschrijving).slice(0, 80);
  }
  if (
    eventType === "maatregel_status_gewijzigd" &&
    payload.beschrijving &&
    payload.naar
  ) {
    return `${String(payload.beschrijving).slice(0, 60)} → ${payload.naar}`;
  }
  if (eventType === "risico_gesloten" && payload.motivering) {
    return String(payload.motivering);
  }
  return "";
}
