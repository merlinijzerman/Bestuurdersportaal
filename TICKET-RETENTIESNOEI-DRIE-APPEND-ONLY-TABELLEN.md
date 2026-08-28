# Retentiesnoei voor drie append-only tabellen — één mechanisme (lost R-24 op)

| | |
|---|---|
| **Type** | Gedragsveranderend — nieuwe service-role-baan + per-tabel termijn |
| **Prioriteit** | P1 voor `platform_event_log` (deblokkeert #183b spoor M) · P2 voor de andere twee |
| **Lost op** | **R-24** (`governance_log_inhoud` zonder retentie) — dit ís dat ticket |
| **Bouwt voort op** | [`GOVERNANCE-LOG-RETENTIE-ONTWERP.md`](GOVERNANCE-LOG-RETENTIE-ONTWERP.md) (auditskelet vs inhoudslaag) · 0191 §4 · 0189 |
| **Spoor** | W · deblokkeert #183b spoor M |

> **Waarom dit ticket bestaat.** Drie append-only tabellen groeien onbegrensd.
> Drie losse snoeibanen bouwen is hoe je er twee krijgt die werken en één die
> stil niet draait — en dat is nú al het geval (§2). Eén mechanisme, drie
> tabellen, per tabel een termijn met een gemotiveerd doel.

---

## 1. De tabellen

| Tabel | Snoeifunctie | Geplande baan | Retentie afgedwongen? |
|---|---|---|---|
| `platform_signal_snapshots` | `snapshot`-route `.delete().lt(...)` | Vercel-cron (`*/5`) | **ja** — het te kopiëren patroon |
| `platform_event_log` | — | — | **nee** — geen functie, geen baan |
| `governance_log_inhoud` | — | — | **nee** (R-24) — ontwerp bestaat, code niet |
| `handelingen_log` | `fn_handelingen_snoei()` bestaat | **geen** | **nee** — functie zonder aanroeper |

De eerste rij is geen probleem maar het **bewijs**: het snoeipatroon dat de
andere drie missen, draait al zichtbaar in een cronroute (§5a).

## 2. De scherpste bevinding: de "opgeloste" tabel draait niet

`handelingen_log` lijkt geregeld — 0191 §4 belooft een "service-role-snoeibaan",
en `fn_handelingen_snoei()` (delete `where tijdstip < now() - interval '90 days'`,
achter `fn_handelingen_retentie_guard`) **bestaat** met `EXECUTE` voor
`service_role`. Maar **niets roept hem aan**:

- geen `pg_cron`-schedule (nergens in `supabase/**`),
- geen Vercel-cron-route (`vercel.json` kent alleen aqlab/ingest/afschrift/snapshot),
- de enige verwijzingen buiten de migratie zijn de grant-allowlist en de rollback.

Dit is precies de "stil niet draait"-modus, en erger dan simpel ontbreken: de
tabel oogt geregeld (guard + functie + grant), dus niemand kijkt ernaar terwijl
hij net zo hard doorgroeit als de andere twee. **Het bewijs dat retentie draait
is niet "de functie bestaat" maar "de baan heeft gedraaid en rijen verwijderd."**

## 3. Waarom dit #183b spoor M blokkeert

`platform_event_log` serialiseert alle appends via
`pg_advisory_xact_lock('platform_event_log_chain')` + `SELECT … FOR UPDATE` op de
singleton `platform_event_chain_state` (migratie `2026_08_15_platform_event_chain_head.sql`).
Dat is **veilig** — geen fork mogelijk — maar het **restrisico is wachttijd bij
volume**, en dat volume is precies wat #183b spoor M erbij zet. Vier crons
(`aqlab`, `ingest`, `afschrift` elke minuut; `snapshot` per 5 min) op een
serialiserende, retentieloze tabel is de verkeerde combinatie. Daarom is de
volumeregel (§4) én deze snoeibaan een **voorwaarde** voor spoor M, niet een
losse verbetering.

## 4. Expliciete regel: outcome-gescopet schrijven

**Een run die niets deed, schrijft niets.** Liveness is de taak van `healthz`,
niet van het auditspoor. De verleiding om "voor de zekerheid elke run te loggen"
is groot en op een serialiserende, retentieloze tabel precies verkeerd:
`aqlab`-worker draait elke minuut → een write per lege poll is ~1440
rijen/dag/worker, permanent. `logResultGegarandeerd` is idempotent op
`correlatie_id`, dus één result-event per run-die-iets-deed is goed te doen.

Leg deze regel vast bij de #183b spoor-M-writes: schrijf `platform_event_log`
alleen bij een daadwerkelijke uitkomst, niet bij een lege queue.

## 5. Eén mechanisme

Eén service-role-snoeibaan die per tabel een eigen snoeifunctie aanroept met een
per-tabel termijn. Elke snoei is een **geautoriseerde, geregistreerde
onderhoudsactie** — géén stille mutatie (conform het ontwerpprincipe in
`GOVERNANCE-LOG-RETENTIE-ONTWERP.md` §3): de append-only guardrail blijft
overeind, retentie raakt de inhouds-/operationele laag, niet het auditskelet.

- **`handelingen_log`** → `fn_handelingen_snoei()` bestaat al; alleen de baan
  ontbreekt. Termijn 90 dagen (al vastgelegd, 0191).
- **`platform_event_log`** → snoeifunctie + guard bouwen naar hetzelfde model
  (`fn_handelingen_retentie_guard` als sjabloon). Termijn: DPO/compliance-besluit.
- **`governance_log_inhoud`** → de inhoudslaag uit
  `GOVERNANCE-LOG-RETENTIE-ONTWERP.md`. **Besluit 2 (werkbesluit, §5b):**
  **skelet permanent, inhoud crypto-shred.**

### 5a. Besluit 1 — baan-drager: één snoeiroute op het bestaande cronpatroon (niet `pg_cron`)
**Herzien besluit.** De eerste afweging koos `pg_cron` met als argument "geen
achtste route aan het gedeelde `CRON_SECRET`". Dat argument **vervalt** zodra je
het snoeien in het **bestaande** cronpatroon doet in plaats van een nieuwe route
te introduceren — dan komt er nul route bij.

**Meetbaar precedent:** `platform/monitoring/snapshot` doet **nu al** een
werkende retentiesnoei — `.from(tabel).delete().lt("tijdstip", grens)` (regel
249), `directeMutaties: ["delete"]` — in een Vercel-cronroute, achter
`CRON_SECRET`, zichtbaar in het declaratieregister, al onder de poorten. Het
patroon bestaat, het draait, en het staat op de plek waar je het kunt zien.
Dat lost het zwaarste bezwaar tegen `pg_cron` — onzichtbaarheid — **beter** op
dan een migratie dat doet.

**Besluit (bevestigd 2026-08-27): een EIGEN snoeiroute op het bestaande cronpatroon
— niet `pg_cron`, en niet meeliftend op `snapshot`.** Eén snoeibaan over de tabellen
`platform_event_log`, `handelingen_log`, `governance_log_inhoud` (`platform_signal_snapshots`
doet `snapshot` al). **Waarom een eigen route en niet in `snapshot`:** (1) valt de
monitoringcron om, dan stopt de retentie **stilzwijgend** mee; (2) `snapshot` is óók
de gatdetector — je zou het bewaken en het bewaakte in één job stoppen. Het cronpatroon
zelf (Vercel-cron achter `CRON_SECRET`, zichtbaar in het register, achter de poorten)
is bewezen door `snapshot`; alleen niet dié job.

> **Prijs, expliciet: dit is een achtste consument van het gedeelde `CRON_SECRET`.**
> Dat is niet gratis, en het is de **derde** keer dat R-06 (secretrotatie) zich meldt
> zonder te zijn uitgevoerd. **Voer R-06 uit** — een uur, hoogste openstaande severity;
> de lijst wordt alleen langer. `pg_cron` blijft de terugval alleen als een expliciete
> reden het cronpatroon uitsluit (extensiebeschikbaarheid dan vaststellen — VEN-4 telde
> nul jobs, wat niets zegt over of het kan).

> `pg_cron` blijft de terugval **alleen** als een expliciete reden het
> cronpatroon uitsluit; dan is de `pg_cron`-extensiebeschikbaarheid op dit
> Supabase-project vast te stellen (VEN-4 telde nul jobs — dat zegt niets over
> of de extensie *kan*). Bij Vercel-cron-uitbreiding blijft **R-06 (rotatie van
> het gedeelde secret)** de staande zorg, maar hij blokkeert niet, want er komt
> geen route bij.

### 5b. Besluit 2 — `governance_log_inhoud`: skelet permanent, inhoud PURGE (gemeten)
> Geen juridisch advies — dit is een compliancebeslissing. Het getal deblokkeert de
> bouw; de privacyfunctie bevestigt het vóór fonds 1. Vastgelegd dát het een
> werkhypothese was — stilzwijgend een termijn in code zetten en later "beleid"
> noemen is niet verdedigbaar.

**Meting (2026-08-27, conclusief):** `governance_log_inhoud` is **plaintext** —
`vraag`/`antwoord` (`text`), `bronnen`/`retrieval_meta_inhoud` (`jsonb`); geen `bytea`,
geen `pgcrypto`/encrypt-schrijfpad. **Gevolg: crypto-shred is hier geen retentiekeuze
maar een bouwproject** (het vereist een periode-/record-sleutel om weg te gooien, en
die is er niet). De reële optie is dus **purge** (de inhoudsvelden legen/verwijderen);
anonimiseren valt af (bij vrije tekst nooit 100% betrouwbaar).

**De spanning.** Voedde een AI-interactie een bestuurlijk besluit, dan is de inhoud
onderdeel van "hoe is dit besluit tot stand gekomen". Korte termijn vernietigt bewijs;
lange termijn bewaart persoonsgegevens te lang. Beide fout.

**Werkbesluit (werkhypothese):**
- **Skelet permanent** — dát er een interactie was, door wie, wanneer, met welke hash
  (`governance_log`). De keten blijft intact ongeacht wat er met de inhoud gebeurt.
- **Inhoud na 12 maanden onleesbaar via PURGE** (crypto-shred zodra er ooit
  versleuteling ís; tot dan purge). Twaalf maanden = één volledige verantwoordingscyclus
  plus marge; geschillen over een bestuursbesluit komen binnen die periode boven.
- **Herzieningstrigger bij onboarding fonds 1** — dan pas ken je het bewaarbeleid van
  het fonds zelf, en dát is leidend.

**Ontwerpimplicatie (nu goed doen):** leg de termijn vast als **configuratiewaarde,
niet als constante in een functiebody.** Fondsen krijgen verschillende termijnen,
en een termijn wijzigen hoort een **configuratiewijziging met auditspoor** te zijn,
geen migratie. Bij één fonds triviaal; bij drie een verbouwing.

## 6. Bewaking — toets de uitkomst, niet de baan

**Het belangrijkste ontwerpdetail.** Een controle op "draaide de job?" is te
foppen door een job die draait en niets doet (of de verkeerde rijen selecteert).
Toets in plaats daarvan **de uitkomst, per tabel**:

> bestaan er rijen ouder dan `<termijn> + marge`? → **rood**

Dat werkt onafhankelijk van de drager-keuze, vangt zowel een stilgevallen baan
als een baan die de verkeerde rijen selecteert, en is één query per tabel. Voor
crypto-shred is de uitkomsttoets navenant: bestaat er nog **leesbare** inhoud
ouder dan termijn+marge? → rood.

**Aansluiten, niet los laten hangen.** Zet de check in **dezelfde CI-gateset als
de cross-tenant-suites** (`scripts/cross-tenant-ci.sh`), zodat hij niet apart kan
worden vergeten — precies wat er met de `fondsleden`-suite (C-01) en
`g2-evidence.sh` wél gebeurde: geschreven, niet aangesloten, dus draaide niet.

## 7. Acceptatiecriteria

- [ ] Eén snoeibaan op het **bestaande cronpatroon** (snapshot-route of één
      toegewijde Vercel-cronroute), vier tabellen, **nul** nieuw aanvalsoppervlak
      (§5a). `pg_cron` alleen als een expliciete reden het cronpatroon uitsluit.
- [ ] `handelingen_log`: `fn_handelingen_snoei()` wordt aantoonbaar aangeroepen
      door de baan; een run verwijdert verlopen rijen (aantoonbaar, niet beweerd).
- [ ] `platform_event_log`: snoeifunctie + guard + termijn; append-only-guardrail
      blijft (UPDATE/DELETE-buiten-snoei faalt nog steeds — P5-check groen).
- [ ] `governance_log_inhoud`: crypto-shred aangesloten (skelet permanent);
      termijn als **configuratiewaarde** (niet constante), met herzieningstrigger
      bij onboarding fonds 1 (§5b).
- [ ] Outcome-gescopet-schrijven (§4) vastgelegd als regel voor #183b spoor M.
- [ ] Bewaking (§6): **uitkomsttoets per tabel** (rijen/inhoud ouder dan
      termijn+marge → rood), **aangesloten in `scripts/cross-tenant-ci.sh`**.
- [ ] `handelingen_log`-retentiebaan opgenomen als **derde vlagvoorwaarde** in
      0191 §7 (voorwaarde 5c) — `ENFORCE_AUDIT=on` pas als alle drie waar zijn.

## 8. Definition of done

Alle drie de tabellen hebben een retentiebaan die **aantoonbaar heeft gedraaid**
(rijen verwijderd of inhoud onleesbaar gemaakt binnen termijn), de append-only
guardrail is intact, en de **uitkomsttoets** in de cross-tenant-gateset maakt een
stilgevallen of verkeerd-selecterende baan rood. Daarmee is R-24 gesloten, is de
90-dagen-belofte van 0191 §4 daadwerkelijk in werking, en is #183b spoor M niet
langer een groeirisico.
