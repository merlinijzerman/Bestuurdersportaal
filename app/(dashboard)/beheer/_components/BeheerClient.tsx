"use client";

import { useCallback, useEffect, useState } from "react";

type Organ = {
  id: string;
  fonds_id: string | null;
  naam: string;
  omschrijving: string | null;
  actief: boolean;
  sort_order: number;
  type?: string | null;
  categorie?: string | null;
  is_template?: boolean;
};

const CATEGORIE_LABEL: Record<string, string> = {
  fondsorgaan: "Fondsorgaan",
  bestuurscommissie: "Bestuurscommissie",
  extern_ketenpartner: "Externe ketenpartner",
};
const GREMIA_CATEGORIEEN = [
  "fondsorgaan",
  "bestuurscommissie",
  "extern_ketenpartner",
] as const;

type Procesmodel = {
  id: string;
  naam: string;
  generiek_procestype: string;
  domein: string | null;
  frequentie: string | null;
  actief: boolean;
};

const FREQUENTIE_LABEL: Record<string, string> = {
  jaarlijks: "Jaarlijks",
  kwartaal: "Per kwartaal",
  maandelijks: "Maandelijks",
  ad_hoc: "Ad hoc",
  projectmatig: "Projectmatig",
  doorlopend: "Doorlopend",
};

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Er ging iets mis");
  return data;
}

export default function BeheerClient() {
  const [tab, setTab] = useState<"catalogus" | "organen" | "review">("catalogus");
  const [procesmodellen, setProcesmodellen] = useState<Procesmodel[]>([]);
  const [gremia, setGremia] = useState<Organ[]>([]);
  const [expertises, setExpertises] = useState<Organ[]>([]);
  const [focus, setFocus] = useState<Organ[]>([]);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);

  const [importeren, setImporteren] = useState(false);
  const [importMelding, setImportMelding] = useState<string | null>(null);

  const [reindexBezig, setReindexBezig] = useState(false);
  const [reindexMelding, setReindexMelding] = useState<string | null>(null);

  const laadAlles = useCallback(async () => {
    setLaden(true);
    setFout(null);
    try {
      const [pm, g, e, f] = await Promise.all([
        jsonFetch("/api/procesmodellen"),
        jsonFetch("/api/gremia"),
        jsonFetch("/api/expertises"),
        jsonFetch("/api/focusgebieden"),
      ]);
      setProcesmodellen(pm.procesmodellen ?? []);
      setGremia(g.items ?? []);
      setExpertises(e.items ?? []);
      setFocus(f.items ?? []);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Laden mislukt");
    } finally {
      setLaden(false);
    }
  }, []);

  useEffect(() => {
    laadAlles();
  }, [laadAlles]);

  async function importeerStandaard() {
    if (
      !confirm(
        "De standaardcatalogus (gremia, expertises, focusgebieden en procesmodellen) wordt naar dit fonds gekopieerd. Reeds geïmporteerde items worden overgeslagen. Doorgaan?"
      )
    )
      return;
    setImporteren(true);
    setImportMelding(null);
    try {
      const { resultaat } = await jsonFetch("/api/catalogus/import", {
        method: "POST",
      });
      const r = resultaat;
      setImportMelding(
        `Import voltooid — procesmodellen: ${r.procesmodellen.aangemaakt} aangemaakt / ${r.procesmodellen.overgeslagen} overgeslagen; ` +
          `gremia: ${r.gremia.aangemaakt}/${r.gremia.overgeslagen}; expertises: ${r.expertises.aangemaakt}/${r.expertises.overgeslagen}; ` +
          `focusgebieden: ${r.focusgebieden.aangemaakt}/${r.focusgebieden.overgeslagen}; koppelingen: ${r.koppelingen.aangemaakt} aangemaakt.`
      );
      await laadAlles();
    } catch (err) {
      setImportMelding(err instanceof Error ? err.message : "Import mislukt");
    } finally {
      setImporteren(false);
    }
  }

  // Her-indexeer de hele fondsbibliotheek met de structuur-bewuste + contextuele
  // indexering (R1.1/R1.2). Elke aanroep verwerkt één document (her-extractie +
  // AI-context + embedding); we loopen tot de server `klaar` meldt. De getoonde
  // brontekst verandert niet — alleen de afgeleide fragmenten/zoekindex.
  async function herindexeerBibliotheek() {
    if (
      !confirm(
        "Her-indexeer de HELE fondsbibliotheek met de verbeterde, structuur-bewuste en contextuele indexering.\n\n" +
          "Per document wordt het origineel opnieuw verwerkt: structuur-bewuste fragmenten, een korte AI-context per fragment (Haiku) en een nieuwe embedding (Mistral). Dit verbruikt AI-credits en kan, afhankelijk van het aantal documenten, enkele minuten duren.\n\n" +
          "De getoonde brontekst en bronvermelding veranderen niet. Doorgaan?"
      )
    )
      return;
    setReindexBezig(true);
    setReindexMelding("Bezig met her-indexeren…");
    let verwerkt = 0;
    let overgeslagen = 0;
    try {
      // Veiligheidsplafond tegen een onverhoopte eindeloze lus.
      for (let i = 0; i < 5000; i++) {
        const data = await jsonFetch("/api/documents/reindex-backfill", { method: "POST" });
        if (!data.document_id && data.klaar) break;
        verwerkt += data.verwerkt ?? 0;
        overgeslagen += data.overgeslagen ?? 0;
        // Een tijdelijke/document-eigen fout (download, extractie, opslag) laat de
        // resterend-teller niet dalen; doorgaan zou hetzelfde document blijven
        // oppakken. Stop en toon de oorzaak zodat een mens het kan oplossen.
        if (data.status === "mislukt") {
          setReindexMelding(
            `Her-indexeren gestopt bij "${data.titel ?? data.document_id}" (${data.reden ?? "onbekende fout"}). ` +
              `Controleer dit document en start daarna opnieuw. Tot nu toe: ${verwerkt} verwerkt, ${overgeslagen} overgeslagen.`
          );
          return;
        }
        setReindexMelding(
          `Verwerkt: ${verwerkt} · overgeslagen: ${overgeslagen} · resterende fragmenten: ${data.resterend ?? 0}…`
        );
        if (data.klaar) break;
      }
      setReindexMelding(
        `Klaar — ${verwerkt} document(en) opnieuw geïndexeerd` +
          (overgeslagen ? `, ${overgeslagen} overgeslagen (geen origineel of geen bruikbare tekst).` : ".")
      );
    } catch (err) {
      setReindexMelding(err instanceof Error ? err.message : "Her-indexeren mislukt");
    } finally {
      setReindexBezig(false);
    }
  }

  return (
    <div>
      {/* Import */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="font-semibold text-[#0F2744]">Standaardcatalogus importeren</div>
          <div className="text-sm text-gray-500">
            Kopieert de globale templates naar dit fonds als bewerkbaar startpunt.
            Idempotent — bestaande items blijven ongemoeid.
          </div>
        </div>
        <button
          onClick={importeerStandaard}
          disabled={importeren}
          className="shrink-0 rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#163556] disabled:opacity-50"
        >
          {importeren ? "Bezig…" : "Importeren"}
        </button>
      </div>
      {importMelding && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 mb-6">
          {importMelding}
        </div>
      )}

      {/* Her-indexeren (R1.1/R1.2) — hele fondsbibliotheek opnieuw verwerken. */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="font-semibold text-[#0F2744]">Bibliotheek her-indexeren</div>
          <div className="text-sm text-gray-500">
            Verwerkt alle fondsdocumenten opnieuw met structuur-bewuste fragmenten en
            een contextuele zoekindex. Verbruikt AI-credits; de getoonde brontekst
            verandert niet. Reeds bijgewerkte documenten worden overgeslagen.
          </div>
        </div>
        <button
          onClick={herindexeerBibliotheek}
          disabled={reindexBezig}
          className="shrink-0 rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#163556] disabled:opacity-50"
        >
          {reindexBezig ? "Bezig…" : "Her-indexeren"}
        </button>
      </div>
      {reindexMelding && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 mb-6">
          {reindexMelding}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(["catalogus", "organen", "review"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t
                ? "border-[#C9A84C] text-[#0F2744]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "catalogus"
              ? "Procescatalogus"
              : t === "organen"
              ? "Organen"
              : "Te beoordelen"}
          </button>
        ))}
      </div>

      {fout && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {fout}
        </div>
      )}
      {tab === "review" ? (
        <ReviewHub />
      ) : laden ? (
        <div className="text-gray-400 text-sm">Laden…</div>
      ) : tab === "catalogus" ? (
        <CatalogusTab
          procesmodellen={procesmodellen}
          gremia={gremia.filter((o) => o.fonds_id && o.actief)}
          expertises={expertises.filter((o) => o.fonds_id && o.actief)}
          focus={focus.filter((o) => o.fonds_id && o.actief)}
          onWijzig={laadAlles}
        />
      ) : (
        <OrganenTab
          gremia={gremia}
          expertises={expertises}
          focus={focus}
          onWijzig={laadAlles}
        />
      )}
    </div>
  );
}

// ── Generieke "Te beoordelen"-hub ───────────────────────────────────────────
// stream=metadata (increment C). Increment E hangt hier een tweede stream
// (AI-procesclassificatie) naast i.p.v. een tweede scherm.
type ReviewItem = {
  id: string;
  document_id: string;
  reden: string;
  status: string;
  aangemaakt: string;
  opmerking: string | null;
  documenten: {
    id: string;
    titel: string;
    bibliotheek: string;
    bron: string;
    context: string | null;
    documenttype: string | null;
    status: string | null;
    bronstatus: string | null;
    documentdatum: string | null;
    metadata_review_status: string | null;
  } | null;
};

// Increment E — classificatievoorstel-item (stream=classificatie).
type ClassificatieItem = {
  id: string;
  document_id: string;
  voorgestelde_procesinstantie_id: string | null;
  voorgesteld_documenttype: string | null;
  confidence: string;
  bron: string;
  status: string;
  toelichting: string | null;
  toegepast_op: string | null;
  teruggedraaid_op: string | null;
  aangemaakt: string;
  documenten: {
    id: string;
    titel: string;
    documenttype: string | null;
    status: string | null;
    documentdatum: string | null;
    procesinstantie_id: string | null;
  } | null;
};

const REVIEW_STREAMS = [
  { key: "metadata", label: "Metadata" },
  { key: "classificatie", label: "Procesclassificatie" },
] as const;
type ReviewStream = (typeof REVIEW_STREAMS)[number]["key"];

const REDEN_LABEL: Record<string, string> = {
  backfill: "Backfill (nog niet verrijkt)",
  ontbrekende_metadata: "Ontbrekende metadata",
  onzekere_status: "Onzekere status",
  handmatig: "Handmatig toegevoegd",
};

const CONFIDENCE_BADGE: Record<string, string> = {
  hoog: "bg-emerald-100 text-emerald-800",
  middel: "bg-amber-100 text-amber-800",
  laag: "bg-gray-100 text-gray-700",
  geen_match: "bg-gray-100 text-gray-500",
};

function ReviewHub() {
  const [stream, setStream] = useState<ReviewStream>("metadata");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [classItems, setClassItems] = useState<ClassificatieItem[]>([]);
  const [tellingen, setTellingen] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);

  const laad = useCallback(async () => {
    setLaden(true);
    setFout(null);
    try {
      const params = new URLSearchParams({ stream });
      if (statusFilter) params.set("status", statusFilter);
      const data = await jsonFetch(`/api/metadata-review/queue?${params}`);
      if (stream === "classificatie") {
        setClassItems(data.items ?? []);
        setItems([]);
      } else {
        setItems(data.items ?? []);
        setClassItems([]);
      }
      setTellingen(data.tellingen ?? {});
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Laden mislukt");
    } finally {
      setLaden(false);
    }
  }, [stream, statusFilter]);

  useEffect(() => {
    laad();
  }, [laad]);

  // Stream wisselen: zet een passend default statusfilter.
  function kiesStream(s: ReviewStream) {
    setStream(s);
    setStatusFilter("open");
  }

  async function beoordeelMetadata(documentId: string, actie: string) {
    setBezig(documentId);
    try {
      await jsonFetch("/api/metadata-review/queue", {
        method: "POST",
        body: JSON.stringify({ document_id: documentId, actie }),
      });
      await laad();
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Bijwerken mislukt");
    } finally {
      setBezig(null);
    }
  }

  // Classificatie-acties lopen via de classificatie-specifieke routes.
  async function classificatieActie(
    voorstelId: string,
    pad: "beoordeel" | "terugdraai",
    body: Record<string, unknown>
  ) {
    setBezig(voorstelId);
    setFout(null);
    try {
      await jsonFetch(`/api/classificatie/${voorstelId}/${pad}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await laad();
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Bijwerken mislukt");
    } finally {
      setBezig(null);
    }
  }

  const statusOpties =
    stream === "classificatie"
      ? [
          ["open", "Open"],
          ["auto_toegepast", "Auto-gekoppeld"],
          ["bevestigd", "Bevestigd"],
          ["afgewezen", "Afgewezen"],
          ["teruggedraaid", "Teruggedraaid"],
          ["", "Alle"],
        ]
      : [
          ["open", "Open"],
          ["in_behandeling", "In behandeling"],
          ["gecontroleerd", "Gecontroleerd"],
          ["afgewezen", "Afgewezen"],
          ["", "Alle"],
        ];

  return (
    <div>
      {/* Stream-tabs: metadata (C) + procesclassificatie (E), één hub */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {REVIEW_STREAMS.map((s) => (
            <button
              key={s.key}
              onClick={() => kiesStream(s.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                stream === s.key
                  ? "bg-[#0F2744] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s.label}
              {stream === s.key && tellingen.open ? (
                <span className="ml-1.5 rounded-full bg-[#C9A84C] text-[#0F2744] px-1.5">
                  {tellingen.open}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          {statusOpties.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        {stream === "classificatie"
          ? "AI-procesclassificatie. Bij hoge zekerheid is het document automatisch gekoppeld (terugdraaibaar); bij middelmatige zekerheid bevestig je het voorstel. Expliciet gekoppelde documenten worden nooit omgehangen."
          : "Documenten die nog niet zijn verrijkt of een onzekere status hebben. Open het document in de bibliotheek om de metadata te corrigeren; markeer het hier als gecontroleerd zodra de metadata klopt."}
      </p>

      {fout && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {fout}
        </div>
      )}

      {laden ? (
        <div className="text-gray-400 text-sm">Laden…</div>
      ) : stream === "classificatie" ? (
        classItems.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Geen classificatievoorstellen in deze status.
          </div>
        ) : (
          <div className="space-y-2">
            {classItems.map((it) => (
              <div
                key={it.id}
                className="rounded-xl border border-gray-200 bg-white p-4 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#0F2744] truncate">
                      {it.documenten?.titel ?? "(document verwijderd)"}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        CONFIDENCE_BADGE[it.confidence] ?? "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {it.confidence}
                    </span>
                    {it.status === "auto_toegepast" && (
                      <span className="shrink-0 rounded-full bg-[#0F2744] text-white px-2 py-0.5 text-[11px] font-semibold">
                        auto-gekoppeld
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    bron: {it.bron}
                    {it.documenten?.documenttype ? ` · ${it.documenten.documenttype}` : ""}
                    {it.toelichting ? ` · ${it.toelichting}` : ""}
                  </div>
                </div>

                {it.status === "open" && (
                  <>
                    <button
                      onClick={() =>
                        classificatieActie(it.id, "beoordeel", { actie: "bevestigen" })
                      }
                      disabled={bezig === it.id}
                      className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Bevestigen
                    </button>
                    <button
                      onClick={() =>
                        classificatieActie(it.id, "beoordeel", { actie: "afwijzen" })
                      }
                      disabled={bezig === it.id}
                      className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Afwijzen
                    </button>
                  </>
                )}
                {it.status === "auto_toegepast" && (
                  <button
                    onClick={() => classificatieActie(it.id, "terugdraai", {})}
                    disabled={bezig === it.id}
                    className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Terugdraaien
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Niets te beoordelen in deze stream — de queue is leeg.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="rounded-xl border border-gray-200 bg-white p-4 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#0F2744] truncate">
                  {it.documenten?.titel ?? "(document verwijderd)"}
                </div>
                <div className="text-xs text-gray-500">
                  {REDEN_LABEL[it.reden] ?? it.reden}
                  {it.documenten?.documenttype ? ` · ${it.documenten.documenttype}` : ""}
                  {it.documenten?.status ? ` · ${it.documenten.status}` : " · geen status"}
                </div>
              </div>
              <a
                href="/bibliotheek"
                className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Naar bibliotheek
              </a>
              {it.status !== "gecontroleerd" && (
                <button
                  onClick={() => beoordeelMetadata(it.document_id, "gecontroleerd")}
                  disabled={bezig === it.document_id}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Gecontroleerd
                </button>
              )}
              {it.status === "open" && (
                <button
                  onClick={() => beoordeelMetadata(it.document_id, "afgewezen")}
                  disabled={bezig === it.document_id}
                  className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Afwijzen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Procescatalogus ────────────────────────────────────────────────────────
function CatalogusTab({
  procesmodellen,
  gremia,
  expertises,
  focus,
  onWijzig,
}: {
  procesmodellen: Procesmodel[];
  gremia: Organ[];
  expertises: Organ[];
  focus: Organ[];
  onWijzig: () => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [nieuwNaam, setNieuwNaam] = useState("");
  const [nieuwType, setNieuwType] = useState("");

  async function maakAan() {
    if (!nieuwNaam.trim() || !nieuwType.trim()) return;
    await jsonFetch("/api/procesmodellen", {
      method: "POST",
      body: JSON.stringify({ naam: nieuwNaam.trim(), generiek_procestype: nieuwType.trim() }),
    });
    setNieuwNaam("");
    setNieuwType("");
    await onWijzig();
  }

  async function toggleActief(pm: Procesmodel) {
    await jsonFetch(`/api/procesmodellen/${pm.id}`, {
      method: "PATCH",
      body: JSON.stringify({ actief: !pm.actief }),
    });
    await onWijzig();
  }

  return (
    <div>
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Naam</label>
          <input
            value={nieuwNaam}
            onChange={(e) => setNieuwNaam(e.target.value)}
            placeholder="bv. Uitbestedingsreview vermogensbeheer"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Generiek procestype
          </label>
          <input
            value={nieuwType}
            onChange={(e) => setNieuwType(e.target.value)}
            placeholder="bv. uitbestedingsreview"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={maakAan}
          className="rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#163556]"
        >
          Toevoegen
        </button>
      </div>

      {procesmodellen.length === 0 ? (
        <div className="text-gray-400 text-sm">
          Nog geen procesmodellen. Importeer de standaardcatalogus of voeg er een toe.
        </div>
      ) : (
        <div className="space-y-2">
          {procesmodellen.map((pm) => (
            <div key={pm.id} className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <div className="font-semibold text-[#0F2744]">
                    {pm.naam}{" "}
                    {!pm.actief && (
                      <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        inactief
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {pm.generiek_procestype}
                    {pm.frequentie ? ` · ${FREQUENTIE_LABEL[pm.frequentie] ?? pm.frequentie}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(open === pm.id ? null : pm.id)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Koppelingen
                </button>
                <button
                  onClick={() => toggleActief(pm)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {pm.actief ? "Deactiveren" : "Activeren"}
                </button>
              </div>
              {open === pm.id && (
                <KoppelPanel
                  procesmodelId={pm.id}
                  gremia={gremia}
                  expertises={expertises}
                  focus={focus}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KoppelPanel({
  procesmodelId,
  gremia,
  expertises,
  focus,
}: {
  procesmodelId: string;
  gremia: Organ[];
  expertises: Organ[];
  focus: Organ[];
}) {
  const [koppelingen, setKoppelingen] = useState<{
    gremia: string[];
    expertises: string[];
    focusgebieden: string[];
  }>({ gremia: [], expertises: [], focusgebieden: [] });
  const [laden, setLaden] = useState(true);

  const laad = useCallback(async () => {
    setLaden(true);
    const data = await jsonFetch(`/api/procesmodellen/${procesmodelId}`);
    setKoppelingen({
      gremia: data.koppelingen.gremia.map((k: { gremium_id: string }) => k.gremium_id),
      expertises: data.koppelingen.expertises.map((k: { expertise_id: string }) => k.expertise_id),
      focusgebieden: data.koppelingen.focusgebieden.map(
        (k: { focusgebied_id: string }) => k.focusgebied_id
      ),
    });
    setLaden(false);
  }, [procesmodelId]);

  useEffect(() => {
    laad();
  }, [laad]);

  async function toggle(
    type: "gremium" | "expertise" | "focusgebied",
    doelId: string,
    gekoppeld: boolean
  ) {
    await jsonFetch(`/api/procesmodellen/${procesmodelId}/koppelingen`, {
      method: gekoppeld ? "DELETE" : "POST",
      body: JSON.stringify({ type, doel_id: doelId }),
    });
    await laad();
  }

  if (laden) return <div className="border-t border-gray-100 p-4 text-sm text-gray-400">Laden…</div>;

  const blok = (
    titel: string,
    items: Organ[],
    gekoppeldeIds: string[],
    type: "gremium" | "expertise" | "focusgebied"
  ) => (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">{titel}</div>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400">Geen actieve items — importeer of voeg ze toe bij Organen.</div>
      ) : (
        <div className="space-y-1">
          {items.map((o) => {
            const gekoppeld = gekoppeldeIds.includes(o.id);
            return (
              <label key={o.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={gekoppeld}
                  onChange={() => toggle(type, o.id, gekoppeld)}
                />
                {o.naam}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-5 border-t border-gray-100 p-4 md:grid-cols-3">
      {blok("Gremia", gremia, koppelingen.gremia, "gremium")}
      {blok("Expertises", expertises, koppelingen.expertises, "expertise")}
      {blok("Focusgebieden", focus, koppelingen.focusgebieden, "focusgebied")}
    </div>
  );
}

// ── Organen ──────────────────────────────────────────────────────────────
function OrganenTab({
  gremia,
  expertises,
  focus,
  onWijzig,
}: {
  gremia: Organ[];
  expertises: Organ[];
  focus: Organ[];
  onWijzig: () => Promise<void>;
}) {
  return (
    <div className="space-y-8">
      <OrgaanSectie titel="Gremia" endpoint="gremia" items={gremia} metType onWijzig={onWijzig} />
      <OrgaanSectie titel="Expertises" endpoint="expertises" items={expertises} onWijzig={onWijzig} />
      <OrgaanSectie
        titel="Kritische focusgebieden"
        endpoint="focusgebieden"
        items={focus}
        onWijzig={onWijzig}
      />
    </div>
  );
}

const GREMIA_TYPES = ["besluitvormend", "adviserend", "toezichthoudend", "uitvoerend"];

function OrgaanSectie({
  titel,
  endpoint,
  items,
  metType,
  onWijzig,
}: {
  titel: string;
  endpoint: string;
  items: Organ[];
  metType?: boolean;
  onWijzig: () => Promise<void>;
}) {
  const [naam, setNaam] = useState("");
  const [type, setType] = useState(metType ? "adviserend" : "");
  const [categorie, setCategorie] = useState(metType ? "bestuurscommissie" : "");

  async function maakAan() {
    if (!naam.trim()) return;
    await jsonFetch(`/api/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({
        naam: naam.trim(),
        ...(metType ? { type, categorie } : {}),
      }),
    });
    setNaam("");
    await onWijzig();
  }

  async function toggleActief(o: Organ) {
    await jsonFetch(`/api/${endpoint}/${o.id}`, {
      method: "PATCH",
      body: JSON.stringify({ actief: !o.actief }),
    });
    await onWijzig();
  }

  const fondsItems = items.filter((o) => o.fonds_id);
  const templates = items.filter((o) => !o.fonds_id);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[#0F2744] mb-3">{titel}</h2>
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Naam</label>
          <input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {metType && (
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Categorie</label>
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {GREMIA_CATEGORIEEN.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIE_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
        )}
        {metType && (
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm capitalize"
            >
              {GREMIA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          onClick={maakAan}
          className="rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#163556]"
        >
          Toevoegen
        </button>
      </div>

      {fondsItems.length === 0 ? (
        <div className="text-gray-400 text-sm mb-2">
          Nog geen fonds-specifieke items. Importeer de standaardset of voeg er een toe.
        </div>
      ) : (
        <div className="space-y-1.5 mb-2">
          {fondsItems.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5"
            >
              <div className="flex-1">
                <span className="text-sm text-[#0F2744]">{o.naam}</span>
                {metType && o.categorie && (
                  <span className="ml-2 rounded bg-[#C9A84C]/15 px-1.5 py-0.5 text-xs text-[#0F2744]">
                    {CATEGORIE_LABEL[o.categorie] ?? o.categorie}
                  </span>
                )}
                {metType && o.type && (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs capitalize text-gray-500">
                    {o.type}
                  </span>
                )}
                {!o.actief && (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                    inactief
                  </span>
                )}
              </div>
              <button
                onClick={() => toggleActief(o)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                {o.actief ? "Deactiveren" : "Activeren"}
              </button>
            </div>
          ))}
        </div>
      )}

      {templates.length > 0 && (
        <details className="text-sm text-gray-500">
          <summary className="cursor-pointer">Globale templates ({templates.length})</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <span key={t.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {t.naam}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
