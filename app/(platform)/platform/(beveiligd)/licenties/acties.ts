"use server";
// ============================================================================
//  Licenties — schrijfpad voor public.fonds_licentie (P5, besluit 0178 · OP-2)
// ----------------------------------------------------------------------------
//  Platform-beheerde config per fonds (bundel, tarieven, contract-ingangsdatum)
//  voor de weergave "Verbruik & bundel". Schrijven loopt UITSLUITEND via
//  withPlatform: service-role achter capability `platform.config.manage` + de
//  twee-fasen-audit (attempt→result). Zelfde patroon als organisatieprofiel.
//
//  fonds_licentie is deny-by-default (RLS aan, geen policy); alleen de
//  service-role die withPlatform injecteert kan hier schrijven. `fonds_id` komt
//  uit de doel-selectie van de beheerder, niet uit een tenant-sessie.
//
//  Validatie wordt TERUGGEGEVEN (ok:false), niet gegooid — net als bij
//  organisatieprofiel, zodat het formulier veldfouten kan tonen.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";
import type { PlatformIdentiteit } from "@/platform/lib/platform-auth";
import { parseLicentieGetal } from "@/platform/lib/licentie-invoer";

const CAP = "platform.config.manage" as const;
const PAD = "/platform/licenties";

export type OpslaanResultaat =
  | { ok: true; bericht: string }
  | { ok: false; foutcode: string; melding: string; veldfouten?: Record<string, string> };

function parseDatum(fd: FormData, key: string): string | null {
  const ruw = (fd.get(key) ?? "").toString().trim();
  if (ruw === "") return null;
  // <input type="date"> levert altijd YYYY-MM-DD; controleer defensief.
  return /^\d{4}-\d{2}-\d{2}$/.test(ruw) && !Number.isNaN(new Date(ruw + "T00:00:00Z").getTime())
    ? ruw
    : "ONGELDIG";
}

export async function licentieOpslaan(fondsId: string, fd: FormData): Promise<OpslaanResultaat> {
  if (!fondsId) {
    return { ok: false, foutcode: "geen_fonds", melding: "Kies eerst een fonds." };
  }

  const bundel = parseLicentieGetal(fd.get("bundel_eur_jaar"));
  const tariefIn = parseLicentieGetal(fd.get("tarief_in_eur_mln"));
  const tariefUit = parseLicentieGetal(fd.get("tarief_uit_eur_mln"));
  const contractStart = parseDatum(fd, "contract_start");
  let geldigVanaf = parseDatum(fd, "geldig_vanaf");

  const veldfouten: Record<string, string> = {};
  const eisPositief = (v: number | null, key: string, naam: string) => {
    if (v === null) veldfouten[key] = `${naam} is verplicht.`;
    else if (Number.isNaN(v)) veldfouten[key] = `${naam} is geen geldig getal.`;
    else if (v < 0) veldfouten[key] = `${naam} mag niet negatief zijn.`;
  };
  eisPositief(bundel, "bundel_eur_jaar", "Jaarbundel");
  eisPositief(tariefIn, "tarief_in_eur_mln", "Input-tarief");
  eisPositief(tariefUit, "tarief_uit_eur_mln", "Output-tarief");
  if (contractStart === null) veldfouten.contract_start = "Contract-ingangsdatum is verplicht.";
  else if (contractStart === "ONGELDIG") veldfouten.contract_start = "Ongeldige datum.";
  if (geldigVanaf === "ONGELDIG") veldfouten.geldig_vanaf = "Ongeldige datum.";

  if (Object.keys(veldfouten).length > 0) {
    return { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten };
  }

  // Geldig-vanaf standaard op 1 januari van het contractjaar als leeg gelaten.
  if (geldigVanaf === null) geldigVanaf = `${contractStart!.slice(0, 4)}-01-01`;

  try {
    return await withPlatform<OpslaanResultaat>(
      {
        capability: CAP,
        handeling: "fondslicentie.opslaan",
        doelFondsId: fondsId,
        doelObject: `fonds_licentie:${fondsId}`,
      },
      async (svc: SupabaseClient, { identiteit }) => {
        const resultaat = await upsert(svc, fondsId, {
          bundel: bundel!,
          tariefIn: tariefIn!,
          tariefUit: tariefUit!,
          contractStart: contractStart!,
          geldigVanaf: geldigVanaf!,
        }, identiteit);
        revalidatePath(PAD);
        // Effect = alleen fonds + versie (aantal/type), geen bedragen in het spoor.
        return { resultaat: resultaat.res, effect: { fonds_id: fondsId, versie: resultaat.versie } };
      }
    );
  } catch (e) {
    return naarFout(e);
  }
}

async function upsert(
  svc: SupabaseClient,
  fondsId: string,
  w: { bundel: number; tariefIn: number; tariefUit: number; contractStart: string; geldigVanaf: string },
  identiteit: PlatformIdentiteit
): Promise<{ res: OpslaanResultaat; versie: number }> {
  // Versie ophogen: lees de huidige, schrijf +1. Config-tabel, één beheerder →
  // geen concurrency-race die dit hard hoeft af te dwingen.
  const { data: bestaand } = await svc
    .from("fonds_licentie")
    .select("versie")
    .eq("fonds_id", fondsId)
    .maybeSingle();
  const versie = ((bestaand?.versie as number | undefined) ?? 0) + 1;

  const { error } = await svc.from("fonds_licentie").upsert(
    {
      fonds_id: fondsId,
      bundel_eur_jaar: w.bundel,
      tarief_in_eur_mln: w.tariefIn,
      tarief_uit_eur_mln: w.tariefUit,
      contract_start: w.contractStart,
      geldig_vanaf: w.geldigVanaf,
      versie,
      // bijgewerkt heeft alleen een INSERT-default; bij UPDATE expliciet zetten.
      bijgewerkt: new Date().toISOString(),
      bijgewerkt_door: identiteit.id,
    },
    { onConflict: "fonds_id" }
  );
  if (error) {
    return { res: { ok: false, foutcode: "db_fout", melding: `Opslaan mislukt: ${error.message}` }, versie };
  }
  return { res: { ok: true, bericht: "Licentie opgeslagen." }, versie };
}

function naarFout(e: unknown): OpslaanResultaat {
  if (e instanceof PlatformError) {
    const melding =
      e.foutcode === "mfa_required"
        ? "Log opnieuw in met tweefactorauthenticatie."
        : e.foutcode === "capability_denied"
        ? "Je hebt geen recht om licenties te beheren (platform.config.manage)."
        : `De actie kon niet worden voltooid (${e.foutcode}).`;
    return { ok: false, foutcode: e.foutcode, melding };
  }
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis bij het opslaan." };
}
