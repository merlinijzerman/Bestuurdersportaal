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
import { createClient } from "@/lib/supabase";
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
  generiekGeldigheidsstatus,
  GELDIGHEIDSSTATUS_LABEL,
  reviewSignaal,
  REVIEW_SIGNAAL_LABEL,
  type ReviewSignaal,
} from "@/lib/generiek-status";
import {
  curatieUploadUrl,
  curatieAanmaken,
  curatieBijwerken,
  curatieVervangen,
  curatieDepreceren,
  curatieWithdrawn,
  curatieHerpubliceren,
  curatieVerwijderen,
  curatieInzageUrl,
  curatieHerindexeren,
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
  // Increment T6 — beheerkenmerken generieke contentlaag (§7/B3).
  eigenaar: string | null;
  volgende_review: string | null;
  versie: string | null;
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
  eigenaar: "",
  volgende_review: "",
  versie: "",
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
    eigenaar: d.eigenaar ?? "",
    volgende_review: d.volgende_review ?? "",
    versie: d.versie ?? "",
    reden: "",
  };
}

function RagBadge({ normgewicht }: { normgewicht: string | null }) {
  const zichtbaar = isStandaardZichtbaarInRag(normgewicht);
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        zichtbaar ? "bg-ok-tint text-ok-ink" : "bg-warn-tint text-warn-ink"
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

function vandaagISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Canonieke geldigheidsstatus (draft/published/deprecated/withdrawn) als badge.
function CanonBadge({ canon }: { canon: keyof typeof GELDIGHEIDSSTATUS_LABEL }) {
  const kleur =
    canon === "published"
      ? "bg-ok-tint text-ok-ink"
      : canon === "withdrawn"
        ? "bg-err-tint text-err-ink"
        : canon === "deprecated"
          ? "bg-warn-tint text-warn-ink"
          : "bg-app-bg text-ink/70";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${kleur}`}
      title={GELDIGHEIDSSTATUS_LABEL[canon]}
    >
      {canon}
    </span>
  );
}

// Review-signaal als badge (verlopen/nadert/geen datum/actueel).
function ReviewBadge({ signaal }: { signaal: ReviewSignaal }) {
  const kleur =
    signaal === "verlopen"
      ? "bg-err-tint text-err-ink"
      : signaal === "nadert" || signaal === "geen_datum"
        ? "bg-warn-tint text-warn-ink"
        : "bg-ok-tint text-ok-ink";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${kleur}`}>
      {REVIEW_SIGNAAL_LABEL[signaal]}
    </span>
  );
}

function TelChip({
  label,
  aantal,
  toon,
}: {
  label: string;
  aantal: number;
  toon: "err" | "warn" | "neutraal";
}) {
  const actief = aantal > 0;
  const kleur = !actief
    ? "bg-app-bg text-ink/40"
    : toon === "err"
      ? "bg-err-tint text-err-ink"
      : toon === "warn"
        ? "bg-warn-tint text-warn-ink"
        : "bg-app-bg text-ink/70";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium ${kleur}`}>
      <span className="font-bold">{aantal}</span>
      {label}
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
  const [reindexBezig, setReindexBezig] = useState(false);
  const [reindexMelding, setReindexMelding] = useState<string | null>(null);

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

  // Bouwt de (kleine) metadata-payload. Het bestand zit hier NIET meer in: dat
  // is al direct naar de quarantainezone geüpload; we geven alleen het pad +
  // oorspronkelijke naam/mime mee zodat de server het kan ophalen en valideren.
  function bouwFormData(quarantainePad: string | null, gekozenBestand: File | null): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    if (quarantainePad && gekozenBestand) {
      fd.set("quarantaine_pad", quarantainePad);
      fd.set("bestandsnaam", gekozenBestand.name);
      fd.set("mime_type", gekozenBestand.type);
    }
    return fd;
  }

  // Stap 1 van de upload: vraag een signed upload-slot aan en zet het bestand
  // DIRECT in de quarantainebucket (browser → Supabase, buiten de server-action
  // om). Geeft het server-gegenereerde pad terug voor stap 2 (cureren).
  async function uploadNaarQuarantaine(
    file: File
  ): Promise<{ ok: true; pad: string } | { ok: false; melding: string }> {
    const slot = await curatieUploadUrl({ bestandsnaam: file.name, mimeType: file.type });
    if (!slot.ok) return { ok: false, melding: slot.melding };
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(slot.bucket)
      .uploadToSignedUrl(slot.pad, slot.token, file);
    if (error) {
      return { ok: false, melding: "Uploaden naar de beveiligde zone mislukte. Probeer het opnieuw." };
    }
    return { ok: true, pad: slot.pad };
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
    const huidigeModus = modus;
    startTransitie(async () => {
      // Stap 1: bij aanmaken/vervangen eerst direct-naar-Storage uploaden.
      let pad: string | null = null;
      if (huidigeModus.soort === "aanmaken" || huidigeModus.soort === "vervangen") {
        if (!bestand) {
          setMelding({ ok: false, tekst: "Kies een bestand om te uploaden." });
          return;
        }
        const up = await uploadNaarQuarantaine(bestand);
        if (!up.ok) {
          setMelding({ ok: false, tekst: up.melding });
          return;
        }
        pad = up.pad;
      }

      // Stap 2: cureren met de (kleine) metadata-payload + het quarantaine-pad.
      const fd = bouwFormData(pad, bestand);
      if (huidigeModus.soort === "aanmaken") {
        verwerk(await curatieAanmaken(fd));
      } else if (huidigeModus.soort === "bewerken") {
        verwerk(await curatieBijwerken(huidigeModus.doc.id, fd));
      } else {
        verwerk(await curatieVervangen(huidigeModus.doc.id, fd));
      }
    });
  }

  // T10 — DEPRECATE: markeer als verouderd (blijft raadpleegbaar als historie).
  function depreceren(doc: GeneriekDocument) {
    const reden = window.prompt(
      `Document "${doc.titel}" markeren als VEROUDERD (deprecated)?\n\n` +
        "De bron valt weg als actuele bron in de AI-assistent, maar blijft als historie leesbaar. " +
        "Geef een reden (verplicht voor het auditspoor):"
    );
    if (reden === null) return;
    startTransitie(async () => {
      const r = await curatieDepreceren(doc.id, reden);
      setMelding(r.ok ? { ok: true, tekst: r.bericht } : { ok: false, tekst: r.melding });
      if (r.ok) router.refresh();
    });
  }

  // T10 — WITHDRAW: definitief intrekken (uitgesloten als bron).
  function withdrawn(doc: GeneriekDocument) {
    const reden = window.prompt(
      `Document "${doc.titel}" INTREKKEN (uitgesloten als bron)?\n\n` +
        "De bron wordt definitief uitgesloten als bron (herstel = nieuw document). " +
        "Geef een reden (verplicht voor het auditspoor):"
    );
    if (reden === null) return;
    startTransitie(async () => {
      const r = await curatieWithdrawn(doc.id, reden);
      setMelding(r.ok ? { ok: true, tekst: r.bericht } : { ok: false, tekst: r.melding });
      if (r.ok) router.refresh();
    });
  }

  // T10 — HERPUBLICEREN: verouderde content na review weer actueel maken.
  function herpubliceren(doc: GeneriekDocument) {
    const reden = window.prompt(
      `Document "${doc.titel}" OPNIEUW PUBLICEREN (na review)?\n\nGeef een reden (verplicht):`
    );
    if (reden === null) return;
    const review = window.prompt(
      "Volgende reviewdatum (JJJJ-MM-DD). Laat leeg voor de standaardhorizon (12 maanden):",
      doc.volgende_review ?? ""
    );
    if (review === null) return;
    startTransitie(async () => {
      const r = await curatieHerpubliceren(doc.id, reden, review || undefined);
      setMelding(r.ok ? { ok: true, tekst: r.bericht } : { ok: false, tekst: r.melding });
      if (r.ok) router.refresh();
    });
  }

  function verwijderen(doc: GeneriekDocument) {
    const bevestigd = window.confirm(
      `Document "${doc.titel}" DEFINITIEF verwijderen?\n\n` +
        "Dit verwijdert de rij, de zoekfragmenten én het opgeslagen origineel onomkeerbaar. " +
        "Gebruik 'Intrekken' als je het document alleen wilt laten vervallen (blijft historisch bewaard)."
    );
    if (!bevestigd) return;
    const reden =
      window.prompt(`Reden voor definitief verwijderen van "${doc.titel}" (optioneel):`) ?? undefined;
    startTransitie(async () => {
      const r = await curatieVerwijderen(doc.id, reden);
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

  // Batch her-indexering: roept de platform-actie herhaaldelijk aan (één
  // generiek document per call) tot `klaar`. Elke verwerkte document veroorzaakt
  // her-extractie + tientallen Haiku-prefix- en embedding-calls; daarom de
  // kostenbevestiging vooraf. `tekst` blijft onaangeraakt (omkeerbaar).
  async function herindexeerGeneriek() {
    const bevestigd = window.confirm(
      "Generieke bibliotheek opnieuw indexeren met structuur-bewuste fragmenten en " +
        "contextuele zoekindex?\n\n" +
        "Dit verwerkt alle nog-niet-geïndexeerde generieke documenten één voor één en " +
        "veroorzaakt AI-kosten (per fragment een korte Haiku-context + een nieuwe embedding). " +
        "De getoonde brontekst en citaten blijven ongewijzigd; de bewerking is omkeerbaar."
    );
    if (!bevestigd) return;
    setReindexBezig(true);
    setReindexMelding("Bezig met her-indexeren…");
    let verwerkt = 0;
    let overgeslagen = 0;
    try {
      for (let i = 0; i < 5000; i++) {
        const r = await curatieHerindexeren();
        if (!r.ok) {
          setReindexMelding(`Her-indexeren gestopt: ${r.melding}`);
          return;
        }
        if (r.status === "verwerkt") verwerkt++;
        else if (r.status === "overgeslagen") overgeslagen++;
        // Tijdelijke/document-eigen fout (download/extractie/opslag): de resterend-
        // teller daalt niet, dus doorgaan zou hetzelfde document blijven oppakken.
        // Stop en toon de oorzaak zodat een mens het kan oplossen.
        else if (r.status === "mislukt") {
          setReindexMelding(
            `Her-indexeren gestopt bij "${r.titel ?? r.document_id}". Controleer dit document en start daarna opnieuw. ` +
              `Tot nu toe: ${verwerkt} verwerkt, ${overgeslagen} overgeslagen.`
          );
          return;
        }
        setReindexMelding(
          `Bezig… ${verwerkt} verwerkt, ${overgeslagen} overgeslagen, ${r.resterend} resterend.`
        );
        if (r.klaar) {
          setReindexMelding(
            `Klaar. ${verwerkt} document(en) opnieuw geïndexeerd` +
              (overgeslagen > 0 ? `, ${overgeslagen} overgeslagen (geen origineel of niet-ondersteund type)` : "") +
              "."
          );
          router.refresh();
          return;
        }
      }
      setReindexMelding(
        `Gestopt na de veiligheidslimiet. ${verwerkt} verwerkt, ${overgeslagen} overgeslagen. Start opnieuw om verder te gaan.`
      );
    } catch {
      setReindexMelding("Her-indexeren mislukte door een onverwachte fout. Probeer het opnieuw.");
    } finally {
      setReindexBezig(false);
    }
  }

  // T10 — review-/statussignalering voor de curatierol (afgeleid; besluit 0053).
  // Geen tweede store: puur berekend over de al opgehaalde generieke documenten.
  const vandaag = vandaagISO();
  const signalen = documenten.map((d) => ({
    canon: generiekGeldigheidsstatus({ status: d.status, bronstatus: d.bronstatus }),
    signaal: reviewSignaal(d.volgende_review, vandaag),
  }));
  const telVerlopen = signalen.filter((s) => s.canon !== "withdrawn" && s.signaal === "verlopen").length;
  const telNadert = signalen.filter((s) => s.canon !== "withdrawn" && s.signaal === "nadert").length;
  const telGeenDatum = signalen.filter((s) => s.canon === "published" && s.signaal === "geen_datum").length;
  const telDeprecated = signalen.filter((s) => s.canon === "deprecated").length;
  const telWithdrawn = signalen.filter((s) => s.canon === "withdrawn").length;

  const heeftFile = modus?.soort === "aanmaken" || modus?.soort === "vervangen";

  return (
    <div className="space-y-4">
      {melding && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            melding.ok
              ? "bg-ok-tint text-ok-ink"
              : "bg-err-tint text-err-ink"
          }`}
        >
          {melding.tekst}
        </div>
      )}

      {magBeheren && !modus && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => open({ soort: "aanmaken" })}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
          >
            + Nieuw generiek document
          </button>
          <button
            onClick={herindexeerGeneriek}
            disabled={reindexBezig}
            title="Genereert per fragment een structuur-label en een korte context-zin voor de zoekindex (Haiku) en maakt een nieuwe embedding. De getoonde brontekst en citaten blijven ongewijzigd; de bewerking is omkeerbaar."
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-accent/5 disabled:opacity-50"
          >
            {reindexBezig ? "Her-indexeren…" : "Bibliotheek her-indexeren"}
          </button>
        </div>
      )}

      {reindexMelding && (
        <div className="rounded-lg bg-app-bg px-4 py-3 text-sm text-ink">{reindexMelding}</div>
      )}

      {/* T10 — review-/statusoverzicht voor de curatierol. Verlopen review =
          niet meer actueel als bron; naderende review = binnenkort actie nodig. */}
      {documenten.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">Review- en statussignalering</h2>
          <p className="mt-0.5 text-xs text-ink/60">
            Verlopen of ingetrokken generieke content telt niet meer als actuele bron in de
            AI-assistent. Content zonder reviewdatum wordt niet gehandhaafd tot een datum is gezet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <TelChip label="Review verlopen" aantal={telVerlopen} toon="err" />
            <TelChip label="Review nadert (≤30 d)" aantal={telNadert} toon="warn" />
            <TelChip label="Geen reviewdatum" aantal={telGeenDatum} toon="warn" />
            <TelChip label="Verouderd (deprecated)" aantal={telDeprecated} toon="neutraal" />
            <TelChip label="Ingetrokken (withdrawn)" aantal={telWithdrawn} toon="neutraal" />
          </div>
        </div>
      )}

      {modus && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verstuur();
          }}
          className="space-y-4 rounded-xl border border-line bg-white p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 text-lg font-semibold">
              {modus.soort === "aanmaken"
                ? "Nieuw generiek document"
                : modus.soort === "bewerken"
                  ? `Bewerken — ${modus.doc.titel}`
                  : `Vervangen — ${modus.doc.titel}`}
            </h2>
            <button type="button" onClick={sluit} className="shrink-0 text-sm text-ink/60 hover:underline">
              Annuleren
            </button>
          </div>

          {/* Impactwaarschuwing (UX: maak gevolg vooraf expliciet). */}
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
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
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
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
            {/* Increment T6 — beheerkenmerken generieke contentlaag (§7/B3). */}
            <Veld label="Eigenaar (team/functie)" fout={veldfouten.eigenaar}>
              <Input value={form.eigenaar} onChange={(v) => set("eigenaar", v)} />
            </Veld>
            <Veld label="Versie" fout={veldfouten.versie}>
              <Input value={form.versie} onChange={(v) => set("versie", v)} />
            </Veld>
            <Veld label="Volgende review" fout={veldfouten.volgende_review}>
              <Input type="date" value={form.volgende_review} onChange={(v) => set("volgende_review", v)} />
            </Veld>
          </div>

          <Veld label="Statusinterpretatie" fout={veldfouten.statusinterpretatie}>
            <textarea
              value={form.statusinterpretatie}
              onChange={(e) => set("statusinterpretatie", e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </Veld>

          {modus.soort === "bewerken" && (
            <Veld
              label="Reden van wijziging (verplicht bij een statusovergang; voor het auditspoor)"
              fout={veldfouten.reden}
            >
              <Input value={form.reden} onChange={(v) => set("reden", v)} />
            </Veld>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={bezig}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
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

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-app-bg text-left text-xs uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Titel</th>
              <th className="px-4 py-2">Bron</th>
              <th className="px-4 py-2">Normgewicht</th>
              <th className="px-4 py-2">RAG</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Review</th>
              <th className="px-4 py-2">Verwerking</th>
              <th className="px-4 py-2 text-right">Acties</th>
            </tr>
          </thead>
          <tbody>
            {documenten.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink/50">
                  Nog geen generieke documenten.
                </td>
              </tr>
            )}
            {documenten.map((d) => {
              const vervangen = !!d.vervangen_door_document_id;
              const canon = generiekGeldigheidsstatus({ status: d.status, bronstatus: d.bronstatus });
              const signaal = reviewSignaal(d.volgende_review, vandaagISO());
              return (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <div className="font-medium">{d.titel}</div>
                    {d.bronorganisatie && (
                      <div className="text-xs text-ink/50">{d.bronorganisatie}</div>
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
                    <CanonBadge canon={canon} />
                    <div className="mt-0.5 text-xs text-ink/50">
                      {d.status ?? "—"} · {d.bronstatus ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <ReviewBadge signaal={signaal} />
                    {d.volgende_review && (
                      <div className="mt-0.5 text-xs text-ink/50">{d.volgende_review}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">{d.verwerkingsstatus ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 whitespace-nowrap text-xs">
                      {d.opslag_pad && (
                        <button onClick={() => inzage(d)} disabled={bezig} className="text-ink hover:underline disabled:opacity-50">
                          Inzage
                        </button>
                      )}
                      {magBeheren && !vervangen && (
                        <>
                          <button onClick={() => open({ soort: "bewerken", doc: d })} className="text-ink hover:underline">
                            Bewerken
                          </button>
                          <button onClick={() => open({ soort: "vervangen", doc: d })} className="text-ink hover:underline">
                            Vervangen
                          </button>
                          {canon === "published" && (
                            <button onClick={() => depreceren(d)} disabled={bezig} className="text-warn-ink hover:underline disabled:opacity-50">
                              Markeer verouderd
                            </button>
                          )}
                          {canon === "deprecated" && (
                            <button onClick={() => herpubliceren(d)} disabled={bezig} className="text-ink hover:underline disabled:opacity-50">
                              Herpubliceren
                            </button>
                          )}
                          {canon !== "withdrawn" && (
                            <button onClick={() => withdrawn(d)} disabled={bezig} className="text-err-ink hover:underline disabled:opacity-50">
                              Intrekken
                            </button>
                          )}
                          <button onClick={() => verwijderen(d)} disabled={bezig} className="text-err-ink hover:underline disabled:opacity-50">
                            Verwijderen
                          </button>
                        </>
                      )}
                      {vervangen && <span className="text-ink/40">Vervangen</span>}
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
      <span className="mb-1 block text-xs font-medium text-ink/70">{label}</span>
      {children}
      {fout && <span className="mt-1 block text-xs text-err-ink">{fout}</span>}
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
      className="w-full rounded-lg border border-line px-3 py-2 text-sm"
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
      className="w-full rounded-lg border border-line px-3 py-2 text-sm"
    >
      {opties.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
