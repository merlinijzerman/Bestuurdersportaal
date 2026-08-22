# Releaseweg — preview eerst

> **Geldt voor elk V-, W- en VEN-ticket vanaf 22-08-2026.** Elk ticket verwijst hiernaar in §0b; dit bestand is de enige plek waar de weg zelf staat beschreven.
>
> **Status per 22-08-2026 14:30 — deels afgedwongen.** De previewpoort (herkomst) is een verplichte check op `main` en werkt aantoonbaar. De deploymentpoort is aangezet maar **noemt omgevingen die op deze weg nooit ontstaan** en kan daardoor niet blokkeren; zie §5.2. Twee Vercel-controles zijn uitgevoerd en zijn groen; zie §5.5.

---

## 1. Waarom dit er staat

Op 21-08 zijn twaalf PR's rechtstreeks naar `main` gemerged, en `main` is de productiebranch. Dat was geen omzeiling: er stonden **twee flows gedocumenteerd** en de uitvoering volgde de verkeerde.

| Document | Wat het zegt | Laatst gewijzigd |
|---|---|---|
| `CLAUDE.md` regel 53 | *"Deploy verloopt via GitHub Desktop (commit → push `main` → Vercel auto-deploy)"* — het woord *preview* kwam er nul keer in voor | **30-05-2026** |
| `security/OMGEVINGEN-RUNBOOK.md` regel 20 | *"Vercel: vaste Preview/custom environment op vaste previewbranch — `main`/Production"* | **14-08-2026** |

Besluiten 0175, 0176 en 0177 leggen de scheiding vast. De agents lazen `CLAUDE.md` en deden precies wat daar stond.

**Regel 53 is gecorrigeerd in de PR die dit bestand toevoegt.** Het woord *preview* stond er nul keer in; nu beschrijft de regel de weg en verwijst hij hierheen. Daarmee is het oorspronkelijke gat — de agent leest morgen de verkeerde instructie — gedicht bij de bron en niet alleen bij het gevolg.

**Wat er sindsdien is gebeurd (geverifieerd 22-08).** De `preview`-branch loopt gelijk met `main`. Sinds de poort staat, is alles wat op `main` terechtkwam via `preview` binnengekomen:

```
main, first-parent, 22-08
  84316cb  10:30  PR #114 vanuit fix/ontbrekende-migratie-fonds-licentie   ← 3 min vóór de poort
  12553de  11:04  PR #119 vanuit preview                                   ← poort actief
  433b67d  12:54  PR #123 vanuit preview                                   ← poort actief
```

---

## 2. De weg

```
feature-branch  →  PR naar preview  →  ✅ verplichte checks
                                          ↓
                                  PREVIEW-omgeving: uitgerold én waargenomen
                                          ↓
                                  waarneming vastgelegd bij het issue
                                          ↓
                            PR van preview naar main  (= productie)
```

**Wat het níét is:** een groene CI-run. De poorten draaien tegen een ephemere testdatabase; ze zeggen niets over de Preview-Supabase, de echte hostmapping, de auth-callback of `TENANT_ENFORCE` in een echte deploymentcontext. Dat is precies het gat dat de waarnemingsstap dicht.

---

## 3. Wat "aantoonbaar op preview" betekent

Per soort wijziging iets anders. Kies bewust en leg de keuze vast.

| Soort wijziging | Wat er op preview moet gebeuren |
|---|---|
| **Applicatiecode** | Preview-deploy afwachten, inloggen als minstens twee rollen, en de schermen raken die de wijziging betreft. Bij een gedragsbehoudende wijziging is de waarneming: *er verandert niets zichtbaars* |
| **Databasemigratie** | Migratie **eerst** op de Preview-Supabase, dan de functionele natest, dan pas productie |
| **Wrapper-/securitylaag** | Bovenop het bovenstaande: het foutpad expliciet uitlokken (geen sessie → 401, verkeerde rol → 403) op de echte omgeving, niet alleen in het harnas |
| **Env-vlag** | De vlag op preview **aan**, gedrag waarnemen, en weer uit — of aan laten met een `BESLUIT:` erbij. Nooit als eerste in productie aanzetten |
| **CI-workflow / gate** | Draait niet in de app; preview-deploy is niet van toepassing. Leg dat vast als `preview: n.v.t. — CI-only`, **als waarde, niet als weglating** |
| **Alleen documentatie** | Idem: `preview: n.v.t. — docs-only` |

De laatste twee zijn echte uitzonderingen, geen achterdeur. Een ontbrekende regel is niet te onderscheiden van een vergeten regel — dezelfde regel als bij `hostGuard: "route-eigen"`.

---

## 4. Wat je vastlegt

Eén comment bij het issue, vóór de merge:

```
PREVIEW — waargenomen op <datum tijd>
deployment: <preview-URL of deployment-id>
gecontroleerd: <wat je hebt aangeraakt, als welke rol(len)>
uitkomst: <wat je zag — inclusief "niets veranderd" als dat de verwachting was>
afwijkingen: <of: geen>
```

**Waargenomen, niet aangenomen.** Dezelfde eis als bij de `[OPS] B9b`-regel: die gaat pas naar `DONE` bij een gezíéne geslaagde nachtrun, niet bij een geconfigureerde cron. Een preview-deploy die bestaat maar die niemand heeft geopend, telt niet.

---

## 5. Het mechanisme — stand van zaken

### 5.1 De herkomstpoort — `.github/workflows/previewpoort.yml` ✅ werkt

Gemerged als PR #118. De check heet **`Previewpoort (naar main alleen vanuit preview)`** en toetst één ding: gaat deze PR naar `main`, dan moet de bronbranch `preview` zijn. Zo niet, dan hard rood, met de herstelinstructie in de step summary (`gh pr edit <nr> --base preview`).

De workflow benoemt zelf waaróm dit als check moest en niet als instelling kon: branch protection kan de bronbranch niet beperken — GitHub biedt die instelling niet. De bestaande poorten toetsen de **inhoud** van een PR; dit is de eerste die naar **herkomst** kijkt.

**De uitzondering is een waarde, geen ontsnapping.** Label `hotfix-direct-naar-main` laat de poort door met een zichtbare `::warning`.

### 5.2 De deploymentpoort — ⚠️ aangezet maar inert

In `Settings → Branches → main` staat **"Require deployments to succeed before merging"** aan. Aangevinkt zijn:

| Omgeving | Verplicht | Ontstaat bij een `preview`→`main`-PR? |
|---|---|---|
| `Preview – bestuurdersportaal` | ✅ | **nee** |
| `Preview – bestuurdersportaal-beheer` | ✅ | **nee** |
| `Preview – bestuurdersportaal-scanner` | ❌ | ja |
| `preview-stable – bestuurdersportaal` | ❌ | ja |
| `preview-stable – bestuurdersportaal-beheer` | ❌ | ja |

**Dit is de kern van het probleem.** De branch `preview` is in Vercel toegewezen aan het custom environment **`preview-stable`** (§5.5). Een PR vanaf `preview` produceert dus deployments met de naam `preview-stable – …`, terwijl de poort wacht op `Preview – …`. Die twee ontstaan op deze weg nooit, en GitHub heeft niets om op te wachten.

Gemeten aan PR #125 (head `ee31630`), de deployments op die commit:

```
preview-stable – bestuurdersportaal            2026-08-22T11:27:30Z
Preview – bestuurdersportaal-scanner           2026-08-22T11:26:25Z
preview-stable – bestuurdersportaal-beheer     2026-08-22T11:25:50Z
```

Geen van de twee verplichte omgevingen staat erbij, en #119, #123 en #125 zijn alle drie gemerged. De poort heeft dus geen enkele merge tegengehouden en kan dat in deze opstelling ook niet.

> **Te herstellen:** vink `preview-stable – bestuurdersportaal` en `preview-stable – bestuurdersportaal-beheer` aan, en haal de twee `Preview – …`-vinkjes weg. Daarna verifiëren op een echte PR — niet op het vinkje. Leg de uitkomst vast als `BESLUIT:` in EPIC W #91.
>
> **De scannervraag verandert hierdoor van kleur.** `Preview – bestuurdersportaal-scanner` is de enige omgeving die vandaag wél ontstaat én niet verplicht is. Is dat een besluit ("de scanner is geen gebruikersvlak") of een vinkje dat niemand zette? Ook vastleggen in #91.

Dit is precies de klasse "platformdefault die niemand heeft geverifieerd" waar C-01 uit voortkwam — en het laat zien waarom §4 waarneming eist in plaats van configuratie.

### 5.3 De volledige stand van de poort op `main`

| Instelling | Stand |
|---|---|
| Require a pull request before merging | ✅ |
| Require approvals | ❌ — solo-repo; bewust, maar benoem het |
| Require status checks (7 stuks) | ✅ incl. **Previewpoort** |
| Require branches to be up to date | ✅ |
| Require conversation resolution | ✅ |
| Require deployments | ⚠️ aan, maar inert — zie §5.2 |
| **Do not allow bypassing the above settings** | ✅ — **geldt óók voor de eigenaar** |
| Allow force pushes / deletions | ❌ / ❌ |

Dat voorlaatste vinkje is het belangrijkste van de lijst. Zonder dat vinkje is elke poort hierboven voor de repo-eigenaar een suggestie, en de repo-eigenaar is degene die alles merget.

### 5.4 Wat hiermee **niet** is afgedekt

1. **`preview` zelf is niet beschermd.** Er is precies één branch protection rule en die staat op `main`. Direct pushen naar `preview` kan dus. Het effect blijft beperkt, want de checks draaien alsnog op de PR van `preview` naar `main`. Wat ontbreekt is de tussenstap: een wijziging kan op `preview` staan zonder dat er ooit een PR-review op is geweest. **Overweeg een tweede, lichtere regel op `preview`** (PR verplicht, geen deploymenteis) en leg de keuze vast.
2. **Een geslaagde deploy is geen waarneming.** GitHub kan zien dát Vercel klaar is; niet of iemand heeft ingelogd en gekeken. §4 blijft dus volledig overeind en blijft menselijk werk.

### 5.5 De Vercel-kant — ✅ geverifieerd 22-08-2026

Beide openstaande controles zijn uitgevoerd, in Vercel zelf.

**Production Branch.** `Settings → Environments` van project `bestuurdersportaal`:

| Environment | Branch tracking | Domein |
|---|---|---|
| Production | `main` | huisartsenpensioen.bestuurdersportaal.com (+8) |
| Preview | alle niet-toegewezen branches | huisartsenpensioen.preview.bestuurdersportaal.com (+2) |
| **preview-stable** (custom) | **`preview`** | app.preview.bestuurdersportaal.com |
| Development | via CLI | — |

`main` is de productiebranch: de poort bewaakt de juiste deur. Dezelfde tabel legt ook §5.2 bloot — `preview` hangt aan `preview-stable`, niet aan `Preview`.

**Environment variables.** Er bestaan Preview-scoped `NEXT_PUBLIC_SUPABASE_URL` en `NEXT_PUBLIC_SUPABASE_ANON_KEY` (toegevoegd 16-08). Beide staan als *Sensitive* en zijn in de UI niet terug te lezen, dus de instelling zelf is geen bewijs.

**Daarom gemeten aan de draaiende app** in plaats van aan het formulier: `app.preview.bestuurdersportaal.com` gescand op Supabase-hosts in de pagina en in alle resource-requests. Uitkomst: **precies één** Supabase-host, en dat is de **Preview**-ref. De productie-ref komt er niet in voor.

Daarmee is het scenario dat §5.5 urgent maakte — een verplichte preview-deploy die bij elke wijziging de productiedatabase aanraakt — uitgesloten. Dat is een waarneming, geen aanname.

---

## 6. Wat dit betekent voor de rest van de reeks

- **§0b in elk V-, W- en VEN-ticket blijft staan.** De herkomstpoort dwingt de weg af; §0b beschrijft wát je op preview moet wáárnemen, en dát is het deel dat geen machine kan overnemen.
- **Drie punten resteren**, klein genoeg voor `BESLUIT:`-regels bij EPIC W #91: de deploymentpoort repareren (§5.2), het scannervinkje, en de bescherming van `preview` (§5.4).

> **Het patroon, voor het rapport.** De eerste versie van dit document meldde de poort als volledig afgedwongen, op basis van de vinkjes in de instellingenpagina. Eén meting aan een echte PR liet zien dat de helft ervan niets doet. Dat is geen tegenslag maar de illustratie van de these: *geconfigureerd is niet werkend*, en het verschil is alleen zichtbaar als je meet. De herkomstpoort — die wél is gemeten aan drie merges — werkt. Neem beide op in §14 van het reviewrapport: de eerste als tegenvoorbeeld, de tweede als bevestiging van het patroon.
