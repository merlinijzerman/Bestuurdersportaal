# 0137 — Bronkeuze antwoord-eerst: de verduidelijkingsvraag wordt niet-blokkerend en per fonds configureerbaar

- **Status:** Geaccepteerd (implementatie) — her-accordering compliance (FO §11a + meetset) vóór productie openstaand
- **Datum:** 2026-08-06
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude (analyse + uitvoering); Compliance (her-accordering — sign-off 0014 was 22-06-2026)

## Context

**Herziet [`0014`](./0014-increment-i2-automatische-bronkeuze.md)** (compliance-sign-off 22-06-2026).
Voorgeschiedenis: [`0070`](./0070-bronkeuze-plicht-patronen-en-meetset-uitbreiding.md)
(plicht-patronen + meetset), [`0090`](./0090-ai-contextbesef-persoonlijke-intentie-en-portaalstand.md)
(persoonlijk anker), [`0091`](./0091-expliciete-scopebepaling-en-voorstelvragen.md)
(meting 17/18) en [`0092`](./0092-terugvraag-wordt-gelogd-en-bewaard.md) (terugvraag
gelogd).

Bij een onzekere bron-intentie (geen fonds- of generiek-anker) stelde de assistent
eerst een **blokkerende** wedervraag: *"Wilt u dit weten voor uw fonds specifiek, of
in algemene zin?"* (0014, FO §11a). Bedoeld als waarborg tegen schijnzekerheid. In
de praktijk vuurt hij bij vrijwel elk portaalgebruik: `0091` mat dat **17 van de 18**
realistische portaalvragen (besluiten, agendapunten, notulen, stukken, risico's,
acties) in de twijfelbak vielen; de geaccordeerde meetset (54 vragen) bevatte **nul**
portaalobject-vragen, dus de drempel `maxTerugvraagFractie: 0.2` mat groen op een
niet-representatieve populatie.

Het inhoudelijke argument: een waarborg die bij circa 94% van de vragen vuurt, is geen
waarborg meer — hij traint de bestuurder om hem weg te klikken, precies op het moment
dat de fonds-versus-algemeen-keuze materieel verschil maakt. Deze wijziging verplaatst
de keuze van **vóór** naar **ná** het antwoord: de assistent antwoordt fondsgericht en
toont de twee keuzes als chips ónder het antwoord. Het principe uit `0014` blijft
overeind — de bestuurder ziet dat er een keuze is gemaakt en kan hem corrigeren — maar
de frictie verdwijnt. Bewust **niet** "de terugvraag uitzetten" (dat haalt de
correctiemogelijkheid weg); wél een derde, per fonds omkeerbare stand.

## Voorfase M0 (verplicht — bepaalt of en hoe gebouwd wordt)

- **M0.2 (beslissend) — GROEN.** Van 18 gereconstrueerde portaalobject-vragen viel
  **17/18 = 94%** in de twijfelbak (reproduceert `0091` exact). Van die twijfelbak-
  vragen is **1/17 = 5,9%** bedoeld níét-`fonds`; over de hele set 2/18 = 11,1%.
  **5,9% ≤ 10% → bouw zoals ontworpen.** Structurele reden: een portaalobject verwijst
  per definitie naar de eigen inhoud van dít fonds.
  **Caveat:** de exacte 18 vragen uit `0091` zijn niet in de repo vastgelegd; dit is een
  reproduceerbare reconstructie (script) met eigen labeling. Compliance bevestigt set +
  labels bij de her-accordering.
- **M0.1 (bewijsstuk compliance-gesprek) — UITGESTELD.** De werkelijke terugvraag-
  frequentie over 30 dagen productie-`governance_log` vergt DB-toegang met de
  service-role; op verzoek van de opdrachtgever uitgesteld tot vóór het compliance-
  gesprek (niet vóór de code). Belegd als openstaand punt (eigenaar: Merlin).

**Herverificatie dempende eigenschappen (alle drie kloppen):** (1) de onzekere
fallback is fondsgericht (`vraagtype.ts` `bepaalBronIntent`); (2) de intentie stuurt de
retrieval niet — `bronIntent` voedt uitsluitend `promptModus` (framing), het meta-event
en het auditspoor; de retrieval-filters en de web-gate draaien op
`bepaalBronsoortprofiel(vraag)` en `antwoordmodus`, nooit op intent (nieuwe sanity
`bronkeuze-modus.sanity.ts` (b) borgt dit); (3) de terugvraag wordt gelogd (`0092`).

## Besluit

**M-B1 — drieweg-configuratie i.p.v. aan/uit.** Nieuwe generieke flag
`bronkeuze_modus` (`fonds_feature_flags`, geen migratie):

| Waarde | Gedrag |
|---|---|
| `blokkerend` | **Default.** Huidig gedrag ongewijzigd — vroege return met het `verduidelijking`-event (0014/0092). |
| `antwoord_eerst` | De beurt loopt door met `{ intent: "fonds", vertrouwen: "onzeker" }`; de twee keuzes reizen mee als chip-aanbod in het `meta`-event, getoond ónder het antwoord. |
| `uit` | Geen wedervraag, geen chips — puur fondsgericht (vangnetstand). |

Onbekende/ongeldige/ontbrekende waarde ⇒ **`blokkerend`** (fail-safe naar het
geaccordeerde gedrag, nooit stil naar het nieuwe). Resolutie: fonds-flag → env-default
`BRONKEUZE_MODUS` → `blokkerend`. Pure resolutie in `fonds-config-core.ts`
(`resolveBronkeuzeModus`), programmatisch getoetst.

**M-B2 — de vroege return wordt conditioneel.** In `app/api/chat/route.ts` blijft de
blokkerende terugvraag alleen bij `bronkeuze_modus === "blokkerend"`. Alle bestaande
vangrails blijven gelden en zijn losgetrokken in `moetVerduidelijkenNu`
(scope/agendapunt/bureau → `bronIntentResultaat === null`; reflectie/transformatie/
verbreding; fondsrestrictie). Bij `antwoord_eerst` reizen `VERDUIDELIJKING_OPTIES` mee
als `bronkeuze_aanbod` in het `meta`-event; de antwoordregel krijgt
`retrieval_meta.bronkeuze_aanbod = true`. Er komt geen aparte terugvraag-logregel meer
in die stand (die tak draait niet).

**M-B3 — chips ónder het antwoord.** De client (`AssistentClient.tsx`) rendert het
aanbod ónder de antwoordbubbel met label **"Dit antwoord gaat uit van uw fonds — liever
in algemene zin?"**. Een klik hergenereert met `bron_intent_override` + vertrouwen
`zeker` (bestaand herstelpad) en **behoudt het eerste antwoord**. De bronbasis-melding
blijft staan náást de chips (geen schijnzekerheid). Agendapunt-modus kent deze stand
niet (intent-twijfel staat daar uit).

**M-B4 — portaalobject-patronen.** `FONDS_INTENT_PATRONEN` uitgebreid met
portaalobjecten (`besluit`, `agendapunt`, `notulen`, `vergadering`, `actiepunt`/`acties`,
`(bestuurs)voorstel`, `risicomatrix`, `jaarplan`) — bewust de OBJECT-woorden, geen kale
onderwerpwoorden. De meetset (`bronkeuze-meetset.ts`) van 54 → **72** met 18
portaalvragen. **Vergt her-accordering compliance vóór productie.**

**M-B5 — twee antwoorden, beide in het spoor.** Bij antwoord-eerst kan één vraag twee
antwoorden opleveren (het fondsgerichte, en na een chipklik het hergegenereerde). Beide
blijven volwaardige `governance_log`-regels (het eerste ís aan de bestuurder getoond en
kan zijn overgenomen). De tweede regel draagt `retrieval_meta.bronkeuze_herzien = true`
+ `bronkeuze_vorige_log_id` (het log-id uit het `done`-event van het eerste antwoord),
zodat bij een beroep op "de assistent zei…" navolgbaar is wélke van de twee is bedoeld
en in welke volgorde ze zijn getoond. Geen RPC-wijziging, geen migratie (jsonb).

## Besluitpunt 1 — drieweg, niet boolean

`uit` is de vangnetstand als `antwoord_eerst` in productie tegenvalt; `blokkerend` als
default betekent dat er niets verandert zolang de vlag niet expliciet is gezet. Eén
sleutel, per fonds omkeerbaar, in het config-auditspoor. Terugdraaien = één
configuratieregel.

## Besluitpunt 2 — de classifier blijft puur; de modus wordt in de route toegepast

`bepaalBronIntent` is functioneel ongewijzigd op de bestaande 54 meetsetvragen (op de
M-B4-patroonuitbreiding na). De modus wordt in de route toegepast, niet in de classifier
— anders breekt de geaccordeerde meetset-runner om de verkeerde reden. Geverifieerd: de
portaalpatronen veranderen **geen enkele** van de 54 bestaande uitkomsten.

## Besluitpunt 3 — "mag-terugvragen" materialiseert als de niet-blokkerende chip

Een tekstueel ambigue vraag (geen anker, geen object-woord) blijft `onzeker`. In
`blokkerend` is dat de terugvraag; in `antwoord_eerst` de chip ónder het antwoord. De
meetset labelt zulke vragen daarom nog steeds `mag-terugvragen` — het label betekent
"de assistent hoort de keuze te presenteren", niet "de assistent moet blokkeren".

## Overwogen alternatieven

- **Terugvraag uitzetten (`uit` als default).** Verworpen als default: haalt de
  correctiemogelijkheid weg. Behouden als per-fonds vangnetstand.
- **Onzekere fallback naar `algemeen`.** Verworpen — schendt de nul-tolerantie uit
  `0014` (`maxFondsAlsAlgemeen: 0` blijft hard).
- **Patronen i.p.v. antwoord-eerst.** `0091` stelt terecht dat scherpere patronen het
  probleem niet oplossen — argument tegen patronen *in plaats van*, niet *naast*.

## Gevolgen

- **Code:** `core/lib/fonds-config-core.ts` (`BronkeuzeModus`, `resolveBronkeuzeModus`,
  pure), `core/lib/fonds-config.ts` (`bronkeuzeModusVoorFonds`, async read),
  `app/api/chat/route.ts` (conditionele tak, `bronkeuze_aanbod` in meta,
  `bronkeuze_aanbod`/`bronkeuze_herzien`/`bronkeuze_vorige_log_id` in `retrieval_meta`),
  `app/(dashboard)/ai/_components/AssistentClient.tsx` (chips ónder het antwoord,
  `kiesBronkeuze`), `core/lib/vraagtype.ts` (`FONDS_INTENT_PATRONEN` +10 portaal-
  patronen), `core/lib/bronkeuze-meetset.ts` (55–72), `core/lib/bronkeuze-modus.sanity.ts`
  (nieuw, 34 checks).
- **Meetset-gating:** 72/72; fondsvraag→stil-'algemeen' **0**, foute zekere auto-keuze
  **0%**, terugvraag **15,3%** (was 16,7% op 54; beide onder de 19,6%-referentie uit
  0070), niet-stil-verkeerd **100%**. `bepaalBronIntent` ongewijzigd op de 54.
- **RLS/tenant-isolatie:** ongemoeid. `bronkeuze_modus` is een generieke
  `fonds_feature_flags`-flag onder bestaande RLS.
- **Audit:** additief in `governance_log.retrieval_meta` (jsonb) —
  `bronkeuze_aanbod`, `bronkeuze_herzien`, `bronkeuze_vorige_log_id`. Append-only
  ongemoeid, geen nieuw event-type, geen RPC-wijziging → **geen structurele gate
  vereist**.
- **Geen migratie, geen schema-/policy-wijziging.** `tsc --noEmit --skipLibCheck` exit
  0; `npm run sanity` volledig groen.
- **Default `blokkerend` — maar met één belangrijke nuance (M-B4).** Het *modus-
  mechanisme* (M-B1/M-B2/M-B3/M-B5) is default-off: zonder expliciete vlag blijft de
  route-tak op het geaccordeerde `blokkerend`-gedrag. **M-B4 is dat echter níet:** de
  portaalobject-patronen draaien in `bepaalBronIntent`, die onvoorwaardelijk wordt
  aangeroepen — ongeacht de vlag. Een portaalobject-vraag zonder ander anker ("Welke
  besluiten zijn genomen?") verschuift daardoor bij **elk** fonds van `fonds/onzeker`
  naar `fonds/zeker` zódra deze branch deployt: geen terugvraag én (want `zeker`) geen
  chip. De 0014-terugvraag-waarborg stopt voor dat cohort dus met vuren op **deploy**,
  niet pas bij een vlag-flip. Dit is bewust (M0.2 groen) en exact waarom de her-
  accordering **vóór deploy** moet — niet pas vóór de productie-vlag. Zie het scherpere
  openstaande punt hieronder en OP-C3.

## Openstaand

- **Her-accordering compliance** (FO §11a + meetset 55–72) vóór **deploy** — `0070`/`0091`.
  Dekt expliciet dat M-B4 de geaccordeerde `blokkerend`-waarborg **globaal** raakt (niet
  alleen de nieuwe modi): portaalobject-vragen krijgen na deploy geen terugvraag en geen
  chip meer, ook zonder vlag. Deploy is dus gegated op deze her-accordering (B10-lijn:
  bouwen/mergen mag vooruit, deploy wacht).
- **M0.1** (productie-terugvraagfrequentie) — bewijsstuk compliance-gesprek, eigenaar
  Merlin.
- **Restrisico antwoord-eerst** (~6%, M0.2): de bestuurder klikt de chip niet en neemt
  het fondsgerichte antwoord voor waar terwijl de vraag algemeen bedoeld was. Mitigatie:
  bronbasis-melding; monitor de chipklikfractie na livegang.
- **Chipklikfractie als signaal** — vrijwel nooit klikken is óf bewijs dat de
  fondsdefault klopt, óf dat de chip niet gezien wordt; die twee zijn niet uit elkaar te
  houden zonder aanvullende meting. Beoordelen na drie maanden.
- **`0092`-dubbele-beurten** krijgt met M-B5 een nieuwe variant; controleer dat de
  retentie-/exportlogica (`GOVERNANCE-LOG-RETENTIE-ONTWERP.md`) beide regels meeneemt.

## Referenties

- Code: zie Gevolgen.
- Besluiten: [`0014`](./0014-increment-i2-automatische-bronkeuze.md) (**dit besluit
  herziet** de blokkerende terugvraag), [`0070`](./0070-bronkeuze-plicht-patronen-en-meetset-uitbreiding.md),
  [`0090`](./0090-ai-contextbesef-persoonlijke-intentie-en-portaalstand.md),
  [`0091`](./0091-expliciete-scopebepaling-en-voorstelvragen.md),
  [`0092`](./0092-terugvraag-wordt-gelogd-en-bewaard.md).
- Ontwerp: `03 Functioneel ontwerp/…functioneel ontwerp v1.3.md` (§11a — de
  verduidelijking is niet langer per definitie blokkerend, maar configureerbaar per
  fonds met `blokkerend` als default).
