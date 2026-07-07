"use server";

// ============================================================================
//  Server-action — organisatieprofiel-beheer (OP-5, FO Organisatieprofiel v0.4
//  §2/§5). Eén handeling achter withPlatform (capability + twee-fasen-audit):
//    • organisatieprofielOpslaan — upsert (1-op-1 op fonds_id). Schrijft via de
//      service-role; zet bijgewerkt_door op de platform-identiteit, de trigger
//      zet bijgewerkt_op. Validatie wordt als ok:false TERUGGEGEVEN, niet geworpen.
//
//  withPlatform gooit PlatformError (403/503) bij weigering/audit-uitval; die
//  wordt in de try/catch tot een nette ok:false-melding herleid (huispatroon,
//  zie standaardcatalogus/acties.ts).
// ============================================================================

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/lib/platform-wrapper";
import type { PlatformIdentiteit } from "@/lib/platform-auth";

const PAD = "/platform/organisatieprofiel";
const CAP = "platform.config.manage" as const; // zie besluit B-OP5-1
const MAX_STRATEGISCH = 600;

const STRATEGISCHE_VELDEN = [
  "missie",
  "visie",
  "strategische_speerpunten",
  "risicohouding",
] as const;

const FEIT_VELDEN = [
  "organisatietype",
  "uitvoerende_partijen",
  "omvang",
  "kernfeiten",
] as const;

export type OpslaanResultaat =
  | { ok: true; bericht: string }
  | { ok: false; foutcode: string; melding: string; veldfouten?: Record<string, string> };

function normaliseer(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

// Herleidt een geworpen PlatformError (of onverwachte fout) tot een nette melding.
function platformMelding(foutcode: string): string {
  switch (foutcode) {
    case "no_session_or_inactive":
      return "Geen geldige platform-sessie. Log opnieuw in.";
    case "mfa_required":
      return "Sterke authenticatie (MFA) vereist voor deze handeling.";
    case "capability_denied":
      return "Je mist de rechten om organisatieprofielen te beheren (platform.config.manage).";
    case "audit_unavailable":
      return "Auditlog tijdelijk niet beschikbaar — handeling geblokkeerd (fail-closed).";
    default:
      return "Handeling geweigerd.";
  }
}

function naarFout(e: unknown): OpslaanResultaat {
  if (e instanceof PlatformError) {
    return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
  }
  console.error("[OP-5] onverwachte fout bij organisatieprofiel opslaan:", e);
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
}

export async function organisatieprofielOpslaan(
  fondsId: string,
  fd: FormData
): Promise<OpslaanResultaat> {
  if (!fondsId) {
    return { ok: false, foutcode: "geen_fonds", melding: "Kies eerst een organisatie." };
  }

  const waarden: Record<string, string | null> = {};
  for (const k of [...FEIT_VELDEN, ...STRATEGISCHE_VELDEN]) waarden[k] = normaliseer(fd, k);
  const peildatum = normaliseer(fd, "peildatum"); // 'YYYY-MM-DD' of null

  const veldfouten: Record<string, string> = {};
  for (const k of STRATEGISCHE_VELDEN) {
    const val = waarden[k];
    if (val && val.length > MAX_STRATEGISCH) {
      veldfouten[k] = `Maximaal ${MAX_STRATEGISCH} tekens (nu ${val.length}).`;
    }
  }
  if (Object.keys(veldfouten).length > 0) {
    return { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten };
  }

  const ingevuld =
    [...FEIT_VELDEN, ...STRATEGISCHE_VELDEN].filter((k) => waarden[k] !== null).length +
    (peildatum ? 1 : 0);

  try {
    return await withPlatform<OpslaanResultaat>(
      {
        capability: CAP,
        handeling: "organisatieprofiel.opslaan",
        doelFondsId: fondsId,
        doelObject: `organisatie_profielen:${fondsId}`,
      },
      async (svc: SupabaseClient, { identiteit }) => {
        const resultaat = await upsert(svc, fondsId, waarden, peildatum, identiteit);
        revalidatePath(PAD);
        return { resultaat, effect: { fonds_id: fondsId, velden_ingevuld: ingevuld } };
      }
    );
  } catch (e) {
    return naarFout(e);
  }
}

async function upsert(
  svc: SupabaseClient,
  fondsId: string,
  waarden: Record<string, string | null>,
  peildatum: string | null,
  identiteit: PlatformIdentiteit
): Promise<OpslaanResultaat> {
  const { error } = await svc.from("organisatie_profielen").upsert(
    {
      fonds_id: fondsId,
      ...waarden,
      peildatum,
      bijgewerkt_door: `${identiteit.naam} <${identiteit.email}>`,
      // bijgewerkt_op: trigger bij UPDATE; default now() bij INSERT.
    },
    { onConflict: "fonds_id" }
  );
  if (error) {
    return { ok: false, foutcode: "db_fout", melding: `Opslaan mislukt: ${error.message}` };
  }
  return { ok: true, bericht: "Organisatieprofiel opgeslagen." };
}
