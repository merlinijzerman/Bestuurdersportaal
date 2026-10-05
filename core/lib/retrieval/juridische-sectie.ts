// Zuivere herkenning en afbakening van een juridische paragraaf. Ook een oude
// PDF-index kan de kop aan het vorige artikel hebben geplakt; daarom lezen we
// de tekst zelf en vertrouwen we niet uitsluitend op structuur_label.

export interface Sectiefocus {
  nummer: string | null;
  vraag: string;
  volledig: boolean;
}

export interface Sectierij {
  id: string;
  document_id: string;
  chunk_index: number;
  tekst: string;
  structuur_label?: string | null;
}

export interface Sectiekop {
  nummer: string;
  titel: string;
  rij: Sectierij;
  positie: number;
}

export interface AfgebakendeSectie {
  kop: Sectiekop;
  rijen: Sectierij[];
  tekst: string;
  volledig: boolean;
  reden: "ok" | "geen_eindgrens" | "onderbroken" | "extractiegaten" | "te_groot";
}

export interface JuridischDocument {
  id: string;
  titel: string;
  extern_url: string | null;
}

const PARAGRAAF_KOP = /(?:^|\n)\s*Paragraaf\s+(\d+(?:\.\d+)*)\.\s+([^\n]+)/g;
const SECTIE_EINDE = /(?:^|\n)\s*(?:Paragraaf\s+\d+(?:\.\d+)*|Hoofdstuk\s+\d+[a-z]?(?:\.\d+)*)\.\s+\p{Lu}/gu;
const MAX_SECTIE_RIJEN = 80;
const MAX_SECTIE_TEKENS = 60_000;

export function bepaalSectiefocus(vraag: string): Sectiefocus | null {
  const nummer = /\bparagraaf\s+(\d+(?:\.\d+)*)\b/i.exec(vraag)?.[1] ?? null;
  const inhoudelijk = /\b(?:waardeoverdracht|waardeoverdrachten)\b/i.test(vraag);
  if (!nummer && !inhoudelijk) return null;
  return {
    nummer,
    vraag,
    volledig: /\b(?:hele|volledige|integraal|letterlijke)\b/i.test(vraag),
  };
}

function normaliseer(tekst: string): string[] {
  return tekst.toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g)?.map((w) => w.endsWith("en") && w.length > 7 ? w.slice(0, -2) : w) ?? [];
}

function titelScore(focus: Sectiefocus, titel: string): number {
  const woorden = new Set(normaliseer(focus.vraag));
  const titelwoorden = normaliseer(titel).filter((w) => w.length >= 5);
  return titelwoorden.filter((w) => woorden.has(w)).length;
}

export function vindParagraafkoppen(rijen: Sectierij[]): Sectiekop[] {
  const uit: Sectiekop[] = [];
  for (const rij of rijen) {
    for (const match of rij.tekst.matchAll(PARAGRAAF_KOP)) {
      // De match kan meerdere regeleinden/inspringingen vóór "Paragraaf"
      // bevatten. Begin exact bij de kop; anders herkent de afbakening de
      // eigen kop ten onrechte als volgende sectie.
      uit.push({ nummer: match[1], titel: match[2].trim(), rij, positie: match.index + match[0].indexOf("Paragraaf") });
    }
  }
  return uit;
}

export function kiesParagraafkop(focus: Sectiefocus, rijen: Sectierij[]): Sectiekop | null {
  const kandidaten = vindParagraafkoppen(rijen)
    .filter((kop) => !focus.nummer || kop.nummer === focus.nummer)
    .map((kop) => ({ kop, score: titelScore(focus, kop.titel) }))
    .sort((a, b) => b.score - a.score || a.kop.rij.chunk_index - b.kop.rij.chunk_index);
  if (kandidaten.length === 0) return null;
  // Zonder expliciet nummer eisen we twee gedeelde titelwoorden. Zo wint
  // 'Individuele waardeoverdracht' van 'Waardeoverdracht klein pensioen'.
  if (!focus.nummer && kandidaten[0].score < 2) return null;
  if (!focus.nummer && kandidaten.length > 1 && kandidaten[0].score === kandidaten[1].score &&
      kandidaten[0].kop.rij.document_id !== kandidaten[1].kop.rij.document_id) return null;
  return kandidaten[0].kop;
}

export function kiesJuridischDocument(vraag: string, documenten: JuridischDocument[]): JuridischDocument | null {
  const woorden = new Set(normaliseer(vraag));
  const gerangschikt = documenten.map((document) => {
    const titel = normaliseer(document.titel);
    const gedeeld = titel.filter((w) => w.length >= 6 && woorden.has(w)).length;
    const soort = /\bbesluit\b/i.test(vraag) && /^Besluit\b/.test(document.titel) ? 3 : 0;
    return { document, score: gedeeld + soort };
  }).sort((a, b) => b.score - a.score);
  if (gerangschikt.length === 0 || gerangschikt[0].score < 2) return null;
  if (gerangschikt.length > 1 && gerangschikt[0].score === gerangschikt[1].score) return null;
  return gerangschikt[0].document;
}

export function bakenParagraafAf(kop: Sectiekop, rijen: Sectierij[]): AfgebakendeSectie {
  const geordend = [...rijen]
    .filter((r) => r.document_id === kop.rij.document_id && r.chunk_index >= kop.rij.chunk_index)
    .sort((a, b) => a.chunk_index - b.chunk_index);
  const delen: string[] = [];
  const gekozen: Sectierij[] = [];
  let einde = false;
  let onderbroken = false;
  for (const rij of geordend.slice(0, MAX_SECTIE_RIJEN + 1)) {
    if (gekozen.length > 0 && rij.chunk_index !== gekozen.at(-1)!.chunk_index + 1) {
      onderbroken = true;
      break;
    }
    const begin = rij.id === kop.rij.id ? kop.positie : 0;
    const stuk = rij.tekst.slice(begin);
    SECTIE_EINDE.lastIndex = 0;
    const volgende = rij.id === kop.rij.id ? null : SECTIE_EINDE.exec(stuk);
    // De eerste kop is die van deze paragraaf; zoek pas ná die kopregel.
    const grens = rij.id === kop.rij.id
      ? (() => {
          const naKop = stuk.indexOf("\n");
          if (naKop < 0) return null;
          SECTIE_EINDE.lastIndex = 0;
          const m = SECTIE_EINDE.exec(stuk.slice(naKop));
          return m ? naKop + m.index : null;
        })()
      : volgende ? volgende.index : null;
    const afgebakend = (grens === null ? stuk : stuk.slice(0, grens)).trim();
    gekozen.push({ ...rij, tekst: afgebakend });
    delen.push(afgebakend);
    if (grens !== null) { einde = true; break; }
  }
  // Lange artikelen zijn met overlap in meerdere chunks verdeeld. Neem die
  // overlap één keer op, zodat een schone bron ook echt letterlijk leesbaar is.
  let tekst = "";
  for (const deel of delen.filter(Boolean)) {
    if (!tekst) { tekst = deel; continue; }
    let overlap = 0;
    for (let n = Math.min(300, tekst.length, deel.length); n >= 40; n--) {
      if (tekst.endsWith(deel.slice(0, n))) { overlap = n; break; }
    }
    tekst += overlap ? deel.slice(overlap) : `\n\n${deel}`;
  }
  const extractiegaten = /\b(?:bedoeld in|op grond van|als bedoeld in)\s*,/i.test(tekst) ||
    /wetten\.nl\s*-\s*Regeling|\/afdrukken\s+\d+\/\d+/i.test(tekst);
  const reden: AfgebakendeSectie["reden"] = onderbroken ? "onderbroken"
    : !einde ? "geen_eindgrens"
    : gekozen.length > MAX_SECTIE_RIJEN || tekst.length > MAX_SECTIE_TEKENS ? "te_groot"
    : extractiegaten ? "extractiegaten"
    : "ok";
  return { kop, rijen: gekozen, tekst, volledig: reden === "ok", reden };
}

export function sectieBronlink(externUrl: string | null | undefined, nummer: string): string | null {
  if (!externUrl) return null;
  try {
    const u = new URL(externUrl);
    if (u.protocol !== "https:" || u.hostname !== "wetten.overheid.nl") return null;
    const m = /^\/(BWB[RV]\d{7})\/(\d{4}-\d{2}-\d{2})/.exec(u.pathname);
    if (!m) return null;
    const hoofdstuk = nummer.split(".")[0];
    return `https://wetten.overheid.nl/${m[1]}/${m[2]}/0/Hoofdstuk${hoofdstuk}/Paragraaf${nummer}`;
  } catch {
    return null;
  }
}

export function geefParagraafLetterlijk(sectie: AfgebakendeSectie, bronlink: string): string {
  const titel = `Paragraaf ${sectie.kop.nummer}. ${sectie.kop.titel}`;
  if (!sectie.volledig) {
    const uitleg = {
      geen_eindgrens: "het einde van de paragraaf ontbreekt",
      onderbroken: "er ontbreken passages",
      extractiegaten: "de PDF-tekst bevat ontbrekende verwijzingen of paginakoppen",
      te_groot: "de tekst kan niet volledig worden gecontroleerd",
      ok: "de tekst kan niet volledig worden gecontroleerd",
    }[sectie.reden];
    return `Ik heb ${titel} in de geraadpleegde bron gevonden. Ik kan de paragraaf niet betrouwbaar letterlijk weergeven: ${uitleg}. Lees de [volledige officiële tekst](${bronlink}).`;
  }
  return `${sectie.tekst}\n\n[Officiële tekst van ${titel}](${bronlink})`;
}

/** Hoogstens één termijnpassage per artikel; kernartikelen gaan vóór uitzonderingen. */
export function kiesTermijnpassages(sectie: AfgebakendeSectie, max: number): Sectierij[] {
  const perArtikel = new Map<string, Sectierij>();
  let artikel = "";
  for (const rij of sectie.rijen) {
    const kop = /(?:^|\n)\s*Artikel\s+(\d+(?:\.\d+)*[a-z]?)\./i.exec(rij.tekst);
    if (kop) artikel = kop[1];
    else if (rij.structuur_label?.startsWith("Artikel ")) artikel = rij.structuur_label.slice(8);
    if (!artikel || perArtikel.has(artikel)) continue;
    if (/\bbinnen\s+(?:\S+\s+){0,3}(?:werkdagen|werkdag|dagen|dag|weken|week|maanden|maand|jaar)\b/i.test(rij.tekst)) {
      perArtikel.set(artikel, rij);
    }
  }
  return [...perArtikel.entries()]
    .sort(([a, ra], [b, rb]) => {
      const aKern = /^\d+$/.test(a) ? 0 : 1;
      const bKern = /^\d+$/.test(b) ? 0 : 1;
      return aKern - bKern || ra.chunk_index - rb.chunk_index;
    })
    .slice(0, Math.max(0, max))
    .map(([, rij]) => rij);
}
