"use client";
import { Fragment, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import DocumentMetadataModal from "@/core/components/DocumentMetadataModal";
import DocumentUploadModal, {
  type RetireKandidaat,
} from "@/core/components/DocumentUploadModal";
import {
  DOCUMENTTYPEN,
  DOCUMENTTYPE_LABEL,
} from "@/core/lib/document-metadata";
import { isActueleRapportageVoorganger } from "@/core/lib/document-rapportage-retire";
// Besluit 0140 — bijzonderheden en classificatie bij aanlevering leven in pure,
// geteste modules; deze pagina rendert ze alleen. Het uploadformulier zelf is
// geëxtraheerd naar core/components/DocumentUploadModal (herbruikbaar in proces
// en vergadering).
import {
  bepaalBijzonderheden,
  telBijzonderheden,
  PIPELINE_STATUSSEN,
  type Bijzonderheid,
} from "@/core/lib/document-bijzonderheden";
import { BRONSTATUS_LABEL } from "@/core/lib/document-status-transities";
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
  // Increment C+/B13 — bronsoort (generiek = platform-gecureerd, read-only)
  bronorganisatie: string | null;
  extern_url: string | null;
  normgewicht: string | null;
  geldig_tot: string | null;
}

const TYPE_LABEL: Record<NonNullable<Document["bestandstype"]>, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
};

// Besluit 0140 — het bestandstype staat vooraan als vaste kolom en is bewust
// KLEURLOOS. De eerdere kleur-per-type (PDF rood, Word blauw, Excel groen) gaf
// drie extra kleuren in een rij waarin de kleur nodig is voor de bijzonderheden.
// Het blokje bakent de kolom af; de tekst doet het werk.
const TYPE_BLOK =
  "inline-flex items-center justify-center min-w-[46px] h-5 rounded border " +
  "border-app-line-strong bg-app-zebra text-[9.5px] font-bold tracking-wider text-muted";

// Groepsvolgorde op de generieke tab (betekenisvol, niet alfabetisch).
const BRONNEN = ["DNB", "AFM", "Pensioenfederatie", "Intern", "Extern"];

// Hoeveel documenten een groep in rust toont. Bewust "toon er meer" en geen
// paginering: zoeken en filteren werken over de HELE groep, en de groepskop
// blijft de volledige telling tonen, zodat je nooit denkt dat je alles ziet.
const GROEP_STAP = 25;

/** Kleur per soort bijzonderheid. De stip draagt de kleur, de tekst blijft
 *  gedempt — dat houdt een tabel met tientallen rijen rustig. Vorm is de
 *  tweede, niet-kleurgebonden drager (besluit 0097). */
const SOORT_STIP: Record<Bijzonderheid["soort"], string> = {
  fout: "bg-err rotate-45 rounded-[2px]",
  let_op: "bg-warn rounded-full",
  audit: "bg-phase rounded-[2px]",
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
  // Positie van het kebab-menu. Het menu wordt via een portal in <body>
  // gerenderd (fixed), zodat het niet langer door de horizontaal scrollende
  // tabelcontainer (`overflow-x-auto`) wordt afgekapt. Bij openen berekenen we
  // de plek t.o.v. de knop; onderaan het scherm klapt het naar boven open.
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number | null;
    bottom: number | null;
  } | null>(null);
  // Een fixed-gepositioneerd menu volgt de knop niet mee bij scrollen; sluit het
  // daarom zodra er gescrolld (ook binnen de tabelcontainer, vandaar capture) of
  // geresized wordt, zodat het nooit losgekoppeld blijft zweven.
  useEffect(() => {
    if (openMenuId === null) return;
    const sluit = () => setOpenMenuId(null);
    window.addEventListener("scroll", sluit, true);
    window.addEventListener("resize", sluit);
    return () => {
      window.removeEventListener("scroll", sluit, true);
      window.removeEventListener("resize", sluit);
    };
  }, [openMenuId]);
  const [deactiveerDoc, setDeactiveerDoc] = useState<Document | null>(null);
  const [deactiveerReden, setDeactiveerReden] = useState("");
  const [actieBezig, setActieBezig] = useState(false);
  const [herindexId, setHerindexId] = useState<string | null>(null);
  const [metadataDocId, setMetadataDocId] = useState<string | null>(null);
  // Welke clustergroepen zijn ingeklapt. Leeg = alles uitgeklapt (voorkeur gebruiker).
  const [ingeklapteGroepen, setIngeklapteGroepen] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBericht, setUploadBericht] = useState("");

  // Besluit 0140 — hoeveel documenten er per groep zijn uitgeklapt ("toon er
  // meer"). Afwezig = de standaardstap. Gaat bewust op groepsleutel en niet op
  // index: bij zoeken/filteren verschuift de volgorde, de sleutel niet.
  const [zichtbaarPerGroep, setZichtbaarPerGroep] = useState<Record<string, number>>({});

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
        (PIPELINE_STATUSSEN as readonly string[]).includes(d.verwerkingsstatus ?? "")
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

  // F3: een async-verwerkt document is nog niet doorzoekbaar — geen ✅ dat
  // "klaar" suggereert (guardrail: geen schijnzekerheid). De upload zelf loopt
  // nu via de gedeelde DocumentUploadModal; deze callback vangt het resultaat.
  function naUpload(res: { status?: string; bericht?: string }) {
    const icoon = res.status === "verwerken" ? "⏳" : "✅";
    setUploadBericht(`${icoon} ${res.bericht ?? ""}`);
    haalDocumenten();
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

  // Her-indexeren: zet het document terug de async pipeline in. De worker haalt
  // het origineel opnieuw uit Storage, her-extraheert (OCR tot 200 pagina's, geen
  // requesttimeout) en vervangt de chunks idempotent — sinds R1.1/R1.2 met
  // structuur-bewuste fragmenten en een contextuele zoekindex; de getoonde
  // brontekst blijft ongewijzigd. Geen ✅ (nog niet klaar): het document gaat op
  // "Verwerken…" en wordt door de polling gevolgd. Server beperkt dit tot
  // voorzitter/beheerder.
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
    setUploadBericht(`⏳ ${data.bericht || "Het document wordt opnieuw geïndexeerd."}`);
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

  // Rapportage-retire-kandidaten voor de uploadmodal: actieve fondsrapportages
  // die een actuele voorganger kunnen zijn. De modal toont de picker alleen bij
  // een nieuwe, actuele rapportage.
  const retireKandidaten: RetireKandidaat[] = documenten
    .filter(
      (d) =>
        d.bibliotheek === "fonds" &&
        d.actief &&
        d.documenttype === "rapportage" &&
        isActueleRapportageVoorganger(
          d.status as Parameters<typeof isActueleRapportageVoorganger>[0]
        )
    )
    .map((d) => ({ id: d.id, titel: d.titel }));

  // Aantal kolommen in de tabel — de kolom "Bron" bestaat alleen op de generieke
  // tab. Groepskoppen en de "toon er meer"-rij spannen hierover.
  const kolomAantal = actieveTab === "generiek" ? 8 : 7;

  return (
    <div className="p-4 sm:p-6 lg:p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="font-serif text-lg font-bold text-ink">Documentbibliotheek</h1>
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
      <div className="flex gap-1 bg-app-bg p-1 rounded-xl mb-4 w-fit">
        {(["fonds", "generiek"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActieveTab(tab);
              // Openstaande uploadmodal sluiten bij wissel naar generiek.
              if (tab === "generiek") setUploadOpen(false);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              actieveTab === tab
                ? "bg-white text-ink shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {tab === "generiek" ? "🏛️ Sectorbibliotheek" : "🏢 Fondsbibliotheek"}
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

      {/* Zoekbalk + toggle */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-line rounded-xl px-3 py-2 flex-1 min-w-[260px]">
          <span className="text-muted">🔍</span>
          <input
            type="text"
            placeholder="Zoek op titel..."
            value={zoekterm}
            onChange={(e) => setZoekterm(e.target.value)}
            className="flex-1 outline-none text-sm text-ink bg-transparent"
          />
        </div>
        <label className="flex items-center gap-2 bg-white border border-line rounded-xl px-3 py-2 text-sm text-ink cursor-pointer select-none">
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
          className="flex items-center gap-2 bg-white border border-line rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:border-accent transition-colors"
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
        /* Besluit 0140 — tabelweergave. Vaste kolomposities in plaats van een
           badgerij: het oog leert waar de datum staat en kan hele kolommen
           aflopen. De kolom "Bijzonderheden" is in rust LEEG; dat lege veld is
           het punt, want daardoor springt een afwijking eruit. */
        <div className="overflow-x-auto rounded-xl border border-line bg-app-surface shadow-card">
          {/* `table-fixed` is essentieel: zonder dat verbreedt de browser de
              titelkolom op de langste titel, duwt hij de rechterkolommen buiten
              beeld en werkt `truncate` niet. Met vaste layout houden alle rijen
              dezelfde kolomgrenzen en kapt de titel netjes af. */}
          <table className="w-full min-w-[860px] table-fixed text-[13px]">
            <thead>
              <tr className="bg-app-zebra text-left align-middle text-[10.5px] font-bold uppercase tracking-wider text-muted">
                <th className="w-[62px] whitespace-nowrap border-b-[1.5px] border-app-line-strong px-3 py-2.5">
                  Type
                </th>
                <th className="border-b-[1.5px] border-app-line-strong px-3 py-2.5">
                  Document
                </th>
                {/* Bron staat alleen op de GENERIEKE tab. In de fondsbibliotheek
                    is vrijwel alles "Intern" — een kolom die bij 90% van de
                    rijen hetzelfde zegt kost breedte en levert niets op. Op de
                    generieke tab varieert hij wél (DNB/AFM/PF) en is hij juist
                    de meest informatieve kolom. */}
                {actieveTab === "generiek" && (
                  <th className="w-[86px] whitespace-nowrap border-b-[1.5px] border-app-line-strong px-3 py-2.5">
                    Bron
                  </th>
                )}
                <th className="w-[92px] whitespace-nowrap border-b-[1.5px] border-app-line-strong px-3 py-2.5">
                  Bronstatus
                </th>
                <th className="w-[78px] whitespace-nowrap border-b-[1.5px] border-app-line-strong px-3 py-2.5 text-right">
                  Omvang
                </th>
                <th className="w-[100px] whitespace-nowrap border-b-[1.5px] border-app-line-strong px-3 py-2.5 text-right">
                  Toegevoegd
                </th>
                <th className="w-[196px] border-b-[1.5px] border-app-line-strong px-3 py-2.5">
                  Bijzonderheden
                </th>
                <th className="w-[40px] border-b-[1.5px] border-app-line-strong px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
          {groepeer(gefilterd).map((groep) => {
            const groepKey = `${actieveTab}:${groep.key}`;
            const open = !ingeklapteGroepen.has(groepKey);
            const zichtbaar = zichtbaarPerGroep[groepKey] ?? GROEP_STAP;
            const getoond = open ? groep.docs.slice(0, zichtbaar) : [];
            const rest = groep.docs.length - getoond.length;
            const samenvatting = telBijzonderheden(groep.docs);
            return (
              <Fragment key={groepKey}>
                <tr>
                  <td colSpan={kolomAantal} className="border-b border-app-line-strong bg-app-bg p-0">
                    <button
                      type="button"
                      onClick={() => toggleGroep(groepKey)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-accent-tint hover:text-accent-ink"
                    >
                      <span
                        className={`text-[9px] transition-transform ${open ? "" : "-rotate-90"}`}
                      >
                        ▼
                      </span>
                      {groep.label}
                      <span className="rounded-full border border-line bg-app-surface px-2 py-0.5 text-[10.5px] font-semibold normal-case tracking-normal">
                        {groep.docs.length}
                      </span>
                      {/* Zonder deze samenvatting verbergt inklappen precies de
                          informatie die je zoekt: je klapt een groep dicht en
                          mist dat daar een niet-verwerkt document in zit. */}
                      <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-medium normal-case tracking-normal text-muted">
                        <span
                          className={`h-[7px] w-[7px] shrink-0 ${
                            samenvatting.zwaarste
                              ? SOORT_STIP[samenvatting.zwaarste]
                              : "rounded-full bg-ok"
                          }`}
                        />
                        {samenvatting.met > 0
                          ? `${samenvatting.met} met bijzonderheden`
                          : "geen bijzonderheden"}
                      </span>
                    </button>
                  </td>
                </tr>
                {getoond.map((doc) => {
            const inactief = !doc.actief;
            const kanInzien = !!doc.opslag_pad;
            const isGeneriek = doc.bibliotheek === "generiek";
            // Besluit 0140 — de bijzonderheden komen uit één pure, geteste
            // functie (core/lib/document-bijzonderheden.ts). Hier stond eerder
            // een reeks booleans met onderlinge uitsluitingen; precies het soort
            // logica dat stil verkeerd gaat zodra er een pipeline-status bijkomt.
            const bijzonderheden = bepaalBijzonderheden(doc);
            // Twee afgeleiden die het MENU nog nodig heeft (niet de rij).
            const verwerkingMislukt = !inactief && doc.verwerkingsstatus === "mislukt";
            const tekstherkenningNodig = bijzonderheden.some(
              (b) => b.sleutel === "geen_tekstlaag"
            );
            return (
              <tr
                key={doc.id}
                className={`align-middle transition-colors hover:bg-app-zebra ${
                  inactief ? "opacity-70" : ""
                }`}
              >
                <td className="border-b border-line px-3 py-2">
                  {doc.bestandstype ? (
                    <span className={TYPE_BLOK}>{TYPE_LABEL[doc.bestandstype]}</span>
                  ) : (
                    <span className={TYPE_BLOK}>—</span>
                  )}
                </td>

                {/* `max-w-0` is de standaardtruc om `truncate` te laten werken in
                    een `table-fixed`: zonder dat groeit de cel mee met de inhoud
                    en wordt er niets afgekapt. */}
                <td className="max-w-0 border-b border-line px-3 py-2">
                  {kanInzien && !inactief ? (
                    <a
                      href={`/api/documents/${doc.id}/bestand`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-semibold text-ink transition-colors hover:text-accent hover:underline"
                      title={doc.titel}
                    >
                      {doc.titel}
                    </a>
                  ) : (
                    <div
                      className={`truncate font-semibold ${
                        inactief ? "text-muted line-through" : "text-ink"
                      }`}
                      title={
                        kanInzien
                          ? doc.titel
                          : `${doc.titel} — origineel niet beschikbaar (vóór mei 2026 geüpload)`
                      }
                    >
                      {doc.titel}
                    </div>
                  )}
                </td>

                {actieveTab === "generiek" && (
                  <td className="whitespace-nowrap border-b border-line px-3 py-2 text-[12px] text-muted">
                    {doc.bron}
                  </td>
                )}

                {/* Bronstatus: NULL ≡ actief (migratie 2026_06_18 §2d). "Actief"
                    is de normale toestand en blijft daarom gedempt; een afwijking
                    krijgt een pill zodat hij opvalt. */}
                <td className="whitespace-nowrap border-b border-line px-3 py-2">
                  {doc.bronstatus && doc.bronstatus !== "actief" ? (
                    <span className="inline-flex h-5 items-center rounded-full bg-app-bg px-2 text-[10.5px] font-semibold text-muted">
                      {BRONSTATUS_LABEL[
                        doc.bronstatus as keyof typeof BRONSTATUS_LABEL
                      ] ?? doc.bronstatus}
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted">Actief</span>
                  )}
                </td>

                <td className="whitespace-nowrap border-b border-line px-3 py-2 text-right text-[12px] tabular-nums text-muted">
                  {doc.paginas
                    ? `${doc.paginas} ${doc.bestandstype === "xlsx" ? "tabbladen" : "pag."}`
                    : "—"}
                </td>

                <td className="whitespace-nowrap border-b border-line px-3 py-2 text-right text-[12px] tabular-nums text-muted">
                  {new Date(doc.aangemaakt).toLocaleDateString("nl-NL")}
                </td>

                {/* In rust leeg. Dat is het uitgangspunt van 0140: alleen
                    afwijkingen krijgen beeldoppervlak. De kleur zit in de stip,
                    niet in de tekst — dat houdt een lange tabel rustig. */}
                <td className="border-b border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {bijzonderheden.map((b) => (
                      <span
                        key={b.sleutel}
                        title={b.toelichting}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted"
                      >
                        <span className={`h-[7px] w-[7px] shrink-0 ${SOORT_STIP[b.soort]}`} />
                        {b.label}
                      </span>
                    ))}
                  </div>
                </td>

                <td className="border-b border-line px-2 py-2 text-center align-middle">
                {/* Kebab-menu */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={(e) => {
                      if (openMenuId === doc.id) {
                        setOpenMenuId(null);
                        return;
                      }
                      const rect = e.currentTarget.getBoundingClientRect();
                      const MENU_W = 200;
                      const SCHATTING_H = 260;
                      const marge = 8;
                      const left = Math.max(
                        marge,
                        Math.min(
                          rect.right - MENU_W,
                          window.innerWidth - MENU_W - marge
                        )
                      );
                      const naarBoven =
                        rect.bottom + SCHATTING_H > window.innerHeight &&
                        rect.top > SCHATTING_H;
                      setMenuPos(
                        naarBoven
                          ? {
                              left,
                              top: null,
                              bottom: window.innerHeight - rect.top + 4,
                            }
                          : { left, top: rect.bottom + 4, bottom: null }
                      );
                      setOpenMenuId(doc.id);
                    }}
                    className="w-8 h-8 rounded-lg hover:bg-app-bg flex items-center justify-center text-muted text-lg"
                    aria-label="Acties"
                  >
                    ⋮
                  </button>
                  {openMenuId === doc.id &&
                    menuPos &&
                    typeof document !== "undefined" &&
                    createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpenMenuId(null)}
                      />
                      <div
                        className="fixed z-50 min-w-[190px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-line bg-app-surface py-1 shadow-lg"
                        style={{
                          left: menuPos.left,
                          top: menuPos.top ?? undefined,
                          bottom: menuPos.bottom ?? undefined,
                          maxHeight: "calc(100vh - 24px)",
                        }}
                      >
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
                    </>,
                    document.body
                  )}
                </div>
                </td>
              </tr>
            );
                })}
                {/* "Toon er meer" — geen paginering (besluit 0140). De telling
                    hierboven blijft de VOLLEDIGE groep tonen, zodat je nooit
                    denkt dat je alles ziet terwijl dat niet zo is. */}
                {open && rest > 0 && (
                  <tr>
                    <td
                      colSpan={kolomAantal}
                      className="border-b border-app-line-strong bg-app-zebra px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
                        <span>
                          {getoond.length} van {groep.docs.length} getoond
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setZichtbaarPerGroep((s) => ({
                              ...s,
                              [groepKey]: zichtbaar + GROEP_STAP,
                            }))
                          }
                          className="rounded-lg border border-app-line-control bg-app-surface px-3 py-1 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-app-zebra"
                        >
                          Toon volgende {Math.min(GROEP_STAP, rest)}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setZichtbaarPerGroep((s) => ({
                              ...s,
                              [groepKey]: groep.docs.length,
                            }))
                          }
                          className="rounded-lg border border-app-line-control bg-app-surface px-3 py-1 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-app-zebra"
                        >
                          Toon alle {groep.docs.length}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {open && rest <= 0 && zichtbaar > GROEP_STAP && (
                  <tr>
                    <td
                      colSpan={kolomAantal}
                      className="border-b border-app-line-strong bg-app-zebra px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
                        <span>Alle {groep.docs.length} documenten getoond</span>
                        <button
                          type="button"
                          onClick={() =>
                            setZichtbaarPerGroep((s) => ({ ...s, [groepKey]: GROEP_STAP }))
                          }
                          className="rounded-lg border border-app-line-control bg-app-surface px-3 py-1 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-app-zebra"
                        >
                          Weer inkorten
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      {/* Deactiveer-bevestiging */}
      {deactiveerDoc && (
        <div className="fixed inset-0 bg-accent/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-xl">
            <h2 className="text-base font-bold text-ink mb-2">
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

      {/* Upload modal (gedeelde component, besluit 0140) — alleen op de
          fondstab (B13). Het volledige metadatapalet zit nu in
          core/components/DocumentUploadModal, gedeeld met proces en vergadering. */}
      {uploadOpen && actieveTab === "fonds" && (
        <DocumentUploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={naUpload}
          retireKandidaten={retireKandidaten}
        />
      )}
    </div>
  );
}
