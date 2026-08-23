# WP3 ClamAV-scanner

Afzonderlijk Vercel-containerproject voor malwarescans. Configureer in Vercel
de rootdirectory als `scanner/`, Fluid Compute, regio `arn1` en 4 GB / 2 vCPU.

Verplichte environmentvariabelen, afzonderlijk voor Preview en Production:

- `SCANNER_OIDC_ISSUER`: `https://oidc.vercel.com/<team-slug>`
- `SCANNER_OIDC_AUDIENCE`: unieke audience voor deze scanner
- `SCANNER_OIDC_SUBJECT`: beheerproject en environment, bijvoorbeeld
  `owner:<team>:project:<beheer>:environment:preview`
- `SCANNER_OIDC_OWNER_ID`: onveranderlijk Vercel team-ID
- `SCANNER_OIDC_PROJECT_ID`: onveranderlijk ID van het beheerproject
- `SCANNER_SUPABASE_HOST`: exact `<project-ref>.supabase.co`

Het project bevat bewust geen Supabase-, database- of leverancierscredential.
`GET /health` is openbaar en bevat alleen engine- en deploymentmetadata.
`POST /scan` vereist een geldig Vercel OIDC-token en accepteert uitsluitend een
kortlevende signed URL naar de vaste quarantainebucket.

## Deploydiscipline — hook-only

De scanner bevat de ClamAV-signatures in zijn containerimage. Een gewone
Git-push zou dus telkens een nieuw, groot Vercel Container Registry-image
maken, ook wanneer alleen app-, beheer- of documentatiecode verandert. Daarom
staat in `vercel.json` onvoorwaardelijk:

```json
"git": { "deploymentEnabled": false }
```

Dit is een harde grens: **geen enkele Git-branch** mag de scanner automatisch
deployen. De test `test/vercel-config.test.mjs` bewaakt die instelling in CI.

Alleen een bestaande, gecontroleerde Vercel Deploy Hook mag de image verversen:

1. de dagelijkse signature-refresh gebruikt de hook met `buildCache=false`;
2. na een wijziging onder `scanner/` draait eerst `npm test`; daarna wordt
   diezelfde hook bewust gestart voor de betreffende omgeving;
3. app- en beheer-previewdeployments gebruiken de al gevalideerde
   scannerdeployment van hun omgeving — ze bouwen geen eigen scannerimage.

Schakel Git-deploys niet tijdelijk in om een scannerrelease te doen. Dat opent
opnieuw de route waarin iedere feature-commit een image en registry-opslag
maakt. Gebruik de hook of een doelbewuste deployment vanuit het dashboard.

Previewcontrole:

1. `npm test`
2. `npm run test:w0:prepare` genereert lokaal het testcorpus en een kortlevend
   self-signed certificaat. Deze bestanden worden bewust niet gecommit.
3. Bouw de image zonder cache en controleer de EICAR- en configuratiepoorten.
4. Controleer `/health`, regio, geheugen en koude start.
5. Test geldige en ongeldige OIDC-claims en het SSRF-corpus.
6. Activeer nog geen productie-uploadpad voordat de cron-OIDC-canary geslaagd is.
