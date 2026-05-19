import { createServerSupabase } from "@/lib/supabase-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import NieuwAgendapuntForm from "../_components/NieuwAgendapuntForm";
import AgendapuntKaart, {
  type Agendapunt,
  type Stuk,
  type Inbreng,
} from "../_components/AgendapuntKaart";
import type { KomendeVergadering } from "../_components/AgendapuntEditModal";
import type { Voorbereiding } from "../_components/VoorbereidingsBlok";

// Page-cache uitschakelen — agendapunt-mutaties moeten direct zichtbaar zijn
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Vergadering {
  id: string;
  titel: string;
  datum: string;
  locatie: string | null;
  status: "gepland" | "in_voorbereiding" | "afgerond";
  fonds_id: string;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  gepland: { bg: "bg-blue-50", text: "text-blue-700", label: "Gepland" },
  in_voorbereiding: { bg: "bg-amber-50", text: "text-amber-800", label: "In voorbereiding" },
  afgerond: { bg: "bg-gray-100", text: "text-gray-600", label: "Afgerond" },
};

function formatDatum(d: string) {
  return new Date(d).toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function VergaderingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ verwijderd?: string }>;
}) {
  const { id } = await params;
  const { verwijderd } = await searchParams;
  const toonVerwijderde = verwijderd === "1";

  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profielRaw } = await supabase
    .from("profielen")
    .select("rol")
    .eq("id", user.id)
    .single();
  const huidigeRol = (profielRaw as { rol?: string } | null)?.rol ?? null;

  const { data: vergadering } = await supabase
    .from("vergaderingen")
    .select("*")
    .eq("id", id)
    .single();

  if (!vergadering) {
    notFound();
  }
  const v = vergadering as Vergadering;

  // Komende vergaderingen binnen hetzelfde fonds (exclusief huidige) voor verplaatsen-dropdown
  const { data: komendeRaw } = await supabase
    .from("vergaderingen")
    .select("id, titel, datum")
    .eq("fonds_id", v.fonds_id)
    .gt("datum", new Date().toISOString())
    .neq("id", v.id)
    .order("datum", { ascending: true });
  const komendeVergaderingen = (komendeRaw || []) as KomendeVergadering[];

  // Agendapunten: standaard alleen niet-verwijderde; toggle via ?verwijderd=1
  let agendaQuery = supabase
    .from("agendapunten")
    .select("*")
    .eq("vergadering_id", id)
    .order("volgorde", { ascending: true });
  if (!toonVerwijderde) {
    agendaQuery = agendaQuery.is("verwijderd_op", null);
  }
  const { data: agendapuntenRaw } = await agendaQuery;

  const agendapuntIds = (agendapuntenRaw || []).map((a: { id: string }) => a.id);

  const [
    { data: stukkenRaw },
    { data: inbrengRaw },
    { data: voorbereidingenRaw },
  ] = await Promise.all([
    agendapuntIds.length > 0
      ? supabase
          .from("documenten")
          .select("id, titel, bestandsnaam, bestandstype, paginas, samenvatting_ai, samengevat_op, opslag_pad, agendapunt_id")
          .in("agendapunt_id", agendapuntIds)
      : Promise.resolve({ data: [] }),
    agendapuntIds.length > 0
      ? supabase
          .from("agendapunt_inbreng")
          .select("id, agendapunt_id, gebruiker_id, gebruiker_naam, tekst, aangemaakt")
          .in("agendapunt_id", agendapuntIds)
          .order("aangemaakt", { ascending: true })
      : Promise.resolve({ data: [] }),
    agendapuntIds.length > 0
      ? supabase
          .from("voorbereidingen")
          .select("*")
          .eq("gebruiker_id", user.id)
          .in("agendapunt_id", agendapuntIds)
      : Promise.resolve({ data: [] }),
  ]);

  const stukken = (stukkenRaw || []) as (Stuk & { agendapunt_id: string })[];
  const inbreng = (inbrengRaw || []) as (Inbreng & { agendapunt_id: string })[];
  const voorbereidingen = (voorbereidingenRaw || []) as Voorbereiding[];

  const agendapunten: Agendapunt[] = (agendapuntenRaw || []).map(
    (a: Omit<Agendapunt, "stukken" | "inbreng">) => ({
      ...a,
      stukken: stukken.filter((s) => s.agendapunt_id === a.id),
      inbreng: inbreng.filter((i) => i.agendapunt_id === a.id),
    })
  );

  // Voor de volgorde-pijltjes: bepaal per actieve kaart wat vorige/volgende is.
  // We berekenen dit op basis van de niet-verwijderde subset, in volgorde.
  const actieveAgendapunten = agendapunten.filter((a) => !a.verwijderd_op);
  const pijltjesData = new Map<string, {
    kanOmhoog: boolean;
    kanOmlaag: boolean;
    vorigeVolgorde: number | null;
    volgendeVolgorde: number | null;
  }>();
  for (let i = 0; i < actieveAgendapunten.length; i++) {
    const punt = actieveAgendapunten[i];
    const vorige = actieveAgendapunten[i - 1];
    const volgende = actieveAgendapunten[i + 1];
    pijltjesData.set(punt.id, {
      kanOmhoog: !!vorige,
      kanOmlaag: !!volgende,
      vorigeVolgorde: vorige ? vorige.volgorde : null,
      volgendeVolgorde: volgende ? volgende.volgorde : null,
    });
  }

  const totaalStukken = stukken.length;
  const totaalSamengevat = stukken.filter((s) => s.samenvatting_ai).length;
  const totaalInbreng = inbreng.length;

  const badge = STATUS_BADGE[v.status] || STATUS_BADGE.in_voorbereiding;

  return (
    <div className="p-7 space-y-5">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/vergaderingen" className="hover:text-[#0F2744]">
          Vergaderingen
        </Link>
        <span className="text-gray-300">›</span>
        <span className="text-[#0F2744] font-medium">{v.titel}</span>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[#0F2744] text-xl font-bold">{v.titel}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {formatDatum(v.datum)}
              {v.locatie ? ` · ${v.locatie}` : ""}
            </p>
          </div>
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-md ${badge.bg} ${badge.text}`}
          >
            {badge.label}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-200">
          <Stat label="Agendapunten" value={agendapunten.length} />
          <Stat label="Stukken" value={totaalStukken} />
          <Stat label="Met AI-samenvatting" value={`${totaalSamengevat} / ${totaalStukken}`} />
          <Stat label="Inbreng vooraf" value={totaalInbreng} />
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-[#0F2744] font-semibold text-sm">Agenda</h2>
          <Link
            href={`/vergaderingen/${v.id}${toonVerwijderde ? "" : "?verwijderd=1"}`}
            className="text-[11px] text-gray-500 hover:text-[#0F2744]"
          >
            {toonVerwijderde ? "← Verberg verwijderde" : "Toon verwijderde"}
          </Link>
        </div>
        <NieuwAgendapuntForm vergaderingId={v.id} />
      </div>

      {agendapunten.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500">
          {toonVerwijderde
            ? "Geen verwijderde agendapunten op deze vergadering."
            : "Nog geen agendapunten. Voeg er hierboven één toe om te beginnen."}
        </div>
      ) : (
        <div className="space-y-3">
          {agendapunten.map((a, idx) => {
            const p = pijltjesData.get(a.id);
            return (
              <AgendapuntKaart
                key={a.id}
                nummer={idx + 1}
                punt={a}
                huidigeGebruikerId={user.id}
                huidigeRol={huidigeRol}
                voorbereiding={
                  voorbereidingen.find((v) => v.agendapunt_id === a.id) || null
                }
                komendeVergaderingen={komendeVergaderingen}
                kanOmhoog={p?.kanOmhoog ?? false}
                kanOmlaag={p?.kanOmlaag ?? false}
                vorigeVolgorde={p?.vorigeVolgorde ?? null}
                volgendeVolgorde={p?.volgendeVolgorde ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-base font-semibold text-[#0F2744] mt-0.5">{value}</div>
    </div>
  );
}
