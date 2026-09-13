# Conflict- en afhankelijkhedenkaart — M365 fase 4 #367–#370

**Peildatum:** 13 september 2026
**Status:** uitgevoerd; de kaart blijft als as-run afhankelijkheden- en conflictbewijs behouden.
Ieder ticket werkte vanuit een eigen worktree en branch op de toen actuele `origin/preview`.

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

1. Na het openen van de documentatie-PR zijn `origin` en de vier schone ticketworktrees ververst;
   startbasis voor alle vier is `origin/preview` op `4a61b7851747`.
2. Parallelle planreviews en inventarisaties voor alle vier; #368 stopt na karakterisering zolang
   #367/#369 niet stabiel zijn.
3. Voorkeursvolgorde voor integratie: **#367 → #369 → #370 → #368**.
4. Na iedere merge: origin verversen, resterende branches rebasen, overlapmatrix en census opnieuw
   controleren.
5. Iedere PR afzonderlijk door volledige gates/build en Preview-waarneming; geen gecombineerde
   productiepromotie zonder nieuw releasebesluit.

## Werkelijk integratieresultaat

| Stap | PR | Preview-mergecommit | Uitkomst |
|---|---:|---|---|
| #367 · versie-identiteit | #379 | `9d9b4ca` | Eerst geïntegreerd; contract en correlatie beschikbaar voor vervolg |
| #369 · zoeken/vergelijken | #381 | `3521a40` | Na #367 geïntegreerd; routes gebruiken centrale orkestratie |
| #370 · Microsoftstub | #380 | `afd0efb` | Hermetisch geïntegreerd; geen Graph- of productiewiring |
| #368 · karakterisering | #378 | `50c54ed` | Census en gedrag vóór implementatie vastgezet |
| #368 · implementatie | #382 | `ca57f5c` | Als laatste geïntegreerd; evidence- en modelcontextgrenzen gesloten |

Er trad geen onopgelost integratieconflict op. De vooraf geïdentificeerde hoge overlap tussen
#367/#370 en #369/#368 is beheerst door de mergevolgorde, rebase/reconciliatie en herhaalde census-
en contracttests. De actuele gecombineerde Preview-basis is `ca57f5c`; `main` blijft `09d473f`.
Issues #367–#370 staan op GitHub nog open en worden pas na het afzonderlijke productie-/releasebesluit
administratief gesloten.

## Bestaande geïsoleerde werkplekken

| Ticket | Worktree | Branch | Starttoestand na openen docs-PR |
|---|---|---|---|
| #367 | `mvp-367-versie-identiteit` | `feat/367-versie-identiteit` | schoon op `4a61b7851747` |
| #368 | `mvp-368-evidencelezingen` | `feat/368-evidencelezingen` | schoon op `4a61b7851747`; eerst inventarisatie/karakterisering |
| #369 | `mvp-369-zoeken-vergelijken` | `feat/369-t2-2-zoeken-vergelijken` | schoon op `4a61b7851747` |
| #370 | `mvp-370-microsoft-stub` | `feat/370-microsoft-adapterstub` | schoon op `4a61b7851747`; hermetisch, geen live wiring |

De oorspronkelijke documentatie-PR #377 en alle vijf implementatie-/karakteriserings-PR's zijn na
afzonderlijk akkoord gemerged. De nieuwe acceptatie-/promotiedocumentatie-PR blijft ongemergd tot
nieuw opdrachtgeverakkoord; daarna kan uitsluitend `preview` zelf als bron voor een PR naar
`main` worden gebruikt.
