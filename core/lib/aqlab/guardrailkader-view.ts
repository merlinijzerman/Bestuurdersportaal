// core/lib/aqlab/guardrailkader-view.ts
// -----------------------------------------------------------------------------
// AQLab — PURE view-model voor de guardrailkader-sectie van de assurance-view
// (T3, FR-19). Vertaalt het canonieke register core/lib/guardrailkader.ts naar
// een read-only, fonds-facing overzicht: per guardrail de klasse, hoe hij is
// getoetst (H/D geautomatiseerd, M via de evalset met menselijke aftekening) en
// het aanvaarde restrisico. Geen I/O, los testbaar.
//
// STRIKTE GRENS (zoals assurance-core): dit view-model bevat UITSLUITEND de
// canonieke matrix + toets-verwijzingen — geen ruwe output, prompt of testcase-
// inhoud. De guardrailtekst en de toets-referentie zijn metadata, geen data.
//
// De aftekening zelf (klasse M) is menselijk werk en wordt vastgelegd in de
// evals/*.md-reviewtabellen; deze view toont WELKE toets een guardrail borgt en
// van welke AARD die is, niet een zelf-gezette "groen"-vlag (geen schijnzekerheid).
// -----------------------------------------------------------------------------

import {
  GUARDRAILKADER,
  schendtKernregel,
  aftekenAard,
  type Guardrail,
  type MatrixWaarde,
} from "../guardrailkader";
import { STUK_PROMPTVARIANT } from "../stukvoorbereiding";

/** De bureau-promptvariant die T2 opleverde en die de bureau-evalset aftekent. */
export const BUREAU_PROMPTVARIANT = STUK_PROMPTVARIANT; // "bureau_stuk_v1"

export interface GuardrailkaderRij {
  id: string;
  omschrijving: string;
  /** Voor wie geldt de guardrail (bestuurlijk samengevat uit de matrix). */
  rollenLabel: string;
  /** "H" | "D" | "M" | "H+D" | "D+M" — de handhavingsklasse(n). */
  klasseLabel: string;
  /** Bestuurlijke duiding van de borging. */
  borging: "Geautomatiseerd geborgd" | "Aftekening via evalset";
  /** De concrete toets(en) waarnaar herleidbaar. */
  bewijs: string;
  /** Aanvaard restrisico met besluit, of null. */
  restrisico: string | null;
}

export interface GuardrailkaderView {
  titel: string;
  inleiding: string;
  /** De promptvariant die de producerende bureau-taak aftekent. */
  promptvariant: string;
  /** Kernregel §7.2 gehaald? (geen compliance-relevante guardrail uitsluitend M) */
  kernregelGroen: boolean;
  kernregelTekst: string;
  /** Aantallen voor de samenvatting boven de tabel. */
  totaal: number;
  aantalGeautomatiseerd: number;
  aantalViaEvalset: number;
  rijen: GuardrailkaderRij[];
}

/** Bestuurlijke samenvatting van de vier matrix-kolommen (B/V/Bh/BB). */
function rollenLabel(g: Guardrail): string {
  const r = g.rollen;
  const gelijk = (w: MatrixWaarde) => r.B === w && r.V === w && r.Bh === w && r.BB === w;
  if (gelijk("ja")) return "Alle rollen";
  if (gelijk("nee")) return "Geen enkele rol";
  // Alleen bureau (bestuurders nee of n.v.t.).
  if (r.BB === "ja" && r.B !== "ja" && r.V !== "ja" && r.Bh !== "ja") {
    return r.B === "nvt" ? "Bureau-taak" : "Alleen bureau";
  }
  // Nulgrens-achtig: geldt voor de bestaande rollen, niet voor het bureau.
  if (r.BB === "nvt" && (r.B === "ja" || r.V === "ja" || r.Bh === "ja")) {
    return "Bestaande rollen";
  }
  // Alleen voor het bureau verboden (bestuurdersrollen n.v.t., zij produceren geen
  // stukken) — bv. G8. Onderscheiden van een voor iedereen verboden guardrail.
  if (r.BB === "nee" && r.B !== "nee" && r.V !== "nee" && r.Bh !== "nee") {
    return "Verboden voor bureau";
  }
  if (r.BB === "nee") return "Verboden (alle rollen)";
  return "Zie matrix §7.3";
}

/** Eén register-guardrail → één read-only view-rij. */
export function bouwGuardrailkaderRij(g: Guardrail): GuardrailkaderRij {
  return {
    id: g.id,
    omschrijving: g.omschrijving,
    rollenLabel: rollenLabel(g),
    klasseLabel: g.klassen.join("+"),
    borging: aftekenAard(g) === "evalset" ? "Aftekening via evalset" : "Geautomatiseerd geborgd",
    bewijs: g.toetsen.map((t) => t.bewijs).join(" · "),
    restrisico: g.restrisico ? `${g.restrisico.reden} (besluit ${g.restrisico.besluit})` : null,
  };
}

/** Bouwt de complete read-only guardrailkader-view uit het canonieke register. */
export function bouwGuardrailkaderView(): GuardrailkaderView {
  const rijen = GUARDRAILKADER.map(bouwGuardrailkaderRij);
  const aantalViaEvalset = rijen.filter((r) => r.borging === "Aftekening via evalset").length;
  const kernregelGroen = schendtKernregel().length === 0;
  return {
    titel: "AI-gebruikskader — guardrailtoetsing",
    inleiding:
      "Het canonieke guardrailkader (ontwerp §7.3) legt per rol vast wat de AI mag, " +
      "en met welke handhavingsklasse dat is geborgd: H (hard — RLS/capability/type-merk), " +
      "D (deterministisch — server-side instructie of verplicht outputelement) of " +
      "M (modelgedrag — promptregel, afgetekend via de evalset). Dit overzicht is " +
      "herleidbaar naar code of eval en dient als onderlegger bij de DPIA.",
    promptvariant: BUREAU_PROMPTVARIANT,
    kernregelGroen,
    kernregelTekst: kernregelGroen
      ? "Geen enkele compliance-relevante guardrail leunt uitsluitend op modelgedrag " +
        "(klasse M) zonder harde tegenhanger of expliciet aanvaard restrisico."
      : "Let op: één of meer compliance-relevante guardrails leunen uitsluitend op " +
        "modelgedrag zonder tegenhanger — dit vergt herstel.",
    totaal: rijen.length,
    aantalGeautomatiseerd: rijen.length - aantalViaEvalset,
    aantalViaEvalset,
    rijen,
  };
}
