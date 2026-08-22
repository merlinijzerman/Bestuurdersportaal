# Publicatiebeleid securitydocumentatie

> Status: vastgesteld in besluit [0186](../decisions/0186-securitydocumentatie-in-twee-lagen.md)
>
> Kernregel: securitydocumentatie is **privé, tenzij zij expliciet als publiek is geclassificeerd**.

## Waarom twee lagen

Openbaarheid helpt bij toetsbaarheid: beleid, architectuurprincipes en de werking van
controls horen bespreekbaar en reviewbaar te zijn. Operationele details kunnen juist
een aanval versnellen, productiecontext blootleggen of bewijs vervuilen. Daarom is
"securitydocumentatie" niet één publicatiecategorie.

De grens is inhoudelijk, niet cosmetisch. Alleen namen of waarden weglakken maakt een
productierunbook nog geen publiek document als volgorde, objecten en faalpaden samen de
operationele omgeving reconstrueren.

## Publieke laag — dit mag in deze repository

- securitybeleid, verantwoordelijkheden en reviewcriteria;
- architectuur- en vertrouwensgrenzen op systeemniveau;
- een hoog-over dreigingsmodel zonder direct uitvoerbare aanvalspaden;
- control-doelen en gesaneerde ASVS-/assurance-status;
- code-, migratie- en testverwijzingen die al onderdeel zijn van de publieke broncode;
- een finding-samenvatting ná triage: ernst, getroffen componentcategorie, oplossing en
  verificatiestatus, zonder exploitdetails of productie-evidence;
- publieke advisories en dependencykeuzes nadat noodzakelijke mitigatie beschikbaar is.

Een publiek document bevat niet de informatie uit de private laag, ook niet in
screenshots, voorbeeldoutput, comments, commitberichten, issue- of PR-tekst.

## Private laag — buiten deze repository

- Supabase-/Vercel-/providerprojectreferenties, account-ID's en interne endpoints;
- exacte host-, tenant-, bucket-, rol- en omgevingsinventarisaties wanneer de combinatie
  operationele topologie of toegangsgrenzen prijsgeeft;
- productie-SQL, console-instructies en deploy-/rollbackrunbooks voor handmatige uitvoering;
- ruwe queryresultaten, logs, screenshots, workflowartefacten en timestamps als bewijs;
- open of ongereviewde findings, exploitketens, reproduceerstappen en pentestdetails;
- namen van test-/productieaccounts en persoonsgegevens van reviewers of gebruikers;
- incidentnotities, herstelstatus en leveranciersconfiguratie die niet al bewust publiek is.

Secrets, wachtwoorden, tokens, private keys en herstelcodes horen **nooit** in een
documentatierepository—ook niet in de private laag. Die gaan rechtstreeks naar de kluis;
documentatie verwijst alleen naar de kluislocatie of een opaque evidence-ID.

## Publicatie- en reviewproces

1. De auteur classificeert het artefact vóór het schrijven. Bij twijfel geldt `private`.
2. Privé-bewijs wordt eerst in de private bestemming vastgelegd; de publieke tekst wordt
   daarvan als afzonderlijke samenvatting geschreven, niet als achteraf geredigeerde kopie.
3. Een tweede reviewer controleert de publieke versie op combinatielekken: meerdere op
   zichzelf onschuldige details mogen samen geen productiebeeld of exploitpad vormen.
4. Issues, PR-bodies en commitberichten volgen dezelfde grens als bestanden.
5. `security/publicatie-manifest.json` classificeert ieder bestand onder `security/`.
   De CI-check faalt bij een ontbrekende classificatie of gewijzigde legacy-inhoud.
6. Na een incident of foutieve publicatie: verspreiding stoppen, waarden roteren indien
   nodig, historie gericht saneren en het incident in de private laag vastleggen.

## Publiek findingsjabloon

Een openbare finding bevat maximaal:

- een neutrale titel en ernst;
- getroffen componentcategorie, zonder productieobject-ID;
- impact in termen van vertrouwelijkheid, integriteit of beschikbaarheid;
- fixstatus en de soort verificatie;
- een opaque verwijzing naar privé-bewijs.

Reproduceerbare payloads, exacte kwetsbare objecten, accounts en ongeredigeerde output
blijven privé totdat expliciete coordinated disclosure anders bepaalt.

## Overgang van de huidige repository

Zes al aanwezige operationele/bewijsdocumenten staan als `legacy_frozen` in het
manifest. Hun hash is gepind: ze kunnen niet verder groeien of ongemerkt worden
bijgewerkt. Na keuze van de private bestemming worden ze daar integraal overgebracht,
op volledigheid gecontroleerd en in deze repository vervangen door een publieke
samenvatting of verwijderstub. Daarna verdwijnt de legacy-uitzondering uit het manifest.

De nog te kiezen bestemming—een aparte private repository of een dossier in de
wachtwoord-/bewijs-kluis—is een operationele keuze. De publicatiegrens uit dit beleid
geldt nu al en wacht daar niet op.
