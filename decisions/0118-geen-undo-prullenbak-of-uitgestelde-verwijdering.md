# 0118 — Geen undo-periode, prullenbak of uitgestelde verwijdering

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, IB

## Context

De gebruikelijke reflex bij een destructieve actie is een prullenbak of een undo-venster van dertig dagen. Bij een reflectiegesprek werkt die reflex averechts: de bestuurder verwijdert juist omdat hij niet wil dat de tekst nog ergens staat. Een prullenbak betekent dat de tekst er wél nog staat, alleen onzichtbaar — en dat is precies wat het oude "archiveren" al deed en wat we aan het repareren zijn.

## Besluit

Verwijderen is onmiddellijk en definitief. Geen prullenbak, geen undo, geen uitgestelde opruiming. In plaats daarvan een bevestigdialoog die vóór de actie expliciet benoemt wat verdwijnt en wat blijft.

## Overwogen alternatieven

- **Undo-venster van 30 dagen** — verworpen: houdt de inhoud in stand terwijl de gebruiker denkt dat hij weg is. Vergroot bovendien het aanvalsoppervlak en compliceert betrokkenenverzoeken.
- **Zachte verwijdering met automatische opruiming** — dezelfde bezwaren, plus een achtergrondproces dat kan uitvallen zonder dat iemand het merkt.
- **Bevestiging in twee stappen (typ de titel over)** — overwogen; te zwaar voor een privégesprek en het verhoogt vooral de irritatie, niet de zorgvuldigheid.

## Gevolgen

- **Gebruikerservaring:** de dialoog moet het werk doen. Hij benoemt vier dingen expliciet — de actieve omgeving, het auditspoor, de back-uptermijn en al gepubliceerde inbreng — en staat op één plek (`core/lib/gesprek-verwijderen.ts`) zodat beide chatingangen hetzelfde beloven.
- **Openstaand:** de feitelijke back-uptermijn is in deze repo nergens vastgelegd. De constante `BACKUP_TERMIJN_DAGEN` staat daarom bewust op `null` en de tekst spreekt van "totdat ze volgens het back-upbeleid vervallen". Een getal invullen dat we niet kunnen onderbouwen zou schijnzekerheid geven over precies datgene wat de dialoog eerlijk moet maken.
- **Back-ups blijven een beperking:** wat de gebruiker verwijdert kan nog in platform-back-ups zitten. Dat wordt gezegd, niet weggelaten.

## Referenties

- `core/lib/gesprek-verwijderen.ts`
- `app/(dashboard)/ai/_components/AssistentClient.tsx`, `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx`
- [[0116]], [[0117]]
