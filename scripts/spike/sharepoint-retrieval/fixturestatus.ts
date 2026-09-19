// ============================================================================
//  #407 F-3b — spike-eigen statusregister voor de semantische fixtures.
// ----------------------------------------------------------------------------
//  De serververtrouwde fixturestatus komt normaal uit
//  `core/lib/microsoft-sharepoint-retrieval-smoke-core.ts`. Die module voedt de
//  Preview-brug en is dus live-retrievalproductiecode; #407 laat haar bewust
//  ongemoeid. De twee semantische fixtures van deze tranche krijgen daarom hier
//  hun status, buiten elk productiepad.
//
//  Harde grenzen, geborgd door `fixturestatus.test.ts`:
//  - uitsluitend PGB407-DOC-101 en PGB407-DOC-102 worden hier vertrouwd;
//  - elke andere code valt terug op de bestaande core-lookup;
//  - een code die geen van beide kent, levert `null` — nooit een gok;
//  - de status komt NOOIT uit het manifest, uit browserinvoer, uit een
//    bestandsnaam of uit een configbestand. Het is een gesloten, statische map.
// ============================================================================
import { sharePointRetrievalFixtureStatus } from "../../../core/lib/microsoft-sharepoint-retrieval-smoke-core";
import type { SpikeFixtureStatus } from "./types";

/**
 * De enige twee codes die deze spike bovenop de core vertrouwt. Beide horen bij
 * de semantische scenario's SEM01 en SEM02 en staan als actuele stukken in de
 * algemene PGB-map.
 */
export const SPIKE_EXTRA_FIXTURE_CODES = ["PGB407-DOC-101", "PGB407-DOC-102"] as const;
export type SpikeExtraFixtureCode = typeof SPIKE_EXTRA_FIXTURE_CODES[number];

const SPIKE_EXTRA_FIXTURE_STATUS = {
  "PGB407-DOC-101": "actueel",
  "PGB407-DOC-102": "actueel",
} as const satisfies Record<SpikeExtraFixtureCode, SpikeFixtureStatus>;

/**
 * Serververtrouwde status op exacte fixturecode. Eerst de gesloten spikemap,
 * daarna de bestaande core-lookup. Geen enkele andere bron mag hier invloed op
 * hebben.
 */
export function spikeFixtureStatus(fixtureCode: string): SpikeFixtureStatus | null {
  if (Object.prototype.hasOwnProperty.call(SPIKE_EXTRA_FIXTURE_STATUS, fixtureCode)) {
    return SPIKE_EXTRA_FIXTURE_STATUS[fixtureCode as SpikeExtraFixtureCode];
  }
  return sharePointRetrievalFixtureStatus(fixtureCode);
}
