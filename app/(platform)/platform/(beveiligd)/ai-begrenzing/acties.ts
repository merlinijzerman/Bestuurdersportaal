"use server";
// ============================================================================
//  AI-begrenzing — beheeracties (besluit 0180)
// ----------------------------------------------------------------------------
//  Zeven mutaties, elk via withPlatform: service-role achter een capability +
//  live AAL2 + de twee-fasen-audit (attempt→result). Binnen die wrapper roept
//  elke actie PRECIES ÉÉN transactionele RPC aan — losse Supabase-aanroepen
//  zouden elk een eigen transactie zijn en samen geen atomaire handeling vormen.
//
//  BEVOEGDHEDEN (werkopdracht §2.3)
//    platform.security.operate → stoppen, aanvragen, goedkeuren, afwijzen, intrekken
//    platform.config.manage    → quota en modelallowlist
//
//  WAT DE DATABASE AFDWINGT EN DEZE LAAG DUS NIET HOEFT
//  Het vier-ogenprincipe zit in de datalaag: `chk_ahb_geen_self_approval` +
//  een composite-FK die de gedenormaliseerde aanvrager aan het verzoek bindt.
//  Zelfgoedkeuring is daardoor ook onmogelijk buiten deze code om. Idem de
//  compare-and-swap op `ai_config_versie`: is er sinds de aanvraag iets aan de
//  AI-configuratie gewijzigd, dan weigert de RPC de goedkeuring.
//
//  Validatie wordt TERUGGEGEVEN (ok:false), niet gegooid — zodat het formulier
//  veldfouten kan tonen. Zelfde patroon als licenties/acties.ts.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";
import type { PlatformIdentiteit } from "@/platform/lib/platform-auth";
import {
  isQuotumSleutel,
  isSchakelaar,
  valideerAllowlist,
  valideerQuotum,
  valideerReden,
} from "@/platform/lib/ai-begrenzing-invoer";

const CAP_SECURITY = "platform.security.operate" as const;
const CAP_CONFIG = "platform.config.manage" as const;
const PAD = "/platform/ai-begrenzing";

export type ActieResultaat =
  | { ok: true; bericht: string }
  | { ok: false; foutcode: string; melding: string };

function leesSleutel(fd: FormData): string {
  return (fd.get("sleutel") ?? "").toString().trim();
}
function leesReden(fd: FormData): string {
  return (fd.get("reden") ?? "").toString().trim();
}



// ── Stoppen ─────────────────────────────────────────────────────────────────

export async function switchStoppen(fd: FormData): Promise<ActieResultaat> {
  const sleutel = leesSleutel(fd);
  const reden = leesReden(fd);
  if (!isSchakelaar(sleutel)) {
    return { ok: false, foutcode: "onbekende_schakelaar", melding: "Onbekende schakelaar." };
  }
  const gevalideerdeReden = valideerReden(reden, "de stop");
  if (!gevalideerdeReden.ok) {
    return { ok: false, foutcode: "validatie", melding: gevalideerdeReden.melding };
  }
  return voerUit(CAP_SECURITY, "ai.switch.stoppen", sleutel, reden, async (svc, identiteit) => {
    const { error } = await svc.rpc("fn_ai_switch_stoppen", {
      p_sleutel: sleutel,
      p_actor: identiteit.id,
      p_reden: reden,
    });
    if (error) throw new Error(error.message);
    return "De schakelaar staat uit. Nieuwe AI-aanroepen worden geweigerd.";
  });
}

// ── Heractivering: aanvragen, goedkeuren, afwijzen, intrekken ───────────────

export async function heractiveringAanvragen(fd: FormData): Promise<ActieResultaat> {
  const sleutel = leesSleutel(fd);
  const reden = leesReden(fd);
  if (!isSchakelaar(sleutel)) {
    return { ok: false, foutcode: "onbekende_schakelaar", melding: "Onbekende schakelaar." };
  }
  const gevalideerdeReden = valideerReden(reden, "het heractiveringsverzoek");
  if (!gevalideerdeReden.ok) {
    return { ok: false, foutcode: "validatie", melding: gevalideerdeReden.melding };
  }
  return voerUit(
    CAP_SECURITY,
    "ai.heractivering.aanvragen",
    sleutel,
    reden,
    async (svc, identiteit) => {
      const { error } = await svc.rpc("fn_ai_heractivering_aanvragen", {
        p_sleutel: sleutel,
        p_actor: identiteit.id,
        p_reden: reden,
      });
      if (error) throw new Error(error.message);
      return "Verzoek ingediend. De schakelaar blijft uit tot een ándere beheerder goedkeurt.";
    }
  );
}

export async function heractiveringGoedkeuren(fd: FormData): Promise<ActieResultaat> {
  const sleutel = leesSleutel(fd);
  const reden = leesReden(fd);
  if (!isSchakelaar(sleutel)) {
    return { ok: false, foutcode: "onbekende_schakelaar", melding: "Onbekende schakelaar." };
  }
  return voerUit(
    CAP_SECURITY,
    "ai.heractivering.goedkeuren",
    sleutel,
    reden || null,
    async (svc, identiteit) => {
      const { error } = await svc.rpc("fn_ai_heractivering_goedkeuren", {
        p_sleutel: sleutel,
        p_actor: identiteit.id,
        p_reden: reden || null,
      });
      if (error) throw new Error(error.message);
      return "Goedgekeurd. De schakelaar staat weer aan.";
    }
  );
}

export async function heractiveringAfwijzen(fd: FormData): Promise<ActieResultaat> {
  const sleutel = leesSleutel(fd);
  const reden = leesReden(fd);
  if (!isSchakelaar(sleutel)) {
    return { ok: false, foutcode: "onbekende_schakelaar", melding: "Onbekende schakelaar." };
  }
  return voerUit(
    CAP_SECURITY,
    "ai.heractivering.afwijzen",
    sleutel,
    reden || null,
    async (svc, identiteit) => {
      const { error } = await svc.rpc("fn_ai_heractivering_afwijzen", {
        p_sleutel: sleutel,
        p_actor: identiteit.id,
        p_reden: reden || null,
      });
      if (error) throw new Error(error.message);
      return "Afgewezen. De schakelaar blijft uit.";
    }
  );
}

export async function heractiveringIntrekken(fd: FormData): Promise<ActieResultaat> {
  const sleutel = leesSleutel(fd);
  if (!isSchakelaar(sleutel)) {
    return { ok: false, foutcode: "onbekende_schakelaar", melding: "Onbekende schakelaar." };
  }
  return voerUit(
    CAP_SECURITY,
    "ai.heractivering.intrekken",
    sleutel,
    null,
    async (svc, identiteit) => {
      const { error } = await svc.rpc("fn_ai_heractivering_intrekken", {
        p_sleutel: sleutel,
        p_actor: identiteit.id,
      });
      if (error) throw new Error(error.message);
      return "Uw verzoek is ingetrokken. De schakelaar blijft uit.";
    }
  );
}

// ── Configuratie: quota en modelallowlist ───────────────────────────────────

export async function quotumWijzigen(fd: FormData): Promise<ActieResultaat> {
  const sleutel = (fd.get("quotum_sleutel") ?? "").toString().trim();
  if (!isQuotumSleutel(sleutel)) {
    return { ok: false, foutcode: "onbekende_sleutel", melding: "Onbekend quotum." };
  }
  const gevalideerd = valideerQuotum(fd.get("waarde"));
  if (!gevalideerd.ok) {
    return { ok: false, foutcode: "validatie", melding: gevalideerd.melding };
  }
  const waarde = gevalideerd.waarde;

  return voerUit(CAP_CONFIG, "ai.quota.wijzigen", sleutel, null, async (svc, identiteit) => {
    const { error } = await svc.rpc("fn_ai_quota_wijzigen", {
      p_sleutel: sleutel,
      p_waarde: waarde,
      p_actor: identiteit.id,
    });
    if (error) throw new Error(error.message);
    return "Quotum bijgewerkt. Een openstaand heractiveringsverzoek is hierdoor vervallen.";
  });
}

export async function allowlistWijzigen(fd: FormData): Promise<ActieResultaat> {
  // Vriendelijke voorcheck; de RPC en de CHECK-constraints zijn de echte poort.
  // De regels zelf staan in platform/lib/ai-begrenzing-invoer.ts en zijn daar
  // programmatisch nagerekend.
  const gevalideerd = valideerAllowlist({
    provider: fd.get("provider"),
    model: fd.get("model"),
    actief: (fd.get("actief") ?? "").toString() === "aan",
    vensterStart: fd.get("venster_start"),
    vensterEind: fd.get("venster_eind"),
    reden: fd.get("reden"),
  });
  if (!gevalideerd.ok) {
    return { ok: false, foutcode: "validatie", melding: gevalideerd.melding };
  }
  const { provider, model, actief, vensterStart, vensterEind, reden } = gevalideerd.waarde;

  return voerUit(
    CAP_CONFIG,
    "ai.allowlist.wijzigen",
    `${provider}:${model}`,
    reden,
    async (svc, identiteit) => {
      const { error } = await svc.rpc("fn_ai_allowlist_wijzigen", {
        p_provider: provider,
        p_model: model,
        p_actief: actief,
        p_venster_start: vensterStart ? new Date(vensterStart).toISOString() : null,
        p_venster_eind: vensterEind ? new Date(vensterEind).toISOString() : null,
        p_reden: reden,
        p_actor: identiteit.id,
      });
      if (error) throw new Error(error.message);
      return "Modelallowlist bijgewerkt.";
    }
  );
}

// ── Gedeelde uitvoering ─────────────────────────────────────────────────────

async function voerUit(
  capability: typeof CAP_SECURITY | typeof CAP_CONFIG,
  handeling: string,
  doelObject: string,
  reden: string | null,
  fn: (svc: SupabaseClient, identiteit: PlatformIdentiteit) => Promise<string>
): Promise<ActieResultaat> {
  try {
    return await withPlatform<ActieResultaat>(
      {
        capability,
        handeling,
        doelObject: `ai_begrenzing:${doelObject}`,
        reden,
      },
      async (svc, { identiteit }) => {
        const bericht = await fn(svc, identiteit);
        revalidatePath(PAD);
        // Effect = uitsluitend het object en de actor; nooit tellerstanden of
        // configuratiewaarden in het auditspoor.
        return {
          resultaat: { ok: true, bericht } as ActieResultaat,
          effect: { object: doelObject, actor: identiteit.id },
        };
      }
    );
  } catch (e) {
    return naarFout(e);
  }
}

function naarFout(e: unknown): ActieResultaat {
  if (e instanceof PlatformError) {
    const melding =
      e.foutcode === "mfa_required"
        ? "Log opnieuw in met tweefactorauthenticatie."
        : e.foutcode === "capability_denied"
          ? "U heeft niet het recht om deze handeling uit te voeren."
          : `De handeling kon niet worden voltooid (${e.foutcode}).`;
    return { ok: false, foutcode: e.foutcode, melding };
  }

  // De RPC's geven leesbare, gesaniteerde fouten terug; die zijn bruikbaar voor
  // de beheerder. De twee belangrijkste vertalen we naar gewone taal, omdat ze
  // beleidsuitkomsten zijn en geen storing.
  const ruw = e instanceof Error ? e.message : String(e);
  if (/chk_ahb_geen_self_approval/.test(ruw)) {
    return {
      ok: false,
      foutcode: "vier_ogen_vereist",
      melding:
        "U kunt uw eigen heractiveringsverzoek niet goedkeuren. Een tweede bevoegde beheerder moet dat doen.",
    };
  }
  if (/configuratie is gewijzigd sinds de aanvraag/.test(ruw)) {
    return {
      ok: false,
      foutcode: "configuratie_gewijzigd",
      melding:
        "De AI-configuratie is gewijzigd sinds dit verzoek werd ingediend. Het verzoek is daarmee vervallen; dien een nieuw verzoek in.",
    };
  }
  if (/alleen de aanvrager/.test(ruw)) {
    return {
      ok: false,
      foutcode: "geen_aanvrager",
      melding: "Alleen de aanvrager kan het eigen verzoek intrekken. Wijs het anders af.",
    };
  }
  console.error("[ai-begrenzing] onverwachte fout:", ruw);
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis bij deze handeling." };
}
