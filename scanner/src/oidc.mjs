// ============================================================================
//  scanner/src/oidc.mjs — verificatie van het Vercel OIDC-token.
// ----------------------------------------------------------------------------
//  Dit is de enige authenticatie van /scan. Er is bewust géén gedeeld secret:
//  het scannerproject mag geen langlevende credentials bevatten, want het
//  verwerkt doelbewust onbetrouwbare bestanden. De verificatiesleutels zijn
//  publiek (JWKS), dus er valt hier niets te stelen.
//
//  Vier pinnen, alle vier verplicht:
//    - issuer   : de teameigen OIDC-issuer
//    - audience : de scanner-audience (aangevraagd door de beheerworker)
//    - subject  : owner:<team>:project:<beheer>:environment:production
//    - owner_id + project_id : de ONVERANDERLIJKE identiteiten. Projectnamen
//      kunnen worden gewijzigd; een hernoemd of nagebootst project mag deze
//      poort niet stilzwijgend openen. Daarom naast `subject` ook de ID's.
// ============================================================================

import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * @typedef {{
 *   issuer: string,
 *   audience: string,
 *   subject: string,
 *   ownerId: string,
 *   projectId: string,
 * }} OidcConfig
 */

/**
 * Bouwt een verifier met een gedeelde, cachende JWKS-set. `createRemoteJWKSet`
 * cachet de sleutels en haalt ze alleen opnieuw op bij een onbekende `kid`, dus
 * dit legt geen netwerkbeurt op het scanpad.
 *
 * @param {OidcConfig} config
 */
export function maakOidcVerifier(config) {
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks`));

  /**
   * @param {string | null | undefined} authorizationHeader
   * @returns {Promise<{ ok: true } | { ok: false, code: string }>}
   */
  return async function verifieer(authorizationHeader) {
    if (!authorizationHeader) return { ok: false, code: "token_ontbreekt" };
    const m = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
    if (!m) return { ok: false, code: "token_vorm_ongeldig" };

    let payload;
    try {
      ({ payload } = await jwtVerify(m[1], jwks, {
        issuer: config.issuer,
        audience: config.audience,
        subject: config.subject,
        // Krappe speling op klokverschil. De concrete levensduur komt uit de
        // ondertekende `exp`-claim en wordt door `jwtVerify` afgedwongen; de
        // scanner codeert geen platform-TTL als eigen aanname in.
        clockTolerance: 30,
      }));
    } catch {
      // Geen detail teruggeven: het onderscheid tussen "verlopen", "verkeerde
      // audience" en "verkeerde handtekening" is voor een aanvaller nuttiger
      // dan voor ons. Het auditspoor krijgt één code.
      return { ok: false, code: "token_ongeldig" };
    }

    // De onveranderlijke claims. `subject` is hierboven al gepind, maar die
    // bevat de projectNAAM — deze twee zijn de identiteiten die niet wijzigen.
    if (payload.owner_id !== config.ownerId) {
      return { ok: false, code: "owner_id_onjuist" };
    }
    if (payload.project_id !== config.projectId) {
      return { ok: false, code: "project_id_onjuist" };
    }

    return { ok: true };
  };
}
