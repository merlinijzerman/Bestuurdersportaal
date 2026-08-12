# 0167 — Adaptieve vraagkeuze binnen guardrails (herziening van het non-classificatieprincipe)

- **Status:** Geaccepteerd (impl.; B-opt tranche 3)
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (opdrachtgever), ontwikkeling
- **Herziet:** de expliciete regel "nooit classificeren op inhoud" (`core/lib/reflectie-flow.ts` / `ReflectieInvoer.tsx`, ontwerp v1.0 §9.5); en de gepinde `SP_REFLECTIE_REGELS`

## Context

De reflectiefunctie kende één harde architecturale belofte die verder ging dan privacy:

> Er wordt nooit op inhoud geclassificeerd — niet met een regex, niet met een model, niet met een heuristiek. Wat de gebruiker in dít veld typt is per definitie een reflectieantwoord.

Een verdiepingsvraag die uit de woorden van de bestuurder een *richting* afleidt om de volgende vraag te kiezen, **ís** een classificatie op inhoud. De adaptieve vraagkeuze (VOORSTEL §A-bis/§D) is daarmee geen verfijning maar een **herziening van dit vastgestelde ontwerpprincipe**. Dit besluit legt die herziening expliciet vast — anders staat er over een half jaar een principe in de code dat de code zelf niet meer waarmaakt.

**Wat we opgeven:** determinisme. Twee bestuurders met dezelfde woorden kunnen een andere vraag krijgen, en omdat er geen telemetrie is ([[0112]]), merkt niemand het als de vraagkeuze systematisch de plank misslaat. Het enige correctiemechanisme blijft de gebruikerstoets (voor deze optimalisatie bewust gewaiverd, [[0164]] — post-hoc aanbevolen).

## Besluit

De verdiepingsvraag mag **contextueel** worden gekozen — het model leidt een *richting* af uit de gekozen ingang, de woorden van de bestuurder en de bevroren bronset — **uitsluitend binnen de zes onderstaande guardrails**. Alle zes zijn niet-onderhandelbaar; sneuvelt er één, dan is de wijziging niet meer wat hier is goedgekeurd.

1. **De classificatie poort niets af.** Elke richting leidt tot exact dezelfde volgende stap. Er is geen pad dat "te vaag" of "niet genoeg twijfel" oplevert.
2. **De classificatie wordt nergens opgeslagen.** Niet in `gesprek_reflectie_state`, niet in `retrieval_meta`, nergens. De richting leeft alleen binnen één request en mag de request niet verlaten. (`core/lib/audit-meta.sanity.ts` bewaakt dat `richting` in geen enkele allowlist voorkomt.)
3. **De classificatie wordt nooit als conclusie getoond.** De vraag mag nooit zeggen wat de twijfel ís; hoogstens twee richtingen aanbieden, mét uitweg.
4. **De vraag kent een verplichte uitweg.** "…of zit dat ergens anders?" is een vormeis, machinaal getoetst (AC-R5).
5. **De deterministische vraag blijft de vloer.** Faalt de generatie of de validatie, dan valt de functie terug op `standaardVraag(ingang)`. De huidige garantie is daarmee het minimum, niet het maximum.
6. **De vraag wordt niet gestreamd.** Een verdiepingsvraag is twee zinnen: genereren → valideren → tonen. Zo is de guardrail preventief in plaats van cosmetisch.

## Implementatie

- **`core/lib/reflectie-richtingen.ts`** (puur, geen I/O): de gesloten richtinglijsten per ingang, `standaardVraag(ingang)` (guardrail 5), `isGeldigeRichting()`, en `valideerVerdiepingsvraag()` — de machinale ondergrens AC-R1 t/m R7 (≤ 60 woorden, precies één vraagteken, geen koppen/rubrieken, geen diagnose-blocklist, verplichte uitweg bij ≥ 2 richtingen, geen bron buiten de bevroren set, geen herkomstuitspraak zonder server-injectie). Getest in `reflectie-richtingen.sanity.ts` (positief én negatief per regel).
- **`SP_REFLECTIE_REGELS`** vervangen (ANTWOORDPAD §1): de drie vaste rubrieken (WAT U INBRENGT / WAT AL VASTSTOND / MOGELIJKE ONDERZOEKSVRAAG) maken plaats voor **attributieplicht** — élke dossieruitspraak draagt een expliciete attributie; een eigen constatering van de assistent bestaat niet. Nieuwe sha256-pin, aangescherpte content-guard (`generatie-kern.sanity.ts`).
- **Route (`app/api/chat/route.ts`):** de verdiepingsbeurt wordt gebufferd en gevalideerd (niet gestreamd, guardrail 6); bij afkeur de deterministische vraag (guardrail 5). De feitelijke bronsamenstelling van het oorspronkelijke antwoord wordt afgeleid uit `retrieval_meta.source_summary` en als één regel meegegeven; zonder die regel verbiedt de prompt elke herkomstuitspraak (§3d, AC-R7).

## Overwogen alternatieven

- **Het principe onaangeroerd laten (alleen vaste vragen per ingang).** Verworpen: dan blijft de vraag een taxonomie-uitkomst i.p.v. een aansluitende doorvraag. De adaptieve keuze verhoogt de kwaliteit — mits binnen de guardrails.
- **De richting als structured output loggen "voor het inzicht".** Verworpen: dat schendt guardrail 2 en besluit [[0112]]; het maakt zichtbaar dat een specifieke bestuurder op een specifiek moment twijfelde over een specifiek onderwerp.
- **Een model dat beoordeelt of er "voldoende scherpte" is.** Expliciet verworpen (VOORSTEL §E): dat is gatekeeping over de inbreng van de bestuurder en per ontwerp onmeetbaar.

## Gevolgen

- Nieuw restrisico: de vraagkeuze is niet deterministisch en per ontwerp niet meetbaar; correctie loopt alleen via de (gewaiverde, post-hoc) gebruikerstoets.
- De blocklist (AC-R4) is de machinale ondergrens, niet de norm — de norm staat in `SP_REFLECTIE_REGELS`.

## Referenties

- `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §A-bis, §D, §E · `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` §0.2, §1, §7
- [[0112]] (geen reflectiemarkering), [[0164]] (waiver toets), [[0166]]
