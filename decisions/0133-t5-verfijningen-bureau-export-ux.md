# 0133 — T5: verfijningen bureau-assistent, export & UX

- **Status:** Geaccepteerd
- **Datum:** 2026-08-06
- **Betrokkenen:** Bestuursbureau (opdrachtgever), ontwikkeling

## Context

Een praktijktest van de opgeleverde bureau-stand (T2) en de Word-export bracht een set concrete verbeterpunten aan het licht in de export, de producerende taak en de algemene assistent-UX. Deze verfijningen staan los van de compliance-poorten (T4) en zijn bewust in één klein, zelfstandig ticket gebundeld zodat ze niet achter de deskresearch-gates blijven hangen. Randvoorwaarden: anti-fabricage en de herkomstregel blijven constructief afgedwongen (0098); geen tweede renderer (0079); de gepinde toon-systeemprompt (nulgrens G23) blijft byte-identiek.

## Besluit

Drie groepen verfijningen, gebouwd op de bestaande AST/`bouwKopie()`-lijn:

- **A. Export & opmaak.** Valide OOXML met `w:tblGrid` + vaste kolombreedtes in DXA (A1); losse markdown-scheidingslijnen (`---`) worden in de gedeelde parser overgeslagen (A2); precies één titel + geen door het model geschreven titelregel (A3); citaties scriptie-stijl als hooggeplaatst cijfer (`<sup>`/superscript) waarvan het getal het lijstnummer is, met platte-tekst-terugval `[n]` voor het klembord (A4); de export bevat uitsluitend het stuk (A5). Opmaakstijl: **neutraal**, met een configlaag-haak voor een fondssjabloon later (A6).
- **B. Producerende taak.** Een inputdocument is niet langer verplicht (B1): drie vertrekpunten — fondsdocumenten (i), deskresearch (ii, volgt met T4), en alleen een onderwerp (iii). Variant (iii) levert een bronloos concept-**skelet** met een aparte, strenge regelset (`SP_BUREAU_BRONLOOS_REGELS`): geen verzonnen fondsfeiten, geen `[Bron N]`, alles wat niet onderbouwd is onder "Aannames en open punten".
- **C. Assistent-UX & copy** (bewuste wijziging, buiten de bureau-nulgrens). Begroetingscopy vervangen door een algemene AI-vermelding; de AVG-logging-transparantie geborgd in de tooltip van de permanente "Governance logging actief"-badge (C1). Een bestaand gesprek én een bestaande vergadering openen onderaan bij het laatste bericht (C2). De verduidelijkingsvraag ("voor uw fonds / algemene zin") vuurt niet meer na een korte bevestiging ("ja graag") of bij een inherent fondsspecifiek (bronloos-bureau) verzoek (C3).

## Overwogen alternatieven

- **A4 alleen in de export vs. export én klembord** — gekozen voor beide, via één gedeelde `bronOrdinaal`-map (0079: dezelfde interpretatie voor docx en klembord). De scherm-weergave (interactieve pills) blijft ongemoeid.
- **A5 met een in-stream sentinel (`###STUK###`) vs. structurele extractie** — gekozen voor marker-loos: de export leest de zichtbare `bericht.tekst`, dus een sentinel zou ofwel zichtbaar in de chat lekken, ofwel na strippen niet meer beschikbaar zijn voor de export. In plaats daarvan een strenge instructie (het model levert het stuk kaal) + `extraheerStukBlok()` als afdwingende vangnetlaag (knipt lead-in vóór de eerste kop en een conversationele afsluiting erna).
- **A5-instructie in `TOON_BLOK_BUREAU` vs. in `bouwStukInstructie`** — gekozen voor de user-prompt-laag (`bouwStukInstructie`), zodat de sha256-gepinde toon-systeemprompt (G23) ongewijzigd blijft.
- **C3 na bevestiging: intent voortzetten als fonds/zeker vs. verduidelijking laten vuren** — gekozen voor voortzetten als `fonds`/`zeker` (nooit stil `algemeen`, schijnzekerheid-guardrail), en alleen bij een korte, inhoudsloze bevestiging ná een assistent-beurt (`isKorteBevestiging` + `heeftVorigAntwoord`).

## Gevolgen

- **Geen migratie, geen datamodel-/RLS-wijziging.** De capability-gate (`ai.stukvoorbereiding`) en de modulegate blijven server-side hard; de bronloze variant wordt append-only gelogd met `retrieval_meta.bureau.bron_aanwezig = false`.
- **Anti-fabricage en herkomst intact.** De scriptie-weergave (A4) verandert niets aan de interne `[Bron N]`-koppeling of de citaatvalidatie (die telt op de ruwe modeltekst). De Word-export weigert nog steeds een payload zonder bureau-herkomstanker.
- **Gedeelde lagen geraakt** (parser A2, klembord A4): bestuurders zien de scriptie-citaties óók bij het kopiëren; het scherm (pills) blijft gelijk. Vastgelegd in de sanity-pins.
- **Groep C is een bewuste wijziging** aan het algemene assistentgedrag (niet onder de bureau-nulgrens G23), met een eigen eval-check: `ai-begroeting-copy.sanity.ts` (C1) en `vraagtype.sanity.ts`/`isKorteBevestiging` (C3).

## Referenties

- Code: `core/lib/antwoord-docx.ts`, `core/lib/antwoord-klembord.ts` (`bronOrdinaal`), `core/lib/antwoord-parser.ts`, `core/lib/stukvoorbereiding.ts` (`extraheerStukBlok`), `core/lib/generatie-kern.ts` (`SP_BUREAU_BRONLOOS_REGELS`), `core/lib/vraagtype.ts` (`isKorteBevestiging`), `app/api/chat/route.ts`, `app/api/ai/stuk-export/route.ts`, `app/(dashboard)/ai/_components/{StukVoorbereiden,AssistentClient}.tsx`, `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx`.
- Sanity: `antwoord-docx`, `antwoord-klembord`, `antwoord-parser`, `stukvoorbereiding`, `generatie-kern`, `vraagtype`, `ai-begroeting-copy`.
- Ontwerp: `03 Functioneel ontwerp/Bestuurdersportaal - Rol Bestuursbureau ontwerp v0.3.md` §6/§6.4/§9. Eerdere besluiten: 0079 (één renderer), 0098 (herkomstregel constructief), [`0129`](./0129-t2-bureau-produceren-en-word-export.md) (T2 basis), 0085/0089 (AI-startpunt/taken).
