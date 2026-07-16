// ============================================================================
//  Stuurinformatie beheer-invoerlaag — SERVER-side schrijvers (T14).
// ----------------------------------------------------------------------------
//  Vier schrijfpaden, alle op de anon-key RLS-client (nooit service-role):
//
//  * schrijfPeriode()      — nieuwe rapportageperiode in de registry (insert;
//                            een bestaande periode geeft een expliciete fout —
//                            peildatum/bron van een bestaande periode worden
//                            via de save-RPC bijgewerkt).
//  * slaBalansReservesOp() — de atomische save via RPC stuurinfo_balans_opslaan
//                            (SECURITY INVOKER; registry + 10 balans-leaves +
//                            8 reserves + FG-KPI in één transactie, RLS geldt).
//  * schrijfSpreiding()    — tab 4 (T15): vijf uitkeringsfase-kpi's in één
//                            batch-upsert (één statement = atomisch; geen RPC
//                            nodig — één tabel, decisions/0076).
//  * slaSolidariteitOp()   — tab 5 (T15): atomische save via RPC
//                            stuurinfo_soli_opslaan (vulling + uitdeling +
//                            bandgrenzen; harde eindstand-consistentie).
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
  type SpreidingInvoer,
  type SolidariteitInvoer,
} from "@/core/lib/stuurinfo-invoer";
import { SPREIDING_KPI_DEFINITIES } from "@/core/lib/stuurinfo-spreiding";

/** Postgres unique_violation (bestaande periode). */
const PG_UNIQUE_VIOLATION = "23505";

/** Postgres foreign_key_violation (periode bestaat niet in de registry). */
const PG_FK_VIOLATION = "23503";

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

// ════════════════════════════════════════════════════════════════════════════
//  Tab 4 (Spreiding) + tab 5 (Solidariteit) — schrijvers (T15, decisions/0076)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Slaat de Spreiding-sectie op: vijf kpi-rijen (uitkeringsfase_*) in ÉÉN
 * batch-upsert — één INSERT … ON CONFLICT-statement is atomisch, dus een RPC
 * voegt hier niets toe (één tabel, geen cross-tabel-consistentie; 0076).
 * RLS (eigen fonds + voorzitter/beheerder, WITH CHECK) en de T14-audittrigger
 * gelden onverkort. Labels/volgorde komen uit SPREIDING_KPI_DEFINITIES (één
 * definitie); de samengestelde FK borgt dat de periode in de registry bestaat.
 */
export async function schrijfSpreiding(
  fondsId: string,
  invoer: SpreidingInvoer
): Promise<SaveResultaat> {
  const supabase = await createServerSupabase();
  const waardeVan: Record<string, number | null> = {
    uitkeringsfase_beschikbaar: invoer.beschikbaar,
    uitkeringsfase_voorziening: invoer.voorziening,
    uitkeringsfase_aanpassingsfactor: invoer.aanpassingsfactor,
    uitkeringsfase_band_onder: invoer.bandOnder,
    uitkeringsfase_band_boven: invoer.bandBoven,
  };
  const rijen = SPREIDING_KPI_DEFINITIES.map((d) => ({
    fonds_id: fondsId,
    periode: invoer.periode,
    kpi_key: d.key,
    label: d.label,
    waarde: waardeVan[d.key],
    eenheid: d.eenheid,
    // delta/toelichting resetten: de leeslaag leidt richting/mutatie zelf af
    // uit beide periodes (T13-besluit) — geen achterblijvende waarden.
    delta: null,
    toelichting: null,
    volgorde: d.volgorde,
    invoer_bron: invoer.invoerBron,
    bijgewerkt: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("fonds_stuurinfo_kpi")
    .upsert(rijen, { onConflict: "fonds_id,periode,kpi_key" });
  if (error) {
    if (error.code === PG_FK_VIOLATION) {
      return {
        ok: false,
        status: 422,
        fout: `Periode ${invoer.periode} bestaat nog niet — maak eerst de rapportageperiode aan.`,
      };
    }
    throw new Error(error.message);
  }
  return { ok: true };
}

/**
 * Slaat de Solidariteit-sectie atomisch op via de RPC stuurinfo_soli_opslaan
 * (T15): 4 vullingsbronnen (reeks) + uitdeling (kpi) + bandgrenzen-update op
 * de soli-reserve-rij in één transactie. fonds_id wordt hier nooit meegegeven:
 * de RPC leidt hem af uit auth.uid(). De DB herhaalt de validaties en dwingt
 * de eindstand-consistentie hard af (SOLI_EINDSTAND_ONGELIJK, decisions/0076).
 */
export async function slaSolidariteitOp(invoer: SolidariteitInvoer): Promise<SaveResultaat> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("stuurinfo_soli_opslaan", {
    p_periode: invoer.periode,
    p_invoer_bron: invoer.invoerBron,
    p_vulling: invoer.vulling,
    p_uitdeling: invoer.uitdeling,
    p_ondergrens: invoer.grenzen.ondergrens,
    p_bovengrens: invoer.grenzen.bovengrens,
  });
  if (error) {
    const kaart: Record<string, string> = {
      SOLI_RESERVE_ONTBREEKT:
        "De solidariteitsreserve van deze periode is nog niet vastgelegd — sla eerst de balans/reserves op.",
      SOLI_EINDSTAND_ONGELIJK:
        "Beginstand + netto vulling − uitdeling wijkt af van de reservestand uit de balans — opslaan geweigerd.",
      ONGELDIGE_VULLING: "Ongeldige vullingsbronnen — opslaan geweigerd.",
      ONGELDIGE_WAARDE: "Ongeldige waarde in de invoer — opslaan geweigerd.",
      ONGELDIGE_GRENZEN: "Ongeldige bandgrenzen — opslaan geweigerd.",
      ONGELDIGE_INVOER_BRON: "Ongeldige invoerbron — opslaan geweigerd.",
    };
    const bekend = Object.keys(kaart).find((k) => error.message.includes(k));
    if (bekend) return { ok: false, status: 422, fout: kaart[bekend] };
    throw new Error(error.message);
  }
  return { ok: true };
}
