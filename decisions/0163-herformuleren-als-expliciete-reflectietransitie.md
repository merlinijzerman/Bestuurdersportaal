# 0163 — `herformuleren` als expliciete reflectietransitie; de normale invoerbalk blijft beëindigend

- **Status:** Geaccepteerd (impl.; B-opt tranche 1a)
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (opdrachtgever), ontwikkeling
- **Herziet:** [[0110]] (de transitietabel van de reflectietoestandsmachine)

## Context

In de conceptweergave van de reflectiefunctie belooft de knop **"Aanpassen"** dat de bestuurder zijn eigen overweging kan bijstellen. In de as-built van plateau B deed de knop iets anders: hij zette de focus op de **normale invoerbalk** en voerde geen transitie uit. Een beurt in die invoerbalk stuurt server-side `afbreken` (FR-56: het invoerkanaal bepaalt alles), dus de reflectie eindigde en de herformulering werd een gewone chatvraag mét retrieval. In de agendapuntchat was de knop zelfs een no-op.

Dat is de beloftebreuk **H-1** uit `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §H: de knop breekt zijn belofte op het gevoeligste moment — de bestuurder ziet een concept van zijn eigen twijfel, wil het bijstellen, en verliest de context.

De regel "het invoerkanaal bepaalt alles" is correct en moet blijven. Het probleem is niet die regel maar het ontbreken van een apart, gelabeld kanaal voor het herformuleren.

## Besluit

Eén nieuwe actie **`herformuleren`** op de bestaande `SECURITY DEFINER`-functie `public.reflectie_transitie`, uitsluitend geldig vanuit `conceptweergave` en met `conceptweergave` als doelstatus. De actie:

- verhoogt de **beurt niet** (het is geen extra verdiepingsvraag, maar dezelfde overweging opnieuw verwoord);
- laat de **ingang** en de **bevroren bronset** ongemoeid (behouden via de bestaande `on conflict`-tak, want `p_actie <> 'start'`);
- kent **geen limiet** — bewust, want het is de eigen tekst van de bestuurder en een teller zou registratie van reflectiegedrag zijn ([[0112]]).

De UI ("Aanpassen") heropent het **gelabelde reflectieveld**, voorgevuld met het **eigen laatste antwoord** van de bestuurder (nooit de AI-tekst van het concept). Versturen stuurt de beurt via de chatroute met het signaal `reflectie_herformuleren`; de route bouwt daarna het concept opnieuw op. De **normale invoerbalk blijft de reflectie beëindigen** — dat is correct gedrag; onder het concept staat dezelfde waarschuwing die onder het verdiepingsveld staat.

Geen nieuwe status, geen nieuwe kolom, geen nieuwe tabel, geen nieuwe policy of grant. Migratie: `2026_08_12_bopt1_herformuleren.sql` (+ROLLBACK).

## Overwogen alternatieven

- **Aanpassen via `reflectie_antwoord`** (de bestaande verdiepingsactie) — verworpen: dat verhoogt de beurt en gaat naar `verdieping_N`, terwijl de bestuurder niet verder wil maar hetzelfde scherper wil zeggen. Het zou bovendien tegen het beurtplafond aanlopen.
- **Voorvullen met de AI-concepttekst** — verworpen: dan bewerkt de bestuurder modelformuleringen en wordt het concept langzaam de tekst van het model. Voorvullen gebeurt met zijn eigen laatste antwoord.
- **De herformulering via de aparte `/api/reflectie/transitie`-route laten lopen** — verworpen: die route flipt alleen de status en genereert niets. Herformuleren vergt een nieuwe conceptgeneratie, dus het loopt via de chatroute.

## Gevolgen

- De transitietabel in TO §6.1 / v1.0 §9.4 krijgt één zelf-lus (`conceptweergave + herformuleren → conceptweergave`). Spiegel bevroren in `core/lib/reflectie-flow.sanity.ts` (nu 15 geldige overgangen; 7 × 6 = 42 combinaties, 27 geweigerd).
- Server-side geborgd: `herformuleren` buiten `conceptweergave` valt door naar `ongeldige_transitie` (niet `ongeldige_actie`); de client behandelt een geweigerde transitie als een normale chatbeurt. Getoetst in `supabase/checks/2026_08_05_b_reflectie_flow.sql` (blok AC-18g).
- **Migratie-eerst-dan-deploy** ([[0110]]-discipline): de migratie moet in Supabase draaien vóór de code-deploy. Zolang de migratie niet live is, weigert de RPC `herformuleren` en valt de knop veilig terug op `afbreken` — maar dan doet hij niets nuttigs.
- Bij een wijziging aan een `SECURITY DEFINER`-functie zijn de structurele gates A–H (`2026_07_31_r1_structurele_gates.sql`) verplicht tegen de doeldatabase.
- Geen auditwijziging: de herformuleerbeurt wordt als gewone chatbeurt gelogd, zonder markering dat het reflectie betrof ([[0112]]).

## Referenties

- `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §H (H-1), §I (transitietabel)
- `WERKOPDRACHT-REFLECTIE-OPTIMALISATIE.md` tranche 1a
- [[0110]], [[0111]], [[0112]]
