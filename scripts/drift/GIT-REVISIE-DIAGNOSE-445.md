# #445 — diagnose van drie Preview-functievormen

## Meetkader

- Doel: `portal_preview`, projectref `swviwoytzvaqypieqgji` (`bestuurdersportaal-preview`). De live metingen waren uitsluitend `BEGIN TRANSACTION READ ONLY` met een fail-closed controle op de actieve Preview-host en afwezigheid van productiehosts.
- Volledige `pg_get_functiondef`-vingerafdrukken: 2026-09-23 **09:47:58 UTC**. Body, opties en codevorm opnieuw gemeten: **09:53:21 UTC**. Rol: `postgres`.
- Replay: uitsluitend de lokale wegwerp-Postgres 17-database `codex_445_history` in container `codex-445-git-historie`. Elke functievariant werd in `BEGIN` aangemaakt, gemeten en met `ROLLBACK` teruggedraaid. Nadien stonden **nul** van de drie functies in de replaydatabase.
- Git-bron: alle lokaal aanwezige revisies van alle relevante migratiebestanden, vanaf de #442-head `c345add`. De afschriftbaseline is apart meegenomen, omdat de `08_22`-migratie geen body definieert maar de bestaande functieopties transformeert.
- De uitgebreide herkomst staat in `supabase/checks/445-git-revisie-vormen.generated.tsv` (19 vormvarianten). Alleen hashes en opties zijn opgeslagen; geen live-functiebody.
- Rechten en overige functieopties zijn nogmaals read-only gemeten om **09:59:12 UTC** en vergeleken met de huidige `allowlist-grants.tsv` en de gemeten Git-varianten.

De replay is herhaalbaar met `scripts/drift/git-revisie-functievormen.py --container <codex-445-wegwerpcontainer> --database <codex_445_wegwerpdb> --output <tsv> --target fn_naam=<ruwe-md5> --target-code fn_naam=<code-md5>` (een paar `--target`-waarden per functie). De container mag geen gepubliceerde poort of tenantdata hebben. Het script controleert dat vóór de replay en weigert zodra de database een `tenant_domains`-host draagt. `--target-body` is optioneel voor het afzonderlijke bewijs over de ruwe bodytekst.

## Resultaat per functie

| Functie | Preview-hash | Exacte repo-tekst | Code zonder lege/commentaarregels | Duiding |
|---|---|---|---|---|
| `fn_access_token_hook(event jsonb)` | `ed0ac11a29cf389f22a58c11d43ec09c` | **Geen** van 9 varianten | Gelijk aan de vier laatste revisies van `2026_09_07_microsoft_login_beleidsmodus.sql` (`faaad09`, `0ad8bc5`, `18f9fbf`, `2f19253`) | De live body mist precies **4 volledig commentaarregels en 3 lege regels**. Alle overige regels zijn zelfs inclusief inspringing byte-gelijk aan de huidige Git-body. De tekstherkomst blijft onbekend; er is geen afwijkende code-regel gemeten. |
| `fn_profiel_fondslock()` | `28190814ca2ad4e5be67aa52b0285f55` | **Geen** van 4 varianten | Gelijk aan de drie laatste revisies van hetzelfde bestand (`0ad8bc5`, `18f9fbf`, `2f19253`) | De live body mist precies **één volledig commentaarregel**. Alle overige regels zijn inclusief inspringing byte-gelijk. |
| `fn_afschrift_bevries_kolommen()` | `7c450090869d688a36043e8462763a0a` | **Ja, als combinatie**: body uit `2026_08_09_afschrift_ai_tekst.sql@886d3e5` plus de `search_path = public, pg_temp`-transformatie uit `2026_08_22_secdef_search_path_pg_temp.sql@07c115d` | Gelijk | De huidige referentiereplay vertrekt van de andere, gepinde baselinebody en eindigt op `0106d62f...`. Dit is een verschil in de uitgangsbody, niet bewijs dat `08_22` ontbrak. |

De codevergelijking is bewust smal: per regel trimmen en uitsluitend volledig lege of volledig commentaarregels weglaten. Zij bewijst voor **deze drie bodies** dat de overblijvende regels en volgorde exact gelijk zijn. Zij is geen algemene SQL-semantiekvalidator en bepaalt niet wie de live tekst heeft geschreven.

De functieopties zijn niet de verborgen oorzaak van de twee ruwe hashverschillen. Preview en de gematchte repo-code hebben hetzelfde `search_path`, `SECURITY DEFINER`-bit, `VOLATILE` en `PARALLEL UNSAFE`: bij de hook `search_path = ''`, security-invoker; bij de fondslock `login_private, public, pg_temp`, security-definer; bij de afschriftfunctie `public, pg_temp`, security-definer. Alle drie hebben `postgres` als eigenaar. De gemeten EXECUTE-rechten passen op de bestaande allowlist: `anon` en `PUBLIC` voor alle drie dicht; `authenticated`/`service_role` alleen bij de afschriftfunctie; `supabase_auth_admin` alleen bij de hook. Deze ACL-check is aanvullend op, geen vervanging van, de V3-rechtengate.

## Wat dit wel en niet bewijst

De hypothese “Preview loopt eenvoudig achter op de huidige migratieketen” blijft weerlegd: geen van de twee Microsoft-functies heeft een exacte voorgangervorm. De stelling “dus handmatig functioneel gewijzigd” volgt daar **niet** uit. Bij beide is de codevorm gelijk aan Git; alleen commentaar of witruimte verschilt. Een handmatige tekstwijziging is mogelijk, maar een editor, deploypad of hersteloperatie die commentaar verwijdert evenzeer. De bron van die tekst is met deze database- en Git-meting niet te bewijzen.

Dit is een gerichte **false positive als #440's ruwe MD5 wordt gelezen als functionele drift**. Een ruwe definitiehash blijft nuttig als provenance-signaal, maar kan verschillen door commentaar/lege regels. Voorstel voor een afzonderlijke correctie op #440: behoud de ruwe mismatch zichtbaar, voeg daarnaast een strikt afgebakende codevorm-hash en opties/ACL-pariteit toe, en label een geval alleen als `tekstdrift; codevorm gelijk` wanneer beide onafhankelijke checks groen zijn. Laat `afwijkend` staan voor onbekende codevorm, opties of rechten. Die wijziging hoort onder review op #442 of in een opvolg-PR; dit #445-spoor raakt de #442-branch niet.

De afschriftfunctie heeft juist een exacte repo-verklaring, maar alleen als men de `08_09_afschrift_ai_tekst`-body als voorganger van de `08_22`-overlay neemt. De huidige baseline/replay neemt de andere body. Dat zegt niet **wanneer** de AI-tekstbody op Preview terechtkwam of welke overige objecten uit die migratie daar staan.

## Vervolgbesluit per scenario

1. **Exacte tussenvorm van een migratiebestand.** Controleer eerst alle objecten die dezelfde bestandsrevisie raakt en de bron van de toegepaste tekst. Herhaal het oude migratiebestand niet. Als de huidige gewenste vorm verschilt, maak een nieuwe, idempotente forward-migratie met eigen preflight en verificatie.
2. **Geen tekstmatch, maar gelijke codevorm en opties** (de twee Microsoft-functies). Classificeer voorlopig als *tekst-/provenancedrift zonder aangetoonde code-afwijking*. Zoek desgewenst in SQL-editor-, deploy- of herstelsporen naar de herkomst. Geen live herschrijving alleen om de ruwe MD5 gelijk te trekken; beslis eerst of de #440-driftmeting naast de ruwe definitie ook deze streng begrensde codevorm als diagnostiek moet tonen.
3. **Geen repo-codevormmatch** bij een toekomstige meting. Meld expliciet *mogelijke handmatige wijziging of ander schrijfpad*; bewaar eerst het live bewijs veilig, onderzoek wie/wanneer wijzigde en laat de functie security-reviewen. Pas na dat onderzoek een afzonderlijk herstelvoorstel. Een onbekende hash is geen toestemming om een oude migratie te plakken.
4. **Afschriftcombinatie met afwijkende baseline.** Beslis welke body canoniek bedoeld is en meet de overige effecten van `2026_08_09_afschrift_ai_tekst.sql` op Preview. Corrigeer een eventueel gat met een nieuwe forward-migratie of een expliciet baseline-/testkaderbesluit, niet met een historische replay op Preview.

## Negatieve controle en grenzen

Een lokale nep-tenantdatabase `codex_445_guard` met `tenant_domains.host = 'app.preview.bestuurdersportaal.com'` werd vóór de eerste functieaanmaak geweigerd: `database draagt tenant-host; replay geweigerd`. De outputfile werd niet aangemaakt. Het script eist bovendien een container- en databasenaam met een #445-wegwerpprefix. Er is geen migratie of andere schrijfactie op Preview of Productie uitgevoerd.

De door Git bekende revisies zijn volledig voor de vijf betrokken migratiebestanden: vier van `09_06`, vijf van `09_07`, één elk van de beide `08_09`-bestanden en één van `08_22`. De baseline heeft één Git-revisie. `fn_profiel_fondslock` bestond nog niet in de eerste `09_07`-revisie, vandaar vier in plaats van vijf vormvarianten. Een nooit in Git vastgelegde SQL-edit blijft buiten deze replay.
