// ============================================================================
//  lib/herindex-selectie.ts — selectie voor de eenmalige generieke herindexering (#548).
// ----------------------------------------------------------------------------
//  PUUR. Bepaalt per document of het nog naar de doelversie moet, al klaar is,
//  of bij een eerdere poging is mislukt/overgeslagen. De vorige selectie
//  ("een chunk met indexering_versie is null") vond een document niet meer
//  terug wanneer al zijn chunks na een fout waren opgeruimd, en pakte een
//  overgeslagen document op r1 eindeloos opnieuw op. Hier telt:
//    • klaar: chunk 0 draagt de doelversie én documenten.geindexeerd = true;
//    • mislukt/overgeslagen: de laatste herindex-job voor deze doelversie
//      (document_processing_jobs, stap 'indexering', foutcode herindex:<versie>:…)
//      en het document is niet klaar — terug te vinden en gericht te hervatten;
//    • te doen: al het andere, óók een document zonder chunks.
//  Alleen voor de generieke bibliotheek: de aanroeper levert uitsluitend
//  generieke documenten aan. Bestaande fondsdocumenten worden niet herindexeerd.
// ============================================================================

export interface HerindexDocRij {
  id: string;
  titel: string | null;
  geindexeerd: boolean | null;
}

export interface HerindexJobRij {
  document_id: string;
  status: string;
  foutcode: string | null;
  aangemaakt: string;
}

export interface HerindexStand<T extends HerindexDocRij> {
  teDoen: T[];
  klaar: T[];
  mislukt: (T & { reden: string | null })[];
  overgeslagen: (T & { reden: string | null })[];
}

const PREFIX = "herindex";

/** Foutcode voor een herindex-job: herindex:<doelversie>:<uitkomst/reden>. */
export function herindexFoutcode(doelVersie: string, reden: string): string {
  return `${PREFIX}:${doelVersie}:${reden}`;
}

function redenUit(foutcode: string | null, doelVersie: string): string | null {
  const prefix = `${PREFIX}:${doelVersie}:`;
  return foutcode?.startsWith(prefix) ? foutcode.slice(prefix.length) : null;
}

export function bepaalHerindexStand<T extends HerindexDocRij>(
  documenten: T[],
  klaarOpDoelversie: Set<string>,
  jobs: HerindexJobRij[],
  doelVersie: string
): HerindexStand<T> {
  // Laatste job per document voor déze doelversie.
  const laatste = new Map<string, HerindexJobRij>();
  for (const job of jobs) {
    if (redenUit(job.foutcode, doelVersie) === null) continue;
    const huidig = laatste.get(job.document_id);
    if (!huidig || job.aangemaakt > huidig.aangemaakt) laatste.set(job.document_id, job);
  }
  const stand: HerindexStand<T> = { teDoen: [], klaar: [], mislukt: [], overgeslagen: [] };
  for (const doc of documenten) {
    if (klaarOpDoelversie.has(doc.id) && doc.geindexeerd === true) {
      stand.klaar.push(doc);
      continue;
    }
    const job = laatste.get(doc.id);
    if (job?.status === "mislukt") {
      stand.mislukt.push({ ...doc, reden: redenUit(job.foutcode, doelVersie) });
    } else if (job?.status === "overgeslagen") {
      stand.overgeslagen.push({ ...doc, reden: redenUit(job.foutcode, doelVersie) });
    } else {
      stand.teDoen.push(doc);
    }
  }
  return stand;
}
