"use client";

// ============================================================================
//  Generieke bibliotheek — curatie-UI (Increment P1/B14).
// ----------------------------------------------------------------------------
//  Pure presentatie + formulierstate; ALLE mutaties lopen via de server-actions
//  (acties.ts) achter withPlatform. Het RAG-zichtbaarheidslabel gebruikt exact
//  dezelfde bron-van-waarheid (isStandaardZichtbaarInRag) als de retrievallaag,
//  zodat label en gedrag niet uiteenlopen (§8.3 #6).
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NORMGEWICHTEN, NORMGEWICHT_LABEL } from "@/lib/bronsoort";
import {
  isStandaardZichtbaarInRag,
  GENERIEKE_BRONNEN,
  GENERIEKE_DOCUMENTSTATUS,
  GENERIEKE_BRONSTATUS,
  REGELINGSTYPES,
  REGELINGSTYPE_LABEL,
} from "@/lib/generiek-curatie";
import {
  curatieAanmaken,
  curatieBijwerken,
  curatieVervangen,
  curatieIntrekken,
  curatieInzageUrl,
  type CuratieResultaat,
} from "../acties";

export interface GeneriekDocument {
  id: string;
  titel: string;
  bron: string;
  bronorganisatie: string | null;
  extern_url: string | null;
  normgewicht: string | null;
  documentdatum: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  status: string | null;
  bronstatus: string | null;
  toepassingsgebied: string | null;
  regelingstype: string | null;
  doelgroep: string | null;
  thema: string | null;
  statusinterpretatie: string | null;
  verwerkingsstatus: string | null;
  paginas: number | null;
  opslag_pad: string | null;
  vervangen_door_document_id: string | null;
  vervangt_document_id: string | null;
  aangemaakt: string | null;
}

type Modus =
  | { soort: "aanmaken" }
  | { soort: "bewerken"; doc: GeneriekDocument }
  | { soort: "vervangen"; doc: GeneriekDocument }
  | null;

const LEEG_FORM = {
  titel: "",
  bron: "Extern",
  bronorganisatie: "",
  extern_url: "",
  normgewicht: "onbekend",
  documentdatum: "",
  geldig_vanaf: "",
  geldig_tot: "",
  documentstatus: "van_kracht",
  bronstatus: "actief",
  toepassingsgebied: "",
  regelingstype: "algemeen",
  doelgroep: "",
  thema: "",
  statusinterpretatie: "",
  reden: "",
};
type FormState = typeof LEEG_FORM;

function docNaarForm(d: GeneriekDocument): FormState {
  return {
    titel: d.titel ?? "",
    bron: d.bron ?? "Extern",
    bronorganisatie: d.bronorganisatie ?? "",
    extern_url: d.extern_url ?? "",
    normgewicht: d.normgewicht ?? "onbekend",
    documentdatum: d.documentdatum ?? "",
    geldig_vanaf: d.geldig_vanaf ?? "",
    geldig_tot: d.geldig_tot ?? "",
    documentstatus: d.status ?? "van_kracht",
    bronstatus: d.bronstatus ?? "actief",
    toepassingsgebied: d.toepassingsgebied ?? "",
    regelingstype: d.regelingstype ?? "algemeen",
    doelgroep: d.doelgroep ?? "",
    thema: d.thema ?? "",
    statusinterpretatie: d.statusinterpretatie ?? "",
    reden: "",
  };
}

function RagBadge({ normgewicht }: { normgewicht: string | null }) {
  const zichtbaar = isStandaardZichtbaarInRag(normgewicht);
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        zichtbaar ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      }`}
      title={
        zichtbaar
          ? "Wordt standaard meegenomen in de AI-assistent."
          : "Zwak normgewicht: alleen getoond als de gebruiker er expliciet om vraagt."
      }
    >
      {zichtbaar ? "Standaard in RAG" : "Niet standaard in RAG"}
    </span>
  );
}

export default function GeneriekeBibliotheekClient({
  documenten,
  aantalFondsen,
  magBeheren,
}: {
  documenten: GeneriekDocument[];
  aantalFondsen: number;
  magBeheren: boolean;
}) {
  const router = useRouter();
  const [modus, setModus] = useState<Modus>(null);
  const [form, setForm] = useState<FormState>(LEEG_FORM);
  const [bestand, setBestand] = useState<File | null>(null);
  const [bezig, startTransitie] = useTransition();
  const [melding, setMelding] = useState<{ ok: boolean; tekst: string } | null>(null);
  const [veldfouten, setVeldfouten] = useState<Record<string, string>>({});

  function open(m: Exclude<Modus, null>) {
    setMelding(null);
    setVeldfouten({});
    setBestand(null);
    setForm(m.soort === "aanmaken" ? LEEG_FORM : docNaarForm(m.doc));
    setModus(m);
  }

  function sluit() {
    setModus(null);
    setVeldfouten({});
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function bouwFormData(): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    if (bestand) fd.set("bestand", bestand);
    return fd;
  }

  function verwerk(r: CuratieResultaat) {
    if (r.ok) {
      setMelding({ ok: true, tekst: r.bericht });
      setVeldfouten({});
      sluit();
      router.refresh();
    } else {
      setMelding({ ok: false, tekst: r.melding });
      setVeldfouten(r.veldfouten ?? {});
    }
  }

  function verstuur() {
    if (!modus) return;
    startTransitie(async () => {
      if (modus.soort === "aanmaken") {
        verwerk(await curatieAanmaken(bouwFormData()));
      } else if (modus.soort === "bewerken") {
        verwerk(await curatieBijwerken(modus.doc.id, bouwFormData()));
      } else {
        verwerk(await curatieVervangen(modus.doc.id, bouwFormData()));
      }
    });
  }

  function intrekken(doc: GeneriekDocument) {
    const reden = window.prompt(
      `Document "${doc.titel}" intrekken (alleen historisch)? Geef een reden:`
    );
    if (reden === null) return;
    startTransitie(async () => {
      const r = await curatieIntrekken(doc.id, reden);
      setMelding(r.ok ? { ok: true, tekst: r.bericht } : { ok: false, tekst: r.melding });
      if (r.ok) router.refresh();
    });
  }

  function inzage(doc: GeneriekDocument) {
    startTransitie(async () => {
      const r = await curatieInzageUrl(doc.id);
      if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer");
      else setMelding({ ok: false, tekst: r.melding });
    });
  }

  const heeftFile = modus?.soort === "aanmaken" || modus?.soort === "vervangen";

  return (
    <div className="space-y-4">
      {melding && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            melding.ok
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-800"
          }`}
        >
          {melding.tekst}
        </div>
      )}

      {magBeheren && !modus && (
        <button
          onClick={() => open({ soort: "aanmaken" })}
          className="rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F2744]/90"
        >
          + Nieuw generiek document
        </button>
      )}

      {modus && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verstuur();
          }}
          className="space-y-4 rounded-xl border border-[#0F2744]/10 bg-white p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {modus.soort === "aanmaken"
                ? "Nieuw generiek document"
                : modus.soort === "bewerken"
                  ? `Bewerken — ${modus.doc.titel}`
                  : `Vervangen — ${modus.doc.titel}`}
            </h2>
            <button type="button" onClick={sluit} className="text-sm text-[#0F2744]/60 hover:underline">
              Annuleren
            </button>
          </div>

          {/* Impactwaarschuwing (UX: maak gevolg vooraf expliciet). */}
          <div className="rounded-lg border border-[#C9A84C]/40 bg-[#C9A84C]/10 px-4 py-3 text-sm">
            Dit document wordt voor <strong>{aantalFondsen} aangesloten fonds(en)</strong>{" "}
            leesbaar. <RagBadge normgewicht={form.normgewicht} /> op basis van het
            gekozen normgewicht.
          </div>

          {heeftFile && (
            <Veld label="Bestand (PDF, DOCX, PPTX, XLSX)" fout={veldfouten.bestand}>
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.xlsx"
                onChange={(e) => setBestand(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
                required
              />
            </Veld>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Veld label="Titel *" fout={veldfouten.titel}>
              <Input value={form.titel} onChange={(v) => set("titel", v)} />
            </Veld>
            <Veld label="Bron" fout={veldfouten.bron}>
              <Select value={form.bron} onChange={(v) => set("bron", v)} opties={GENERIEKE_BRONNEN} />
            </Veld>
            <Veld label="Bronorganisatie" fout={veldfouten.bronorganisatie}>
              <Input value={form.bronorganisatie} onChange={(v) => set("bronorganisatie", v)} />
            </Veld>
            <Veld label="Externe URL" fout={veldfouten.extern_url}>
              <Input value={form.extern_url} onChange={(v) => set("extern_url", v)} placeholder="https://…" />
            </Veld>
            <Veld label="Normgewicht" fout={veldfouten.normgewicht}>
              <select
                value={form.normgewicht}
                onChange={(e) => set("normgewicht", e.target.value)}
                className="w-full rounded-lg border border-[#0F2744]/20 px-3 py-2 text-sm"
              >
                {NORMGEWICHTEN.map((n) => (
                  <option key={n} value={n}>
                    {NORMGEWICHT_LABEL[n]}
                  </option>
                ))}
              </select>
            </Veld>
            <Veld label="Regelingstype" fout={veldfouten.regelingstype}>
              <select
                value={form.regelingstype}
                onChange={(e) => set("regelingstype", e.target.value)}
                className="w-full rounded-lg border border-[#0F2744]/20 px-3 py-2 text-sm"
              >
                {REGELINGSTYPES.map((r) => (
                  <option key={r} value={r}>
                    {REGELINGSTYPE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Veld>
            <Veld label="Documentdatum" fout={veldfouten.documentdatum}>
              <Input type="date" value={form.documentdatum} onChange={(v) => set("documentdatum", v)} />
            </Veld>
            <Veld label="Thema" fout={veldfouten.thema}>
              <Input value={form.thema} onChange={(v) => set("thema", v)} />
            </Veld>
            <Veld label="Geldig vanaf" fout={veldfouten.geldig_vanaf}>
              <Input type="date" value={form.geldig_vanaf} onChange={(v) => set("geldig_vanaf", v)} />
            </Veld>
            <Veld label="Geldig tot" fout={veldfouten.geldig_tot}>
              <Input type="date" value={form.geldig_tot} onChange={(v) => set("geldig_tot", v)} />
            </Veld>
            <Veld label="Documentstatus" fout={veldfouten.documentstatus}>
              <Select value={form.documentstatus} onChange={(v) => set("documentstatus", v)} opties={GENERIEKE_DOCUMENTSTATUS} />
            </Veld>
            <Veld label="Bronstatus" fout={veldfouten.bronstatus}>
              <Select value={form.bronstatus} onChange={(v) => set("bronstatus", v)} opties={GENERIEKE_BRONSTATUS} />
            </Veld>
            <Veld label="Toepassingsgebied" fout={veldfouten.toepassingsgebied}>
              <Input value={form.toepassingsgebied} onChange={(v) => set("toepassingsgebied", v)} />
            </Veld>
            <Veld label="Doelgroep" fout={veldfouten.doelgroep}>
              <Input value={form.doelgroep} onChange={(v) => set("doelgroep", v)} />
            </Veld>
          </div>

          <Veld label="Statusinterpretatie" fout={veldfouten.statusinterpretatie}>
            <textarea
              value={form.statusinterpretatie}
              onChange={(e) => set("statusinterpretatie", e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-[#0F2744]/20 px-3 py-2 text-sm"
            />
          </Veld>

          {modus.soort === "bewerken" && (
            <Veld label="Reden van wijziging (voor het auditspoor)">
              <Input value={form.reden} onChange={(v) => set("reden", v)} />
            </Veld>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={bezig}
              className="rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F2744]/90 disabled:opacity-50"
            >
              {bezig
                ? "Bezig…"
                : modus.soort === "aanmaken"
                  ? "Cureren"
                  : modus.soort === "bewerken"
                    ? "Wijzigingen opslaan"
                    : "Nieuwe versie publiceren"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-[#0F2744]/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#F0F3F8] text-left text-xs uppercase tracking-wide text-[#0F2744]/60">
            <tr>
              <th className="px-4 py-2">Titel</th>
              <th className="px-4 py-2">Bron</th>
              <th className="px-4 py-2">Normgewicht</th>
              <th className="px-4 py-2">RAG</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Verwerking</th>
              <th className="px-4 py-2 text-right">Acties</th>
            </tr>
          </thead>
          <tbody>
            {documenten.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[#0F2744]/50">
                  Nog geen generieke documenten.
                </td>
              </tr>
            )}
            {documenten.map((d) => {
              const vervangen = !!d.vervangen_door_document_id;
              return (
                <tr key={d.id} className="border-t border-[#0F2744]/5">
                  <td className="px-4 py-2">
                    <div className="font-medium">{d.titel}</div>
                    {d.bronorganisatie && (
                      <div className="text-xs text-[#0F2744]/50">{d.bronorganisatie}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">{d.bron}</td>
                  <td className="px-4 py-2">
                    {NORMGEWICHT_LABEL[(d.normgewicht as keyof typeof NORMGEWICHT_LABEL) ?? "onbekend"] ??
                      d.normgewicht ??
                      "—"}
                  </td>
                  <td className="px-4 py-2">
                    <RagBadge normgewicht={d.normgewicht} />
                  </td>
                  <td className="px-4 py-2">
                    <div>{d.status ?? "—"}</div>
                    <div className="text-xs text-[#0F2744]/50">{d.bronstatus ?? "—"}</div>
                  </td>
                  <td className="px-4 py-2">{d.verwerkingsstatus ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2 text-xs">
                      {d.opslag_pad && (
                        <button onClick={() => inzage(d)} disabled={bezig} className="text-[#0F2744] hover:underline disabled:opacity-50">
                          Inzage
                        </button>
                      )}
                      {magBeheren && !vervangen && (
                        <>
                          <button onClick={() => open({ soort: "bewerken", doc: d })} className="text-[#0F2744] hover:underline">
                            Bewerken
                          </button>
                          <button onClick={() => open({ soort: "vervangen", doc: d })} className="text-[#0F2744] hover:underline">
                            Vervangen
                          </button>
                          {d.status !== "alleen_historisch" && (
                            <button onClick={() => intrekken(d)} disabled={bezig} className="text-rose-700 hover:underline disabled:opacity-50">
                              Intrekken
                            </button>
                          )}
                        </>
                      )}
                      {vervangen && <span className="text-[#0F2744]/40">Vervangen</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Veld({
  label,
  fout,
  children,
}: {
  label: string;
  fout?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#0F2744]/70">{label}</span>
      {children}
      {fout && <span className="mt-1 block text-xs text-rose-600">{fout}</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-[#0F2744]/20 px-3 py-2 text-sm"
    />
  );
}

function Select({
  value,
  onChange,
  opties,
}: {
  value: string;
  onChange: (v: string) => void;
  opties: readonly string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-[#0F2744]/20 px-3 py-2 text-sm"
    >
      {opties.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
