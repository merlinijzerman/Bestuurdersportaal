"use client";

// ============================================================================
//  Beheer › Stuurinformatie — hoofd-clientcomponent (T14, decisions/0075).
// ----------------------------------------------------------------------------
//  Leest/schrijft via /api/stuurinformatie/beheer. Mockup-opzet: sticky
//  sectienavigatie links, kaarten Periode & bron / Balans / Reserves / Upload,
//  sticky savebar onderaan. De live berekende velden (subtotalen, evenwicht)
//  zijn cosmetisch — de server valideert hard (allowlist 400, evenwicht 422)
//  en de RPC/RLS blijven de echte grens. Opslaan publiceert DIRECT naar het
//  dashboard (geen vier-ogen — bewust besluit); elke mutatie wordt door de
//  DB-trigger append-only gelogd.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  ACTIVA_KEYS,
  PASSIVA_KEYS,
  VRIJE_RESERVE_KEYS,
  PERIODE_BRONNEN,
  berekenEvenwicht,
  type ActivaKey,
  type PassivaKey,
  type VrijeReserveKey,
} from "@/core/lib/stuurinfo-invoer";
import { parseNlGetal } from "@/core/lib/stuurinfo-sjabloon";
import { SOLI_VULLING_KEYS } from "@/core/lib/stuurinfo-soli";
import { OPER_MUTATIE_KEYS, OPER_KOSTEN_KEYS } from "@/core/lib/stuurinfo-operationeel";
import { PREMIE_COMPONENT_KEYS, COMP_MUTATIE_KEYS } from "@/core/lib/stuurinfo-premie";
import BalansInvoerTabel from "./BalansInvoerTabel";
import ReservesInvoer from "./ReservesInvoer";
import SpreidingInvoer from "./SpreidingInvoer";
import SolidariteitInvoer from "./SolidariteitInvoer";
import OperationeelInvoer from "./OperationeelInvoer";
import PremieInvoer from "./PremieInvoer";
import UploadPaneel, { type UploadToepassing } from "./UploadPaneel";

// ── Respons-vormen (spiegelen core/lib/stuurinfo-beheer-bron.ts) ────────────
export type Snapshot = {
  activa: Record<string, number | null>;
  passiva: Record<string, number | null>;
  reserves: Record<string, number | null>;
  grenzen: { solidariteitsreserve: { ondergrens: number | null; bovengrens: number | null } };
  financieringsgraad: number | null;
  spreiding: {
    beschikbaar: number | null;
    voorziening: number | null;
    aanpassingsfactor: number | null;
    bandOnder: number | null;
    bandBoven: number | null;
  };
  soli: Record<string, number | null> & { uitdeling: number | null; reserveStand: number | null };
  /** Tab 6 (T16): mutaties + norm/band + oper-reservestand (read-only anker). */
  operationeel: Record<string, number | null> & {
    norm: number | null;
    bandOnder: number | null;
    bandBoven: number | null;
    reserveStand: number | null;
  };
  operKostenRealisatie: Record<string, number | null>;
  operKostenBegroot: Record<string, number | null>;
  /** Tab 7 (T16): componenten (€ + %), depot-mutaties, kpi's + depotstand. */
  premie: {
    eur: Record<string, number | null>;
    pct: Record<string, number | null>;
    mutaties: Record<string, number | null>;
    toekenning: number | null;
    startomvang: number | null;
    ondergrensPct: number | null;
    reserveStand: number | null;
  };
};

type PeriodeOptie = { periode: string; label: string; peildatum: string; bron: string };

type LogRegel = {
  id: string;
  periode: string;
  tabel: string;
  veld_key: string;
  oude_waarde: unknown;
  nieuwe_waarde: unknown;
  invoer_bron: string | null;
  gebruiker_naam: string | null;
  aangemaakt: string;
};

type InvoerData = {
  periodes: PeriodeOptie[];
  gekozen: string | null;
  vorige: string | null;
  huidig: Snapshot;
  referentie: Snapshot | null;
  log: LogRegel[];
};

// ── Formulierstate (alles strings; NL-notatie toegestaan) ───────────────────
export type VeldState = {
  activa: Record<string, string>;
  passiva: Record<string, string>;
  reserves: Record<string, string>;
  ondergrens: string;
  bovengrens: string;
  fg: string;
  /** Tab 4 (T15): payload-veldnamen (beschikbaar, voorziening, …, band_onder/_boven). */
  spreiding: Record<string, string>;
  /** Tab 5 (T15): vier bronnen + uitdeling. */
  soli: Record<string, string>;
  /** Tab 6 (T16): acht mutatiebronnen + norm + band_onder/_boven. */
  operationeel: Record<string, string>;
  operKostenRealisatie: Record<string, string>;
  operKostenBegroot: Record<string, string>;
  /** Tab 7 (T16): componenten (€ + %), depot-mutaties en kpi-velden. */
  premieEur: Record<string, string>;
  premiePct: Record<string, string>;
  compMutaties: Record<string, string>;
  premieKpis: Record<string, string>;
};

/** T16-veldsecties (tab 6/7) — gedeelde setter voor beide invoercomponenten. */
export type T16VeldSectie =
  | "operationeel"
  | "operKostenRealisatie"
  | "operKostenBegroot"
  | "premieEur"
  | "premiePct"
  | "compMutaties"
  | "premieKpis";

const naarTekst = (v: number | null): string =>
  v === null ? "" : String(v).replace(".", ",");

const naarVeldState = (s: Snapshot): VeldState => ({
  activa: Object.fromEntries(ACTIVA_KEYS.map((k) => [k, naarTekst(s.activa[k] ?? null)])),
  passiva: Object.fromEntries(PASSIVA_KEYS.map((k) => [k, naarTekst(s.passiva[k] ?? null)])),
  reserves: Object.fromEntries(VRIJE_RESERVE_KEYS.map((k) => [k, naarTekst(s.reserves[k] ?? null)])),
  ondergrens: naarTekst(s.grenzen.solidariteitsreserve.ondergrens),
  bovengrens: naarTekst(s.grenzen.solidariteitsreserve.bovengrens),
  fg: naarTekst(s.financieringsgraad),
  spreiding: {
    beschikbaar: naarTekst(s.spreiding.beschikbaar),
    voorziening: naarTekst(s.spreiding.voorziening),
    aanpassingsfactor: naarTekst(s.spreiding.aanpassingsfactor),
    band_onder: naarTekst(s.spreiding.bandOnder),
    band_boven: naarTekst(s.spreiding.bandBoven),
  },
  soli: {
    ...Object.fromEntries(SOLI_VULLING_KEYS.map((k) => [k, naarTekst(s.soli[k] ?? null)])),
    uitdeling: naarTekst(s.soli.uitdeling),
  },
  operationeel: {
    ...Object.fromEntries(OPER_MUTATIE_KEYS.map((k) => [k, naarTekst(s.operationeel[k] ?? null)])),
    norm: naarTekst(s.operationeel.norm),
    band_onder: naarTekst(s.operationeel.bandOnder),
    band_boven: naarTekst(s.operationeel.bandBoven),
  },
  operKostenRealisatie: Object.fromEntries(
    OPER_KOSTEN_KEYS.map((k) => [k, naarTekst(s.operKostenRealisatie[k] ?? null)])
  ),
  operKostenBegroot: Object.fromEntries(
    OPER_KOSTEN_KEYS.map((k) => [k, naarTekst(s.operKostenBegroot[k] ?? null)])
  ),
  premieEur: Object.fromEntries(
    PREMIE_COMPONENT_KEYS.map((k) => [k, naarTekst(s.premie.eur[k] ?? null)])
  ),
  premiePct: Object.fromEntries(
    PREMIE_COMPONENT_KEYS.map((k) => [k, naarTekst(s.premie.pct[k] ?? null)])
  ),
  compMutaties: Object.fromEntries(
    COMP_MUTATIE_KEYS.map((k) => [k, naarTekst(s.premie.mutaties[k] ?? null)])
  ),
  premieKpis: {
    toekenning: naarTekst(s.premie.toekenning),
    startomvang: naarTekst(s.premie.startomvang),
    ondergrens_pct: naarTekst(s.premie.ondergrensPct),
  },
});

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData
      ? init?.headers
      : { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Er ging iets mis");
  return data;
}

const SECTIES = [
  { id: "periode", label: "Periode & bron", actief: true, tag: null },
  { id: "balans", label: "1 · Balans", actief: true, tag: "Tab 1" },
  { id: "reserves", label: "1 · Reserves", actief: true, tag: "Tab 1" },
  { id: "spreiding", label: "4 · Spreiding", actief: true, tag: "Tab 4" },
  { id: "solidariteit", label: "5 · Solidariteit", actief: true, tag: "Tab 5" },
  { id: "operationeel", label: "6 · Operationeel", actief: true, tag: "Tab 6" },
  { id: "premie", label: "7 · Premie & compensatie", actief: true, tag: "Tab 7" },
  { id: "upload", label: "Upload i.p.v. typen", actief: true, tag: null },
  { id: null, label: "2 · Rendementstoedeling", actief: false, tag: "volgt" },
  { id: null, label: "3 · Biometrisch", actief: false, tag: "volgt" },
  { id: null, label: "Deelnemers & signalen", actief: false, tag: "volgt" },
] as const;

// "reeks" heette hier t/m T15 "Balans" (toen de enige reeks); sinds T15/T16
// dekt de tabel ook soli-, oper- en premie-reeksen — neutraal label dus.
const LOG_TABEL_LABEL: Record<string, string> = {
  periode: "Periode",
  reeks: "Reeks",
  reserve: "Reserve",
  kpi: "KPI",
};

export default function StuurinfoInvoer() {
  const [data, setData] = useState<InvoerData | null>(null);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const [velden, setVelden] = useState<VeldState | null>(null);
  const [peildatum, setPeildatum] = useState("");
  const [bron, setBron] = useState<string>("handmatig");
  const [invoerBron, setInvoerBron] = useState<"handmatig" | "upload">("handmatig");
  const [gewijzigd, setGewijzigd] = useState(false);

  // Mini-formulier "+ Nieuwe periode aanmaken…"
  const [nieuwOpen, setNieuwOpen] = useState(false);
  const [nieuwPeriode, setNieuwPeriode] = useState("");
  const [nieuwPeildatum, setNieuwPeildatum] = useState("");
  const [nieuwBron, setNieuwBron] = useState<string>("uitvoerder_kwartaal");

  const laad = useCallback(async (periode?: string) => {
    setLaden(true);
    setFout(null);
    try {
      const url = periode
        ? `/api/stuurinformatie/beheer?periode=${encodeURIComponent(periode)}`
        : "/api/stuurinformatie/beheer";
      const d = (await jsonFetch(url)) as InvoerData;
      setData(d);
      setVelden(naarVeldState(d.huidig));
      const optie = d.periodes.find((p) => p.periode === d.gekozen);
      setPeildatum(optie?.peildatum ?? "");
      // Registry-bron kan nog 'seed_synthetisch' zijn; het invoerformulier
      // beperkt tot de vaste bronnenlijst (fallback: handmatig).
      setBron(PERIODE_BRONNEN.some((b) => b.key === optie?.bron) ? (optie?.bron as string) : "handmatig");
      setInvoerBron("handmatig");
      setGewijzigd(false);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Laden mislukt");
    } finally {
      setLaden(false);
    }
  }, []);

  useEffect(() => {
    laad();
  }, [laad]);

  // ── Veld-mutaties (handmatige wijziging zet de invoerbron terug) ──────────
  const zetVeld = (sectie: "activa" | "passiva" | "reserves", key: string, waarde: string) => {
    setVelden((v) => (v ? { ...v, [sectie]: { ...v[sectie], [key]: waarde } } : v));
    setInvoerBron("handmatig");
    setGewijzigd(true);
  };
  const zetLosVeld = (veld: "ondergrens" | "bovengrens" | "fg", waarde: string) => {
    setVelden((v) => (v ? { ...v, [veld]: waarde } : v));
    setInvoerBron("handmatig");
    setGewijzigd(true);
  };
  // Tab 4/5-secties (T15): eigen save per sectie — de gedeelde gewijzigd-vlag
  // van de balans-savebar blijft onaangeraakt (losse publicatiepaden). Een
  // handmatige wijziging zet de invoerbron wél terug (correcte herkomst in
  // het auditlog, ook ná "upload toepassen" op de balans-sectie).
  const zetSpreidingVeld = (key: string, waarde: string) => {
    setVelden((v) => (v ? { ...v, spreiding: { ...v.spreiding, [key]: waarde } } : v));
    setInvoerBron("handmatig");
  };
  const zetSoliVeld = (key: string, waarde: string) => {
    setVelden((v) => (v ? { ...v, soli: { ...v.soli, [key]: waarde } } : v));
    setInvoerBron("handmatig");
  };
  // Tab 6/7-secties (T16): één setter voor alle T16-veldsecties.
  const zetT16Veld = (sectie: T16VeldSectie, key: string, waarde: string) => {
    setVelden((v) => (v ? { ...v, [sectie]: { ...v[sectie], [key]: waarde } } : v));
    setInvoerBron("handmatig");
  };

  // ── Upload → formulierstate (één publish-pad via de savebar) ──────────────
  const pasUploadToe = (toepassing: UploadToepassing) => {
    setVelden((v) => {
      if (!v) return v;
      const kopie: VeldState = {
        ...v,
        activa: { ...v.activa },
        passiva: { ...v.passiva },
        reserves: { ...v.reserves },
      };
      for (const { doel, waarde } of toepassing.velden) {
        const tekst = naarTekst(waarde);
        if (doel.soort === "balans_activa") kopie.activa[doel.key] = tekst;
        else if (doel.soort === "balans_passiva") kopie.passiva[doel.key] = tekst;
        else if (doel.soort === "reserve") kopie.reserves[doel.key] = tekst;
        else if (doel.soort === "reserve_grens") kopie[doel.key] = tekst;
        else if (doel.soort === "kpi") kopie.fg = tekst;
      }
      return kopie;
    });
    setInvoerBron("upload");
    setGewijzigd(true);
    setMelding(
      `${toepassing.velden.length} herkende velden overgenomen in het formulier. Controleer en publiceer via de balk onderaan.`
    );
  };

  // ── Payload + blokkers (live; de server hervalideert hard) ────────────────
  const parseVelden = () => {
    if (!velden) return null;
    const activa = {} as Record<ActivaKey, number | null>;
    const passiva = {} as Record<PassivaKey, number | null>;
    const reserves = {} as Record<VrijeReserveKey, number | null>;
    for (const k of ACTIVA_KEYS) activa[k] = parseNlGetal(velden.activa[k]);
    for (const k of PASSIVA_KEYS) passiva[k] = parseNlGetal(velden.passiva[k]);
    for (const k of VRIJE_RESERVE_KEYS) reserves[k] = parseNlGetal(velden.reserves[k]);
    return {
      activa,
      passiva,
      reserves,
      ondergrens: velden.ondergrens.trim() === "" ? null : parseNlGetal(velden.ondergrens),
      bovengrens: velden.bovengrens.trim() === "" ? null : parseNlGetal(velden.bovengrens),
      fg: parseNlGetal(velden.fg),
    };
  };

  const geparsed = parseVelden();
  const ontbrekend: string[] = [];
  if (geparsed) {
    for (const k of ACTIVA_KEYS) if (geparsed.activa[k] === null) ontbrekend.push(`activa: ${k}`);
    for (const k of PASSIVA_KEYS) if (geparsed.passiva[k] === null) ontbrekend.push(`passiva: ${k}`);
    for (const k of VRIJE_RESERVE_KEYS) if (geparsed.reserves[k] === null) ontbrekend.push(`reserve: ${k}`);
    if (geparsed.fg === null) ontbrekend.push("financieringsgraad");
    if (velden && velden.ondergrens.trim() !== "" && geparsed.ondergrens === null) ontbrekend.push("ondergrens (ongeldig)");
    if (velden && velden.bovengrens.trim() !== "" && geparsed.bovengrens === null) ontbrekend.push("bovengrens (ongeldig)");
  }
  const compleet = geparsed !== null && ontbrekend.length === 0;
  const evenwicht = compleet
    ? berekenEvenwicht(
        geparsed.activa as Record<ActivaKey, number>,
        geparsed.passiva as Record<PassivaKey, number>
      )
    : null;
  const magOpslaan =
    compleet && evenwicht !== null && evenwicht.sluit && !bezig && !nieuwOpen && data?.gekozen !== null;

  // ── Acties ─────────────────────────────────────────────────────────────────
  async function maakPeriode() {
    setBezig(true);
    setFout(null);
    setMelding(null);
    try {
      await jsonFetch("/api/stuurinformatie/beheer", {
        method: "POST",
        body: JSON.stringify({
          type: "periode",
          periode: nieuwPeriode.trim().toUpperCase(),
          peildatum: nieuwPeildatum,
          bron: nieuwBron,
        }),
      });
      setMelding(`Periode ${nieuwPeriode.trim().toUpperCase()} aangemaakt.`);
      setNieuwOpen(false);
      setNieuwPeriode("");
      setNieuwPeildatum("");
      await laad(nieuwPeriode.trim().toUpperCase());
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Aanmaken mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function opslaan() {
    if (!geparsed || !data?.gekozen || !compleet) return;
    setBezig(true);
    setFout(null);
    setMelding(null);
    try {
      await jsonFetch("/api/stuurinformatie/beheer", {
        method: "POST",
        body: JSON.stringify({
          type: "balans_reserves",
          periode: data.gekozen,
          peildatum,
          bron,
          invoer_bron: invoerBron,
          activa: geparsed.activa,
          passiva: geparsed.passiva,
          reserves: geparsed.reserves,
          grenzen: {
            solidariteitsreserve: {
              ondergrens: geparsed.ondergrens,
              bovengrens: geparsed.bovengrens,
            },
          },
          financieringsgraad: geparsed.fg,
        }),
      });
      setMelding(`Opgeslagen en gepubliceerd naar het dashboard (periode ${data.gekozen}).`);
      await laad(data.gekozen);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  // ── Tab 4/5-saves (T15): eigen POST-type per sectie ────────────────────────
  async function slaSpreidingOp() {
    if (!velden || !data?.gekozen) return;
    setBezig(true);
    setFout(null);
    setMelding(null);
    try {
      await jsonFetch("/api/stuurinformatie/beheer", {
        method: "POST",
        body: JSON.stringify({
          type: "spreiding",
          periode: data.gekozen,
          invoer_bron: invoerBron,
          kerncijfers: {
            beschikbaar: parseNlGetal(velden.spreiding.beschikbaar),
            voorziening: parseNlGetal(velden.spreiding.voorziening),
            aanpassingsfactor: parseNlGetal(velden.spreiding.aanpassingsfactor),
            band_onder: velden.spreiding.band_onder.trim() === "" ? null : parseNlGetal(velden.spreiding.band_onder),
            band_boven: velden.spreiding.band_boven.trim() === "" ? null : parseNlGetal(velden.spreiding.band_boven),
          },
        }),
      });
      setMelding(`Spreiding opgeslagen en gepubliceerd naar het dashboard (periode ${data.gekozen}).`);
      await laad(data.gekozen);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function slaSolidariteitOp() {
    if (!velden || !data?.gekozen) return;
    setBezig(true);
    setFout(null);
    setMelding(null);
    try {
      await jsonFetch("/api/stuurinformatie/beheer", {
        method: "POST",
        body: JSON.stringify({
          type: "solidariteit",
          periode: data.gekozen,
          invoer_bron: invoerBron,
          vulling: Object.fromEntries(
            SOLI_VULLING_KEYS.map((k) => [k, parseNlGetal(velden.soli[k])])
          ),
          uitdeling: parseNlGetal(velden.soli.uitdeling),
          grenzen: {
            ondergrens: velden.ondergrens.trim() === "" ? null : parseNlGetal(velden.ondergrens),
            bovengrens: velden.bovengrens.trim() === "" ? null : parseNlGetal(velden.bovengrens),
          },
        }),
      });
      setMelding(`Solidariteit opgeslagen en gepubliceerd naar het dashboard (periode ${data.gekozen}).`);
      await laad(data.gekozen);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  // ── Tab 6/7-saves (T16): eigen POST-type per sectie ────────────────────────
  async function slaOperationeelOp() {
    if (!velden || !data?.gekozen) return;
    setBezig(true);
    setFout(null);
    setMelding(null);
    try {
      await jsonFetch("/api/stuurinformatie/beheer", {
        method: "POST",
        body: JSON.stringify({
          type: "operationeel",
          periode: data.gekozen,
          // Altijd 'handmatig': de Excel-upload mapt geen T16-velden, dus de
          // gedeelde invoerBron-state ('upload' na "upload toepassen" op de
          // balans) zou hier een onjuiste herkomst loggen (audit-review T16).
          // Bij de latere sjabloon-uitbreiding: per-sectie herkomst invoeren.
          invoer_bron: "handmatig",
          mutaties: Object.fromEntries(
            OPER_MUTATIE_KEYS.map((k) => [k, parseNlGetal(velden.operationeel[k])])
          ),
          norm: parseNlGetal(velden.operationeel.norm),
          band_onder:
            velden.operationeel.band_onder.trim() === ""
              ? null
              : parseNlGetal(velden.operationeel.band_onder),
          band_boven:
            velden.operationeel.band_boven.trim() === ""
              ? null
              : parseNlGetal(velden.operationeel.band_boven),
          kosten_realisatie: Object.fromEntries(
            OPER_KOSTEN_KEYS.map((k) => [k, parseNlGetal(velden.operKostenRealisatie[k])])
          ),
          kosten_begroot: Object.fromEntries(
            OPER_KOSTEN_KEYS.map((k) => [k, parseNlGetal(velden.operKostenBegroot[k])])
          ),
        }),
      });
      setMelding(`Operationeel opgeslagen en gepubliceerd naar het dashboard (periode ${data.gekozen}).`);
      await laad(data.gekozen);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function slaPremieOp() {
    if (!velden || !data?.gekozen) return;
    setBezig(true);
    setFout(null);
    setMelding(null);
    try {
      await jsonFetch("/api/stuurinformatie/beheer", {
        method: "POST",
        body: JSON.stringify({
          type: "premie",
          periode: data.gekozen,
          // Altijd 'handmatig' — zelfde reden als de operationeel-save.
          invoer_bron: "handmatig",
          componenten_eur: Object.fromEntries(
            PREMIE_COMPONENT_KEYS.map((k) => [k, parseNlGetal(velden.premieEur[k])])
          ),
          componenten_pct: Object.fromEntries(
            PREMIE_COMPONENT_KEYS.map((k) => [k, parseNlGetal(velden.premiePct[k])])
          ),
          comp_mutaties: Object.fromEntries(
            COMP_MUTATIE_KEYS.map((k) => [k, parseNlGetal(velden.compMutaties[k])])
          ),
          toekenning: parseNlGetal(velden.premieKpis.toekenning),
          startomvang:
            velden.premieKpis.startomvang.trim() === ""
              ? null
              : parseNlGetal(velden.premieKpis.startomvang),
          ondergrens_pct:
            velden.premieKpis.ondergrens_pct.trim() === ""
              ? null
              : parseNlGetal(velden.premieKpis.ondergrens_pct),
        }),
      });
      setMelding(
        `Premie & compensatie opgeslagen en gepubliceerd naar het dashboard (periode ${data.gekozen}).`
      );
      await laad(data.gekozen);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  if (laden && !data) return <div className="text-muted text-sm">Invoerdata laden…</div>;
  if (fout && !data)
    return (
      <div className="rounded-lg border border-err/30 bg-err-tint p-3 text-sm text-err-ink">{fout}</div>
    );
  if (!data || !velden) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_1fr]">
      {/* ── Sectienavigatie (sticky) ─────────────────────────────────────── */}
      <nav className="hidden lg:block">
        <div className="sticky top-6 space-y-0.5 text-sm">
          {SECTIES.map((s) =>
            s.actief && s.id ? (
              <a
                key={s.label}
                href={`#${s.id}`}
                className="flex items-center justify-between rounded-lg px-3 py-1.5 text-ink hover:bg-app-bg"
              >
                <span>{s.label}</span>
                {s.tag && <span className="text-[10px] text-muted">{s.tag}</span>}
              </a>
            ) : (
              <div
                key={s.label}
                className="flex items-center justify-between rounded-lg px-3 py-1.5 text-muted/60"
                title="Invoer volgt in het betreffende tab-ticket"
              >
                <span>{s.label}</span>
                <span className="text-[10px]">(volgt)</span>
              </div>
            )
          )}
        </div>
      </nav>

      {/* ── Inhoud ───────────────────────────────────────────────────────── */}
      <div className="space-y-6 min-w-0 pb-8">
        {melding && (
          <div className="rounded-lg border border-ok/30 bg-ok-tint p-3 text-sm text-ok-ink">{melding}</div>
        )}
        {fout && (
          <div className="rounded-lg border border-err/30 bg-err-tint p-3 text-sm text-err-ink">{fout}</div>
        )}

        {/* ── Periode & bron ────────────────────────────────────────────── */}
        <section id="periode" className="rounded-xl border border-line bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-ink">Periode &amp; bron</h2>
            <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Bewerken</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Rapportageperiode</label>
              <select
                value={nieuwOpen ? "__nieuw" : data.gekozen ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__nieuw") {
                    setNieuwOpen(true);
                  } else {
                    setNieuwOpen(false);
                    laad(e.target.value);
                  }
                }}
                disabled={bezig}
                className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm bg-white"
              >
                {data.periodes.map((p) => (
                  <option key={p.periode} value={p.periode}>
                    {p.label}
                  </option>
                ))}
                <option value="__nieuw">+ Nieuwe periode aanmaken…</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Bron van de cijfers</label>
              <select
                value={bron}
                onChange={(e) => {
                  setBron(e.target.value);
                  setGewijzigd(true);
                }}
                disabled={bezig || nieuwOpen}
                className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm bg-white"
              >
                {PERIODE_BRONNEN.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Peildatum</label>
              <input
                type="date"
                value={peildatum}
                onChange={(e) => {
                  setPeildatum(e.target.value);
                  setGewijzigd(true);
                }}
                disabled={bezig || nieuwOpen}
                className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm bg-white"
              />
            </div>
          </div>

          {nieuwOpen && (
            <div className="mt-4 rounded-lg border border-accent/30 bg-app-bg p-4">
              <div className="text-sm font-medium text-ink mb-2">Nieuwe rapportageperiode</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Periode (bv. 2026Q3)</label>
                  <input
                    value={nieuwPeriode}
                    onChange={(e) => setNieuwPeriode(e.target.value)}
                    placeholder="2026Q3"
                    className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Peildatum</label>
                  <input
                    type="date"
                    value={nieuwPeildatum}
                    onChange={(e) => setNieuwPeildatum(e.target.value)}
                    className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Bron</label>
                  <select
                    value={nieuwBron}
                    onChange={(e) => setNieuwBron(e.target.value)}
                    className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm bg-white"
                  >
                    {PERIODE_BRONNEN.map((b) => (
                      <option key={b.key} value={b.key}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={maakPeriode}
                  disabled={bezig || !/^\d{4}Q[1-4]$/.test(nieuwPeriode.trim().toUpperCase()) || !nieuwPeildatum}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
                >
                  Periode aanmaken
                </button>
                <button
                  onClick={() => setNieuwOpen(false)}
                  disabled={bezig}
                  className="rounded-lg border border-app-line-strong px-4 py-2 text-sm text-ink hover:bg-app-bg"
                >
                  Annuleren
                </button>
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-muted">
            <strong>Bron + peildatum</strong> worden per periode vastgelegd, zodat altijd herleidbaar is
            waar de cijfers vandaan komen. Invoer werkt voorlopig <strong>zonder vier-ogen</strong>:
            opslaan zet de cijfers direct in het dashboard.
          </p>
        </section>

        {/* ── Balans ────────────────────────────────────────────────────── */}
        <BalansInvoerTabel
          velden={velden}
          referentie={data.referentie}
          gekozenPeriode={data.gekozen}
          vorigePeriode={data.vorige}
          zetVeld={zetVeld}
          zetFg={(w) => zetLosVeld("fg", w)}
          uitgeschakeld={bezig || nieuwOpen}
        />

        {/* ── Reserves ──────────────────────────────────────────────────── */}
        <ReservesInvoer
          velden={velden}
          referentie={data.referentie}
          zetVeld={(key, w) => zetVeld("reserves", key, w)}
          uitgeschakeld={bezig || nieuwOpen}
        />

        {/* ── Spreiding (tab 4, T15) — eigen save ───────────────────────── */}
        <SpreidingInvoer
          velden={velden}
          referentie={data.referentie}
          zetVeld={zetSpreidingVeld}
          opslaan={slaSpreidingOp}
          bezig={bezig}
          uitgeschakeld={bezig || nieuwOpen}
        />

        {/* ── Solidariteit (tab 5, T15) — eigen save; grenzen = één bron ── */}
        <SolidariteitInvoer
          velden={velden}
          huidig={data.huidig}
          referentie={data.referentie}
          zetVeld={zetSoliVeld}
          zetGrens={(veld, w) => zetLosVeld(veld, w)}
          opslaan={slaSolidariteitOp}
          bezig={bezig}
          uitgeschakeld={bezig || nieuwOpen}
        />

        {/* ── Operationeel (tab 6, T16) — eigen save ────────────────────── */}
        <OperationeelInvoer
          velden={velden}
          huidig={data.huidig}
          referentie={data.referentie}
          zetVeld={zetT16Veld}
          opslaan={slaOperationeelOp}
          bezig={bezig}
          uitgeschakeld={bezig || nieuwOpen}
        />

        {/* ── Premie & compensatie (tab 7, T16) — eigen save ────────────── */}
        <PremieInvoer
          velden={velden}
          huidig={data.huidig}
          referentie={data.referentie}
          zetVeld={zetT16Veld}
          opslaan={slaPremieOp}
          bezig={bezig}
          uitgeschakeld={bezig || nieuwOpen}
        />

        {/* ── Upload ────────────────────────────────────────────────────── */}
        <UploadPaneel
          referentie={data.referentie}
          onToepassen={pasUploadToe}
          uitgeschakeld={bezig || nieuwOpen}
        />

        {/* ── Sticky savebar ────────────────────────────────────────────── */}
        <div className="sticky bottom-4 z-20 rounded-xl border border-line bg-white/95 shadow-lg backdrop-blur px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px] text-xs text-muted">
              {gewijzigd ? (
                <span>
                  <strong className="text-ink">Concept — nog niet opgeslagen.</strong> Elke wijziging
                  wordt append-only gelogd (wie, wat, wanneer).
                </span>
              ) : (
                <span>Geen openstaande wijzigingen.</span>
              )}
              {ontbrekend.length > 0 && (
                <span className="ml-2 text-warn-ink">
                  Nog {ontbrekend.length} veld{ontbrekend.length === 1 ? "" : "en"} leeg of ongeldig.
                </span>
              )}
              {evenwicht && !evenwicht.sluit && (
                <span className="ml-2 text-err-ink">Balans sluit niet — opslaan geblokkeerd.</span>
              )}
            </div>
            <button
              onClick={() => {
                setVelden(naarVeldState(data.huidig));
                setInvoerBron("handmatig");
                setGewijzigd(false);
                setMelding(null);
                setFout(null);
              }}
              disabled={bezig || !gewijzigd}
              className="rounded-lg border border-app-line-strong px-4 py-2 text-sm text-ink hover:bg-app-bg disabled:opacity-50"
            >
              Annuleren
            </button>
            <button
              onClick={opslaan}
              disabled={!magOpslaan || !gewijzigd}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Opslaan & publiceren naar dashboard"}
            </button>
          </div>
        </div>

        {/* ── Wijzigingshistorie ────────────────────────────────────────── */}
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-lg font-semibold text-ink mb-1">Recente wijzigingen</h2>
          <p className="text-sm text-muted mb-3">
            Append-only auditspoor van invoer en uploads (wie, wat, wanneer, oud → nieuw, bron).
            Regels zonder gebruiker zijn seed-/migratiewrites.
          </p>
          {data.log.length === 0 ? (
            <div className="text-muted text-sm">Nog geen invoerwijzigingen vastgelegd.</div>
          ) : (
            <div className="space-y-1.5">
              {data.log.map((r) => (
                <div key={r.id} className="rounded-lg border border-line px-4 py-2 text-sm">
                  <div className="text-ink">
                    <span className="font-medium">{LOG_TABEL_LABEL[r.tabel] ?? r.tabel}</span> · {r.veld_key}{" "}
                    <span className="text-xs text-muted">({r.periode})</span>
                    {r.invoer_bron && (
                      <span className="ml-2 rounded bg-app-bg px-1.5 py-0.5 text-xs text-muted">
                        {r.invoer_bron}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(r.aangemaakt).toLocaleString("nl-NL")}
                    {r.gebruiker_naam ? ` · ${r.gebruiker_naam}` : " · systeem/seed"}
                    {r.oude_waarde !== null ? " · gewijzigd" : " · nieuw"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
