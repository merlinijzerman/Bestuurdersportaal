// Content-type- en dispositionbepaling voor het serveren van originele
// documentbytes (WP4, pen-testvoorbereiding 17-08-2026).
//
// Bewust een pure helper, net als document-scan-poort.ts: de regel die bepaalt
// hoe onvertrouwde bytes aan een browser worden aangeboden verdient een
// regressietest zonder server- of Supabase-context.
//
// Twee harde uitgangspunten:
//  1. `attachment`, altijd. Er is geen bestandstype dat we op onze eigen origin
//     laten renderen. Een document dat inline rendert op een vertrouwd domein is
//     een phishingoppervlak, en het portaal heeft geen eigen viewer die dat zou
//     rechtvaardigen.
//  2. Nooit een content-type beloven dat niet is vastgesteld. Een onbekend of
//     leeg bestandstype wordt `application/octet-stream` — het type dat niets
//     belooft — en niet stilzwijgend `application/pdf`.
import {
  CONTENT_TYPE_PER_BESTANDSTYPE,
  ONDERSTEUNDE_TYPES,
  type Bestandstype,
} from "./document-extractie";

export const ONBEKEND_CONTENT_TYPE = "application/octet-stream";

/** Geldig bestandstype, of null. Geen enkele terugval op een ander type. */
export function normaliseerBestandstype(ruw: unknown): Bestandstype | null {
  if (typeof ruw !== "string") return null;
  return (ONDERSTEUNDE_TYPES as string[]).includes(ruw) ? (ruw as Bestandstype) : null;
}

export function bepaalContentType(ruw: unknown): string {
  const type = normaliseerBestandstype(ruw);
  return type ? CONTENT_TYPE_PER_BESTANDSTYPE[type] : ONBEKEND_CONTENT_TYPE;
}

/**
 * Bestandsnaam voor de Content-Disposition. Valt terug op de titel; hangt er
 * alleen een extensie aan als het type daadwerkelijk is vastgesteld.
 */
export function bepaalBestandsnaam(
  bestandsnaam: unknown,
  titel: string,
  ruwType: unknown
): string {
  if (typeof bestandsnaam === "string" && bestandsnaam.trim() !== "") return bestandsnaam;
  const type = normaliseerBestandstype(ruwType);
  return type ? `${titel}.${type}` : titel;
}
