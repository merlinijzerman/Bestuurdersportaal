# Conflict- en afhankelijkhedenkaart — M365 fase 4 #367–#370

**Peildatum:** 11 september 2026
**Startregel:** ieder ticket werkt in een eigen worktree en branch, na de documentatie-PR opnieuw
gebaseerd op de dan actuele `origin/preview`. Elk ticket begint met planreview; productiecode wordt
pas daarna gewijzigd.

## Afhankelijkheden

| Ticket | Zelfstandig startbaar | Afhankelijk van | Mergevoorwaarde |
|---|---|---|---|
| #367 · T2-3 versie-identiteit | Ja | Actueel providerneutraal retrievalcontract | Eerst mergen; publiceert het versie-/correlatiecontract voor de andere tranches |
| #369 · T2-2 zoeken/vergelijken | Ja | Actuele orkestratie uit T2-1 | Voor merge rebasen op #367; geen route- of scoperegressie |
| #370 · T2-5 Microsoftstub | Ja, hermetisch | Actueel adaptercontract; consumeert versiecontract uit #367 | Voor merge rebasen op #367 en contractlekkage opnieuw toetsen |
| #368 · T2-4 evidence/context | Alleen inventarisatie en karakterisering volledig zelfstandig | Definitieve wiring gebruikt #367 en volgt de consumentenombouw uit #369 | Implementatie/wiring als laatste; chunksVoor-brug pas verwijderen als census nul goedgekeurde consumenten toont |

## Verwachte overlap en conflictrisico

| Combinatie | Risico | Waarschijnlijk raakvlak | Coördinatiemaatregel |
|---|---|---|---|
| #367 ↔ #370 | Hoog | `core/lib/retrieval`-typen, capabilities, bewijsfixtures en contracttests | #367-contract eerst vastzetten; #370 daarna rebasen en alleen adapter-/fixturegedrag toevoegen |
| #367 ↔ #368 | Middel | Versievelden in evidence/context en correlation-id in audit | T2-4-inventaris kan parallel; typed wiring pas op het gemergde #367-contract |
| #369 ↔ #368 | Hoog | `/zoeken`, `/vergelijk`, directe retrieval/evidence-call-sites en grensgates | Eén actuele census delen; #369 migreert routes, #368 verwijdert pas daarna resterende directe lezingen |
| #369 ↔ #370 | Laag–middel | Orkestratiecontract en foutnormalisatie | Geen Microsoftspecifieke typen in routes; hermetische stub blijft buiten productiewiring |
| #368 ↔ #370 | Middel | Niet-retrieval contextcontract versus adapterresultaten/fixtures | Contractgrens expliciet houden; geen testfixture als productiecontextbron gebruiken |

## Uitvoering en mergevolgorde

1. Na merge van de documentatie-PR: `git fetch origin --prune` en per schone ticketworktree de
   branch op de nieuwe `origin/preview` baseren.
2. Parallelle planreviews en inventarisaties voor alle vier; #368 stopt na karakterisering zolang
   #367/#369 niet stabiel zijn.
3. Voorkeursvolgorde voor integratie: **#367 → #369 → #370 → #368**.
4. Na iedere merge: origin verversen, resterende branches rebasen, overlapmatrix en census opnieuw
   controleren.
5. Iedere PR afzonderlijk door volledige gates/build en Preview-waarneming; geen gecombineerde
   productiepromotie zonder nieuw releasebesluit.

## Bestaande geïsoleerde werkplekken

| Ticket | Worktree | Branch | Huidige toestand vóór docs-PR |
|---|---|---|---|
| #367 | `mvp-367-versie-identiteit` | `feat/367-versie-identiteit` | schoon, maar nog op oudere Preview-basis `1b70bf2` |
| #368 | `mvp-368-evidencelezingen` | `feat/368-evidencelezingen` | schoon, maar nog op oudere Preview-basis `1b70bf2` |
| #369 | `mvp-369-zoeken-vergelijken` | `feat/369-t2-2-zoeken-vergelijken` | schoon, maar nog op oudere Preview-basis `1b70bf2` |
| #370 | `mvp-370-microsoft-stub` | `feat/370-microsoft-adapterstub` | schoon, maar nog op oudere Preview-basis `1b70bf2` |

Deze branches worden niet vooruitgezet en er start geen implementatie voordat de
documentatie-PR is gemerged en `origin/preview` opnieuw is vastgesteld.
