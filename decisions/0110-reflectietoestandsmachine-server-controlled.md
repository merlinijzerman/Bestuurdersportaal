# 0110 — De reflectietoestandsmachine is server-controlled; de client kan de status niet muteren

- **Status:** Geaccepteerd — ontwerp vastgesteld, **implementatie volgt in plateau B**
- **Datum:** 2026-08-04
- **Betrokkenen:** IB, ontwikkeling

## Context

De reflectiedialoog loopt door vaste toestanden: ingang gekozen, één tot drie verdiepingsvragen, conceptweergave, afgerond. Zou die status client-side worden bijgehouden, dan kan een gebruiker (of een fout) direct naar "afgerond" springen, de beurtteller verlagen of een willekeurige bronset kiezen. Dat is niet alleen een UI-probleem: de bevroren bronset ([[0111]]) hangt aan de status.

Belangrijk feit: `gesprekken` wordt client-side beschreven met de anon-key en de gebruiker heeft UPDATE-recht op de eigen rij. Kolomrechten zijn in die opzet niet betrouwbaar af te schermen; tabelrechten wel.

## Besluit

De flowstatus leeft in een aparte tabel `gesprek_reflectie_state` met uitsluitend een SELECT-policy. Muteren kan alleen via `reflectie_transitie()` (`security definer`, vaste `search_path`), die de huidige status opnieuw uitleest met `for update` en de gevraagde overgang toetst tegen een vaste transitietabel. Een clientwaarde is nooit leidend.

## Overwogen alternatieven

- **Kolom op `gesprekken`** — verworpen om de reden hierboven: de gebruiker mag die rij zelf updaten.
- **Status afleiden uit de berichtenreeks** — fragiel en niet toetsbaar; bovendien zou de bronset dan nergens vastliggen.

## Gevolgen

- Vijf concrete pogingen moeten falen: direct op `afgerond` zetten, de beurtteller verlagen, een willekeurige bronset kiezen, de status van een ander wijzigen, en een ongeldige transitie aanvragen.
- De transitietabel wordt als pure functie in TypeScript gespiegeld en met een sanitytest bevroren, zodat de UI dezelfde regels kent zonder ze te bepalen.
- Fail-safe bij heropenen: de server geeft `niet_actief` terug bij twijfel, in plaats van een halve flow te herstellen.

## Referenties

- Ontwerp v1.0 §10, technisch ontwerp §4.6, §5.2, §6.1
- [[0111]], [[0108]]
