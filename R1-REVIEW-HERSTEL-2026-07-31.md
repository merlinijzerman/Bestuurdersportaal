# R1 — Herstel van de codebevindingen uit de integrale review

**Branch:** `fix/review-code-findings` (afgetakt van `main` @ `151afe9`)
**Datum:** 31 juli 2026
**Bron:** integrale code-, architectuur- en securityreview van 30 juli 2026
**Status:** wijzigingen staan **uncommitted** op de branch — bedoeld om eerst door te lopen.

Deze ronde dekt uitsluitend de **codebevindingen**. De procedurele en operationele
maatregelen (branch protection, omgevingsscheiding, migratierunner, Sentry,
back-up/restore, pentest) staan bewust open tot er een getekend contract is.

---

## 1. Wat is er gewijzigd, per bevinding

### Kritiek

| ID | Bevinding | Aanpak | Bestanden |
|---|---|---|---|
| **K-01** | `decision_dissent`: RLS-policy zonder tenantgrens — elke voorzitter/beheerder van elk fonds kon dissent van álle fondsen lezen, wijzigen, verwijderen en injecteren | Beide policies herschreven met een fondsclausule via `decision_objects`; de strengere zichtbaarheidsregel per dissenttype blijft daar bovenop gelden | `supabase/migrations/2026_07_31_r1_rls_tenantgrenzen.sql` |

### Hoog

| ID | Bevinding | Aanpak | Bestanden |
|---|---|---|---|
| **H-01** | `notificaties`: ontvanger niet aan het fonds gebonden | SELECT én INSERT fondsgebonden; ontvangercheck via de nieuwe `SECURITY DEFINER`-helper `fn_zelfde_fonds` (nodig omdat `profielen` eigen-rij-only leesbaar is en een subquery in een policy onder díe RLS draait) | migratie |
| **H-02** | `document_inzage` / `document_metadata_log`: INSERT zonder fonds- of documentbinding → vervalsbaar auditlog | Beide policies binden nu actor + document + fonds. `fonds_id = null` blijft toegestaan, maar uitsluitend voor een aantoonbaar generiek document — daarmee vervalt de route waarlangs een rij bij álle fondsen zichtbaar werd | migratie |
| **H-03** | Open redirect in `/auth/callback` (`@evil.com`, `.evil.com` kapen de host) | Nieuwe pure module `veiligVervolgpad`: alleen relatieve paden, fail-safe terug naar `/`. Elf sanity-tests, inclusief de host-verificatie met de WHATWG-parser | `core/lib/redirect-veilig.ts` (+ sanity), `app/auth/callback/route.ts` |
| **H-07** | Tenant-uploadroute omzeilde `valideerUpload()`; geen groottelimiet, magic bytes, naamsanitisatie, dedup of decompressiecap | `bestand-validatie.ts` verhuisd van `platform/lib` naar `core/lib` (puur, hoort niet in de service-role-laag) en aangeroepen op de tenantroute. Toegevoegd: groottecheck vóór inlezen (413), decompressiebudget tegen zip bombs, dedup op inhoudshash (409), veilige bestandsnaam in de database | `core/lib/bestand-validatie.ts`, `app/api/documents/upload/route.ts` |
| **H-08** | Gedeactiveerd document bleef downloadbaar | `actief`-controle vóór de download; 410 met een expliciete melding | `app/api/documents/[id]/bestand/route.ts` |
| **H-09** | Chunk-inserts faalden stil; her-indexering was niet atomair | Beide pipelines fail-closed: bij een insertfout opruimen, status op `mislukt`/gedeactiveerd, expliciete fout naar de gebruiker. Her-extract vervangt nu pas ná de dure stappen en zet `geindexeerd=false` tijdens de vervanging | `app/api/documents/upload/route.ts`, `app/api/documents/[id]/her-extract/route.ts`, `platform/lib/generiek-pipeline.ts` |
| **H-10** | Documentinhoud werd niet als onbetrouwbare data behandeld; contextopbouw escapete niets | (a) Nieuw promptblok `SP_BRON_VERTROUWEN` op élke modus met bronnen; (b) elke bron in een `<bron s="…">`-blok met een per-request onvoorspelbare sentinel; (c) neutralisatie van bronlabel-patronen en scheidingslijnen in chunktekst, geteld in `retrieval_meta.context_geneutraliseerd` | `core/lib/bron-afbakening.ts` (nieuw), `core/lib/rag.ts`, `core/lib/generatie-kern.ts`, `app/api/chat/route.ts`, `platform/lib/aqlab/generate-adapter.ts` |
| **H-11** | Injectieketen upload → `samenvatting_ai` → agendavoorbereiding als `[Bron N]` | Samenvatting wordt gevalideerd tegen het JSON-schema (niet-conform = niet opslaan, i.p.v. rauwe tekst bewaren); documenttekst gaat afgebakend en als data naar de samenvatter; in de voorbereiding heet het nu `[Samenvatting AI]` en telt het niet meer als genummerde bron | `app/api/documents/upload/route.ts`, `app/api/agendapunten/[id]/voorbereiding/route.ts` |
| **H-12** | Geen inputbegrenzing op `/api/chat`; historie client-gestuurd; rate-limit fail-open | Nieuwe pure module `valideerChatInvoer`: vorm van élke beurt, caps per beurt (8.000), totaal (60.000) en aantal beurten (60), met 400/413. Historie-hash + tekenaantal in `retrieval_meta`. Rate-limit fail-closed voor kostendragende routes | `core/lib/chat-invoer.ts` (+ sanity), `app/api/chat/route.ts`, `core/lib/rate-limit.ts` |
| **H-13** | `quarantaine_pad` prefix-check omzeilbaar met `..` (service-role-download) | Strikte regex `^generiek/<uuid>.<ext>$`, centraal als `QUARANTAINE_PAD_PATROON` | `platform/lib/generiek-pipeline.ts`, `app/(platform)/.../generieke-bibliotheek/acties.ts` |
| **H-15** | Service-role-leespaden buiten de auditwrapper | Nieuwe `withPlatformRead()`: identiteit + `actief` + live AAL2 + capability + result-event met aantallen (nooit inhoud). Toegepast op contact-inbox, gebruikersbeheer, organisatieprofiel, rechtenregister en de aqlab-auditdownload | `platform/lib/platform-wrapper.ts` + 5 aanroepplekken |

### Middel

| ID | Aanpak |
|---|---|
| **M-01** | `agendapunt_inbreng`: INSERT joint nu naar `vergaderingen.fonds_id` |
| **M-02** | `documenten select` en `chunks select` eisen `auth.uid() is not null` (generieke bibliotheek niet meer leesbaar met de kale anon-key) |
| **M-04** | `search_path` gepind op `maak_profiel` en vier functies die `pg_temp` misten; CI-gate erop |
| **M-06** | Rate limiting op `zoeken`, `her-extract`, beide backfills, `segmenteer` en `bulk-metadata`; de vijf kostendragende varianten fail-closed |
| **M-13** | `errorResponse()` in `decisions/[id]/dossier`, `procedures/[id]/dossier` en `instellingen` — geen `e.message` meer naar de client |

### Laag

`L-02` timing-safe `CRON_SECRET` · `L-03` `esc()` op de twee ongeëscapete interpolaties in de auditdossier-HTML · `L-04` `isVeiligeUrl`-rendergate in `OnderbouwingPaneel` · `L-05` `user!` vervangen in twee server-pagina's · `L-06` NUL-byte in `document-extractie.ts` geëscaped (bestand is weer tekst voor grep/`file`) · `L-07` bestandsnaam via `logNaam()` in serverlogs.

Aanvullend meegenomen: de inzage-log in de downloadroute logt zijn eigen fout nu wél (het commentaar beloofde dat, de code deed het niet).

### Observatie

`O-01` `fondsen` alleen leesbaar voor ingelogde gebruikers.

---

## 2. Regressiepreventie: nieuwe CI-gates

De eigenlijke oorzaak van K-01 was niet de policy zelf maar de **gate**: de T3-controle
toetste of een schrijfpolicy een `WITH CHECK` *heeft*, niet of het predikaat een
tenantgrens *bevat*. Zonder aanvullende gate herhaalt dit zich bij de volgende tabel.

**`supabase/checks/2026_07_31_r1_structurele_gates.sql`** — vijf gates, geen seed nodig (op D na):

| Gate | Wat het afdwingt |
|---|---|
| A1 | Elke tabel met RLS zonder eigen `fonds_id` staat in het register óf in de expliciete globale lijst. Een nieuwe tabel dwingt dus een bewuste keuze af |
| A2 | Elke policy op een parent-afgeleide tabel noemt de parenttabel in `USING` én `WITH CHECK` — dit maakt K-01 en M-01 permanent onmogelijk |
| B | Geen tenant-blinde policy op een tabel met `fonds_id` (vangt `using (true)` en OR-takken zonder binding) |
| C | Geen `USING (true)` op een tenanttabel |
| D | De rol `anon` ziet nul rijen in `documenten`, `document_chunks` en `fondsen` — mét seed, zodat de test niet vacuüm slaagt |
| E | Elke `SECURITY DEFINER`-functie in `public` heeft een gepind `search_path` |

**`supabase/checks/2026_07_31_r1_tenantgrenzen.sql`** — gedragsbewijs voor de vijf herstelde
tabellen: twee fondsen, drie gebruikers (inclusief een voorzitter, de rol die K-01
exploiteerbaar maakte), tien negatieve controles en vier positieve regressiecontroles.

Beide zijn opgenomen in `scripts/cross-tenant-ci.sh`, samen met
`2026_06_20g_retrieval_filtering.sql` — die stond buiten CI terwijl hij de breedste
dekking heeft op vervallen en verwijderde bronnen.

---

## 3. Uitgevoerde verificatie

| Controle | Uitkomst |
|---|---|
| `tsc --noEmit --skipLibCheck` | **groen** |
| `npm run lint:boundaries` | **groen** |
| `bash scripts/check-service-role-leak.sh` | **groen** |
| `npm run lint:colors` | **groen** |
| `redirect-veilig.sanity.ts` | **11 tests groen** |
| `chat-invoer.sanity.ts` (incl. bron-neutralisatie) | **17 tests groen** |
| `bestand-validatie.sanity.ts` | **niet gedraaid** — vereist `jszip`; draait mee in de volledige sanity-run |
| `tests/cross-tenant/*.test.ts` | **niet gedraaid** — zie hieronder |
| SQL-checks (R1-gates + gedrag) | **niet gedraaid** — vereist een test-database |

De laatste drie konden niet in deze omgeving draaien: `node_modules` is op macOS
geïnstalleerd, dus de meegeleverde `esbuild` is `darwin-arm64` terwijl de
werkomgeving Linux is. `tsx` weigert daardoor te starten. Dat is een
omgevingsartefact, geen codeprobleem — op jouw Mac en in CI (Linux, verse `npm ci`)
draaien ze normaal.

**Draai daarom zelf, vóór je commit:**

```bash
cd mvp
npm run sanity                                   # 66 suites, incl. de drie nieuwe
node --import tsx --test tests/cross-tenant/*.test.ts
npm run build                                    # de enige gate die ik niet kon draaien
TEST_DATABASE_URL='postgresql://…' bash scripts/cross-tenant-ci.sh
```

Let op: `npm run sanity` is fail-fast en `generatie-kern.sanity.ts` stond al rood op
`main` (verouderde prompt-byte-hash-pin, bekend). **Die pin verschuift door deze
wijziging sowieso** — `SP_BRON_VERTROUWEN` verandert de statische instructies. Pin
opnieuw of de-pin hem; dat is geen regressie maar een bewuste promptwijziging.

---

## 4. Wat je handmatig moet doen

1. **Migratie draaien.** `supabase/migrations/2026_07_31_r1_rls_tenantgrenzen.sql` in de
   Supabase SQL-editor. Idempotent; rollback ligt ernaast. Leg vast wanneer en door wie —
   er is nog geen migratietracker.
2. **Verificatiequery's** onderaan de migratie draaien (drie stuks; alle drie horen 0 rijen
   te geven).
3. **Storage-policy handmatig.** De derde `generiek`-leestak zit op `storage.objects` en
   staat buiten de migraties. Voeg daar in het dashboard dezelfde `auth.uid() is not null`
   toe aan de policy `documenten storage lezen`.
4. **`ANTHROPIC_API_KEY` roteren** en `git log --all -- .env.vercel-now` draaien. Dat stond
   nog open uit de review en kost tien minuten.
5. **Opruimen:** `mvp/_to_delete/r1-review-fixes.patch`, `mvp/_to_delete/r1-verplaatst/`
   (de oude `platform/lib/bestand-validatie*`) en `mvp/_to_delete/stale-git-locks/`. Ik kan
   op jouw schijf niet verwijderen, alleen verplaatsen.

---

## 5. Bewuste keuzes en aandachtspunten

**Gedragswijzigingen die je moet kennen:**

- **Uploads worden strenger geweigerd.** Boven 25 MB → 413. Magic-bytes-mismatch → 400.
  Zip bomb → 413 `decompressie_cap`. Een tweede upload van hetzelfde bestand binnen het
  fonds → 409 met een verwijzing naar het bestaande document. Dat laatste is nieuw gedrag
  dat gebruikers kunnen opmerken.
- **Een mislukte indexering leidt nu tot een foutmelding** in plaats van een stil
  half-verwerkt document. Bij een instabiele verbinding zul je dus vaker een expliciete
  fout zien — dat is de bedoeling.
- **Chat weigert extreem lange invoer.** 8.000 tekens per beurt, 60.000 per gesprek. Als
  bestuurders gewend zijn hele documenten in het vraagveld te plakken, merken ze dit.
- **Rate limiting is fail-closed op zes routes.** Bij een DB-storing in de teller krijgen
  gebruikers een 429 op chat/zoeken in plaats van doorgang. Bewust: dat is de enige rem op
  de modelkosten.
- **De promptset is gewijzigd** (`SP_BRON_VERTROUWEN` + `<bron>`-afbakening). Draai een
  AQLab-run vóór productie; de bronvermelding en de "niet aangetroffen"-formuleringen zijn
  de gevoeligste punten.
- **De agendavoorbereiding nummert alleen nog bibliotheekbronnen.** Gekoppelde stukken
  verschijnen als `[Samenvatting AI]` en staan niet meer in de bronlijst van dat bericht.

**Bewust níet gedaan:**

- **Vier van de negen service-role-leespaden** (de AQLab-consolepagina's:
  `aqlab/page.tsx`, `dashboard`, `promoveren`, `runs/[runId]`) lopen nog buiten
  `withPlatformRead`. Die lezen productbrede, synthetische evaluatiedata zonder
  persoonsgegevens — laagste prioriteit binnen H-15. Het patroon staat klaar.
- **`notifyByRole` blijft stilzwijgend niets doen.** Doordat `profielen` eigen-rij-only
  leesbaar is, levert de query in `core/lib/notifications.ts` hooguit de eigen rij op:
  notificaties bij stemronde-events en AI-validatie bereiken dus niemand. Dat is
  security-technisch juist goed, maar functioneel kapot. Ik heb het bewust niet
  meegenomen — het is een functionele wijziging, geen securityfix. De helper
  `fn_zelfde_fonds` is er nu wel; een `SECURITY DEFINER`-RPC die alleen id's van
  fondsgenoten met een bepaalde rol teruggeeft, is het logische vervolg. **Beslispunt.**
- **Alle P0/P1-maatregelen uit `REMEDIATION_PLAN.md` die procedureel zijn** — conform
  afspraak tot na contractondertekening.

**Eén ding om te weten over de branch:** je open werk in `HANDOVER.md`,
`decisions/0094`, `decisions/README.md` en het nieuwe `decisions/0095` is met
`git switch -c` meegereisd naar deze branch. Dat is standaard git-gedrag; commit die
apart of zet ze terug op `main`.
