// ============================================================================
//  #407 labsmoke — de registry is de ENIGE bron van context.
// ----------------------------------------------------------------------------
//  Tenant, identiteit, appregistratie en SharePoint-bron komen uitsluitend uit
//  de centrale repository `bestuurdersportaal-integraties`. Niets in deze
//  runner mag die waarden uit een chatgeschiedenis, een `.env`, een eerdere
//  meting of een commandoregelvlag halen: dat is precies hoe een smoke stil op
//  de verkeerde tenant of de verkeerde bibliotheek terechtkomt.
//
//  DE LEZER IS FAIL-CLOSED. Elke veronderstelling die deze runner doet, wordt
//  hier expliciet getoetst en niet verderop nog eens impliciet aangenomen:
//  het profiel-id ligt vast, de adapter ligt vast, het permissiemodel ligt
//  vast, en alle vier de verwijzingen (environment, tenant, identiteit, app,
//  bron) moeten naar DEZELFDE tenant wijzen. Eén kruisverwijzing die niet
//  klopt is genoeg om te stoppen.
//
//  WAT HIER NOOIT GEBEURT: een secret lezen. De registry bevat per beleid geen
//  wachtwoorden of clientsecrets, en deze runner heeft er ook geen nodig — de
//  appregistratie is een public client met PKCE.
// ============================================================================
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Het enige profiel dat deze runner mag draaien. Bewust een constante en geen
 * parameter: een runner die elk profiel aankan, is een runner die per ongeluk
 * op productie kan worden gericht.
 */
export const LAB_PROFIEL_ID = "pgb_m365_lab_copilot";

/** Vaste verwachtingen bij dat profiel. Drift hierin stopt de run. */
const VERWACHTE_ADAPTER = "microsoft_365_copilot_retrieval";
const VERWACHT_PERMISSIEMODEL = "delegated";
const VERWACHT_CREDENTIALMODEL = "public_client_pkce";

export class RegistryFout extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "RegistryFout";
    this.code = code;
  }
}

export interface Labprofiel {
  profielId: string;
  /** Entra-tenant-GUID; de enige tenant die deze runner mag raken. */
  tenantId: string;
  tenantDomein: string;
  /** De geregistreerde lab-testidentiteit (actor). */
  actorUpn: string;
  actorObjectId: string;
  /** Public-client-appregistratie in de labtenant. */
  clientId: string;
  redirectUris: string[];
  delegatedPermissions: string[];
  /** SharePoint-bron: site en bibliotheekroot. */
  siteUrl: string;
  siteHostnaam: string;
  /** Server-relatief sitepad, zoals Graph het in `/sites/{host}:{pad}` wil. */
  siteRelatiefPad: string;
  rootUrl: string;
  /** Laatst geregistreerde indexstand; puur informatief, nooit een gate. */
  indexStatus: string | null;
  indexGecontroleerdOp: string | null;
}

type Json = Record<string, unknown>;

function leesJson(map: string, bestand: string): Json {
  const pad = resolve(map, "registry", bestand);
  let ruw: string;
  try {
    ruw = readFileSync(pad, "utf8");
  } catch {
    throw new RegistryFout("registry_onbereikbaar", `${bestand} niet leesbaar op ${pad}`);
  }
  try {
    const waarde = JSON.parse(ruw) as unknown;
    if (typeof waarde !== "object" || waarde === null || Array.isArray(waarde)) {
      throw new Error("geen object");
    }
    return waarde as Json;
  } catch {
    throw new RegistryFout("registry_onleesbaar", `${bestand} is geen geldig JSON-object`);
  }
}

/** Zoekt één record op `id` binnen een genoemde lijst; ontbreken is fataal. */
function zoekOpId(bron: Json, lijstnaam: string, id: string, bestand: string): Json {
  const lijst = bron[lijstnaam];
  if (!Array.isArray(lijst)) {
    throw new RegistryFout("registry_vorm", `${bestand} mist de lijst '${lijstnaam}'`);
  }
  const treffers = lijst.filter(
    (record): record is Json =>
      typeof record === "object" && record !== null && (record as Json).id === id,
  );
  if (treffers.length === 0) {
    throw new RegistryFout("registratie_ontbreekt", `${bestand}: geen '${lijstnaam}'-record met id '${id}'`);
  }
  // Twee records met hetzelfde id is geen detail: dan is niet te zeggen welke
  // van de twee de run heeft gestuurd, en dus is de run niet reproduceerbaar.
  if (treffers.length > 1) {
    throw new RegistryFout("registratie_dubbel", `${bestand}: id '${id}' komt ${treffers.length}x voor in '${lijstnaam}'`);
  }
  return treffers[0];
}

function tekst(record: Json, veld: string, context: string): string {
  const waarde = record[veld];
  if (typeof waarde !== "string" || waarde.trim().length === 0) {
    throw new RegistryFout("registratie_onvolledig", `${context}: veld '${veld}' ontbreekt of is leeg`);
  }
  return waarde.trim();
}

function optioneleTekst(record: Json, veld: string): string | null {
  const waarde = record[veld];
  return typeof waarde === "string" && waarde.trim().length > 0 ? waarde.trim() : null;
}

function tekstlijst(record: Json, veld: string, context: string): string[] {
  const waarde = record[veld];
  if (!Array.isArray(waarde) || waarde.some((item) => typeof item !== "string")) {
    throw new RegistryFout("registratie_onvolledig", `${context}: veld '${veld}' is geen lijst van tekst`);
  }
  return waarde as string[];
}

function gelijk(veld: string, gevonden: string, verwacht: string): void {
  if (gevonden !== verwacht) {
    throw new RegistryFout("registratie_inconsistent", `${veld}: '${gevonden}' hoort '${verwacht}' te zijn`);
  }
}

/**
 * Splitst de geregistreerde site-URL in host en server-relatief pad.
 *
 * Strikt, en met opzet zonder tolerantie: een site-URL met query, fragment,
 * poort, gebruikersdeel of een niet-SharePoint-host is geen site-URL maar een
 * signaal dat er iets anders in de registratie staat dan wij denken.
 */
function ontleedSiteUrl(siteUrl: string): { hostnaam: string; relatiefPad: string } {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new RegistryFout("bron_site_ongeldig", "site_url is geen geldige URL");
  }
  if (parsed.protocol !== "https:") throw new RegistryFout("bron_site_ongeldig", "site_url is niet https");
  if (parsed.username || parsed.password) throw new RegistryFout("bron_site_ongeldig", "site_url bevat een gebruikersdeel");
  if (parsed.port) throw new RegistryFout("bron_site_ongeldig", "site_url bevat een poort");
  if (parsed.search || parsed.hash) throw new RegistryFout("bron_site_ongeldig", "site_url bevat query of fragment");
  const hostnaam = parsed.hostname.toLowerCase();
  if (!/^[a-z0-9-]+\.sharepoint\.com$/.test(hostnaam)) {
    throw new RegistryFout("bron_site_ongeldig", "site_url staat niet op een sharepoint.com-host");
  }
  const relatiefPad = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
  if (!relatiefPad.startsWith("/")) throw new RegistryFout("bron_site_ongeldig", "site_url mist een sitepad");
  return { hostnaam, relatiefPad };
}

/**
 * De root moet aantoonbaar ONDER de site liggen. Een root die daarbuiten valt,
 * zou de scope van de hele smoke verbreden terwijl de sitecontrole nog groen
 * oogt — dat is precies de drift waar de stopregel op doelt.
 */
function toetsRootOnderSite(rootUrl: string, siteUrl: string): void {
  let root: URL;
  let site: URL;
  try {
    root = new URL(rootUrl);
    site = new URL(siteUrl);
  } catch {
    throw new RegistryFout("bron_root_ongeldig", "root_url is geen geldige URL");
  }
  if (root.protocol !== "https:" || root.username || root.password || root.port || root.search || root.hash) {
    throw new RegistryFout("bron_root_ongeldig", "root_url is niet een kale https-URL");
  }
  if (root.origin !== site.origin) {
    throw new RegistryFout("bron_root_ongeldig", "root_url staat op een andere host dan site_url");
  }
  const rootPad = decodeURIComponent(root.pathname).normalize("NFC").replace(/\/+$/, "");
  const sitePad = decodeURIComponent(site.pathname).normalize("NFC").replace(/\/+$/, "");
  if (rootPad !== sitePad && !rootPad.startsWith(`${sitePad}/`)) {
    throw new RegistryFout("bron_root_ongeldig", "root_url ligt niet onder site_url");
  }
}

/**
 * Bepaalt waar de registry staat. `INTEGRATIES_REGISTRY_DIR` wint; anders de
 * zustermap van de repository-root. Geen netwerk, geen `git clone`, geen
 * impliciete fallback naar een tweede locatie: één pad, en als dat pad er niet
 * is stopt de run met een leesbare fout.
 */
export function registryMap(repoRoot: string): string {
  const uitEnv = process.env.INTEGRATIES_REGISTRY_DIR?.trim();
  if (uitEnv) return isAbsolute(uitEnv) ? uitEnv : resolve(repoRoot, uitEnv);
  return resolve(repoRoot, "..", "bestuurdersportaal-integraties");
}

/**
 * Leest en valideert het labprofiel. Geeft een bevroren object terug: alles wat
 * hierna nog verandert, is geen registratie meer.
 */
export function leesLabprofiel(map: string, profielId: string = LAB_PROFIEL_ID): Labprofiel {
  if (profielId !== LAB_PROFIEL_ID) {
    throw new RegistryFout("profiel_niet_toegestaan", `deze runner draait uitsluitend '${LAB_PROFIEL_ID}'`);
  }

  const profielen = leesJson(map, "retrieval-profiles.json");
  const profiel = zoekOpId(profielen, "retrieval_profiles", profielId, "retrieval-profiles.json");

  gelijk("profiel.adapter", tekst(profiel, "adapter", "profiel"), VERWACHTE_ADAPTER);
  gelijk("profiel.permission_model", tekst(profiel, "permission_model", "profiel"), VERWACHT_PERMISSIEMODEL);
  // Een profiel dat aan productie hangt, hoort niet in een labsmoke thuis.
  if (profiel.production_wiring !== false) {
    throw new RegistryFout("profiel_productiegekoppeld", "profiel.production_wiring is niet false");
  }

  const environmentId = tekst(profiel, "environment_id", "profiel");
  const tenantRef = tekst(profiel, "tenant_id", "profiel");
  const identityId = tekst(profiel, "identity_id", "profiel");
  const applicationId = tekst(profiel, "application_id", "profiel");
  const dataSourceId = tekst(profiel, "data_source_id", "profiel");

  const environment = zoekOpId(leesJson(map, "environments.json"), "environments", environmentId, "environments.json");
  const tenant = zoekOpId(leesJson(map, "tenants.json"), "tenants", tenantRef, "tenants.json");
  const identity = zoekOpId(leesJson(map, "identities.json"), "identities", identityId, "identities.json");
  const application = zoekOpId(leesJson(map, "applications.json"), "applications", applicationId, "applications.json");
  const dataSource = zoekOpId(leesJson(map, "data-sources.json"), "data_sources", dataSourceId, "data-sources.json");

  // De vier verwijzingen moeten op DEZELFDE tenant uitkomen. Twee registraties
  // die allebei op zichzelf kloppen maar naar verschillende tenants wijzen, zijn
  // hier de gevaarlijkste vorm van drift: elke losse controle is dan groen.
  const tenantId = tekst(tenant, "tenant_id", "tenant").toLowerCase();
  gelijk("tenant.environment_id", tekst(tenant, "environment_id", "tenant"), environmentId);
  gelijk("environment.tenant_id", tekst(environment, "tenant_id", "environment").toLowerCase(), tenantId);
  gelijk("identity.environment_id", tekst(identity, "environment_id", "identiteit"), environmentId);
  gelijk("application.tenant_id", tekst(application, "tenant_id", "applicatie"), tenantRef);
  gelijk("data_source.tenant_id", tekst(dataSource, "tenant_id", "bron"), tenantRef);

  // De appregistratie moet een PUBLIC client zijn. Een confidential client zou
  // een clientsecret vragen, en die mag deze runner per opdracht niet aanraken.
  gelijk("application.credential_model", tekst(application, "credential_model", "applicatie"), VERWACHT_CREDENTIALMODEL);
  if (application.client_secret_present === true) {
    throw new RegistryFout("app_heeft_secret", "de appregistratie is als secret-dragend geregistreerd");
  }
  if ("secret_ref" in application && application.secret_ref !== null && application.secret_ref !== undefined) {
    throw new RegistryFout("app_heeft_secret", "de appregistratie draagt een secret_ref");
  }

  const siteUrl = tekst(dataSource, "site_url", "bron");
  const rootUrl = tekst(dataSource, "root_url", "bron");
  const { hostnaam, relatiefPad } = ontleedSiteUrl(siteUrl);
  toetsRootOnderSite(rootUrl, siteUrl);

  return Object.freeze({
    profielId,
    tenantId,
    tenantDomein: tekst(tenant, "primary_domain", "tenant"),
    actorUpn: tekst(identity, "account", "identiteit"),
    actorObjectId: tekst(identity, "object_id", "identiteit").toLowerCase(),
    clientId: tekst(application, "client_id", "applicatie").toLowerCase(),
    redirectUris: tekstlijst(application, "redirect_uris", "applicatie"),
    delegatedPermissions: tekstlijst(application, "delegated_permissions", "applicatie"),
    siteUrl,
    siteHostnaam: hostnaam,
    siteRelatiefPad: relatiefPad,
    rootUrl,
    indexStatus: optioneleTekst(dataSource, "index_status"),
    indexGecontroleerdOp: optioneleTekst(dataSource, "index_checked_at"),
  });
}
