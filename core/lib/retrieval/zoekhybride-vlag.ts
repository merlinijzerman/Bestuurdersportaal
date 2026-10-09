// R1b: env is de hoofdstop; alleen een expliciete fondsvlag true schakelt om.
// Beide ontbreken standaard. De bestaande hybride_zoeken-vlag bepaalt nog
// steeds OF hybride retrieval gebruikt wordt; deze vlag kiest alleen de RPC.
export const ZOEK_HYBRIDE_V2_ENV = "ZOEK_HYBRIDE_V2";
export const ZOEK_HYBRIDE_V2_FONDSVLAG = "zoek_hybride_v2";

export function zoekHybrideV2Actief(env: string | undefined, fondsvlag: boolean | undefined): boolean {
  return env === "on" && fondsvlag === true;
}
