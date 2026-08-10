# 0156 — Opsteller-register (TOON_BLOK_OPSTELLER) bij opsteltaken

- **Status:** Geaccepteerd
- **Datum:** 2026-08-10
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering)

## Context

Vraagt een bestuurder "stel een memo op" / "schrijf een notitie", dan schreef het model in het standaard gesprekspartner-register (TOON_BLOK) de opdrachtgever aan ín het document ("uw signaal is terecht", "goede vraag"). Dat hoort in een gesprek, niet in een stuk. Randvoorwaarden: de sha256-gepinde toon-systeemprompt (nulgrens G23) moet byte-identiek blijven voor élke bestaande vraag; anders dan de bureau-stand mag deze correctie géén bevoegdheid ontsluiten.

## Besluit

Een additief toonblok `TOON_BLOK_OPSTELLER` (opsteller-register + anti-affirmatie) komt óver TOON_BLOK heen wanneer de route een opsteltaak detecteert (`opstelToon=true` in `bouwStatischeInstructies`/`bouwSysteemBlokken`). Het stuk richt zich tot de beoogde lezer (het bestuur), begint met de probleemstelling en bevat geen validatie van de opdracht. Detectie via `isOpsteltaak()` — bewust streng: zowel een producerend werkwoord (opstellen/schrijf/formuleer/"stel..op"/"maak..<doc>") ALS een documentsoort (memo/notitie/oplegger/brief/nota/concept/voorstel/bestuursstuk/agendastuk) moeten aanwezig zijn. Precedentie: bureau > opsteller > sparring/duiding.

## Overwogen alternatieven

- **TOON_BLOK zelf aanpassen** — verworpen: dat breekt de nulgrens G23 (byte-identiek voor alle bestaande vragen) en zou de gesprekstoon voor gewone vragen veranderen. Een additief blok laat élke andere vraag ongemoeid.
- **Register via de bureau-stand ontsluiten** — verworpen: de bureau-stand is capability-gated en ontsluit bevoegdheid; een opsteltaak is een gewone bestuurdersvraag die alleen een andere toon vraagt, geen andere rechten.
- **Detectie op alleen een werkwoord of alleen een documentsoort** — verworpen: "wat staat er in de notitie?" (vraag óver een stuk) zou dan vals vuren. De ÉN-eis houdt dat buiten schot.

## Gevolgen

- **Geen migratie, geen datamodel-/RLS-/capability-wijziging.** Zuiver prompt-/toonlaag.
- **Nulgrens G23 intact:** `TOON_BLOK_OPSTELLER` is gepind in `core/lib/generatie-kern.sanity.ts`; TOON_BLOK blijft byte-identiek.
- **Gedrag:** een expliciete opsteltaak levert een document in bestuurlijk register (geen affirmaties aan de opdrachtgever, begint met de kernboodschap); een voorstel mag, maar als voorstel ter besluitvorming, nooit als reeds genomen besluit en nooit namens het bestuur.
- **Openstaand (technische schuld):** het transformatie-/lens-pad (bestuurlijke duiding, herschrijven) kent nog geen anti-affirmatie-regel; als aparte post geparkeerd.
- **Verificatie:** `generatie-kern.sanity.ts` (+ toonblok-pin), `vraagtype.sanity.ts` (isOpsteltaak); `tsc --noEmit` groen.

## Referenties

- Code: `core/lib/generatie-kern.ts` (`TOON_BLOK_OPSTELLER`, `opstelToon`), `core/lib/vraagtype.ts` (`isOpsteltaak`), `app/api/chat/route.ts` (route-bedrading). Commit `0a5a4be` (2026-08-10, `main`).
- Sanity: `generatie-kern`, `vraagtype`.
- Eerdere besluiten: 0128/0129 (bureau-stand), 0130/0132 (nulgrens G23), 0091 (voorstelvraag).
