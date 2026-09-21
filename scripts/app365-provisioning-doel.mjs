const DOELEN = Object.freeze({
  preview: Object.freeze({
    projectRef: "swviwoytzvaqypieqgji",
    mutatieAkkoord: "428-fase2-preview",
  }),
  production: Object.freeze({
    projectRef: "aebwiufuegsiwhwpdrfb",
    mutatieAkkoord: "428-fase3-productie",
  }),
});

function geblokkeerd(reden) {
  return new Error(`APP365 UITVOERING GEBLOKKEERD: ${reden}`);
}

export function projectrefUitDatabaseUrl(waarde) {
  let url;
  try { url = new URL(waarde); } catch { throw geblokkeerd("APP365_DATABASE_URL ontbreekt of is ongeldig."); }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw geblokkeerd("alleen een PostgreSQL-database-URL is toegestaan.");
  }
  const match = url.hostname.toLowerCase().match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (!match) throw geblokkeerd("databasehost bevat geen herkenbare Supabase-projectref.");
  return match[1];
}

export function bevestigApp365Doel({ omgeving, databaseUrl, actie, mutatieAkkoord }) {
  if (!Object.hasOwn(DOELEN, omgeving)) throw geblokkeerd("APP365_DOELOMGEVING moet exact 'preview' of 'production' zijn.");
  if (!new Set(["provision", "check", "rollback"]).has(actie)) throw geblokkeerd("actie moet provision, check of rollback zijn.");
  const projectRef = projectrefUitDatabaseUrl(databaseUrl);
  if (projectRef !== DOELEN[omgeving].projectRef) {
    throw geblokkeerd(`projectref '${projectRef}' hoort niet bij '${omgeving}'.`);
  }
  if (actie !== "check" && mutatieAkkoord !== DOELEN[omgeving].mutatieAkkoord) {
    throw geblokkeerd(`afzonderlijk mutatieakkoord '${DOELEN[omgeving].mutatieAkkoord}' ontbreekt.`);
  }
  return { omgeving, projectRef, actie };
}

export { DOELEN as APP365_DOELEN };
