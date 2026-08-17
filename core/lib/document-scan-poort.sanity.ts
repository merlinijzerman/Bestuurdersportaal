import { heeftSchoonScanbewijs } from "./document-scan-poort";

const hash = "a".repeat(64);

function check(naam: string, waarde: boolean) {
  if (!waarde) throw new Error(`FAALT: ${naam}`);
  console.log(`OK: ${naam}`);
}

check("clean + gelijke sha256 opent de poort", heeftSchoonScanbewijs({
  bestand_hash: hash,
  scan_resultaat: { verdict: "clean", sha256: hash },
}));
check("null-resultaat blijft dicht", !heeftSchoonScanbewijs({
  bestand_hash: hash,
  scan_resultaat: null,
}));
check("infected blijft dicht", !heeftSchoonScanbewijs({
  bestand_hash: hash,
  scan_resultaat: { verdict: "infected", sha256: hash },
}));
check("hashverschil blijft dicht", !heeftSchoonScanbewijs({
  bestand_hash: hash,
  scan_resultaat: { verdict: "clean", sha256: "b".repeat(64) },
}));
check("ongeldige hash blijft dicht", !heeftSchoonScanbewijs({
  bestand_hash: "niet-een-sha256",
  scan_resultaat: { verdict: "clean", sha256: "niet-een-sha256" },
}));

