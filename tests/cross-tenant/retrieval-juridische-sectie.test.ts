import test from "node:test";
import assert from "node:assert/strict";
import { vulAanMetSectiekandidaten, type DocumentChunk } from "../../core/lib/rag";
import { bepaalSectiefocus } from "../../core/lib/retrieval/juridische-sectie";
import { haalJuridischeSectieVoorWeergave } from "../../core/lib/retrieval/juridische-sectie-ophalen";

const DOC = "d0000000-0000-4000-8000-000000000062";
const FONDS = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
const tekst = [
  "Artikel 17f. Vorige bepaling\n\nParagraaf 6.2. Individuele waardeoverdracht",
  "Artikel 17g. Overgangsrecht\nBinnen zes maanden vraagt de deelnemer een opgave.",
  "Artikel 18. Verzoek opgave\nDe ontvangende uitvoerder vraagt binnen één maand een opgave.",
  "Artikel 19. Opgave\nDe overdragende uitvoerder verstrekt binnen twee maanden een opgave.",
  "Artikel 20. Informatie deelnemer\nDe ontvangende uitvoerder verstrekt binnen twee maanden de opgave.",
  "Artikel 21. Verzoek\nDe deelnemer vraagt binnen twee maanden waardeoverdracht.",
  "Artikel 23. Afhandeling\nDe waarde wordt binnen vijftien werkdagen betaald.",
  "Artikel 28. Behandeling\nAanspraken worden behandeld.\nHoofdstuk 6a. Bestuur en toezicht",
];
const sectieRijen = tekst.map((t, i) => ({
  id: `c${i}`, document_id: DOC, chunk_index: 206 + i, tekst: t,
  structuur_label: i > 0 ? /^Artikel \w+/.exec(t)?.[0] ?? null : "Artikel 17f",
}));

function toelatingsrij(r: typeof sectieRijen[number], fondsId: string | null = null) {
  const bibliotheek = fondsId ? "fonds" : "generiek";
  return {
    ...r, pagina: 24, paragraaf: null, documentstatus: "van_kracht", bronstatus: "actief",
    documentdatum: "2026-01-01", geldig_vanaf: "2026-01-01", geldig_tot: null,
    procesinstantie_id: null, bronorganisatie: null, normgewicht: "primair",
    extern_url: "https://wetten.overheid.nl/BWBR0020892/2026-01-01/0",
    wettelijk_regime: "beide", bibliotheek,
    documenten: {
      titel: "Besluit uitvoering Pensioenwet", bron: "extern", bibliotheek,
      opslag_pad: null, fonds_id: fondsId, volgende_review: "2027-01-01", actief: true,
    },
  };
}

function nepSupabase(toelatingFonds: string | null = null) {
  const aanroepen: { tabel: string; methode: string; args: unknown[] }[] = [];
  let chunkQueries = 0;
  return {
    aanroepen,
    client: {
      from(tabel: string) {
        const soort = tabel === "documenten" ? "documenten" : ++chunkQueries === 1 ? "kop" : chunkQueries === 2 ? "sectie" : "toelating";
        let ids: string[] = [];
        const builder: Record<string, unknown> = {};
        for (const methode of ["select", "eq", "in", "ilike", "gte", "lte", "order", "limit", "or", "textSearch"]) {
          builder[methode] = (...args: unknown[]) => {
            aanroepen.push({ tabel: soort, methode, args });
            if (soort === "toelating" && methode === "in" && args[0] === "id") ids = args[1] as string[];
            return builder;
          };
        }
        builder.abortSignal = () => builder;
        builder.then = (resolve: (waarde: unknown) => unknown, reject: (fout: unknown) => unknown) => {
          const data = soort === "documenten"
            ? [{ id: DOC, bestand_hash: HASH, scan_resultaat: { verdict: "clean", sha256: HASH } }]
            : soort === "kop" ? [sectieRijen[0]]
              : soort === "sectie" ? sectieRijen
                : sectieRijen.filter((r) => ids.includes(r.id)).map((r) => toelatingsrij(r, toelatingFonds));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        };
        return builder;
      },
    },
  };
}

const oud: DocumentChunk = {
  id: "oud", document_id: DOC, chunk_index: 100, tekst: "Een niet relevante bijlage.",
  pagina: 53, paragraaf: null, rang: 0.9,
  documenten: { titel: "Besluit uitvoering Pensioenwet", bron: "extern", bibliotheek: "generiek", opslag_pad: null },
};
const focus = bepaalSectiefocus("Wat zijn de termijnen voor individuele waardeoverdrachten volgens de Pensioenwet?")!;

test("gerichte sectie levert de procedureartikelen op en houdt de opvraging bij het kandidaatdocument", async () => {
  const nep = nepSupabase();
  const uit = await vulAanMetSectiekandidaten([oud], {
    focus, fondsId: FONDS, filters: { modus: "actueel", peildatum: "2026-10-05" },
    maxKandidaten: 10, supabase: nep.client,
  });
  assert.deepEqual(uit.slice(0, 6).map((c) => c.structuur_label),
    ["Artikel 18", "Artikel 19", "Artikel 20", "Artikel 21", "Artikel 23", "Artikel 17g"]);
  assert.equal(uit[0].sectiespoor, true);
  assert.equal(uit.at(-1)?.id, "oud");
  assert.ok(nep.aanroepen.some((a) => a.tabel === "documenten" && a.methode === "in" && a.args[0] === "id"));
  assert.ok(nep.aanroepen.some((a) => a.tabel === "toelating" && a.methode === "in" && a.args[0] === "id"));
  assert.ok(!nep.aanroepen.some((a) => a.methode === "textSearch"), "exacte sectie-ID's hebben geen FTS-frase nodig");
});

test("fondsdiscipline laat sectiepassages van een ander fonds niet toe", async () => {
  const nep = nepSupabase("99999999-9999-4999-8999-999999999999");
  const uit = await vulAanMetSectiekandidaten([oud], {
    focus, fondsId: FONDS, filters: { modus: "actueel", peildatum: "2026-10-05" },
    maxKandidaten: 10, supabase: nep.client,
  });
  assert.deepEqual(uit.map((c) => c.id), ["oud"]);
});

test("een volledige paragraaf uit een beschadigde PDF krijgt de officiële vindplaats", async () => {
  let chunks = 0;
  const client = {
    from(tabel: string) {
      const soort = tabel === "documenten" ? "documenten" : ++chunks === 1 ? "kop" : "sectie";
      const builder: Record<string, unknown> = {};
      for (const methode of ["select", "eq", "in", "ilike", "gte", "lte", "order", "limit"]) {
        builder[methode] = () => builder;
      }
      builder.abortSignal = () => builder;
      builder.then = (resolve: (waarde: unknown) => unknown, reject: (fout: unknown) => unknown) => {
        const data = soort === "documenten"
          ? [{
              id: DOC, titel: "Besluit uitvoering Pensioenwet en Wet verplichte beroepspensioenregeling",
              extern_url: "https://wetten.overheid.nl/BWBR0020892/2026-01-01/0",
              status: "van_kracht", bronstatus: "actief", geldig_vanaf: "2026-01-01", geldig_tot: null,
              fonds_id: null, bibliotheek: "generiek", volgende_review: "2027-01-01",
              bestand_hash: HASH, scan_resultaat: { verdict: "clean", sha256: HASH },
            }]
          : soort === "kop" ? [sectieRijen[0]]
            : sectieRijen.map((r) => ({
                ...r, tekst: r.id === "c2" ? `${r.tekst} De opgave, bedoeld in , wordt verwerkt.` : r.tekst,
                documentstatus: "van_kracht", bronstatus: "actief", geldig_vanaf: "2026-01-01", geldig_tot: null,
              }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return builder;
    },
  };
  const uit = await haalJuridischeSectieVoorWeergave({
    vraag: "Geef de hele Paragraaf 6.2 Individuele waardeoverdracht van het Besluit uitvoering Pensioenwet",
    fondsId: FONDS, peildatum: "2026-10-05", supabase: client, signal: new AbortController().signal,
  });
  assert.equal(uit?.sectie.reden, "extractiegaten");
  assert.equal(uit?.bronlink, "https://wetten.overheid.nl/BWBR0020892/2026-01-01/0/Hoofdstuk6/Paragraaf6.2");
});
