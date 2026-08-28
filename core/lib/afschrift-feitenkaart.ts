// ============================================================================
// T6 — Afschrift-feitenkaart (C7): deterministische feitenkaart per proces.
// ----------------------------------------------------------------------------
// De feitenkaart is de SCHEIDSLIJN tussen laag B (afgeleid, code) en laag C
// (duiding, AI — fase 2). Zij wordt volledig in code afgeleid uit de
// dossierviews + procedure_log. In fase 1 voedt zij het deterministische
// leeswijzer-sjabloon; in fase 2 is zij de ENIGE modelinput en de toetssteen
// voor de guardrail (elke datum/getal/eigennaam in de AI-tekst moet hierin
// voorkomen). Zij bevat dus GEEN duiding, alleen feiten.
//
// Puur en zonder DB: input is uitsluitend AfschriftBron (getypeerde fixtures).
// ============================================================================

import { DECISION_STATUS_LABEL } from "./decision-view";
import type {
  DecisionDossierView,
  Vertrouwelijkheid,
} from "./decision-view";
import {
  VERTROUWELIJKHEID_RANG,
  VERTROUWELIJKHEID_LABEL,
  type AfschriftBron,
  type BesluitFeiten,
  type BewijsTelling,
  type DissentTelling,
  type Feitenkaart,
  type Telling,
} from "./afschrift-types";

/** Hele dagen tussen twee ISO-tijdstippen (>= 0), of null bij ontbrekende data. */
export function dagenTussen(startISO: string | null, eindISO: string | null): number | null {
  if (!startISO || !eindISO) return null;
  const start = Date.parse(startISO);
  const eind = Date.parse(eindISO);
  if (Number.isNaN(start) || Number.isNaN(eind)) return null;
  return Math.max(0, Math.round((eind - start) / 86_400_000));
}

/** Telt items per waarde van een statusveld; alleen voorkomende statussen. */
function tellPerStatus<T>(items: T[], veld: (t: T) => string): Telling {
  const perStatus: Record<string, number> = {};
  for (const it of items) {
    const s = veld(it);
    perStatus[s] = (perStatus[s] ?? 0) + 1;
  }
  return { totaal: items.length, perStatus };
}

/** Kleinste/grootste ISO-tijdstip uit een reeks (null-safe). */
function minMaxISO(waarden: (string | null | undefined)[]): {
  eerste: string | null;
  laatste: string | null;
} {
  let eerste: string | null = null;
  let laatste: string | null = null;
  for (const w of waarden) {
    if (!w) continue;
    const t = Date.parse(w);
    if (Number.isNaN(t)) continue;
    if (eerste === null || t < Date.parse(eerste)) eerste = w;
    if (laatste === null || t > Date.parse(laatste)) laatste = w;
  }
  return { eerste, laatste };
}

/** Hoogste vertrouwelijkheid over alle besluiten (default 'intern' bij leeg). */
export function hoogsteVertrouwelijkheid(
  decisions: DecisionDossierView[]
): Vertrouwelijkheid {
  let hoogste: Vertrouwelijkheid = "intern";
  for (const d of decisions) {
    const v = d.decision.vertrouwelijkheid;
    if (VERTROUWELIJKHEID_RANG[v] > VERTROUWELIJKHEID_RANG[hoogste]) hoogste = v;
  }
  return hoogste;
}

/** Statusmarkers die als besluitniveau-afwijking gelden (beschrijvend). */
const AFWIJKENDE_STATUS: Record<string, string> = {
  heropend: "heropend",
  teruggezet: "teruggezet naar een eerdere fase",
  geescaleerd: "geëscaleerd",
  afgewezen: "afgewezen",
  aangehouden: "aangehouden",
  geannuleerd: "geannuleerd",
  voorwaardelijk_besloten: "voorwaardelijk besloten",
};

/** event_type-fragmenten die op een overruling/override wijzen. */
const OVERRULE_MARKERS = ["overrul", "override", "readiness_overrul", "readiness_override"];

function isOverruleEvent(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return OVERRULE_MARKERS.some((m) => t.includes(m));
}

function besluitFeiten(view: DecisionDossierView): BesluitFeiten {
  const d = view.decision;

  const aannames = tellPerStatus(view.assumptions, (a) => a.status);
  const risicos = tellPerStatus(view.risks, (r) => r.status);
  const voorwaarden = tellPerStatus(view.conditions, (c) => c.status);
  const acties = tellPerStatus(view.actions, (a) => a.status);

  const dissent: DissentTelling = {
    totaal: view.dissent.length,
    formeel: view.dissent.filter((x) => x.formeel_vastgesteld).length,
    perZichtbaarheid: tellPerStatus(view.dissent, (x) => x.zichtbaarheid).perStatus,
  };

  // Besluiten die bij dít Decision Object horen (view.besluiten is procesbreed).
  const eigenBesluiten = view.besluiten.filter((b) => b.decision_id === d.id);
  const { laatste: laatsteBesluitDatum } = minMaxISO(eigenBesluiten.map((b) => b.datum));

  // Eerste/laatste vastlegging: alle getimede items van dit besluit.
  const tijdstempels: (string | null)[] = [
    ...view.events.filter((e) => e.decision_id === d.id).map((e) => e.tijdstip),
    ...view.assumptions.map((a) => a.aangemaakt_op),
    ...view.risks.map((r) => r.aangemaakt_op),
    ...view.conditions.map((c) => c.aangemaakt_op),
    ...view.actions.map((a) => a.aangemaakt_op),
    ...view.dissent.map((x) => x.aangemaakt_op),
    ...eigenBesluiten.map((b) => b.datum),
  ];
  const { eerste, laatste } = minMaxISO(tijdstempels);

  return {
    besluitCode: d.besluit_code,
    titel: d.titel,
    status: d.status,
    statusLabel: DECISION_STATUS_LABEL[d.status] ?? d.status,
    vertrouwelijkheid: d.vertrouwelijkheid,
    aannames,
    risicos,
    voorwaarden,
    acties,
    dissent,
    vastgelegdeBesluiten: {
      totaal: eigenBesluiten.length,
      laatsteDatum: laatsteBesluitDatum,
    },
    eersteVastlegging: eerste,
    laatsteVastlegging: laatste,
  };
}

function bewijsTelling(view: DecisionDossierView | undefined): BewijsTelling {
  const bewijs = view?.bewijs ?? [];
  const metDocument = bewijs.filter((b) => b.document_id !== null).length;
  return {
    totaal: bewijs.length,
    metDocument,
    zonderDocument: bewijs.length - metDocument,
  };
}

function verzamelAfwijkingen(bron: AfschriftBron, bewijs: BewijsTelling): string[] {
  const uit: string[] = [];

  for (const view of bron.decisions) {
    const d = view.decision;
    const statusReden = AFWIJKENDE_STATUS[d.status];
    if (statusReden) {
      uit.push(`Besluit ${d.besluit_code} is ${statusReden}.`);
    }

    const overrulings = view.events.filter((e) => isOverruleEvent(e.event_type)).length;
    if (overrulings > 0) {
      uit.push(
        `Bij besluit ${d.besluit_code} ${overrulings === 1 ? "is één readiness-horde" : `zijn ${overrulings} readiness-hordes`} met een expliciete overruling gepasseerd.`
      );
    }

    // Blokkerende (kritieke), nog niet vervulde vereisten.
    const blokkerend = new Set<string>();
    if (view.readiness) {
      // OUD, append-only afschrift-snapshot: de readiness-vorm blijft leidend zodat
      // bestaande afschriften exact ongewijzigd blijven (0187/§443-slot).
      for (const res of Object.values(view.readiness)) {
        for (const o of res.ontbrekend) {
          if (o.blokkerend) blokkerend.add(`${o.requirement_type}:${o.stap_volgorde}:${o.label}`);
        }
      }
    } else {
      // NIEUW (readiness ontmanteld): de kritieke, nog niet vervulde vereisten uit
      // de evidence (`blokkerend` = zwaarte kritiek).
      for (const item of view.evidence) {
        if (!item.vervuld && item.blokkerend) {
          blokkerend.add(`${item.requirement_type}:${item.stap_volgorde}:${item.label}`);
        }
      }
    }
    if (blokkerend.size > 0) {
      uit.push(
        `Besluit ${d.besluit_code} heeft ${blokkerend.size} nog niet vervulde, blokkerende vereiste${blokkerend.size === 1 ? "" : "n"}.`
      );
    }
  }

  if (bewijs.zonderDocument > 0) {
    uit.push(
      `${bewijs.zonderDocument} bewijsstuk${bewijs.zonderDocument === 1 ? "" : "ken"} ${bewijs.zonderDocument === 1 ? "bestaat" : "bestaan"} alleen uit titel en beschrijving, zonder bijgevoegd bestand.`
    );
  }

  return uit;
}

/**
 * Bouwt de deterministische feitenkaart voor een proces. Procesbrede
 * collecties (bewijs) worden ontdubbeld uit de eerste view; besluitniveau-
 * feiten per Decision Object.
 */
export function bouwFeitenkaart(bron: AfschriftBron): Feitenkaart {
  const { context, decisions } = bron;
  const eersteView = decisions[0];
  const procedure = eersteView?.procedure ?? null;

  const besluiten = decisions.map(besluitFeiten);
  const bewijs = bewijsTelling(eersteView);

  const totalen = {
    aannames: 0,
    aannamesGevalideerd: 0,
    risicos: 0,
    risicosGeaccepteerd: 0,
    voorwaarden: 0,
    voorwaardenOpen: 0,
    acties: 0,
    dissent: 0,
    dissentFormeel: 0,
  };
  for (const view of decisions) {
    totalen.aannames += view.assumptions.length;
    totalen.aannamesGevalideerd += view.assumptions.filter((a) => a.status === "gevalideerd").length;
    totalen.risicos += view.risks.length;
    totalen.risicosGeaccepteerd += view.risks.filter((r) => r.status === "geaccepteerd").length;
    totalen.voorwaarden += view.conditions.length;
    totalen.voorwaardenOpen += view.conditions.filter((c) => c.status === "open").length;
    totalen.acties += view.actions.length;
    totalen.dissent += view.dissent.length;
    totalen.dissentFormeel += view.dissent.filter((x) => x.formeel_vastgesteld).length;
  }

  const doorlooptijdDagen = dagenTussen(
    procedure?.gestart_op ?? null,
    procedure?.afgerond_op ?? context.aangemaaktOp
  );

  // Onderbouwingsfase: eerste → laatste vastlegging over alle besluiten samen.
  const alleEerste = besluiten.map((b) => b.eersteVastlegging);
  const alleLaatste = besluiten.map((b) => b.laatsteVastlegging);
  const start = minMaxISO(alleEerste).eerste;
  const eind = minMaxISO(alleLaatste).laatste;

  return {
    procescode: context.procescode,
    procedureTitel: procedure?.titel ?? context.procescode,
    versie: context.versie,
    aanleiding: context.aanleiding,
    aangemaaktOp: context.aangemaaktOp,
    aantalBesluiten: decisions.length,
    hoogsteVertrouwelijkheid: hoogsteVertrouwelijkheid(decisions),
    doorlooptijdDagen,
    onderbouwingsfase: { start, eind },
    besluiten,
    bewijs,
    totalen,
    afwijkingen: verzamelAfwijkingen(bron, bewijs),
  };
}

/** Leesbaar label voor de hoogste vertrouwelijkheid (voor kop-/voettekst). */
export function vertrouwelijkheidLabel(v: Vertrouwelijkheid): string {
  return VERTROUWELIJKHEID_LABEL[v];
}
