// ============================================================================
//  ROL-TESTSET — tenant-rol `bestuursbureau` (T1 plateau A, besluit 0128).
// ----------------------------------------------------------------------------
//  WAAROM DEZE SUITE APART BESTAAT.
//  De bestaande §15-suite toetst TENANTgrenzen: fonds A tegen fonds B. Deze
//  toetst een ROLgrens BINNEN één fonds. Dat onderscheid is wezenlijk, want RLS
//  isoleert in dit schema op `fonds_id` en niet op rol: een nieuwe rol ziet by
//  default álles wat fondsbreed leesbaar is en mag by default álles schrijven wat
//  een fondslid mag. De afscherming van het bureau is dus een ACTIEVE
//  predicaat-uitbreiding — zonder deze suite is ze een aanname en geen
//  aantoonbaarheid (ontwerp §5.4, risico R4).
//
//  TWEE LAGEN, ZOALS OVERAL IN DIT PROJECT.
//   • App-laag (dit bestand): pure functies + bron-inspectie. Geen DB.
//   • DB-laag: supabase/checks/2026_08_05_bb_rolgrenzen.sql — daar wordt onder
//     échte RLS bewezen dat het bureau 0 rijen leest en niets kan schrijven.
//  Dit bestand bewijst dus NIET dat de afscherming werkt; het bewijst dat de
//  mapping klopt en dat elke afwezige knop een server-side weigering dekt.
//
//  Draaien: node --import tsx --test tests/cross-tenant/bureau-rolgrenzen.test.ts
//  (of via `npm run test:xtenant` / `bash scripts/cross-tenant-ci.sh`).
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ROL_CAPABILITIES, rolHeeftCapability } from "../../core/lib/capabilities";
import { BUREAU_ROL, isBureauRol } from "../../core/lib/bureau-gate";
import {
  TENANT_ROLLEN,
  ROL_LABEL,
  isTenantRol,
} from "../../app/(platform)/platform/(beveiligd)/gebruikers/gedeeld";
import { MODULE_REGISTRY, alleModules } from "../../core/lib/module-registry";
import {
  telEigenInbreng,
  telZonderGekoppeldStuk,
} from "../../core/lib/portaalcontext-afleiding";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

// ── (1) De capability-mapping is exact §5.2 ────────────────────────────────

const BUREAU_WEL = [
  "documents.metadata.update",
  "documents.status.change",
  "documents.bronstatus.change",
  "profile.manage.own",
  "stuurinformatie.view",
  "klantbeeld.view",
  "ai.deskresearch",
  "ai.stukvoorbereiding",
] as const;

const BUREAU_NIET = [
  "metadata.review",
  "classification.review",
  "notulen.segment.confirm",
  "dossiers.manage",
  "catalog.manage",
  "organisation.profile.manage",
  "fonds.config.manage",
  "stuurinformatie.manage",
  "generic.library.manage",
] as const;

test("BB-1 — bestuursbureau draagt exact de capabilities uit ontwerp §5.2", () => {
  assert.deepEqual([...ROL_CAPABILITIES.bestuursbureau].sort(), [...BUREAU_WEL].sort());
});

test("BB-2 — bestuursbureau draagt geen enkele uitgesloten capability (§5.3)", () => {
  for (const cap of BUREAU_NIET) {
    assert.equal(rolHeeftCapability("bestuursbureau", cap), false, `bureau ${cap}`);
  }
});

test("BB-3 — de twee nieuwe capabilities hangen aan géén andere rol", () => {
  // Ze zijn in T1 gedefinieerd en toegekend, maar niet bedraad. Zouden ze aan een
  // bestaande rol hangen, dan zou de latere bedrading (T2 / deskresearch-ticket)
  // het gedrag van die rol wijzigen — en dat is de nulgrens G23.
  for (const [rol, caps] of Object.entries(ROL_CAPABILITIES)) {
    const heeft =
      (caps as string[]).includes("ai.deskresearch") ||
      (caps as string[]).includes("ai.stukvoorbereiding");
    assert.equal(heeft, rol === "bestuursbureau", `${rol} en de ai.*-bureaucapabilities`);
  }
});

test("BB-4 — de twee AI-capabilities zijn server-side bedraad (T2/T4)", () => {
  // De pure mapping verhuisde na T1 naar capabilities-map.ts. De twee
  // capabilities zijn inmiddels bewust bedraad: stukvoorbereiding en live
  // deskresearch moeten beide in de serverroute op de sessierol worden getoetst.
  const capsBestand = lees("core", "lib", "capabilities-map.ts");
  assert.ok(capsBestand.includes("ai.deskresearch"), "capability moet gedefinieerd zijn");
  assert.ok(capsBestand.includes("ai.stukvoorbereiding"), "capability moet gedefinieerd zijn");

  const chatRoute = lees("app", "api", "chat", "route.ts");
  assert.match(
    chatRoute,
    /rolHeeftCapability\([\s\S]{0,180}?"ai\.stukvoorbereiding"/,
    "stukvoorbereiding mist de server-side capability-gate"
  );
  assert.match(
    chatRoute,
    /rolHeeftCapability\([\s\S]{0,180}?"ai\.deskresearch"/,
    "deskresearch mist de server-side capability-gate"
  );
});

// ── (2) NULGRENS G23 — de drie bestaande rollen zijn ongewijzigd ───────────

test("BB-5 — nulgrens: de capability-sets van bestuurder/voorzitter/beheerder zijn gepind", () => {
  // Letterlijk gepind. Wijzigt er één, dan is dat per definitie een doorbraak van
  // de nulgrens en faalt deze test luid in plaats van stil.
  assert.deepEqual([...ROL_CAPABILITIES.beheerder].sort(), [
    "catalog.manage",
    "classification.review",
    "documents.bronstatus.change",
    "documents.metadata.update",
    "documents.status.change",
    "dossiers.manage",
    "fonds.config.manage",
    "klantbeeld.view",
    "metadata.review",
    "notulen.segment.confirm",
    "organisation.profile.manage",
    "profile.manage.own",
    "stuurinformatie.manage",
    "stuurinformatie.view",
  ]);
  assert.deepEqual([...ROL_CAPABILITIES.voorzitter].sort(), [
    "classification.review",
    "documents.bronstatus.change",
    "documents.metadata.update",
    "documents.status.change",
    "dossiers.manage",
    "fonds.config.manage",
    "klantbeeld.view",
    "metadata.review",
    "notulen.segment.confirm",
    "profile.manage.own",
    "stuurinformatie.manage",
    "stuurinformatie.view",
  ]);
  assert.deepEqual([...ROL_CAPABILITIES.bestuurder].sort(), [
    "documents.bronstatus.change",
    "documents.metadata.update",
    "documents.status.change",
    "klantbeeld.view",
    "profile.manage.own",
    "stuurinformatie.view",
  ]);
});

test("BB-6 — nulgrens: de bureau-gate raakt de bestaande rollen niet", () => {
  for (const rol of ["bestuurder", "voorzitter", "beheerder", "auditor", null, undefined]) {
    assert.equal(isBureauRol(rol), false, `${rol} mag niet als bureau gelden`);
  }
  assert.equal(isBureauRol(BUREAU_ROL), true);
});

test("BB-7 — nulgrens: het stemrecht-/quorumfilter is ongewijzigd", () => {
  // Quorum en stemgerechtigdheid worden geteld met `rol in ('bestuurder','voorzitter')`.
  // Het bureau valt daar vanzelf buiten — precies de bedoeling — maar dat mag
  // niet betekenen dat het filter zélf is aangepast, want dan zou het quorum voor
  // de bestaande rollen verschuiven.
  const sluiten = lees("app", "api", "stemmingen", "[id]", "sluiten", "route.ts");
  assert.match(
    sluiten,
    /\.in\("rol",\s*\["bestuurder",\s*"voorzitter"\]\)/,
    "de quorumtelling moet ongewijzigd op bestuurder+voorzitter filteren"
  );
  assert.ok(
    !sluiten.includes('"bestuursbureau"]'),
    "bestuursbureau mag niet aan het quorumfilter zijn toegevoegd"
  );

  const stemmen = lees("app", "api", "stemmingen", "[id]", "stemmen", "route.ts");
  assert.match(
    stemmen,
    /\["bestuurder",\s*"voorzitter"\]\.includes/,
    "de volmachtvalidatie moet ongewijzigd op bestuurder+voorzitter filteren"
  );
});

// ── (3) Rolkeuze in het gebruikersbeheer (FR-1) ────────────────────────────

test("BB-8 — bestuursbureau is selecteerbaar in /platform/gebruikers", () => {
  assert.ok(TENANT_ROLLEN.includes("bestuursbureau"), "rol ontbreekt in TENANT_ROLLEN");
  assert.ok(isTenantRol("bestuursbureau"));
  assert.equal(ROL_LABEL.bestuursbureau, "Bestuursbureau");
  // Elke rol in de whitelist heeft een label — anders toont de dropdown `undefined`.
  for (const r of TENANT_ROLLEN) {
    assert.ok(ROL_LABEL[r], `label ontbreekt voor ${r}`);
  }
});

test("BB-9 — de rol wordt via het bestaande service-role-pad gezet, niet via de trigger", () => {
  // maak_profiel() zet `rol` bewust niet (default 'bestuurder'); het platform-
  // scherm doet daarna een service-role-update. Dat pad blijft ongewijzigd —
  // zou de trigger de rol gaan zetten, dan omzeilt onboarding de bevriezing.
  const acties = lees(
    "app",
    "(platform)",
    "platform",
    "(beveiligd)",
    "gebruikers",
    "acties.ts"
  );
  assert.match(acties, /if \(rol !== "bestuurder"\)/);
  const migratie = lees("supabase", "migrations", "2026_08_05_bestuursbureau_rol.sql");
  assert.ok(
    !migratie.includes("create or replace function public.maak_profiel"),
    "de bureau-migratie mag maak_profiel() niet aanpassen"
  );
});

// ── (4) Module-zichtbaarheid (§5.5) ────────────────────────────────────────

test("BB-10 — beheer-, governance- en assurance-modules zijn onzichtbaar voor het bureau", () => {
  // De sidebar filtert op strikte gelijkheid: `!item.rolVereist || item.rolVereist === rol`.
  // Beide modules dragen rolVereist 'beheerder' en vallen daarmee vanzelf weg —
  // §5.5 vraagt hier dus GEEN codewijziging. Deze test legt dat vast, zodat een
  // latere versoepeling van rolVereist niet ongemerkt de modules opent.
  const zichtbaar = (rol: string) =>
    alleModules()
      .filter((m) => !m.rolVereist || m.rolVereist === rol)
      .map((m) => m.key);

  const bureau = zichtbaar("bestuursbureau");
  assert.ok(!bureau.includes("beheer"), "Catalogus & organen mag niet zichtbaar zijn");
  assert.ok(!bureau.includes("governance"), "Governance Log mag niet zichtbaar zijn");
  assert.ok(!bureau.includes("assurance"), "Kwaliteitsborging AI is beheerder-only");

  // En de kernmodules die §5.5 wél toekent:
  const kern = [
    "home",
    "ai",
    "bibliotheek",
    "vergaderingen",
    "notulen",
    "procedures",
    "risicomatrix",
    "stuurinformatie",
    "klantbeeld",
  ] as const;
  for (const key of kern) {
    assert.ok(bureau.includes(key), `${key} hoort zichtbaar te zijn voor het bureau`);
  }
});

test("BB-11 — nulgrens: de rolVereist-waarden zelf zijn ongewijzigd", () => {
  assert.equal(MODULE_REGISTRY.beheer.rolVereist, "beheerder");
  assert.equal(MODULE_REGISTRY.governance.rolVereist, "beheerder");
  assert.equal(MODULE_REGISTRY.assurance.rolVereist, "beheerder");
  // Geen enkele module mag een bureau-specifieke rolgate krijgen: rolVereist is
  // UI-cosmetica en nooit de autorisatielaag (module-registry kopregel).
  for (const m of alleModules()) {
    assert.notEqual(m.rolVereist, "bestuursbureau", `${m.key} gebruikt rolVereist als autorisatie`);
  }
});

// ── (5) Elke afwezige knop dekt een server-side weigering (FR-2, FR-7, FR-21) ─

const SCHRIJFROUTES: { pad: string[]; wat: string }[] = [
  { pad: ["app", "api", "inbreng", "route.ts"], wat: "inbreng plaatsen" },
  { pad: ["app", "api", "stemmingen", "route.ts"], wat: "stemronde openen" },
  { pad: ["app", "api", "stemmingen", "[id]", "stemmen", "route.ts"], wat: "stem uitbrengen" },
  { pad: ["app", "api", "stemmingen", "[id]", "sluiten", "route.ts"], wat: "stemronde sluiten" },
  { pad: ["app", "api", "stemmingen", "[id]", "intrekken", "route.ts"], wat: "stemronde intrekken" },
  { pad: ["app", "api", "decisions", "[id]", "dissent", "route.ts"], wat: "dissent vastleggen" },
  { pad: ["app", "api", "decisions", "[id]", "dissent", "[did]", "route.ts"], wat: "dissent wijzigen/intrekken" },
  { pad: ["app", "api", "inbreng", "[id]", "route.ts"], wat: "inbreng verwijderen" },
];

test("BB-12 — elke bestuurlijke schrijfroute weigert het bureau server-side met 403", () => {
  for (const { pad, wat } of SCHRIJFROUTES) {
    const bron = lees(...pad);
    assert.ok(
      bron.includes("isBureauRol("),
      `${pad.join("/")} (${wat}) mist de bureau-gate`
    );
    assert.match(
      bron,
      /isBureauRol\([\s\S]{0,120}?\)\s*\)\s*\{[\s\S]{0,200}?status:\s*403/,
      `${pad.join("/")} (${wat}) weigert niet met 403`
    );
    assert.ok(
      bron.includes("BUREAU_WEIGERING"),
      `${pad.join("/")} (${wat}) gebruikt geen gedeelde weigeringsmelding`
    );
  }
});

test("BB-13 — de UI-gating dekt exact dezelfde handelingen", () => {
  const kaart = lees("app", "(dashboard)", "vergaderingen", "_components", "AgendapuntKaart.tsx");
  assert.ok(kaart.includes("isBureauRol(huidigeRol)"), "AgendapuntKaart leidt isBureau niet af");
  assert.match(kaart, /magStemmingStarten\s*=\s*!isBureau/, "stemronde starten niet afgeschermd");
  assert.ok(kaart.includes("magStemmen={!isBureau}"), "stemmen niet afgeschermd");

  const blok = lees("app", "(dashboard)", "vergaderingen", "_components", "StemrondeBlok.tsx");
  assert.ok(blok.includes("magStemmen"), "StemrondeBlok kent geen magStemmen-prop");

  const paneel = lees("app", "(dashboard)", "procedures", "_components", "DissentPaneel.tsx");
  assert.ok(paneel.includes("currentUserIsBureau"), "DissentPaneel kent geen bureau-prop");
});

// FR-4/G9 is in T1 NIET gehaald: `stemmingen.uitslag` draagt een bevroren
// `per_stemgerechtigde[]` met naam, keuze en motivering, en die tabel is voor het
// bureau bewust leesbaar. Deze test pint de twee klasse-D-mitigaties die er wél
// zijn, zodat ze niet stilletjes verdwijnen vóór de structurele fix (OP-T1-7).
// Hij bewijst NIET dat het gat dicht is — dat kan hij ook niet, want de jsonb
// blijft via PostgREST leesbaar.
test("BB-24 — het per-persoonsblok van de uitslag is voor het bureau afgeschermd (klasse D, OP-T1-7)", () => {
  const blok = lees("app", "(dashboard)", "vergaderingen", "_components", "StemrondeBlok.tsx");
  assert.match(
    blok,
    /\{magStemmen && uitslag\.per_stemgerechtigde\.length > 0 && \(/,
    "het per-persoonsblok in de gesloten-uitslagweergave mist de magStemmen-gate"
  );
  assert.match(
    blok,
    /<StemUitslagWeergave[\s\S]{0,200}?magStemmen=\{magStemmen\}/,
    "StemUitslagWeergave krijgt magStemmen niet doorgegeven"
  );

  const dossier = lees("app", "api", "decisions", "[id]", "auditdossier", "route.ts");
  assert.ok(
    dossier.includes("isBureauRol("),
    "de auditdossier-export rendert per_stemgerechtigde en mist de bureau-gate"
  );
  assert.match(dossier, /isBureauRol\([\s\S]{0,120}?\)\s*\)\s*\{[\s\S]{0,300}?status:\s*403/);
});

test("BB-14 — het inbrengpaneel toont een expliciete melding, geen lege lijst (FR-6)", () => {
  const kaart = lees("app", "(dashboard)", "vergaderingen", "_components", "AgendapuntKaart.tsx");
  assert.ok(
    kaart.includes(
      "Inbreng van bestuursleden is niet zichtbaar voor het bestuursbureau."
    ),
    "de voorgeschreven melding uit ontwerp §5.5 ontbreekt"
  );
  // De lijst en het formulier mogen niet voor het bureau renderen.
  assert.ok(kaart.includes("{!isBureau && punt.inbreng.length > 0 && ("), "inbrenglijst niet afgeschermd");
  // En de teller mag geen "0 inbrengen" tonen — dat zou juist verzwijgen.
  assert.ok(kaart.includes('"inbreng afgeschermd"'), "de samenvattingsregel toont een misleidende telling");

  // Zelfde eis op de vergaderstatistiek: `totaalInbreng` is voor deze rol altijd 0.
  const pagina = lees("app", "(dashboard)", "vergaderingen", "[id]", "page.tsx");
  assert.match(
    pagina,
    /label="Inbreng vooraf"[\s\S]{0,160}?isBureauRol\(huidigeRol\)\s*\?\s*"afgeschermd"/,
    'de statistiek "Inbreng vooraf" toont voor het bureau een misleidende 0'
  );
});

test("BB-15 — de motiveringseis bij agendapuntwijziging is fail-safe voor het bureau", () => {
  // De telling van bijdragen loopt over de RLS-client en levert voor het bureau
  // altijd 0. Zonder fail-safe zou de motiveringsplicht — een governancecontrole
  // met notificatie aan de bijdragers — precies voor die rol stil verdwijnen.
  const route = lees("app", "api", "agendapunten", "[id]", "route.ts");
  assert.match(route, /if \(isBureauRol\(profiel\?\.rol\)\) motiveringVereist = true;/);
});

// ── (6) Startpunt (§6.6, FR-7a) ────────────────────────────────────────────

test("BB-16 — de portaalcontext kiest per rol de juiste maatstaf", () => {
  const bron = lees("core", "lib", "portaalcontext.ts");
  assert.ok(bron.includes("isBureauRol("), "portaalcontext leidt de bureau-stand niet af");
  assert.ok(bron.includes("telZonderGekoppeldStuk("), "de bureau-variant ontbreekt");
  // De privacy-single-lock uit de bestaande suite moet blijven staan.
  assert.match(
    bron,
    /from\("agendapunt_inbreng"\)[\s\S]*?\.eq\("gebruiker_id",\s*userId\)/,
    "de eigen-inbreng-telling mag niet zijn ontkoppeld van gebruiker_id"
  );
});

test("BB-17 — de twee Startpunt-maatstaven vervuilen elkaars velden niet", () => {
  const inbreng = telEigenInbreng([{ id: "a1", titel: "X" }], []);
  assert.equal(inbreng.maatstaf, "eigen_inbreng");
  assert.equal(inbreng.zonderEigenInbreng, 1);
  assert.equal(inbreng.zonderGekoppeldStuk, 0);

  const stuk = telZonderGekoppeldStuk([{ id: "a1", titel: "X" }], []);
  assert.equal(stuk.maatstaf, "gekoppeld_stuk");
  assert.equal(stuk.zonderGekoppeldStuk, 1);
  assert.equal(stuk.zonderEigenInbreng, 0);
});

// Deze test pint de AANROEPKETEN, niet de module. BB-16 controleert dat
// portaalcontext.ts de bureau-tak kent; dat zegt niets over de call-sites. Precies
// daar ging het mis: app/api/chat/route.ts gaf `rol` niet mee, waardoor de
// afleiding terugviel op de bestuurdersmaatstaf en de assistent tegen een
// bureaugebruiker over "uw eigen inbreng" sprak — de misleiding die §6.6 wegneemt.
// `rol` is bewust optioneel (bestaande call-sites blijven werken), dus de compiler
// vangt dit niet; deze test doet dat wel.
test("BB-22 — elke getPortaalContext-aanroep mét input geeft de rol mee", () => {
  const CALLSITES: string[][] = [
    ["app", "api", "chat", "route.ts"],
    ["app", "(dashboard)", "page.tsx"],
  ];
  for (const pad of CALLSITES) {
    const bron = lees(...pad);
    const aanroep = bron.match(/getPortaalContext\(\{[\s\S]*?\}\)/);
    assert.ok(aanroep, `${pad.join("/")} heeft geen getPortaalContext-aanroep met input`);
    assert.match(
      aanroep[0],
      /\brol:/,
      `${pad.join("/")} geeft geen rol mee aan getPortaalContext — de bureau-maatstaf is daar niet bedraad`
    );
  }

  // De no-arg variant (app/(dashboard)/ai/page.tsx) leidt de rol zelf af via
  // haalFondsSessie(); die hoeft niets mee te geven en is daarom niet in de lijst.
  const aiPagina = lees("app", "(dashboard)", "ai", "page.tsx");
  assert.match(aiPagina, /getPortaalContext\(\)/);
});

test("BB-18 — de promptregel volgt de maatstaf (geen 'uw eigen inbreng' voor het bureau)", () => {
  const bron = lees("core", "lib", "portaalstand-blok.ts");
  assert.ok(bron.includes('ap.maatstaf === "gekoppeld_stuk"'), "geen maatstaf-tak in het standblok");
  assert.ok(bron.includes("Agendapunten zonder gekoppeld stuk"), "bureau-variant van de regel ontbreekt");
  // Nulgrens: de bestaande regel blijft letterlijk staan.
  assert.ok(bron.includes("Agendapunten zonder uw eigen inbreng"), "de bestuurdersregel is gewijzigd");
});

// ── (7) De RLS-afscherming staat in een migratie, niet alleen in schema.sql ──

test("BB-19 — elf policies dragen de rol-uitsluiting in de migratie", () => {
  // schema.sql is documentatie en mag achterlopen; de migratie is authoritatief.
  // Deze test toetst de REPO, niet de database — het DB-bewijs staat in
  // supabase/checks/2026_08_05_bb_rolgrenzen.sql en draait onder échte RLS.
  const m = lees("supabase", "migrations", "2026_08_05_bestuursbureau_rol.sql");
  const policies = [
    "fonds inbreng lezen",
    "eigen inbreng schrijven",
    "eigen inbreng wijzigen",
    "eigen inbreng verwijderen",
    "fonds stem select",
    "fonds stem insert",
    "fonds stem update",
    "fonds stem delete",
    "fonds stemmingen insert",
    "fonds stemmingen update",
    "dissent zichtbaarheid write",
  ];
  for (const p of policies) {
    assert.ok(m.includes(`create policy "${p}"`), `policy "${p}" ontbreekt in de migratie`);
  }
  // De uitslag blijft leesbaar (FR-4): de SELECT-policy op stemmingen wordt niet aangeraakt.
  assert.ok(
    !m.includes('create policy "fonds stemmingen select"'),
    "de leespolicy op stemmingen mag niet worden gewijzigd — de uitslag blijft zichtbaar"
  );
  // En de dissent-SELECT evenmin (§5.4).
  assert.ok(
    !m.includes('create policy "dissent zichtbaarheid select"'),
    "de dissent-leespolicy mag niet worden gewijzigd"
  );
});

test("BB-20 — het predicaat is NULL-veilig (`is distinct from`, niet `<>`)", () => {
  // Met `<>` levert een profiel met rol IS NULL de waarde NULL op → rij
  // onzichtbaar → gedragswijziging voor een BESTAANDE gebruiker. `profielen.rol`
  // is nullable, dus dat is een reëel scenario en een doorbraak van de nulgrens.
  const m = lees("supabase", "migrations", "2026_08_05_bestuursbureau_rol.sql");
  // Alleen de SQL zelf toetsen: de kop citeert de `<>`-vorm uit ontwerp §5.4 om
  // uit te leggen waaróm die hier niet gebruikt wordt.
  const sql = m
    .split("\n")
    .filter((r) => !r.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(
    !/<>\s*'bestuursbureau'/.test(sql),
    "gebruik `is distinct from 'bestuursbureau'`, niet `<> 'bestuursbureau'`"
  );
  const treffers = m.match(/is distinct from 'bestuursbureau'/g) ?? [];
  assert.ok(
    treffers.length >= 11,
    `verwacht minstens 11 rol-uitsluitingen, gevonden ${treffers.length}`
  );
});

// Deze test bestaat door schade. De eerste versie van de checksuite ving in elke
// lektest `when others then … raise notice 'OK …'`, met een guard die de eigen
// melding zou doorlaten: `if sqlstate='P0001' and sqlerrm like 'LEK:%'`. Maar de
// meldingen luiden `LEK (FR-7): …` — mét spatie en haakjes — en matchen dus NIET
// op `LEK:%`. Gevolg: vijf lektests slikten hun eigen lek-exception en rapporteerden
// "OK". Een suite die niet rood kán worden bewijst niets, en dat is precies de
// faalmodus die CLAUDE.md met "toets de uitkomst in de database" adresseert.
test("BB-23 — geen enkele lektest in de DB-suite kan een lek als OK rapporteren", () => {
  const suite = lees("supabase", "checks", "2026_08_05_bb_rolgrenzen.sql");

  // Geen `when others`-tak mag nog een OK melden: die vangt zowel de eigen
  // LEK-exception als schemadrift (kolomhernoeming, NOT NULL, typefout in de seed).
  const regels = suite.split("\n");
  for (let i = 0; i < regels.length; i++) {
    if (regels[i].trim() !== "when others then") continue;
    const staart = regels
      .slice(i + 1, i + 4)
      .join("\n");
    assert.ok(
      !/raise notice\s+'OK/.test(staart),
      `regel ${i + 1}: een \`when others\`-tak meldt OK — die maakt een lek onzichtbaar`
    );
  }

  // En de guard die niet werkte mag niet terugkeren.
  assert.ok(
    !suite.includes("sqlerrm like 'LEK:%'"),
    "de LEK-prefixguard matcht niet op de meldingen 'LEK (…): …' en hoort niet terug te komen"
  );

  // Elke lek-raise hoort herkenbaar te zijn aan het LEK-voorvoegsel.
  const lekRaises = suite.match(/raise exception\s+'LEK/g) ?? [];
  assert.ok(lekRaises.length >= 10, `verwacht ≥10 lektests, gevonden ${lekRaises.length}`);
});

test("BB-21 — er is een ROLLBACK, en die weigert bij bestaande bureau-profielen", () => {
  const r = lees("supabase", "migrations", "2026_08_05_bestuursbureau_rol_ROLLBACK.sql");
  assert.ok(r.includes("ROLLBACK GEWEIGERD"), "de rollback heeft geen voorportaal");
  assert.ok(
    !r.includes("is distinct from 'bestuursbureau'"),
    "de rollback moet de rol-uitsluiting juist verwijderen"
  );
});
