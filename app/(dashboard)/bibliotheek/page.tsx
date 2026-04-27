"use client";
import { useState, useEffect, useRef } from "react";

interface Document {
  id: string;
  titel: string;
  bron: string;
  bibliotheek: string;
  bestandsnaam: string | null;
  paginas: number | null;
  geindexeerd: boolean;
  aangemaakt: string;
}

const BRONNEN = ["DNB", "AFM", "Pensioenfederatie", "Intern", "Extern"];
const BRONKLEUR: Record<string, string> = {
  DNB: "bg-red-100 text-red-700",
  AFM: "bg-blue-100 text-blue-700",
  Pensioenfederatie: "bg-green-100 text-green-700",
  Intern: "bg-amber-100 text-amber-700",
  Extern: "bg-amber-100 text-amber-700",
};

export default function BibliotheekPage() {
  const [actieveTab, setActieveTab] = useState<"generiek" | "fonds">("generiek");
  const [documenten, setDocumenten] = useState<Document[]>([]);
  const [laden, setLaden] = useState(true);
  const [zoekterm, setZoekterm] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploaden, setUploaden] = useState(false);
  const [uploadBericht, setUploadBericht] = useState("");
  const bestandRef = useRef<HTMLInputElement>(null);

  const [uploadForm, setUploadForm] = useState({
    titel: "",
    bron: "DNB",
    bibliotheek: "generiek",
  });

  useEffect(() => {
    haalDocumenten();
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
      setUploadForm({ titel: "", bron: "DNB", bibliotheek: "generiek" });
    } else {
      setUploadBericht(`❌ ${data.error}`);
    }
    setUploaden(false);
  }

  const gefilterd = documenten.filter(
    (d) =>
      d.bibliotheek === actieveTab &&
      d.titel.toLowerCase().includes(zoekterm.toLowerCase())
  );

  return (
    <div className="p-7">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-[#0F2744]">Documentbibliotheek</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload en beheer documenten — de kennisbasis voor de AI-assistent
          </p>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="bg-[#0F2744] text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-[#1A3A5C] transition-colors"
        >
          + Document uploaden
        </button>
      </div>

      {uploadBericht && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
          {uploadBericht}
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
                ? "bg-white text-[#0F2744] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "generiek" ? "🏛️ Generiek (DNB / AFM / PF)" : "🏢 Fondsbibliotheek"}
          </button>
        ))}
      </div>

      {/* Zoekbalk */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 mb-4">
        <span className="text-gray-400">🔍</span>
        <input
          type="text"
          placeholder="Zoek op titel..."
          value={zoekterm}
          onChange={(e) => setZoekterm(e.target.value)}
          className="flex-1 outline-none text-sm text-gray-700 bg-transparent"
        />
      </div>

      {/* Document lijst */}
      {laden ? (
        <div className="text-center py-12 text-gray-400">Documenten laden...</div>
      ) : gefilterd.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📂</div>
          <h3 className="font-semibold text-gray-700 mb-1">Geen documenten</h3>
          <p className="text-sm text-gray-400">
            Upload een PDF om te beginnen. De AI-assistent kan dan uw vragen beantwoorden.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {gefilterd.map((doc) => (
            <div
              key={doc.id}
              className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 hover:border-[#C9A84C] transition-colors"
            >
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
                📋
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#0F2744] text-sm truncate">{doc.titel}</div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full font-semibold ${BRONKLEUR[doc.bron] || "bg-gray-100 text-gray-600"}`}>
                    {doc.bron}
                  </span>
                  {doc.paginas && <span>{doc.paginas} pag.</span>}
                  <span>
                    {new Date(doc.aangemaakt).toLocaleDateString("nl-NL")}
                  </span>
                  {doc.geindexeerd && (
                    <span className="text-green-600 font-semibold">✓ Geïndexeerd</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-[#0F2744]/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-7 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-[#0F2744]">Document uploaden</h2>
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
                  PDF-bestand
                </label>
                <input
                  ref={bestandRef}
                  type="file"
                  accept=".pdf"
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Titel</label>
                <input
                  type="text"
                  value={uploadForm.titel}
                  onChange={(e) => setUploadForm({ ...uploadForm, titel: e.target.value })}
                  placeholder="bijv. DNB Leidraad Deskundigheid 2024"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Bibliotheek</label>
                  <select
                    value={uploadForm.bibliotheek}
                    onChange={(e) => setUploadForm({ ...uploadForm, bibliotheek: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none"
                  >
                    <option value="generiek">Generiek</option>
                    <option value="fonds">Fonds</option>
                  </select>
                </div>
              </div>
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
                  className="flex-1 bg-[#0F2744] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#1A3A5C] disabled:opacity-50"
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
