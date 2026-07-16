// ============================================================================
//  Stuurinformatie beheer-invoerlaag — SERVER-side schrijvers (T14).
// ----------------------------------------------------------------------------
//  Twee schrijfpaden, beide op de anon-key RLS-client (nooit service-role):
//
//  * schrijfPeriode()      — nieuwe rapportageperiode in de registry (insert;
//                            een bestaande periode geeft een expliciete fout —
//                            peildatum/bron van een bestaande periode worden
//                            via de save-RPC bijgewerkt).
//  * slaBalansReservesOp() — de atomische save via RPC stuurinfo_balans_opslaan
//                            (SECURITY INVOKER; registry + 10 balans-leaves +
//                            8 reserves + FG-KPI in één transactie, RLS geldt).
//
//  De caller (route handler) heeft de payload al gevalideerd met
//  valideerBalansInvoer()/valideerPeriodeInvoer() (400/422) én de capability-
//  en modulegates gepasseerd. fonds_id wordt hier nooit meegegeven aan de RPC:
//  die leidt hem zelf af uit auth.uid() (geen parameter — tenant-invariant).
//  Elke geslaagde write wordt door de DB-trigger fn_fonds_stuurinfo_capture
//  append-only gelogd (fonds_stuurinfo_log) — niet overslaanbaar vanuit code.
// ============================================================================

import "server-only";
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  bouwReserveRijen,
  periodeVolgorde,
  type BalansReservesInvoer,
  type PeriodeInvoer,
} from "@/core/lib/stuurinfo-invoer";

/** Postgres unique_violation (bestaande periode). */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Maakt een nieuwe rapportageperiode aan in de registry van het eigen fonds.
 * Bewust een INSERT (geen upsert): per ongeluk een bestaande periode
 * "aanmaken" mag geen stille overschrijving van peildatum/bron zijn.
 */
export async function schrijfPeriode(
  fondsId: string,
  invoer: PeriodeInvoer
): Promise<{ ok: true } | { ok: false; fout: string }> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("fonds_stuurinfo_periode").insert({
    fonds_id: fondsId,
    periode: invoer.periode,
    peildatum: invoer.peildatum,
    bron: invoer.bron,
    volgorde: periodeVolgorde(invoer.periode),
    invoer_bron: "handmatig",
  });
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, fout: `Periode ${invoer.periode} bestaat al — kies hem in de lijst.` };
    }
    throw new Error(error.message);
  }
  return { ok: true };
}

export type SaveResultaat = { ok: true } | { ok: false; status: 422; fout: string };

/**
 * Slaat de volledige balans/reserves-invoer van één periode atomisch op via
 * de RPC. De reserve-rijen (incl. gekoppelde standen en pct_waarde) worden
 * hier uit de gevalideerde payload opgebouwd — één definitie (stuurinfo-invoer).
 * Bekende DB-weigeringen (race of directe/afwijkende aanroep — de app-laag
 * valideerde al) komen als result-object terug zodat de route ze mét reden en
 * juiste statuscode kan beantwoorden; onbekende fouten blijven een throw
 * (→ generieke 500 via errorResponse).
 */
export async function slaBalansReservesOp(invoer: BalansReservesInvoer): Promise<SaveResultaat> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("stuurinfo_balans_opslaan", {
    p_periode: invoer.periode,
    p_peildatum: invoer.peildatum,
    p_bron: invoer.bron,
    p_invoer_bron: invoer.invoerBron,
    p_activa: invoer.activa,
    p_passiva: invoer.passiva,
    p_reserves: bouwReserveRijen(invoer),
    p_financieringsgraad: invoer.financieringsgraad,
  });
  if (error) {
    const kaart: Record<string, string> = {
      BALANS_SLUIT_NIET: "Balans sluit niet — opslaan geweigerd (DB-controle).",
      GEKOPPELDE_STAND_ONGELIJK: "Gekoppelde reservestanden wijken af van de balans — opslaan geweigerd.",
      ONGELDIGE_ACTIVA: "Ongeldige balansposten (activa) — opslaan geweigerd.",
      ONGELDIGE_PASSIVA: "Ongeldige balansposten (passiva) — opslaan geweigerd.",
      ONGELDIGE_RESERVES: "Ongeldige reserveset — opslaan geweigerd.",
      ONGELDIGE_WAARDE: "Ongeldige waarde in de balansposten — opslaan geweigerd.",
      ONGELDIGE_BRON: "Ongeldige bron — opslaan geweigerd.",
      ONGELDIGE_INVOER_BRON: "Ongeldige invoerbron — opslaan geweigerd.",
    };
    const bekend = Object.keys(kaart).find((k) => error.message.includes(k));
    if (bekend) return { ok: false, status: 422, fout: kaart[bekend] };
    throw new Error(error.message);
  }
  return { ok: true };
}
