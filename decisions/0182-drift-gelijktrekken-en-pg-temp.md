# 0182 — Drift wordt weggenomen, niet uitgezonderd; en pg_temp hoort in elke SECDEF-search_path

- **Status:** Geaccepteerd (uitgevoerd)
- **Datum:** 2026-08-22
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitvoering)

## Context

De driftdetectie ([[0185]] voor het meldkanaal) meldde tien functies die verschilden tussen Productie en Preview. Zolang die delta bestond kon de nachtelijke cron niet aan: een bewaking die elke nacht rood begint, leest niemand meer. De cron aanzetten hing dus aan de vraag wat we met die tien doen.

Onderzoek liet zien dat **acht van de tien cosmetisch** waren. Met commentaar en witruimte weggehaald was de SQL letterlijk identiek; het verschil zat in commentaarregels en waar regels afbreken. Bij de drie `aqlab`-functies ging het zelfs alleen om de plaatsing van haakjes.

De twee echte verschillen zaten **allebei op Preview**, niet op Productie:

- `contact_notificatie_status` miste de D1-hardening (one-shot binnen een uur, `mail_error` gekapt op 500). Deze functie is met de anon-sleutel aanroepbaar.
- `fn_afschrift_bevries_kolommen` bevroor `ai_leeswijzer_tekst` niet, terwijl die kolom op Preview wél bestond.

Randvoorwaarden die meewogen: de bewaking moet scherp blijven (geen lijst die stil groeit), er is geen migratierunner dus alles wordt met de hand toegepast, en Productie mag niet zonder noodzaak worden aangeraakt.

## Besluit

**De acht cosmetische verschillen zijn weggenomen door de opgeslagen functietekst gelijk te trekken met de repo — niet door ze op een uitzonderingslijst te zetten.** Zeven functies zijn opnieuw uitgerold op Productie, één op Preview.

**Daarnaast is `pg_temp` als laatste entry toegevoegd aan de `search_path` van elke SECURITY-DEFINER-functie in `public`** (zeven functies), en is die stand in de repo vastgelegd via `2026_08_22_secdef_search_path_pg_temp.sql`.

## Overwogen alternatieven

- **Uitzonderingslijst in het driftscript** — afgewezen. Een lijst van bekende-en-aanvaarde verschillen moet onderhouden worden zodra één van de acht legitiem verandert, en een vergeten regel is niet te onderscheiden van een bewuste. Dezelfde redenering als bij `hostGuard: "route-eigen"`: een uitzondering hoort een waarde te zijn, maar dan wel een die je nodig hebt.
- **De meting normaliseren** (hashen op code met commentaar en witruimte weg) — afgewezen, hoewel aantrekkelijk. Het lost de ruis structureel op, maar maskeert ook witruimteverschillen *binnen tekstwaarden*, en dat zijn nu juist plekken waar een rolnaam of foutmelding kan wijzigen. De meting mag niet stiller worden dan het onderwerp.
- **Niets doen en de cron uit laten** — afgewezen. Dat maakt de bewaking permanent theoretisch, en dit is de derde keer dat een controle in deze codebase ontworpen bleek maar nooit aangesloten.

## Gevolgen

**De nachtelijke cron staat aan.** Beide signalen zijn groen gemeten vóór het aanzetten, en de eerste echte nachtrun (23-08-2026 04:28 UTC) is schoon. Daarmee is `[OPS] B9b` op DONE gegaan — automatisch, op grond van een wáárgenomen run, niet op grond van een aanwezige cronregel.

**Er is geen uitzonderingslijst ontstaan.** Elk toekomstig verschil is per definitie nieuw en verdient een blik.

**Een fout tijdens de uitvoering legde een ouder gat bloot, en dat is het belangrijkste gevolg.** `fn_rate_limit_check` opnieuw uitrollen vanuit `2026_06_10_rate_limiting.sql` maakte de functie op Productie zwakker: die migratie declareert `set search_path = public`, terwijl Productie `public, pg_temp` had — via handwerk dat nergens in de repo stond.

Staat `pg_temp` niet in de `search_path`, dan doorzoekt Postgres het tijdelijke schema juist als **eerste** voor relatie- en typenamen. Bij een SECURITY-DEFINER-functie is dat de shadowing-route: een aanroeper maakt `create temp table profielen (...)` en de functie leest die met de rechten van de eigenaar. Gemeten op Productie: `authenticated`, `anon` én PUBLIC hebben alle drie TEMP-rechten op de database, dus de voorwaarde is vervuld. Hoe makkelijk de route in de praktijk te lopen is hangt af van hergebruik van poolverbindingen.

De driftmeting ving dit **binnen één run**, en dat is precies waar signaal 2 (Productie versus Preview) voor bedoeld is. De losse `alter` is direct teruggedraaid.

Het onderliggende gat zat er al maanden: de repo bevatte de sterkere instelling nergens, dus elke herbouw uit de repo — inclusief de CI-testdatabase — leverde de zwakke variant. Zeven functies zijn nu gehard. De verificatie in de migratie is **breder dan de fix**: ze faalt op elke SECDEF-functie in `public` zonder `pg_temp`, en vond daardoor drie `platform_event`-functies die niet in de oorspronkelijke lijst stonden.

**Bewust geaccepteerd.** Er is een tweede versie van de migratie nodig geweest: de eerste zette botweg `search_path = public, pg_temp` en zou daarmee de betekenisvolle paden van drie functies (`pg_catalog, public`, en één met `extensions`) stil hebben gesloopt. De definitieve versie *voegt* `pg_temp` toe aan wat er staat. Dat onderscheid is in de migratie zelf vastgelegd, zodat het niet opnieuw fout gaat.

**Geen impact op RLS of tenant-isolatie.** Geen functiebody en geen data geraakt bij de hardening; alleen `proconfig`. Het gelijktrekken raakte functietekst maar geen gedrag — dat was vooraf en achteraf gemeten.

## Referenties

- Migratie `supabase/migrations/2026_08_22_secdef_search_path_pg_temp.sql` (+ ROLLBACK)
- `.github/workflows/drift-productie.yml` — cron aan, stap 4 afgerond
- `supabase/checks/drift-momentopname-verwacht.txt` — opnieuw gepind
- `scripts/g2-evidence.sh` — `[OPS] B9b`, DONE bij een waargenomen nachtrun
- Runs: `32575692781` (groen vóór aanzetten), `32576401776` (groen op `main`), `32617964246` (eerste nachtrun, schoon)
- Meldkanaal: [[0185]]
