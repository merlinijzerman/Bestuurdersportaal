// ============================================================================
//  Veilige redirect-doelen — PUUR, geen I/O, geen `server-only`.
// ----------------------------------------------------------------------------
//  Reviewbevinding H-03 (2026-07-30): /auth/callback plakte een door de client
//  aangeleverde `next`-parameter rechtstreeks achter `origin`. Omdat
//  `URL.origin` géén afsluitende slash heeft, herschrijft een `next` die niet
//  met "/" begint de AUTHORITY van de URL:
//
//    origin = "https://portaal.fonds.nl"
//      next="@evil.com/x"   → https://portaal.fonds.nl@evil.com/x   host = evil.com
//      next=".evil.com"     → https://portaal.fonds.nl.evil.com     host = …evil.com
//      next="//evil.com"    → https://portaal.fonds.nl//evil.com    host = portaal (veilig)
//
//  De eerste twee zijn open redirects die zichtbaar met het eigen fondsdomein
//  beginnen — precies wat een phishinglink geloofwaardig maakt. Er lekt geen
//  sessietoken (de code-exchange gebeurt server-side en de cookie wordt op de
//  eigen origin gezet), maar de misleiding is het risico.
//
//  ONTWERP: allowlist in plaats van blocklist. Alleen een relatief pad binnen
//  de eigen origin is toegestaan; al het overige valt fail-safe terug op "/".
//  Bewust géén `new URL(...)`-normalisatie: dat maakt het gedrag afhankelijk
//  van parser-details, terwijl een simpele vormcheck hier volstaat en
//  aantoonbaar te testen is (redirect-veilig.sanity.ts).
// ============================================================================

/**
 * Geeft een veilig vervolgpad terug voor een redirect binnen de eigen origin.
 *
 * Toegestaan: een pad dat met precies één "/" begint (bv. `/procedures/123?tab=a`).
 * Geweigerd (→ "/"):
 *   - `null`/leeg;
 *   - alles wat niet met "/" begint (`@evil.com`, `.evil.com`, `https://evil.com`,
 *     `javascript:...`);
 *   - protocol-relatieve varianten `//evil.com` en `/\evil.com` — browsers lezen
 *     de backslash als slash, dus die telt als tweede slash;
 *   - paden met een CR/LF (headerinjectie via de Location-header).
 */
export function veiligVervolgpad(ruw: string | null | undefined): string {
  if (!ruw) return "/";
  if (/[\r\n]/.test(ruw)) return "/";
  if (!ruw.startsWith("/")) return "/";
  if (ruw.startsWith("//") || ruw.startsWith("/\\")) return "/";
  return ruw;
}
