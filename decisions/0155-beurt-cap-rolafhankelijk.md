# 0155 — Per-beurt tekenlimiet rol-afhankelijk (user vs. assistent)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-10
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering)

## Context

De invoervalidatie (`core/lib/chat-invoer.ts`, `valideerChatInvoer`) hanteerde één tekenlimiet van 8.000 per beurt, ongeacht rol. Die grens is een teken-cap en bedoeld als aanvalsoppervlak-rem (denial-of-wallet, prompt-injectie via geplakte tekst, H-12). De eigen output van het portaal is echter in tokens begrensd (`MAX_TOKENS_BESTUURLIJK = 8.000` tokens ≈ ~32.000 tekens). Een normaal, lang bureau-/memo-antwoord overschreed daardoor de 8.000-teken cap zodra het als historie terugkwam bij een vervolgvraag — met de melding "upload een document", die de gebruiker ten onrechte de schuld gaf en de vervolgvraag blokkeerde. Aanleiding: de partnerbegrip-memo (door de assistent zelf gegenereerd) → doodlopende vervolgvraag "Kunt u de impact-uitvraag concreet maken?".

## Besluit

De per-beurt cap staat rol-afhankelijk. User-beurten houden de krappe cap `MAX_BEURT_TEKENS = 8.000` (aanvalsoppervlak, met de bestaande "upload een document"-melding en foutcode `beurt_te_lang`); assistent-beurten in de historie krijgen `MAX_ASSISTANT_BEURT_TEKENS = 40.000` met een eigen, niet-verwijtende melding en nieuwe foutcode `antwoord_te_lang` ("Dit gesprek bevat een eerder antwoord dat te lang is om op voort te bouwen. Start een nieuw gesprek."). `MAX_HISTORIE_TEKENS = 60.000` (som over alle beurten) is bewust ongewijzigd.

## Overwogen alternatieven

- **De user-cap simpelweg verhogen naar 40.000** — verworpen: dat verzwakt het werkelijke aanvalsoppervlak (geplakte tekst) terwijl het probleem in de assistent-historie zit. Rol-splitsing houdt de user-kant krap.
- **De historiegrens (60.000) meteen meeschalen** — bewust níét gedaan: één lange memo + vervolgvraag past ruim binnen 60.000; pas bij meerdere lange memo's in één gesprek raakt dit. Als eerstvolgende kalibratiepost én kostenrem geparkeerd (technische schuld).
- **De cap voor assistent-beurten laten vallen** — verworpen: een overschrijding boven 40.000 is abnormaal (ruim boven wat het model kan produceren) en duidt op een vervormde/gefabriceerde historie; de cap blijft daarom fail-closed.

## Gevolgen

- **Geen migratie, geen datamodel-/RLS-wijziging.** Zuiver invoervalidatie.
- **Gebruikerservaring:** een lange bureau-/memo-uitvoer blokkeert de vervolgvraag niet meer, en de foutmelding wijst niet langer ten onrechte naar de gebruiker.
- **Bewust geaccepteerde schuld:** `MAX_ASSISTANT_BEURT_TEKENS = 40.000` is een werkhypothese (output-plafond + marge), te kalibreren op echte antwoordlengtes; `MAX_HISTORIE_TEKENS` idem (zie `04 Technische inrichting/technische-schuld.md`).
- **Verificatie:** `core/lib/chat-invoer.sanity.ts` uitgebreid (rol-afhankelijke cap + nieuwe foutcode); `tsc --noEmit` groen.

## Referenties

- Code: `core/lib/chat-invoer.ts` (`MAX_BEURT_TEKENS`, `MAX_ASSISTANT_BEURT_TEKENS`, foutcode `antwoord_te_lang`), sanity `core/lib/chat-invoer.sanity.ts`. Commit `28622f7` (2026-08-10, `main`).
- Notitie "AI-assistent — verbeterprogramma opsteltaken en bureau-assistent" (2026-08-10).
- Eerdere grens: H-12 (invoervalidatie), `MAX_TOKENS_BESTUURLIJK`.
