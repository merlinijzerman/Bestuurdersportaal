"use client";
import { useState, useEffect, useRef } from "react";
import DocumentMetadataModal from "@/core/components/DocumentMetadataModal";
import { bronkaartLabels } from "@/core/lib/bronsoort";
import { DOCUMENTTYPEN, DOCUMENTTYPE_LABEL } from "@/core/lib/document-metadata";
import { uploadDocument } from "@/core/lib/document-upload-client";
import ZoekenPaneel from "./_components/ZoekenPaneel";

interface Document {
  id: string;
  titel: string;
  bron: string;
  bibliotheek: string;
  bestandsnaam: string | null;
  bestandstype: "pdf" | "docx" | "xlsx" | null;
  paginas: number | null;
  geindexeerd: boolean;
  // Async ingest (F3/F4): de pipeline-status waar de UI "Verwerken…"/"Mislukt"
  // uit afleidt. `null` = geen async-pipeline (bv. oud document of OCR-kandidaat).
  verwerkingsstatus: string | null;
  // Besluit 0020/0134 — audit: is dit document via tekstherkenning ontsloten?
  // Zichtbaar maken is bewust: OCR maakt fouten, en een bestuurder die een getal
  // overneemt moet kunnen zien dat er een herkenningsstap tussen bron en citaat zit.
  ocr_toegepast: boolean | null;
  aangemaakt: string;
  actief: boolean;
  opslag_pad: string | null;
  gedeactiveerd_op: string | null;
  deactivatie_reden: string | null;
  // Increment C — metadata/statusmodel
  documenttype: string | null;
  status: string | null;
  bronstatus: string | null;
  metadata_review_status: string | null;
  // Increment C+/B13 — bronsoort (generiek = platform-gecureerd, read-only)
  bronorganisatie: string | null;
  extern_url: string | null;
  normgewicht: string | null;
  geldig_tot: string | null;
}

// Pipeline-statussen waarin een document nog asynchroon wordt verwerkt (F3/F4).
// `beschikbaar` valt hier bewust buiten (dan is geindexeerd true = doorzoekbaar).
const PIPELINE_STATUSSEN = [
  "ontvangen",
  "gevalideerd",
  "gescand",
  "extractie",
  "chunking",
  "embedding",
];

// Boven deze leeftijd toont een nog-verwerkend document een eerlijker tekst
// (§4b verstoring 11): "duurt langer dan verwacht".
const VERWERKING_TRAAG_MS = 15 * 60 * 1000;

const TYPE_LABEL: Record<NonNullable<Document["bestandstype"]>, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
};

const TYPE_KLEUR: Record<NonNullable<Document["bestandstype"]>, string> = {
  pdf: "bg-err-tint text-err-ink",
  docx: "bg-accent-tint text-accent-ink",
  xlsx: "bg-ok-tint text-ok-ink",
};

const BRONNEN = ["DNB", "AFM", "Pensioenfederatie", "Intern", "Extern"];
const BRONKLEUR: Record<string, string> = {
  DNB: "bg-err-tint text-err-ink",
  AFM: "bg-accent-tint text-accent-ink",
  Pensioenfederatie: "bg-ok-tint text-ok-ink",
  Intern: "bg-warn-tint text-warn-ink",
  Extern: "bg-warn-tint text-warn-ink",
};

export default function BibliotheekPage() {
  // Weergave: documentbeheer (titelzoeken + lijst) of uitgebreid inhoudelijk zoeken.
  const [weergave, setWeergave] = useState<"beheren" | "zoeken">("beheren");
  // Standaard de Fondsbibliotheek als eerste/actieve tab (verzoek 29-07): het
  // eigen fondsmateriaal is het startpunt; het generieke kader staat ernaast.
  const [actieveTab, setActieveTab] = useState<"generiek" | "fonds">("fonds");
  const [documenten, setDocumenten] = useState<Document[]>([]);
  const [laden, setLaden] = useState(true);
  // Zoekterm PER TAB (30-07-2026). Eén gedeelde term leverde een verwarrende lege
  // lijst op: je zoekt iets in de Fondsbibliotheek, wisselt naar Generiek en ziet
  // nul resultaten omdat de term van de andere bibliotheek nog in het veld staat.
  const [zoektermen, setZoektermen] = useState<Record<"generiek" | "fonds", string>>({
    fonds: "",
    generiek: "",
  });
  const zoekterm = zoektermen[actieveTab];
  const setZoekterm = (waarde: string) =>
    setZoektermen((s) => ({ ...s, [actieveTab]: waarde }));
  const [toonInactief, setToonInactief] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deactiveerDoc, setDeactiveerDoc] = useState<Document | null>(null);
  const [deactiveerReden, setDeactiveerReden] = useState("");
  const [actieBezig, setActieBezig] = useState(false);
  const [herindexId, setHerindexId] = useState<string | null>(null);
  const [metadataDocId, setMetadataDocId] = useState<string | null>(null);
  // Welke clustergroepen zijn ingeklapt. Leeg = alles uitgeklapt (voorkeur gebruiker).
  const [ingeklapteGroepen, setIngeklapteGroepen] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploaden, setUploaden] = useState(false);
  const [uploadBericht, setUploadBericht] = useState("");
  const bestandRef = useRef<HTMLInputElement>(null);

  const [uploadForm, setUploadForm] = useState({
    titel: "",
    bron: "DNB",
    bibliotheek: "fonds",
    // Besluit 0136 — statusverklaring bij aanlevering. Leeg = concept (default).
    status: "",
    statusReden: "",
  });

  useEffect(() => {
    haalDocumenten();
    // Oude /zoeken-links komen binnen als /bibliotheek?weergave=zoeken.
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (p.get("weergave") === "zoeken") setWeergave("zoeken");
    }
  }, []);

  async function haalDocumenten(stil = false) {
    if (!stil) setLaden(true);
    try {
      const res = await fetch("/api/documents/upload");
      const data = await res.json().catch(() => ({}));
      setDocumenten(data.documenten || []);
    } finally {
      if (!stil) setLaden(false);
    }
  }

  // Polling zolang er documenten in verwerking zijn (F5). Stopt vanzelf zodra de
  // worker ze afrondt (geindexeerd) of markeert als mislukt, en heeft een harde
  // bovengrens op het aantal rondes zodat een vastgelopen document niet eeuwig
  // pollt (dat wordt door de "duurt langer dan verwacht"-tekst afgevangen).
  const pollRondes = useRef(0);
  useEffect(() => {
    const inVerwerking = documenten.some(
      (d) =>
        d.actief &&
        !d.geindexeerd &&
        PIPELINE_STATUSSEN.includes(d.verwerkingsstatus ?? "")
    );
    if (!inVerwerking) {
      pollRondes.current = 0;
      return;
    }
    if (pollRondes.current >= 40) return; // ~3,5 min bij 5s
    const t = setTimeout(() => {
      pollRondes.current += 1;
      haalDocumenten(true);
    }, 5000);
    return () => clearTimeout(t);
  }, [documenten]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const bestand = bestandRef.current?.files?.[0];
    if (!bestand) return;

    setUploaden(true);
    setUploadBericht("");

    try {
      // F7: direct-to-storage. De helper doet init → directe upload → complete
      // en handhaaft de groottegrens (nu MAX_BESTAND_BYTES; de 4,5 MB-muur is weg).
      const res = await uploadDocument(bestand, {
        titel: uploadForm.titel,
        bron: uploadForm.bron,
        bibliotheek: uploadForm.bibliotheek,
        ...(uploadForm.status
          ? { status: uploadForm.status, status_reden: uploadForm.statusReden }
          : {}),
      });

      if (res.ok) {
        // F3: een async-verwerkt document is nog niet doorzoekbaar — geen ✅ dat
        // "klaar" suggereert (guardrail: geen schijnzekerheid).
        const icoon = res.status === "verwerken" ? "⏳" : "✅";
        setUploadBericht(`${icoon} ${res.bericht ?? ""}`);
        haalDocumenten();
        setUploadOpen(false);
        setUploadForm({
          titel: "",
          bron: "DNB",
          bibliotheek: "fonds",
          status: "",
          statusReden: "",
        });
      } else {
        setUploadBericht(
          `❌ ${res.error ?? "Uploaden is niet gelukt. Probeer het opnieuw of neem contact op met de beheerder."}`
        );
      }
    } catch {
      // Netwerkfout of afgebroken verbinding.
      setUploadBericht(
        "❌ Uploaden is niet gelukt door een verbindingsprobleem. Probeer het opnieuw."
      );
    } finally {
      setUploaden(false);
    }
  }

  async function deactiveer(doc: Document, reden: string) {
    setActieBezig(true);
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actie: "deactiveren", reden: reden || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setActieBezig(false);
    if (!res.ok) {
      alert(data?.error || "Deactiveren is niet gelukt.");
      return;
    }
    setDeactiveerDoc(null);
    setDeactiveerReden("");
    haalDocumenten();
  }

  async function reactiveer(doc: Document) {
    setActieBezig(true);
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actie: "reactiveren" }),
    });
    const data = await res.json().catch(() => ({}));
    setActieBezig(false);
    if (!res.ok) {
      alert(data?.error || "Reactiveren is niet gelukt.");
      return;
    }
    haalDocumenten();
  }

  // Her-indexeren: haalt het origineel opnieuw door de extractie-pipeline en
  // vervangt de chunks. Sinds R1.1/R1.2 levert dat structuur-bewuste fragmenten
  // (artikel/§/definitie/tabel blijven heel) én een contextuele zoekindex
  // (context-prefix + verrijkte embedding/FTS); de getoonde brontekst blijft
  // ongewijzigd. Server beperkt dit tot voorzitter/beheerder.
  async function herindexeer(doc: Document) {
    setHerindexId(doc.id);
    setUploadBericht("");
    const res = await fetch(`/api/documents/${doc.id}/her-extract`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    setHerindexId(null);
    if (!res.ok) {
      alert(data?.error || "Her-indexeren is niet gelukt.");
      return;
    }
    setUploadBericht(`✅ ${data.bericht || "Document opnieuw geïndexeerd."}`);
    haalDocumenten();
  }

  // Opnieuw verwerken (F5): een async-mislukt document terug de pipeline in. Zet
  // de verwerkingsstatus server-side terug op 'embedding'; de worker-reaper pikt
  // het daarna op. Geen synchrone her-extractie — de chunks staan er al, alleen
  // de embeddings ontbreken. Server beperkt dit tot voorzitter/beheerder.
  async function herverwerk(doc: Document) {
    setHerindexId(doc.id);
    setUploadBericht("");
    const res = await fetch(`/api/documents/${doc.id}/opnieuw-verwerken`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    setHerindexId(null);
    if (!res.ok) {
      alert(data?.error || "Opnieuw verwerken is niet gelukt.");
      return;
    }
    setUploadBericht("⏳ Het document wordt opnieuw verwerkt.");
    haalDocumenten();
  }

  const gefilterd = documenten.filter(
    (d) =>
      d.bibliotheek === actieveTab &&
      d.titel.toLowerCase().includes(zoekterm.toLowerCase()) &&
      (toonInactief || d.actief)
  );

  const aantalInactief = documenten.filter(
    (d) => d.bibliotheek === actieveTab && !d.actief
  ).length;

  // Increment C — documenten die nog niet zijn verrijkt (review-queue).
  const aantalTeVerrijken = documenten.filter(
    (d) => d.bibliotheek === actieveTab && d.metadata_review_status === "te_controleren"
  ).length;

  function toggleGroep(key: string) {
    setIngeklapteGroepen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Clustering: generieke documenten op bron, fondsdocumenten op documenttype.
  // Lege/onbekende waarden vallen in een 'Overig'/'Zonder type'-groep zodat niets
  // onzichtbaar wordt. Volgorde is betekenisvol (vaste lijst), niet alfabetisch.
  type Groep = { key: string; label: string; docs: Document[] };
  function groepeer(lijst: Document[]): Groep[] {
    const buckets = new Map<string, Document[]>();
    const push = (k: string, d: Document) => {
      const arr = buckets.get(k);
      if (arr) arr.push(d);
      else buckets.set(k, [d]);
    };
    const groepen: Groep[] = [];

    if (actieveTab === "generiek") {
      lijst.forEach((d) => push(d.bron || "Overig", d));
      const overige = [...buckets.keys()].filter((k) => !BRONNEN.includes(k)).sort();
      [...BRONNEN, ...overige].forEach((b) => {
        const docs = buckets.get(b);
        if (docs) groepen.push({ key: b, label: b, docs });
      });
      return groepen;
    }

    lijst.forEach((d) => push(d.documenttype || "__zonder__", d));
    DOCUMENTTYPEN.forEach((t) => {
      const docs = buckets.get(t);
      if (docs) groepen.push({ key: t, label: DOCUMENTTYPE_LABEL[t], docs });
    });
    const zonder = buckets.get("__zonder__");
    if (zonder) groepen.push({ key: "__zonder__", label: "Zonder type", docs: zonder });
    return groepen;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-7">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="font-serif text-xl font-black text-ink">Documentbibliotheek</h1>
          <p className="text-sm text-muted mt-1">
            {weergave === "zoeken"
              ? `Uitgebreid zoeken in de inhoud van ${
                  actieveTab === "fonds" ? "de fondsdocumenten" : "het generieke kader"
                }`
              : actieveTab === "fonds"
              ? "Upload en beheer fondsdocumenten — de kennisbasis voor de AI-assistent"
              : "Centraal gecureerd kader (DNB / AFM / PF) — hier alleen-lezen"}
          </p>
        </div>
        {/* B13 (31-07-2026): uploaden is uitsluitend een FONDS-actie. Generieke
            (platform-gecureerde) documenten worden centraal in het beheerportaal
            (platform-surface, PLATFORM_HOST) beheerd; de tenant is daar read-only.
            De uploadroute weigerde bibliotheek="generiek" al server-side — deze
            knop stond alleen nog op de generieke tab en suggereerde onterecht dat
            je daar kon toevoegen (upload landde stilzwijgend in de fondslijst). */}
        {weergave === "beheren" && actieveTab === "fonds" && (
          <button
            onClick={() => setUploadOpen(true)}
            className="bg-accent text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-accent-ink transition-colors"
          >
            + Document uploaden
          </button>
        )}
        {weergave === "beheren" && actieveTab === "generiek" && (
          <p className="max-w-xs text-xs text-muted sm:text-right">
            Generieke documenten worden centraal gecureerd door de
            platformbeheerder en zijn hier alleen-lezen.
          </p>
        )}
      </div>

      {/* Tabs — sinds 30-07-2026 sturen ze BEIDE weergaven: in "beheren" bepalen ze
          welke lijst je ziet, in "zoeken" waarin je zoekt. Daarom staan ze nu buiten
          de weergave-splitsing. Eén plek waar je kiest met welke bibliotheek je
          bezig bent, in plaats van een tab hier en een bronsoort-dropdown daar. */}
      <div className="flex gap-1 bg-app-bg p-1 rounded-xl mb-5 w-fit">
        {(["fonds", "generiek"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActieveTab(tab);
              // Openstaande uploadmodal sluiten bij wissel naar generiek.
              if (tab === "generiek") setUploadOpen(false);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              actieveTab === tab
                ? "bg-white text-ink shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {tab === "generiek" ? "🏛️ Generiek (DNB / AFM / PF)" : "🏢 Fondsbibliotheek"}
          </button>
        ))}
      </div>

      {/* Uitgebreid zoeken — semantisch zoeken in de documentinhoud. */}
      {weergave === "zoeken" ? (
        <>
          <button
            type="button"
            onClick={() => setWeergave("beheren")}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-accent transition-colors"
          >
            ← Terug naar documenten
          </button>
          <p className="mb-3 text-sm text-muted">
            U doorzoekt de inhoud van{" "}
            <span className="font-semibold text-ink">
              {actieveTab === "fonds"
                ? "de fondsdocumenten van dit fonds"
                : "het generieke kader (DNB / AFM / Pensioenfederatie)"}
            </span>
            . Wissel hierboven van tab om in de andere bibliotheek te zoeken — uw
            zoekterm blijft staan.
          </p>
          <ZoekenPaneel vasteBronsoort={actieveTab} />
        </>
      ) : (
      <>
      {uploadBericht && (
        <div className="mb-4 bg-ok-tint border border-ok/30 rounded-lg px-4 py-3 text-sm text-ok-ink">
          {uploadBericht}
        </div>
      )}

      {/* Increment C — review-banner: nog niet verrijkte documenten */}
      {aantalTeVerrijken > 0 && (
        <div className="mb-4 flex items-center justify-between flex-wrap gap-4 rounded-lg border border-warn/30 bg-warn-tint px-4 py-3">
          <div className="text-sm text-warn-ink">
            <span className="font-semibold">{aantalTeVerrijken}</span>{" "}
            {aantalTeVerrijken === 1 ? "document is" : "documenten zijn"} nog niet
            verrijkt (status/bronstatus/context ontbreken of zijn onzeker).
          </div>
          <a
            href="/beheer"
            className="shrink-0 rounded-lg bg-warn px-3 py-1.5 text-sm font-semibold text-white hover:bg-warn"
          >
            Naar review →
          </a>
        </div>
      )}


      {/* Zoekbalk + toggle */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-line rounded-xl px-4 py-2.5 flex-1 min-w-[260px]">
          <span className="text-muted">🔍</span>
          <input
            type="text"
            placeholder="Zoek op titel..."
            value={zoekterm}
            onChange={(e) => setZoekterm(e.target.value)}
            className="flex-1 outline-none text-sm text-ink bg-transparent"
          />
        </div>
        <label className="flex items-center gap-2 bg-white border border-line rounded-xl px-4 py-2.5 text-sm text-ink cursor-pointer select-none">
          <input
            type="checkbox"
            checked={toonInactief}
            onChange={(e) => setToonInactief(e.target.checked)}
            className="accent-accent"
          />
          Toon gedeactiveerde documenten
          {aantalInactief > 0 && (
            <span className="text-xs text-muted">({aantalInactief})</span>
          )}
        </label>
        <button
          type="button"
          onClick={() => setWeergave("zoeken")}
          title="Zoek op de inhoud van documenten (niet alleen de titel)"
          className="flex items-center gap-2 bg-white border border-line rounded-xl px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent transition-colors"
        >
          🔎 Uitgebreid zoeken
        </button>
      </div>

      {/* Document lijst */}
      {laden ? (
        <div className="text-center py-12 text-muted">Documenten laden...</div>
      ) : gefilterd.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📂</div>
          <h3 className="font-semibold text-ink mb-1">Geen documenten</h3>
          <p className="text-sm text-muted">
            Upload een PDF, Word- of Excel-bestand om te beginnen. De AI-assistent kan dan uw vragen beantwoorden.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groepeer(gefilterd).map((groep) => {
            const groepKey = `${actieveTab}:${groep.key}`;
            const open = !ingeklapteGroepen.has(groepKey);
            return (
              <div key={groepKey}>
                <button
                  type="button"
                  onClick={() => toggleGroep(groepKey)}
                  className="flex items-center gap-2 w-full text-left mb-2"
                >
                  <span
                    className={`text-muted text-[10px] transition-transform ${
                      open ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  <span className="text-sm font-bold text-ink">
                    {groep.label}
                  </span>
                  <span className="rounded-full bg-app-bg px-2 py-0.5 text-xs font-semibold text-muted">
                    {groep.docs.length}
                  </span>
                </button>
                {open && (
                  <div className="space-y-2">
                    {groep.docs.map((doc) => {
            const inactief = !doc.actief;
            const kanInzien = !!doc.opslag_pad;
            const isGeneriek = doc.bibliotheek === "generiek";
            const labels = bronkaartLabels(doc);
            // Besluit 0134 — een actief, niet-geïndexeerd document is niet
            // doorzoekbaar. Bij een PDF is de oorzaak vrijwel altijd een
            // ontbrekende tekstlaag (scan) en is tekstherkenning de remedie;
            // bij een eerder mislukte her-indexering is dat óók de juiste knop.
            // Bij andere bestandstypen tonen we neutraal wát er aan de hand is
            // in plaats van een oorzaak te suggereren die we niet kennen.
            // Generieke documenten uitgesloten: die zijn voor tenants read-only
            // (B13) en de her-indexeerknop is er bewust verborgen. Een badge die
            // naar een menu-item wijst dat er niet is, is erger dan geen badge.
            // Async ingest (F3/F4): onderscheid "wordt verwerkt" en "mislukt" van
            // de OCR-/niet-doorzoekbaar-toestanden, die geen pipeline-status dragen.
            const inVerwerking =
              !inactief &&
              !doc.geindexeerd &&
              PIPELINE_STATUSSEN.includes(doc.verwerkingsstatus ?? "");
            const verwerkingTraag =
              inVerwerking &&
              Date.now() - new Date(doc.aangemaakt).getTime() > VERWERKING_TRAAG_MS;
            const verwerkingMislukt = !inactief && doc.verwerkingsstatus === "mislukt";
            const verwerkingGeweigerd =
              !inactief &&
              (doc.verwerkingsstatus === "geweigerd" ||
                doc.verwerkingsstatus === "gequarantineerd");
            const nietDoorzoekbaar =
              !inactief &&
              !doc.geindexeerd &&
              !isGeneriek &&
              !inVerwerking &&
              !verwerkingMislukt &&
              !verwerkingGeweigerd;
            const tekstherkenningNodig =
              nietDoorzoekbaar && doc.bestandstype === "pdf" && kanInzien;
            return (
              <div
                key={doc.id}
                className={`relative bg-white border rounded-xl p-4 flex items-center gap-4 transition-colors ${
                  inactief
                    ? "border-line opacity-70"
                    : "border-line hover:border-accent"
                }`}
              >
                <div className="w-10 h-10 bg-app-bg rounded-lg flex items-center justify-center text-xl flex-shrink-0">
                  📋
                </div>
                <div className="flex-1 min-w-0">
                  {kanInzien && !inactief ? (
                    <a
                      href={`/api/documents/${doc.id}/bestand`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-ink text-sm truncate hover:text-accent transition-colors block"
                      title="Origineel openen of downloaden"
                    >
                      {doc.titel}
                    </a>
                  ) : (
                    <div
                      className={`font-semibold text-sm truncate ${
                        inactief ? "text-muted" : "text-ink"
                      }`}
                    >
                      {doc.titel}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        BRONKLEUR[doc.bron] || "bg-app-bg text-muted"
                      }`}
                    >
                      {doc.bron}
                    </span>
                    {doc.bestandstype && (
                      <span
                        className={`px-2 py-0.5 rounded-full font-semibold ${TYPE_KLEUR[doc.bestandstype]}`}
                      >
                        {TYPE_LABEL[doc.bestandstype]}
                      </span>
                    )}
                    {isGeneriek && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-tint text-accent-ink font-semibold border border-accent/30">
                        {labels.bronsoortLabel}
                      </span>
                    )}
                    {isGeneriek && labels.vervallen && (
                      <span className="px-2 py-0.5 rounded-full bg-err-tint text-err-ink font-semibold border border-err/30">
                        {labels.vervallenLabel}
                      </span>
                    )}
                    {doc.paginas && (
                      <span>
                        {doc.paginas}{" "}
                        {doc.bestandstype === "xlsx" ? "tabbladen" : "pag."}
                      </span>
                    )}
                    <span>
                      {new Date(doc.aangemaakt).toLocaleDateString("nl-NL")}
                    </span>
                    {doc.geindexeerd && !inactief && (
                      <span className="text-ok-ink font-semibold">
                        ✓ Geïndexeerd
                      </span>
                    )}
                    {inVerwerking && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-warn-tint text-warn-ink font-semibold"
                        title={
                          verwerkingTraag
                            ? "De verwerking duurt langer dan verwacht. Neem contact op met de beheerder als dit aanhoudt."
                            : "Dit document wordt nu verwerkt en is binnen enkele minuten doorzoekbaar."
                        }
                      >
                        ⏳ {verwerkingTraag ? "Verwerken — duurt langer dan verwacht" : "Verwerken…"}
                      </span>
                    )}
                    {verwerkingMislukt && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-err-tint text-err-ink font-semibold"
                        title="De verwerking is mislukt. Een voorzitter of beheerder kan 'Opnieuw verwerken' kiezen."
                      >
                        Verwerking mislukt
                      </span>
                    )}
                    {verwerkingGeweigerd && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-err-tint text-err-ink font-semibold"
                        title="Dit bestand is bij de veiligheidscontrole afgewezen en is niet doorzoekbaar."
                      >
                        Geweigerd
                      </span>
                    )}
                    {doc.ocr_toegepast && !inactief && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-app-bg text-muted font-semibold"
                        title="De tekst van dit document is via tekstherkenning (OCR) uit een scan gehaald. Controleer overgenomen getallen tegen het origineel."
                      >
                        Via tekstherkenning
                      </span>
                    )}
                    {tekstherkenningNodig && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-warn-tint text-warn-ink font-semibold"
                        title="Deze PDF bevat geen tekstlaag — vermoedelijk een scan. Kies in het menu 'Tekstherkenning uitvoeren' om het document alsnog doorzoekbaar te maken."
                      >
                        Tekstherkenning nodig
                      </span>
                    )}
                    {nietDoorzoekbaar && !tekstherkenningNodig && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-warn-tint text-warn-ink font-semibold"
                        title="Dit document is nog niet geïndexeerd en wordt daarom niet door de assistent gevonden."
                      >
                        Nog niet doorzoekbaar
                      </span>
                    )}
                    {doc.status && !inactief && (
                      <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted font-semibold">
                        {doc.status}
                      </span>
                    )}
                    {doc.metadata_review_status === "te_controleren" && !inactief && (
                      <span className="px-2 py-0.5 rounded-full bg-warn-tint text-warn-ink font-semibold">
                        Nog niet verrijkt
                      </span>
                    )}
                    {inactief && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-err-tint text-err-ink font-semibold"
                        title={doc.deactivatie_reden ?? undefined}
                      >
                        Gedeactiveerd
                      </span>
                    )}
                    {!kanInzien && !inactief && (
                      <span
                        className="text-muted"
                        title="Origineel niet beschikbaar — vóór mei 2026 geüpload"
                      >
                        Origineel niet beschikbaar
                      </span>
                    )}
                  </div>
                  {inactief && doc.deactivatie_reden && (
                    <div className="text-xs text-muted mt-1 italic">
                      Reden: {doc.deactivatie_reden}
                    </div>
                  )}
                  {tekstherkenningNodig && (
                    <div className="text-xs text-muted mt-1 italic">
                      Geen tekstlaag gevonden — de assistent kan dit document nog
                      niet doorzoeken. Een voorzitter of beheerder kan in het menu
                      &quot;Tekstherkenning uitvoeren&quot; kiezen.
                    </div>
                  )}
                </div>

                {/* Kebab-menu */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() =>
                      setOpenMenuId(openMenuId === doc.id ? null : doc.id)
                    }
                    className="w-8 h-8 rounded-lg hover:bg-app-bg flex items-center justify-center text-muted text-lg"
                    aria-label="Acties"
                  >
                    ⋮
                  </button>
                  {openMenuId === doc.id && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setOpenMenuId(null)}
                      />
                      <div className="absolute right-0 top-9 z-20 bg-white border border-line rounded-lg shadow-lg py-1 min-w-[180px]">
                        {!inactief && (
                          <button
                            onClick={() => {
                              setMetadataDocId(doc.id);
                              setOpenMenuId(null);
                            }}
                            className="w-full text-left px-4 py-2 text-sm font-medium text-ink hover:bg-warn-tint"
                            title={
                              isGeneriek
                                ? "Generiek document — metadata is alleen-lezen (centraal beheerd)"
                                : "Status, bronstatus, context en datums bewerken (geen herupload)"
                            }
                          >
                            {isGeneriek ? "Metadata bekijken" : "Metadata bewerken"}
                          </button>
                        )}
                        {!inactief && doc.geindexeerd && (
                          <a
                            href={`/ai?doc=${doc.id}`}
                            onClick={() => setOpenMenuId(null)}
                            className="block px-4 py-2 text-sm font-medium text-ink hover:bg-warn-tint"
                            title="Open de AI-assistent met de vraag beperkt tot dit document"
                          >
                            Vraag de AI over dit stuk
                          </a>
                        )}
                        {kanInzien && !inactief && (
                          <a
                            href={`/api/documents/${doc.id}/bestand`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpenMenuId(null)}
                            className="block px-4 py-2 text-sm text-ink hover:bg-app-bg"
                          >
                            Bekijken
                          </a>
                        )}
                        {/* B13: schrijfacties (her-indexeren/deactiveren) zijn
                            voor generieke documenten verborgen — tenants zijn
                            read-only op generiek; RLS blokkeert ze hoe dan ook. */}
                        {kanInzien && !inactief && !isGeneriek && (
                          <button
                            onClick={() => {
                              herindexeer(doc);
                              setOpenMenuId(null);
                            }}
                            disabled={herindexId === doc.id}
                            className="w-full text-left px-4 py-2 text-sm text-ink hover:bg-app-bg disabled:opacity-50"
                            title={
                              tekstherkenningNodig
                                ? "Tekstherkenning (OCR) op het origineel uitvoeren en het document alsnog doorzoekbaar maken (voorzitter/beheerder). Kan enkele minuten duren."
                                : "Origineel opnieuw door de extractie-pipeline halen: structuur-bewuste fragmenten + verbeterde (contextuele) zoekindex (voorzitter/beheerder)"
                            }
                          >
                            {herindexId === doc.id
                              ? tekstherkenningNodig
                                ? "Bezig met tekstherkenning..."
                                : "Bezig met her-indexeren..."
                              : tekstherkenningNodig
                                ? "Tekstherkenning uitvoeren"
                                : "Her-indexeren"}
                          </button>
                        )}
                        {!inactief && !isGeneriek && verwerkingMislukt && (
                          <button
                            onClick={() => {
                              herverwerk(doc);
                              setOpenMenuId(null);
                            }}
                            disabled={herindexId === doc.id}
                            className="w-full text-left px-4 py-2 text-sm text-ink hover:bg-app-bg disabled:opacity-50"
                            title="De verwerking is mislukt. Zet het document opnieuw in de verwerkingswachtrij (voorzitter/beheerder)."
                          >
                            {herindexId === doc.id
                              ? "Bezig..."
                              : "Opnieuw verwerken"}
                          </button>
                        )}
                        {!isGeneriek &&
                          (!inactief ? (
                            <button
                              onClick={() => {
                                setDeactiveerDoc(doc);
                                setOpenMenuId(null);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-err-ink hover:bg-err-tint"
                            >
                              Deactiveren
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                reactiveer(doc);
                                setOpenMenuId(null);
                              }}
                              disabled={actieBezig}
                              className="w-full text-left px-4 py-2 text-sm text-ok-ink hover:bg-ok-tint disabled:opacity-50"
                            >
                              Reactiveren
                            </button>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      {/* Deactiveer-bevestiging */}
      {deactiveerDoc && (
        <div className="fixed inset-0 bg-accent/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-7 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-2">
              Document deactiveren
            </h2>
            <p className="text-sm text-muted mb-4">
              <span className="font-semibold">{deactiveerDoc.titel}</span> wordt
              uitgesloten van zoeken en AI-antwoorden. Het origineel en de
              chunks blijven bewaard; reactiveren kan later weer.
            </p>
            <label className="block text-sm font-semibold text-ink mb-1">
              Reden (optioneel)
            </label>
            <textarea
              value={deactiveerReden}
              onChange={(e) => setDeactiveerReden(e.target.value)}
              rows={3}
              placeholder="bijv. verouderd, vervangen door nieuwere versie..."
              className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeactiveerDoc(null);
                  setDeactiveerReden("");
                }}
                className="flex-1 border border-line rounded-lg py-2.5 text-sm font-semibold text-muted hover:bg-app-bg"
              >
                Annuleren
              </button>
              <button
                onClick={() => deactiveer(deactiveerDoc, deactiveerReden)}
                disabled={actieBezig}
                className="flex-1 bg-err text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-err disabled:opacity-50"
              >
                {actieBezig ? "Bezig..." : "Deactiveren"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metadata-bewerkmodal (Increment C) */}
      {metadataDocId && (
        <DocumentMetadataModal
          documentId={metadataDocId}
          onClose={() => setMetadataDocId(null)}
          onSaved={haalDocumenten}
        />
      )}

      {/* Upload modal — alleen op de fondstab (zie B13 hierboven). */}
      {uploadOpen && actieveTab === "fonds" && (
        <div className="fixed inset-0 bg-accent/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-7 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
              <h2 className="text-lg font-bold text-ink">Document uploaden</h2>
              <button
                onClick={() => setUploadOpen(false)}
                className="text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">
                  Bestand
                </label>
                <input
                  ref={bestandRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  required
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-[11px] text-muted mt-1">
                  PDF, Word (.docx) of Excel (.xlsx). Gescande PDF&apos;s eerst
                  doorzoekbaar maken via Acrobat/Preview.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Titel</label>
                <input
                  type="text"
                  value={uploadForm.titel}
                  onChange={(e) => setUploadForm({ ...uploadForm, titel: e.target.value })}
                  placeholder="bijv. DNB Leidraad Deskundigheid 2024"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Bron</label>
                <select
                  value={uploadForm.bron}
                  onChange={(e) => setUploadForm({ ...uploadForm, bron: e.target.value })}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none"
                >
                  {BRONNEN.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              {/* Besluit 0136 — statusverklaring bij aanlevering. De keten
                  concept -> ter bespreking -> ter besluitvorming -> vastgesteld
                  modelleert een stuk dat IN het portaal ontstaat. Een reglement
                  of jaarverslag is buiten het portaal al vastgesteld; dat hier
                  verklaren is eerlijker dan achteraf drie overgangen doorlopen
                  die nooit hebben plaatsgevonden. Server-side gevalideerd tegen
                  dezelfde transitietabel (rechten + redenplicht). */}
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">
                  Status bij aanlevering
                </label>
                <select
                  value={uploadForm.status}
                  onChange={(e) =>
                    setUploadForm({ ...uploadForm, status: e.target.value })
                  }
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none"
                >
                  <option value="">Concept — nog geen actuele bron</option>
                  <option value="vastgesteld">
                    Vastgesteld — buiten het portaal vastgesteld
                  </option>
                  <option value="van_kracht">
                    Van kracht — buiten het portaal geldend
                  </option>
                </select>
                <p className="text-[11px] text-muted mt-1">
                  Alleen &quot;vastgesteld&quot; en &quot;van kracht&quot; tellen
                  als actuele bron voor de assistent. Laat op concept staan als
                  het stuk nog in besluitvorming is.
                </p>
              </div>
              {uploadForm.status && (
                <div>
                  <label className="block text-sm font-semibold text-ink mb-1">
                    Reden <span className="font-normal text-muted">(verplicht)</span>
                  </label>
                  <input
                    type="text"
                    value={uploadForm.statusReden}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, statusReden: e.target.value })
                    }
                    placeholder="bijv. vastgesteld in bestuursvergadering 12-03-2026"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                    required
                  />
                  <p className="text-[11px] text-muted mt-1">
                    Deze reden landt in het auditlog bij het document.
                  </p>
                </div>
              )}
              {/* B13: tenants uploaden uitsluitend naar de fondsbibliotheek.
                  Generieke (platform-gecureerde) documenten worden centraal beheerd. */}
              <p className="text-[11px] text-muted -mt-1">
                Dit document wordt opgeslagen in de <span className="font-semibold">fondsbibliotheek</span>.
                Generieke (DNB/AFM/PF) documenten worden centraal beheerd en zijn alleen-lezen.
              </p>
              {uploadBericht && (
                <div className="text-sm text-err-ink">{uploadBericht}</div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setUploadOpen(false)}
                  className="flex-1 border border-line rounded-lg py-2.5 text-sm font-semibold text-muted hover:bg-app-bg"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={uploaden}
                  className="flex-1 bg-accent text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-accent-ink disabled:opacity-50"
                >
                  {uploaden ? "Verwerken..." : "Uploaden & indexeren"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
