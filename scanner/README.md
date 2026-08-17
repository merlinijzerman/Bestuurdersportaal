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
