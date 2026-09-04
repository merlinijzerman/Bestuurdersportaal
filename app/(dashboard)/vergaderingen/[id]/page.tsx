import { createServerSupabase } from "@/core/lib/supabase-server";
import { isBureauRol } from "@/core/lib/bureau-gate";
import { moduleBeschikbaar } from "@/core/lib/fonds-config";
import Link from "next/link";
import { notFound } from "next/navigation";
import NieuwAgendapuntForm from "../_components/NieuwAgendapuntForm";
import VergaderingEditModal from "../_components/VergaderingEditModal";
import AgendapuntKaart, {
  type Agendapunt,
  type Stuk,
  type Inbreng,
} from "../_components/AgendapuntKaart";
import type { KomendeVergadering } from "../_components/AgendapuntEditModal";
import type { Voorbereiding } from "../_components/VoorbereidingsBlok";
import type {
  StemmingData,
  StemData,
  Bestuurslid,
} from "../_components/StemrondeBlok";

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
  aangemaakt_door: string | null;
  outlook_beheerd: boolean;
  outlook_sync_status: "gesynchroniseerd" | "geannuleerd" | "afgeschermd" | "extern_gewijzigd_of_verwijderd" | null;
  outlook_eind: string | null;
  outlook_teams_link: string | null;
  outlook_laatst_gesynchroniseerd_op: string | null;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  gepland: { bg: "bg-accent-tint", text: "text-accent-ink", label: "Gepland" },
  in_voorbereiding: { bg: "bg-warn-tint", text: "text-warn-ink", label: "In voorbereiding" },
  afgerond: { bg: "bg-app-bg", text: "text-muted", label: "Afgerond" },
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

  // VEN-2 — is de stemmodule voor dit fonds beschikbaar? Vandaag: nee, voor elk
  // fonds (registry: defaultActief=false, manifestBeheerbaar=false). Dit stuurt
  // uitsluitend de WEERGAVE; de maatregel is de server-guard in de vier
  // /api/stemmingen-routes. Nooit alleen dit blok wijzigen.
  const stemmenBeschikbaar = await moduleBeschikbaar(v.fonds_id, "stemmingen");

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
    { data: stemmingenRaw },
    { data: bestuursledenRaw },
    { data: koppelingenRaw },
  ] = await Promise.all([
    agendapuntIds.length > 0
      ? supabase
          .from("documenten")
          .select("id, titel, bestandsnaam, bestandstype, paginas, samenvatting_ai, samengevat_op, opslag_pad, agendapunt_id, ai_ondersteund_voorbereid, geindexeerd, verwerkingsstatus")
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
    // VEN-2: met een uitgeschakelde stemmodule halen we de stemronden niet op.
    // Niet renderen is niet genoeg — props van een server-component belanden in
    // de RSC-payload, dus stemgedrag zou anders alsnog naar de browser gaan.
    stemmenBeschikbaar && agendapuntIds.length > 0
      ? supabase
          .from("stemmingen")
          .select("*")
          .in("agendapunt_id", agendapuntIds)
          .order("geopend_op", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("profielen")
      .select("id, naam")
      .eq("fonds_id", v.fonds_id)
      .in("rol", ["bestuurder", "voorzitter"]),
    // Non-destructieve vergaderkoppelingen (document_agendapunten): bestaande
    // bibliotheekdocumenten die aan een agendapunt zijn gekoppeld zonder kopie.
    agendapuntIds.length > 0
      ? supabase
          .from("document_agendapunten")
          .select("document_id, agendapunt_id")
          .in("agendapunt_id", agendapuntIds)
      : Promise.resolve({ data: [] }),
  ]);

  const stukken = (stukkenRaw || []) as (Stuk & { agendapunt_id: string })[];
  const inbreng = (inbrengRaw || []) as (Inbreng & { agendapunt_id: string })[];
  const voorbereidingen = (voorbereidingenRaw || []) as Voorbereiding[];

  // Secundaire (non-destructieve) vergaderkoppelingen: haal de gekoppelde
  // bibliotheekdocumenten op en zet ze klaar per agendapunt. Het brondocument
  // blijft ongemoeid; hier tonen we het alleen óók onder het agendapunt.
  const koppelingen = (koppelingenRaw || []) as {
    document_id: string;
    agendapunt_id: string;
  }[];
  const gekoppeldeDocIds = [...new Set(koppelingen.map((k) => k.document_id))];
  let gekoppeldeDocs: Stuk[] = [];
  if (gekoppeldeDocIds.length > 0) {
    const { data: gekoppeldeRaw } = await supabase
      .from("documenten")
      .select("id, titel, bestandsnaam, bestandstype, paginas, samenvatting_ai, samengevat_op, opslag_pad, ai_ondersteund_voorbereid, geindexeerd, verwerkingsstatus")
      .in("id", gekoppeldeDocIds);
    gekoppeldeDocs = (gekoppeldeRaw || []) as Stuk[];
  }
  const gekoppeldeDocMap = new Map(gekoppeldeDocs.map((d) => [d.id, d]));

  // ── Stemmingen: kies per agendapunt de relevante stemming (open eerst,
  //    anders meest recente) en haal stemmen op voor open stemmingen. ──
  type StemmingRow = StemmingData & { agendapunt_id: string };
  const alleStemmingen = (stemmingenRaw || []) as StemmingRow[];
  const bestuursleden = (bestuursledenRaw || []) as Bestuurslid[];
  const totaalBestuursleden = bestuursleden.length;
  const naamMap = new Map<string, string | null>(
    bestuursleden.map((b) => [b.id, b.naam])
  );

  // Per agendapunt: open stemming heeft prioriteit, anders meest recente.
  const stemmingPerAgendapunt = new Map<string, StemmingRow>();
  for (const s of alleStemmingen) {
    const huidige = stemmingPerAgendapunt.get(s.agendapunt_id);
    if (!huidige) {
      stemmingPerAgendapunt.set(s.agendapunt_id, s);
    } else if (s.status === "open" && huidige.status !== "open") {
      stemmingPerAgendapunt.set(s.agendapunt_id, s);
    }
  }

  // Stemmen ophalen voor de open stemmingen (voor live-totalen + eigen stem).
  // (leeg zolang de stemmodule uit staat — de query hierboven draaide niet)
  const openStemmingIds = Array.from(stemmingPerAgendapunt.values())
    .filter((s) => s.status === "open")
    .map((s) => s.id);
  const stemmenPerStemming = new Map<string, StemData[]>();
  if (openStemmingIds.length > 0) {
    const { data: stemmenRaw } = await supabase
      .from("stem_uitbrengingen")
      .select(
        "id, stemming_id, stemgerechtigde_id, uitgebracht_door, keuze, motivering, is_volmacht, volmacht_toelichting"
      )
      .in("stemming_id", openStemmingIds);
    for (const r of (stemmenRaw || []) as {
      id: string;
      stemming_id: string;
      stemgerechtigde_id: string;
      uitgebracht_door: string;
      keuze: string;
      motivering: string | null;
      is_volmacht: boolean;
      volmacht_toelichting: string | null;
    }[]) {
      const lijst = stemmenPerStemming.get(r.stemming_id) ?? [];
      lijst.push({
        id: r.id,
        stemgerechtigde_id: r.stemgerechtigde_id,
        stemgerechtigde_naam: naamMap.get(r.stemgerechtigde_id) ?? null,
        uitgebracht_door: r.uitgebracht_door,
        uitgebracht_door_naam: naamMap.get(r.uitgebracht_door) ?? null,
        keuze: r.keuze,
        motivering: r.motivering,
        is_volmacht: r.is_volmacht,
        volmacht_toelichting: r.volmacht_toelichting,
      });
      stemmenPerStemming.set(r.stemming_id, lijst);
    }
  }

  const agendapunten: Agendapunt[] = (agendapuntenRaw || []).map(
    (a: Omit<Agendapunt, "stukken" | "inbreng">) => {
      const primair = stukken.filter((s) => s.agendapunt_id === a.id);
      const primaireIds = new Set(primair.map((s) => s.id));
      // Gekoppelde stukken die niet al primair onder dit agendapunt hangen.
      const secundair: Stuk[] = koppelingen
        .filter(
          (k) => k.agendapunt_id === a.id && !primaireIds.has(k.document_id)
        )
        .map((k) => gekoppeldeDocMap.get(k.document_id))
        .filter((d): d is Stuk => !!d)
        .map((d) => ({ ...d, gekoppeld: true }));
      return {
        ...a,
        stukken: [...primair, ...secundair],
        inbreng: inbreng.filter((i) => i.agendapunt_id === a.id),
      };
    }
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

  // Bewerken van de vergaderkop: zelfde rechtenmodel als agendapunten
  // (aanmaker + voorzitter/beheerder); afgerond = vergrendeld. De server
  // (PATCH /api/vergaderingen/[id]) dwingt dit onafhankelijk af.
  const magVergaderingBewerken =
    v.status !== "afgerond" &&
    !v.outlook_beheerd &&
    (v.aangemaakt_door === user.id ||
      huidigeRol === "voorzitter" ||
      huidigeRol === "beheerder");

  return (
    <div className="portal-page portal-page-stack">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/vergaderingen" className="hover:text-ink">
          Vergaderingen
        </Link>
        <span className="text-muted">›</span>
        <span className="text-ink font-medium">{v.titel}</span>
      </div>

      <div className="portal-card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="portal-page-title">{v.titel}</h1>
            <p className="text-sm text-muted mt-1">
              {formatDatum(v.datum)}
              {v.outlook_eind ? ` tot ${new Date(v.outlook_eind).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}` : ""}
              {v.locatie ? ` · ${v.locatie}` : ""}
            </p>
            {v.outlook_beheerd && (
              <p className="mt-2 text-xs text-muted">
                Beheerd vanuit Outlook
                {v.outlook_sync_status === "geannuleerd" ? " · Geannuleerd in Outlook" : ""}
                {v.outlook_sync_status === "afgeschermd" ? " · Afspraakdetails afgeschermd" : ""}
                {v.outlook_sync_status === "extern_gewijzigd_of_verwijderd" ? " · Mogelijk verplaatst of verwijderd in Outlook" : ""}
                {v.outlook_laatst_gesynchroniseerd_op ? ` · Laatst gesynchroniseerd ${new Date(v.outlook_laatst_gesynchroniseerd_op).toLocaleString("nl-NL")}` : ""}
              </p>
            )}
            {v.outlook_teams_link && (
              <a href={v.outlook_teams_link} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-accent-ink hover:underline">
                Deelnemen via Microsoft Teams
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            {magVergaderingBewerken && (
              <VergaderingEditModal
                vergadering={{
                  id: v.id,
                  titel: v.titel,
                  datum: v.datum,
                  locatie: v.locatie,
                }}
              />
            )}
            <span
              className={`portal-status-pill ${badge.bg} ${badge.text}`}
            >
              {badge.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-line">
          <Stat label="Agendapunten" value={agendapunten.length} />
          <Stat label="Stukken" value={totaalStukken} />
          <Stat label="Met AI-samenvatting" value={`${totaalSamengevat} / ${totaalStukken}`} />
          {/* T1 bureau-rol (FR-6): voor `bestuursbureau` levert de RLS 0
              inbrengrijen, dus "0" zou hier suggereren dat er geen inbreng ís.
              Zelfde correctie als in AgendapuntKaart. */}
          <Stat
            label="Inbreng vooraf"
            value={isBureauRol(huidigeRol) ? "afgeschermd" : totaalInbreng}
          />
        </div>
      </div>

      <section className="portal-card overflow-hidden">
      <div className="portal-card-header">
        <div className="flex items-center gap-3">
          <h2 className="portal-card-title">Agenda</h2>
          <Link
            href={`/vergaderingen/${v.id}${toonVerwijderde ? "" : "?verwijderd=1"}`}
            className="text-[11px] text-muted hover:text-ink"
          >
            {toonVerwijderde ? "← Verberg verwijderde" : "Toon verwijderde"}
          </Link>
        </div>
        <NieuwAgendapuntForm vergaderingId={v.id} />
      </div>

      {agendapunten.length === 0 ? (
        <div className="m-4 portal-empty">
          {toonVerwijderde
            ? "Geen verwijderde agendapunten op deze vergadering."
            : "Nog geen agendapunten. Voeg er hierboven één toe om te beginnen."}
        </div>
      ) : (
        <div className="divide-y divide-line">
          {agendapunten.map((a, idx) => {
            const p = pijltjesData.get(a.id);
            const stemmingRow = stemmingPerAgendapunt.get(a.id) ?? null;
            const stemmenVoorPunt = stemmingRow
              ? stemmenPerStemming.get(stemmingRow.id) ?? []
              : [];
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
                stemmenBeschikbaar={stemmenBeschikbaar}
                stemming={stemmingRow}
                stemmen={stemmenVoorPunt}
                bestuursleden={bestuursleden}
                totaalBestuursleden={totaalBestuursleden}
              />
            );
          })}
        </div>
      )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-base font-semibold text-ink mt-0.5">{value}</div>
    </div>
  );
}
