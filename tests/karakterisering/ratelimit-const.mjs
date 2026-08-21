// W1 — rate-limit-constanten (spiegel van core/lib/rate-limit.ts, LIMIETEN).
// Los bestand zodat scenarios.mjs geen TS hoeft te importeren.
//
// LET OP: dit is een KOPIE. Wijzigt een limiet in rate-limit.ts en niet hier,
// dan vult de preseed de teller tot een te lage waarde en slaat het scenario om
// van 429 naar het happy path — een groen snapshot dat de verkeerde tak toetst.
export const LIMIET_ZOEKEN_ENDPOINT = "zoeken";
export const LIMIET_ZOEKEN = 60;

// W5 — de twee SSE-routes.
export const LIMIET_CHAT_ENDPOINT = "chat";
export const LIMIET_CHAT = 20;
export const LIMIET_VOORBEREIDING_ENDPOINT = "voorbereiding";
export const LIMIET_VOORBEREIDING = 30;
