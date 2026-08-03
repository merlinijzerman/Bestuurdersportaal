// ============================================================================
//  platform-fout-log.ts — schrijfpad naar app_errors vanaf de BEHEER-surface
// ----------------------------------------------------------------------------
//  Tegenhanger van core/lib/app-fout-schrijf.ts. Het verschil is uitsluitend de
//  client: het beheer-project heeft de service-role en kan dus rechtstreeks
//  inserten; de RPC (die op auth.uid() leunt) is hier niet nodig en zou ook niets
//  opleveren — een cron-run heeft geen sessie.
//
//  De RECORDVORM en de SANITATIE komen uit dezelfde pure module
//  (core/lib/app-fout.ts) als het tenant-pad. Eén implementatie, twee
//  schrijfpaden: anders drift de sanitatie uit elkaar en dekt de negatieve
//  controle nog maar de helft.
//
//  fonds_id blijft hier null tenzij de aanroeper er expliciet één meegeeft. Een
//  platformhandeling is per definitie fondsoverstijgend; waar een beheeractie
//  wél op één fonds slaat (bv. een pipeline-actie op een fondsdocument) mag de
//  aanroeper dat doorgeven. Dit is géén tenant-invoer maar server-side bekend,
//  dus er is niets te vervalsen.
//
//  Net als het tenant-pad: nooit blokkerend, nooit werpend, nooit recursief.
// ============================================================================

import "server-only";
import { bouwAppFout, type AppFoutInvoer } from "@/core/lib/app-fout";
import { createServiceSupabase } from "@/platform/lib/supabase-service";

export type PlatformFoutInvoer = AppFoutInvoer & {
  /** Alleen invullen als de fout aantoonbaar op één fonds slaat. Default: null (platformbreed). */
  fondsId?: string | null;
};

/**
 * Schrijft een foutregel vanaf de beheer-surface of een cron-route.
 *
 * Geeft een promise terug zodat een cron-route hem desgewenst kan awaiten
 * (daar is geen gebruiker die op een response wacht). De promise verwerpt nooit;
 * awaiten is dus veilig, en niet-awaiten ook.
 */
export async function logPlatformFout(invoer: PlatformFoutInvoer): Promise<void> {
  try {
    const record = bouwAppFout(invoer);
    const svc = createServiceSupabase();

    const { error } = await svc.from("app_errors").insert({
      fonds_id: invoer.fondsId ?? null,
      label: record.label,
      categorie: record.categorie,
      severity: record.severity,
      http_status: record.httpStatus,
      fouttype: record.fouttype,
      foutcode: record.foutcode,
      melding_kort: record.meldingKort,
      context_sleutels: record.contextSleutels,
      correlatie_id: record.correlatieId,
      // Herkomst expliciet: dit pad schrijft server-side. Rijen met bron='rpc'
      // zijn door een ingelogde gebruiker aangeleverd en dus beïnvloedbaar; dat
      // onderscheid moet een operator kunnen maken.
      bron: "service",
    });

    if (error) {
      // Eén regel, geen error-object: die kan zelf schemadetail dragen.
      console.warn(
        `[app-errors] wegschrijven mislukt voor "${record.label}" (${error.code ?? "geen code"})`
      );
    }
  } catch {
    console.warn("[app-errors] wegschrijven mislukt (beheer-surface)");
  }
}
