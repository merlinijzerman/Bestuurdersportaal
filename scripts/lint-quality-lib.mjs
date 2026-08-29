import path from "node:path";

export const QUALITY_PREFIXES = ["react/", "react-hooks/", "@next/next/"];

function gesorteerdObject(entries) {
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
}

export function normaliseerLintResultaten(resultaten, cwd = process.cwd()) {
  const bestanden = new Map();
  const perRegel = new Map();
  const fouten = [];

  for (const resultaat of resultaten) {
    const relatiefPad = path.relative(cwd, resultaat.filePath).split(path.sep).join("/");
    const telling = new Map();

    for (const melding of resultaat.messages) {
      if (melding.severity === 2) {
        fouten.push({
          bestand: relatiefPad,
          regel: melding.ruleId ?? "parser/configuratie",
          regelnummer: melding.line ?? null,
        });
      }
      if (!melding.ruleId || !QUALITY_PREFIXES.some((prefix) => melding.ruleId.startsWith(prefix))) continue;
      telling.set(melding.ruleId, (telling.get(melding.ruleId) ?? 0) + 1);
      perRegel.set(melding.ruleId, (perRegel.get(melding.ruleId) ?? 0) + 1);
    }

    if (telling.size > 0) bestanden.set(relatiefPad, gesorteerdObject(telling));
  }

  const perRegelObject = gesorteerdObject(perRegel);
  return {
    totaal: Object.values(perRegelObject).reduce((som, aantal) => som + aantal, 0),
    perRegel: perRegelObject,
    bestanden: gesorteerdObject(bestanden),
    fouten: fouten.sort((a, b) =>
      a.bestand.localeCompare(b.bestand) ||
      a.regel.localeCompare(b.regel) ||
      (a.regelnummer ?? 0) - (b.regelnummer ?? 0),
    ),
  };
}

export function vergelijkMetBaseline(actueel, baseline) {
  const toenames = [];

  for (const [bestand, regels] of Object.entries(actueel.bestanden)) {
    for (const [regel, aantal] of Object.entries(regels)) {
      const toegestaan = baseline.bestanden?.[bestand]?.[regel] ?? 0;
      if (aantal > toegestaan) toenames.push({ bestand, regel, toegestaan, aantal });
    }
  }

  return toenames.sort((a, b) =>
    a.bestand.localeCompare(b.bestand) || a.regel.localeCompare(b.regel),
  );
}

export function maakBaseline(actueel) {
  return {
    schemaVersie: 1,
    scope: ["app", "core", "platform", "fondsen"],
    uitleg: "Bestaande React/Hooks/Next-bevindingen. De gate blokkeert alleen toenames per bestand en regel.",
    totaal: actueel.totaal,
    perRegel: actueel.perRegel,
    bestanden: actueel.bestanden,
  };
}

export function renderSamenvatting(actueel, toenames = []) {
  const regels = [
    "## React/Hooks/Next-lint",
    "",
    `- Huidige rapportage: **${actueel.totaal}** bevinding(en).`,
    `- Regels met bevindingen: **${Object.keys(actueel.perRegel).length}**.`,
    `- Bestanden met bevindingen: **${Object.keys(actueel.bestanden).length}**.`,
    `- Errors: **${actueel.fouten.length}**.`,
  ];

  if (toenames.length === 0 && actueel.fouten.length === 0) {
    regels.push("- Baselinegate: **groen** — geen nieuwe bevindingen per bestand/regel.");
  } else {
    regels.push(
      `- Baselinegate: **rood** — ${toenames.length} toename(s), ${actueel.fouten.length} error(s).`,
      "",
    );
    for (const item of toenames) {
      regels.push(`  - \`${item.bestand}\` — \`${item.regel}\`: ${item.toegestaan} → ${item.aantal}`);
    }
    for (const fout of actueel.fouten) {
      const plaats = fout.regelnummer === null ? fout.bestand : `${fout.bestand}:${fout.regelnummer}`;
      regels.push(`  - \`${plaats}\` — error \`${fout.regel}\``);
    }
  }

  return `${regels.join("\n")}\n`;
}
