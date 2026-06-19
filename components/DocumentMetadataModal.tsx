"use client";

// ============================================================
//  DocumentMetadataModal — Increment C
//
//  Metadata corrigeren/verrijken zonder herupload (FO §7). Toont
//  contextvereisten + RAG-impact VOORAF (preview), dwingt reden af waar
//  vereist (de server is leidend; deze UI is begeleiding) en kan een
//  document als "gecontroleerd" markeren (haalt het uit de review-queue).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  DOCUMENT_CONTEXTEN,
  DOCUMENT_CONTEXT_LABEL,
  DOCUMENTTYPEN,
  DOCUMENTTYPE_LABEL,
  type DocumentContext,
  type Documenttype,
} from "@/lib/document-metadata";
import {
  DOCUMENT_STATUS_LABEL,
  BRONSTATUSSEN,
  BRONSTATUS_LABEL,
  type DocumentStatus,
  type Bronstatus,
} from "@/lib/document-status-transities";

interface MetadataDoc {
  id: string;
  titel: string;
  context: DocumentContext;
  procesinstantie_id: string | null;
  vergadering_id: string | null;
  agendapunt_id: string | null;
  documenttype: Documenttype | null;
  status: DocumentStatus | null;
  bronstatus: Bronstatus | null;
  documentdatum: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  metadata_review_status: string | null;
}

interface PlanWijziging {
  veld: string;
  rag_impact: boolean;
  redenplicht: boolean;
}
interface Plan {
  ok: boolean;
  blokkers: string[];
  fouten: string[];
  wijzigingen: PlanWijziging[];
  ragImpact: boolean;
}

export default function DocumentMetadataModal({
  documentId,
  onClose,
  onSaved,
}: {
  documentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doc, setDoc] = useState<MetadataDoc | null>(null);
  const [vervolgstatussen, setVervolgstatussen] = useState<DocumentStatus[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reden, setReden] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(async () => {
    setLaden(true);
    setFout(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Laden mislukt");
      const d: MetadataDoc = data.document;
      setDoc(d);
      setVervolgstatussen(data.toegestane_vervolgstatussen ?? []);
      setForm({
        context: d.context ?? "algemeen",
        documenttype: d.documenttype ?? "",
        status: d.status ?? "",
        bronstatus: d.bronstatus ?? "",
        documentdatum: d.documentdatum ?? "",
        geldig_vanaf: d.geldig_vanaf ?? "",
        geldig_tot: d.geldig_tot ?? "",
      });
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLaden(false);
    }
  }, [documentId]);

  useEffect(() => {
    laad();
  }, [laad]);

  // Bouw het verzoek-payload uit gewijzigde velden t.o.v. het document.
  function bouwVerzoek(): Record<string, unknown> {
    if (!doc) return {};
    const v: Record<string, unknown> = {};
    const leeg = (s: string) => (s === "" ? null : s);
    if (form.context !== (doc.context ?? "algemeen")) v.context = form.context;
    if (leeg(form.documenttype) !== doc.documenttype) v.documenttype = leeg(form.documenttype);
    if (form.status && form.status !== doc.status) v.status = form.status;
    if (leeg(form.bronstatus) !== doc.bronstatus) v.bronstatus = leeg(form.bronstatus);
    if (leeg(form.documentdatum) !== doc.documentdatum) v.documentdatum = leeg(form.documentdatum);
    if (leeg(form.geldig_vanaf) !== doc.geldig_vanaf) v.geldig_vanaf = leeg(form.geldig_vanaf);
    if (leeg(form.geldig_tot) !== doc.geldig_tot) v.geldig_tot = leeg(form.geldig_tot);
    if (reden.trim()) v.reden = reden.trim();
    return v;
  }

  async function preview() {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bouwVerzoek(), preview: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Preview mislukt");
      setPlan(data.plan);
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Preview mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function opslaan(markeerGecontroleerd = false) {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bouwVerzoek(),
          markeer_gecontroleerd: markeerGecontroleerd,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail =
          data?.blokkers?.join(" ") || data?.fouten?.join(" ") || data?.error;
        throw new Error(detail || "Opslaan mislukt");
      }
      onSaved();
      onClose();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  const statusOpties: DocumentStatus[] = doc?.status
    ? [doc.status, ...vervolgstatussen]
    : (Object.keys(DOCUMENT_STATUS_LABEL) as DocumentStatus[]);

  return (
    <div className="fixed inset-0 bg-[#0F2744]/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-7 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-[#0F2744]">Metadata bewerken</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        {doc && (
          <p className="text-sm text-gray-500 mb-4 truncate" title={doc.titel}>
            {doc.titel}
          </p>
        )}

        {fout && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
            {fout}
          </div>
        )}

        {laden ? (
          <div className="text-gray-400 text-sm py-6">Laden…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Veld label="Context">
                <select
                  value={form.context}
                  onChange={(e) => setForm({ ...form, context: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {DOCUMENT_CONTEXTEN.map((c) => (
                    <option key={c} value={c}>
                      {DOCUMENT_CONTEXT_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Veld>
              <Veld label="Documenttype">
                <select
                  value={form.documenttype}
                  onChange={(e) => setForm({ ...form, documenttype: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— kies —</option>
                  {DOCUMENTTYPEN.map((t) => (
                    <option key={t} value={t}>
                      {DOCUMENTTYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Veld>
              <Veld label="Documentstatus">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— geen —</option>
                  {[...new Set(statusOpties)].map((s) => (
                    <option key={s} value={s}>
                      {DOCUMENT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Veld>
              <Veld label="Bronstatus">
                <select
                  value={form.bronstatus}
                  onChange={(e) => setForm({ ...form, bronstatus: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— niet gezet (≡ actief) —</option>
                  {BRONSTATUSSEN.map((b) => (
                    <option key={b} value={b}>
                      {BRONSTATUS_LABEL[b]}
                    </option>
                  ))}
                </select>
              </Veld>
              <Veld label="Documentdatum">
                <input
                  type="date"
                  value={form.documentdatum}
                  onChange={(e) => setForm({ ...form, documentdatum: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </Veld>
              <Veld label="Geldig vanaf">
                <input
                  type="date"
                  value={form.geldig_vanaf}
                  onChange={(e) => setForm({ ...form, geldig_vanaf: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </Veld>
              <Veld label="Geldig tot">
                <input
                  type="date"
                  value={form.geldig_tot}
                  onChange={(e) => setForm({ ...form, geldig_tot: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </Veld>
            </div>

            <Veld label="Reden (verplicht bij status-/governance-kritieke wijzigingen)">
              <textarea
                value={reden}
                onChange={(e) => setReden(e.target.value)}
                rows={2}
                placeholder="bijv. Vastgesteld in bestuursvergadering 2026-06-10"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </Veld>

            {plan && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  plan.ok
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <div className="font-semibold mb-1">
                  Voorbeeld van de wijziging
                </div>
                {plan.blokkers.length > 0 && (
                  <ul className="list-disc ml-5">
                    {plan.blokkers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
                {plan.fouten.length > 0 && (
                  <ul className="list-disc ml-5">
                    {plan.fouten.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                )}
                {plan.ok && (
                  <div>
                    {plan.wijzigingen.length} veld(en) wijzigen.{" "}
                    {plan.ragImpact
                      ? "⚠️ RAG-impact: herindexering nodig."
                      : "Geen RAG-impact."}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={preview}
                disabled={bezig}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Toon RAG-impact
              </button>
              <button
                onClick={() => opslaan(false)}
                disabled={bezig}
                className="rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1A3A5C] disabled:opacity-50"
              >
                {bezig ? "Bezig…" : "Opslaan"}
              </button>
              <button
                onClick={() => opslaan(true)}
                disabled={bezig}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                title="Opslaan en uit de review-queue halen"
              >
                Opslaan + gecontroleerd
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Veld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
