// ============================================================================
// OMG-1 — harde doelomgevingsgrendel voor de karakteriseringsseed.
// ----------------------------------------------------------------------------
// De seed gebruikt een service-role en wist eigen fixtures. Daarom is een URL
// alleen nooit voldoende bewijs: de projectref moet op de expliciete allowlist
// staan én de uitvoerder moet de bedoelde omgeving expliciet bevestigen.
// ============================================================================

// Dit is de afzonderlijke Preview-Supabase uit besluit 0177. `local` is niet
// een code-uitzondering: de CLI-stack staat als concrete allowlist-invoer hier.
export const SEED_DOELOMGEVINGEN = Object.freeze({
  preview: Object.freeze(["swviwoytzvaqypieqgji"]),
  local: Object.freeze(["127.0.0.1:54321", "localhost:54321"]),
});

function doelFout(reden) {
  return new Error(`SEED GEBLOKKEERD: ${reden}`);
}

export function projectrefUitSupabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw doelFout("NEXT_PUBLIC_SUPABASE_URL ontbreekt of is geen geldige URL.");
  }

  const host = parsed.host.toLowerCase();
  const suffix = ".supabase.co";
  if (parsed.protocol === "https:" && parsed.hostname.endsWith(suffix)) {
    const projectRef = parsed.hostname.slice(0, -suffix.length);
    if (/^[a-z0-9]+$/.test(projectRef)) return projectRef;
  }
  if (parsed.protocol === "http:" && ["127.0.0.1:54321", "localhost:54321"].includes(host)) {
    return host;
  }
  throw doelFout(`URL verwijst niet naar een herkenbare Supabase-doelomgeving (${parsed.host}).`);
}

/**
 * Faalt gesloten vóór er een client of query bestaat. Houd deze aanroep vóór
 * elke databasehandeling; ook callers die zelf een adminclient doorgeven gaan
 * via `seed()` langs deze grendel.
 */
export function bevestigVeiligeSeedDoelomgeving({
  url,
  doelomgeving = process.env.SEED_DOELOMGEVING,
  allowlist = SEED_DOELOMGEVINGEN,
} = {}) {
  if (!allowlist || Object.keys(allowlist).length === 0) {
    throw doelFout("de projectref-allowlist ontbreekt; fail-closed.");
  }
  if (!doelomgeving || !Object.hasOwn(allowlist, doelomgeving)) {
    throw doelFout("zet SEED_DOELOMGEVING expliciet op 'preview' of 'local'.");
  }

  const projectRef = projectrefUitSupabaseUrl(url);
  const toegestaneRefs = allowlist[doelomgeving];
  if (!Array.isArray(toegestaneRefs) || toegestaneRefs.length === 0) {
    throw doelFout(`de allowlist voor '${doelomgeving}' ontbreekt; fail-closed.`);
  }
  if (!toegestaneRefs.includes(projectRef)) {
    throw doelFout(
      `gevonden projectref '${projectRef}' staat niet op de allowlist voor '${doelomgeving}'.`
    );
  }

  return { doelomgeving, projectRef };
}
