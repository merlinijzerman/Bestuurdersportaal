import {
  heeftSchoonScanbewijs,
  isAiContextBeschikbaar,
  isOrigineelBeschikbaar,
} from "./document-scan-poort";

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

const schoonDocument = {
  actief: true,
  opslag_pad: "fonds/document.pdf",
  geindexeerd: true,
  documentdatum: null,
  bestand_hash: hash,
  scan_resultaat: { verdict: "clean", sha256: hash },
};
check("schoon origineel is onder WP3 beschikbaar", isOrigineelBeschikbaar(schoonDocument, true));
check("AI-context is beschikbaar met index en sterk bewijs", isAiContextBeschikbaar(schoonDocument, true));
check("lopende AI-indexering blokkeert het schone origineel niet", isOrigineelBeschikbaar({
  ...schoonDocument,
  geindexeerd: false,
}, true));
check("lopende AI-indexering verbergt de AI-ingang", !isAiContextBeschikbaar({
  ...schoonDocument,
  geindexeerd: false,
}, true));
check("legacy-origineel zonder scanbewijs blijft onder WP3 dicht", !isOrigineelBeschikbaar({
  ...schoonDocument,
  bestand_hash: null,
  scan_resultaat: null,
}, true));
check("zonder WP3 blijft bestaand origineel backwards-compatible beschikbaar", isOrigineelBeschikbaar({
  ...schoonDocument,
  bestand_hash: null,
  scan_resultaat: null,
}, false));
