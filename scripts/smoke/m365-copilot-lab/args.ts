import type { Meetmodus } from "./smoke";

export interface SmokeArgumenten {
  dryRun: boolean;
  geenBrowser: boolean;
  rapportPad: string | null;
  wachtMs: number;
  modus: Meetmodus;
}

/** Een typefout in de CLI mag nooit stil een andere betaalde vraag kiezen. */
export function parseerSmokeArgumenten(args: readonly string[]): SmokeArgumenten {
  const gezien = new Set<string>();
  const resultaat: SmokeArgumenten = {
    dryRun: false,
    geenBrowser: false,
    rapportPad: null,
    wachtMs: 300_000,
    modus: "sem01",
  };

  for (const arg of args) {
    const sleutel = arg.split("=", 1)[0];
    if (gezien.has(sleutel)) throw new Error("dubbel CLI-argument");
    gezien.add(sleutel);
    if (arg === "--dry-run") resultaat.dryRun = true;
    else if (arg === "--geen-browser") resultaat.geenBrowser = true;
    else if (arg === "--exacte-canary") resultaat.modus = "exacte_canary";
    else if (arg.startsWith("--rapport=")) {
      resultaat.rapportPad = arg.slice("--rapport=".length);
      if (!resultaat.rapportPad) throw new Error("--rapport vereist een pad");
    } else if (arg.startsWith("--wacht-s=")) {
      const seconden = Number(arg.slice("--wacht-s=".length));
      if (!Number.isSafeInteger(seconden) || seconden < 1 || seconden > 1800) {
        throw new Error("--wacht-s moet een geheel getal tussen 1 en 1800 zijn");
      }
      resultaat.wachtMs = seconden * 1000;
    } else {
      throw new Error("onbekend CLI-argument");
    }
  }
  return resultaat;
}
