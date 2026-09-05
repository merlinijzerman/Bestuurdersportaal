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

Previewcontrole:

1. `npm test`
2. `npm run test:w0:prepare` genereert lokaal het testcorpus en een kortlevend
   self-signed certificaat. Deze bestanden worden bewust niet gecommit.
3. Bouw de image zonder cache en controleer de EICAR- en configuratiepoorten.
4. Controleer `/health`, regio, geheugen en koude start.
5. Test geldige en ongeldige OIDC-claims en het SSRF-corpus.
6. Activeer nog geen productie-uploadpad voordat de cron-OIDC-canary geslaagd is.

## Dagelijkse productie-refresh

De signatures worden tijdens de containerbuild opgehaald en niet in een
draaiende container bijgewerkt. Daarom voert
`.github/workflows/scanner-signatures-production.yml` dagelijks om 02:17 UTC
een cacheloze Production-deployment uit via de Vercel CLI. De workflow gebruikt
de afgeschermde `VERCEL_TOKEN` en `VERCEL_TEAM_ID` uit de GitHub-environment
`production-backup`; hij krijgt geen Supabase- of documentcredentials.

Na de deployment controleert de workflow fail-closed de vaste Production-health
`https://project-pnkzy.vercel.app/health`. De run is alleen groen als ClamAV
gereed is, de EICAR-buildpoort is geslaagd, de signature maximaal 48 uur oud is
en de actieve image in de laatste 30 minuten is gebouwd. Een rode run laat de
bestaande gezonde deployment staan en moet als productie-incident worden
behandeld. De workflow kan voor herstel ook handmatig worden gestart.
