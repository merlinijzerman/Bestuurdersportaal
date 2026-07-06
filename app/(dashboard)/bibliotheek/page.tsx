"use client";
import { useState, useEffect, useRef } from "react";
import DocumentMetadataModal from "@/components/DocumentMetadataModal";
import { bronkaartLabels } from "@/lib/bronsoort";
import { DOCUMENTTYPEN, DOCUMENTTYPE_LABEL } from "@/lib/document-metadata";
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

const TYPE_LABEL: Record<NonNullable<Document["bestandstype"]>, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
};

const TYPE_KLEUR: Record<NonNullable<Document["bestandstype"]>, string> = {
  pdf: "bg-red-50 text-red-700",
  docx: "bg-blue-50 text-blue-700",
  xlsx: "bg-emerald-50 text-emerald-700",
};

const BRONNEN = ["DNB", "AFM", "Pensioenfederatie", "Intern", "Extern"];
const BRONKLEUR: Record<string, string> = {
  DNB: "bg-red-100 text-red-700",
  AFM: "bg-blue-100 text-blue-700",
  Pensioenfederatie: "bg-green-100 text-green-700",
  Intern: "bg-amber-100 text-amber-700",
  Extern: "bg-amber-100 text-amber-700",
};

export default function BibliotheekPage() {
  // Weergave: documentbeheer (titelzoeken + lijst) of uitgebreid inhoudelijk zoeken.
  const [weergave, setWeergave] = useState<"beheren" | "zoeken">("beheren");
  const [actieveTab, setActieveTab] = useState<"generiek" | "fonds">("generiek");
  const [documenten, setDocumenten] = useState<Document[]>([]);
  const [laden, setLaden] = useState(true);
  const [zoekterm, setZoekterm] = useState("");
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
  });

  useEffect(() => {
    haalDocumenten();
    // Oude /zoeken-links komen binnen als /bibliotheek?weergave=zoeken.
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (p.get("weergave") === "zoeken") setWeergave("zoeken");
    }
  }, []);

  async function haalDocumenten() {
    setLaden(true);
    const res = await fetch("/api/documents/upload");
    const data = await res.json();
    setDocumenten(data.documenten || []);
    setLaden(false);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const bestand = bestandRef.current?.files?.[0];
    if (!bestand) return;

    setUploaden(true);
    setUploadBericht("");

    const formData = new FormData();
    formData.append("bestand", bestand);
    formData.append("titel", uploadForm.titel);
    formData.append("bron", uploadForm.bron);
    formData.append("bibliotheek", uploadForm.bibliotheek);

    const res = await fetch("/api/documents/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (data.success) {
      setUploadBericht(`✅ ${data.bericht}`);
      haalDocumenten();
      setUploadOpen(false);
      setUploadForm({ titel: "", bron: "DNB", bibliotheek: "fonds" });
    } else {
      setUploadBericht(`❌ ${data.error}`);
    }
    setUploaden(false);
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
    <div className="p-7">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-ink">Documentbibliotheek</h1>
          <p className="text-sm text-gray-500 mt-1">
            {weergave === "zoeken"
              ? "Uitgebreid zoeken in de inhoud van de documenten"
              : "Upload en beheer documenten — de kennisbasis voor de AI-assistent"}
          </p>
        </div>
        {weergave === "beheren" && (
          <button
            onClick={() => setUploadOpen(true)}
            className="bg-accent text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-accent-ink transition-colors"
          >
            + Document uploaden
          </button>
        )}
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
          <ZoekenPaneel />
        </>
      ) : (
      <>
      {uploadBericht && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
          {uploadBericht}
        </div>
      )}

      {/* Increment C — review-banner: nog niet verrijkte documenten */}
      {aantalTeVerrijken > 0 && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-sm text-amber-800">
            <span className="font-semibold">{aantalTeVerrijken}</span>{" "}
            {aantalTeVerrijken === 1 ? "document is" : "documenten zijn"} nog niet
            verrijkt (status/bronstatus/context ontbreken of zijn onzeker).
          </div>
          <a
            href="/beheer"
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
          >
            Naar review →
          </a>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-5 w-fit">
        {(["generiek", "fonds"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActieveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              actieveTab === tab
                ? "bg-white text-ink shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "generiek" ? "🏛️ Generiek (DNB / AFM / PF)" : "🏢 Fondsbibliotheek"}
          </button>
        ))}
      </div>

      {/* Zoekbalk + toggle */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex-1 min-w-[260px]">
          <span className="text-gray-400">🔍</span>
          <input
            type="text"
            placeholder="Zoek op titel..."
            value={zoekterm}
            onChange={(e) => setZoekterm(e.target.value)}
            className="flex-1 outline-none text-sm text-gray-700 bg-transparent"
          />
        </div>
        <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={toonInactief}
            onChange={(e) => setToonInactief(e.target.checked)}
            className="accent-accent"
          />
          Toon gedeactiveerde documenten
          {aantalInactief > 0 && (
            <span className="text-xs text-gray-400">({aantalInactief})</span>
          )}
        </label>
        <button
          type="button"
          onClick={() => setWeergave("zoeken")}
          title="Zoek op de inhoud van documenten (niet alleen de titel)"
          className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent transition-colors"
        >
          🔎 Uitgebreid zoeken
        </button>
      </div>

      {/* Document lijst */}
      {laden ? (
        <div className="text-center py-12 text-gray-400">Documenten laden...</div>
      ) : gefilterd.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📂</div>
          <h3 className="font-semibold text-gray-700 mb-1">Geen documenten</h3>
          <p className="text-sm text-gray-400">
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
                    className={`text-gray-400 text-[10px] transition-transform ${
                      open ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  <span className="text-sm font-bold text-ink">
                    {groep.label}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
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
            return (
              <div
                key={doc.id}
                className={`relative bg-white border rounded-xl p-4 flex items-center gap-4 transition-colors ${
                  inactief
                    ? "border-gray-200 opacity-70"
                    : "border-gray-200 hover:border-accent"
                }`}
              >
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
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
                        inactief ? "text-gray-500" : "text-ink"
                      }`}
                    >
                      {doc.titel}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        BRONKLEUR[doc.bron] || "bg-gray-100 text-gray-600"
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
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
                        {labels.bronsoortLabel}
                      </span>
                    )}
                    {isGeneriek && labels.vervallen && (
                      <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-semibold border border-red-200">
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
                      <span className="text-green-600 font-semibold">
                        ✓ Geïndexeerd
                      </span>
                    )}
                    {doc.status && !inactief && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                        {doc.status}
                      </span>
                    )}
                    {doc.metadata_review_status === "te_controleren" && !inactief && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                        Nog niet verrijkt
                      </span>
                    )}
                    {inactief && (
                      <span
                        className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold"
                        title={doc.deactivatie_reden ?? undefined}
                      >
                        Gedeactiveerd
                      </span>
                    )}
                    {!kanInzien && !inactief && (
                      <span
                        className="text-gray-400"
                        title="Origineel niet beschikbaar — vóór mei 2026 geüpload"
                      >
                        Origineel niet beschikbaar
                      </span>
                    )}
                  </div>
                  {inactief && doc.deactivatie_reden && (
                    <div className="text-xs text-gray-500 mt-1 italic">
                      Reden: {doc.deactivatie_reden}
                    </div>
                  )}
                </div>

                {/* Kebab-menu */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() =>
                      setOpenMenuId(openMenuId === doc.id ? null : doc.id)
                    }
                    className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500 text-lg"
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
                      <div className="absolute right-0 top-9 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px]">
                        {!inactief && (
                          <button
                            onClick={() => {
                              setMetadataDocId(doc.id);
                              setOpenMenuId(null);
                            }}
                            className="w-full text-left px-4 py-2 text-sm font-medium text-ink hover:bg-amber-50"
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
                            className="block px-4 py-2 text-sm font-medium text-ink hover:bg-amber-50"
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
                            className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
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
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            title="Origineel opnieuw door de extractie-pipeline halen: structuur-bewuste fragmenten + verbeterde (contextuele) zoekindex (voorzitter/beheerder)"
                          >
                            {herindexId === doc.id
                              ? "Bezig met her-indexeren..."
                              : "Her-indexeren"}
                          </button>
                        )}
                        {!isGeneriek &&
                          (!inactief ? (
                            <button
                              onClick={() => {
                                setDeactiveerDoc(doc);
                                setOpenMenuId(null);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
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
                              className="w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50 disabled:opacity-50"
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
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold">{deactiveerDoc.titel}</span> wordt
              uitgesloten van zoeken en AI-antwoorden. Het origineel en de
              chunks blijven bewaard; reactiveren kan later weer.
            </p>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Reden (optioneel)
            </label>
            <textarea
              value={deactiveerReden}
              onChange={(e) => setDeactiveerReden(e.target.value)}
              rows={3}
              placeholder="bijv. verouderd, vervangen door nieuwere versie..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeactiveerDoc(null);
                  setDeactiveerReden("");
                }}
                className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Annuleren
              </button>
              <button
                onClick={() => deactiveer(deactiveerDoc, deactiveerReden)}
                disabled={actieBezig}
                className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
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

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-accent/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-7 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-ink">Document uploaden</h2>
              <button
                onClick={() => setUploadOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Bestand
                </label>
                <input
                  ref={bestandRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  PDF, Word (.docx) of Excel (.xlsx). Gescande PDF&apos;s eerst
                  doorzoekbaar maken via Acrobat/Preview.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Titel</label>
                <input
                  type="text"
                  value={uploadForm.titel}
                  onChange={(e) => setUploadForm({ ...uploadForm, titel: e.target.value })}
                  placeholder="bijv. DNB Leidraad Deskundigheid 2024"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Bron</label>
                <select
                  value={uploadForm.bron}
                  onChange={(e) => setUploadForm({ ...uploadForm, bron: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none"
                >
                  {BRONNEN.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              {/* B13: tenants uploaden uitsluitend naar de fondsbibliotheek.
                  Generieke (platform-gecureerde) documenten worden centraal beheerd. */}
              <p className="text-[11px] text-gray-500 -mt-1">
                Dit document wordt opgeslagen in de <span className="font-semibold">fondsbibliotheek</span>.
                Generieke (DNB/AFM/PF) documenten worden centraal beheerd en zijn alleen-lezen.
              </p>
              {uploadBericht && (
                <div className="text-sm text-red-600">{uploadBericht}</div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setUploadOpen(false)}
                  className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
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
