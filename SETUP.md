# Bestuurdersportaal MVP — Setup in 30 minuten

## Stap 1 — Node.js installeren (5 min)

1. Ga naar **https://nodejs.org**
2. Klik op de groene knop **"LTS"** (de aanbevolen versie)
3. Download en installeer (gewoon "Next" klikken door de installer)
4. Controleer of het gelukt is: open Terminal (Mac) of Command Prompt (Windows) en typ:
   ```
   node --version
   ```
   Je zou iets als `v22.x.x` moeten zien.

---

## Stap 2 — Supabase account aanmaken (5 min)

1. Ga naar **https://supabase.com** en klik "Start your project"
2. Maak een account aan (gratis)
3. Klik "New project", kies een naam (bijv. `bestuurdersportaal`) en een wachtwoord
4. Kies regio: **West Europe (Frankfurt)** — verplicht voor AVG
5. Wacht ~2 minuten tot het project klaar is

**Schema instellen:**
1. Ga in Supabase naar: **SQL Editor** (links in het menu)
2. Klik "New query"
3. Kopieer de volledige inhoud van het bestand `supabase/schema.sql`
4. Plak in de editor en klik **"Run"**
5. Je ziet "Success" als alles goed gaat

**API-sleutels ophalen:**
1. Ga naar **Project Settings** → **API**
2. Kopieer de **Project URL** (begint met `https://`)
3. Kopieer de **anon/public** sleutel

---

## Stap 3 — Anthropic API account (5 min)

1. Ga naar **https://console.anthropic.com**
2. Maak een account aan en voeg een betaalmethode toe
3. Ga naar **API Keys** en klik "Create Key"
4. Kopieer de sleutel (begint met `sk-ant-`)

> 💡 Kosten: Claude claude-sonnet-4-5 kost ca. €0,003 per vraag. Voor een MVP met 100 vragen/maand = < €1.

---

## Stap 4 — Project configureren (2 min)

1. Open de map `mvp` op je computer
2. Kopieer het bestand `.env.example` en hernoem de kopie naar `.env.local`
3. Open `.env.local` in een teksteditor (Notepad, TextEdit) en vul in:

```
NEXT_PUBLIC_SUPABASE_URL=https://jouw-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...  (de anon sleutel van Supabase)
ANTHROPIC_API_KEY=sk-ant-...               (jouw Anthropic sleutel)
NEXT_PUBLIC_FONDS_NAAM=Stichting Pensioenfonds Horizon
```

**Optioneel — AI Quality Lab multi-provider (AQL-6, alleen voor de providervergelijking).**
Deze keys zijn **server-side only** (nooit `NEXT_PUBLIC_`) en worden pas gezet nadat de
governance-poort groen is (decision `0064`, FG/DPO-akkoord). Zonder key blijft de betreffende
challenger simpelweg onbruikbaar; de baseline (Claude) draait ongewijzigd.

```
OPENAI_API_KEY=sk-...        # OpenAI GPT-challenger (reguliere api.openai.com)
MISTRAL_API_KEY=...          # Mistral: embeddings/OCR én (AQL-6) generatie-challenger
# Optioneel voor de latere EU-migratie (config-wissel, geen herbouw):
# OPENAI_BASE_URL=https://<azure-openai-eu-endpoint>/...   (default: https://api.openai.com/v1)
# MISTRAL_CHAT_URL=https://<mistral-eu-endpoint>/v1/chat/completions
```

> ⚠️ Externe providers draaien uitsluitend op de **synthetische golden set** — nooit echte
> fondsdata (decision `0064`). No-training aan; EU-residentie is bewust uitgesteld (roadmap).

---

## Stap 5 — Applicatie starten (3 min)

Open Terminal/Command Prompt, navigeer naar de `mvp` map en voer uit:

```bash
# Ga naar de mvp map
cd pad/naar/mvp

# Installeer de packages (eenmalig, duurt ~1 minuut)
npm install

# Start de applicatie
npm run dev
```

Open je browser en ga naar: **http://localhost:3000**

---

## Stap 6 — Eerste gebruiker aanmaken

1. Ga naar Supabase Dashboard → **Authentication** → **Users**
2. Klik "Invite user" of "Add user"
3. Vul een e-mailadres en wachtwoord in
4. Log in via http://localhost:3000/login

---

## Stap 7 — Eerste document uploaden

1. Ga in het portaal naar **Documentbibliotheek**
2. Klik "Document uploaden"
3. Upload een PDF (bijv. de DNB Leidraad Deskundigheid)
4. Kies bron "DNB" en bibliotheek "Generiek"
5. Na upload ga naar **AI Assistent** en stel een vraag!

---

## Stap 8 — Contactformulier: e-mailnotificatie instellen (Mailgun) — TODO

> Het contactformulier (`/contact`, W2) **slaat altijd op** in Supabase, ook zonder
> mail. De mail is een **soft-fail-notificatie**: lukt-ie niet, dan blijft de
> aanvraag bewaard en wordt het record gemarkeerd. Deze stap zet de notificatie aan.
> Mailgun-**sandbox** is bewust een tussenoplossing (geen DNS nodig); Resend of een
> geverifieerd `the-paradox.com`-domein is de doelopzet voor later.

**A. Mailgun-account + sandbox (eenmalig)**

- [ ] Maak een account op **https://www.mailgun.com** (gratis tier volstaat voor de sandbox).
- [ ] Kies bij registratie/region **EU** (NL-context; de code gebruikt standaard `https://api.eu.mailgun.net`).
- [ ] Ga naar **Sending → Domains** en open het automatisch aangemaakte **sandbox-domein** (`sandboxXXXX.mailgun.org`).
- [ ] **Autoriseer beide ontvangers** onder *Authorized Recipients*: `merlin.ijzerman@the-paradox.com` én `robert.timmer@the-paradox.com`. **Belangrijk:** een sandbox stuurt alléén naar geautoriseerde adressen — beide moeten de bevestigingsmail accepteren, anders komt de notificatie niet aan.
- [ ] Kopieer de **private API-key** (Mailgun → *Send → API keys*; begint meestal met `key-...`).
- [ ] Noteer de **sandbox-domeinnaam** (`sandboxXXXX.mailgun.org`).

**B. Environment variables (lokaal in `.env.local`, en in Vercel voor productie)**

Vul deze server-side variabelen in — **nooit als `NEXT_PUBLIC_*`**:

```
MAILGUN_API_KEY=key-...                      # private API-key uit Mailgun
MAILGUN_DOMAIN=sandboxXXXX.mailgun.org       # jouw sandbox-domein
MAILGUN_BASE_URL=https://api.eu.mailgun.net  # optioneel; dit is al de default (EU)
CONTACT_NOTIFY_TO=merlin.ijzerman@the-paradox.com,robert.timmer@the-paradox.com
CONTACT_NOTIFY_FROM=postmaster@sandboxXXXX.mailgun.org   # sandbox: postmaster@<domein>
CONTACT_IP_HASH_SALT=<een-lange-willekeurige-string>     # voor de rate-limit (geen ruw IP)
SUPABASE_SERVICE_ROLE_KEY=<service_role-key uit Supabase> # Project Settings → API
```

- [ ] In `.env.local` ingevuld (in `mvp/.env.local` staan al uitgecommentarieerde regels — haal het `#` weg en vul de waarden in).
- [ ] In **Vercel** dezelfde variabelen gezet onder *Project → Settings → Environment Variables*.

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` is óók nodig voor de platform-back-office. Zonder deze
> sleutel geeft het contactformulier een nette foutmelding en wordt er niets opgeslagen.
> Genereer `CONTACT_IP_HASH_SALT` bijv. met `openssl rand -hex 32` in de Terminal.

**C. Deploy + verifiëren**

- [ ] Code is via een PR naar `preview` gegaan (client vrij: `gh` of GitHub Desktop) → Vercel deployt de Preview-omgeving; promotie naar `main` volgt met expliciet akkoord. Zie `CLAUDE.md` r. 53 en `decisions/0207`.
- [ ] Lokaal smoke-testen: `npm run dev`, ga naar `http://localhost:3000/contact`, vul het formulier in en verstuur.
- [ ] Controleer dat er een rij verschijnt in Supabase → tabel `contact_aanvragen` (kolom `notificatie_verzonden` = `true` als de mail lukte).
- [ ] Controleer dat Merlin **én** Robert de notificatiemail ontvangen (kijk ook in spam).
- [ ] Test dat **antwoorden** op de notificatie naar de aanvrager gaat (`reply-to` = het ingevulde e-mailadres).

**D. Later (niet blokkerend)**

- [ ] Overstap naar **Resend** of een geverifieerd `the-paradox.com`-domein (SPF/DKIM), zodat mail naar elk adres mag en niet meer beperkt is tot geautoriseerde sandbox-ontvangers. De code in `lib/email.ts` is provider-agnostisch: dit raakt alleen de env-variabelen en de fetch-call.

---

## Deployment naar Vercel (optioneel, 10 min)

Om het portaal online te zetten:

1. Maak een account op **https://vercel.com**
2. Installeer de Vercel CLI: `npm i -g vercel`
3. Voer uit in de `mvp` map: `vercel`
4. Volg de stappen en voeg je environment variables toe in het Vercel dashboard

---

## Problemen?

Kom je iets tegen, stuur de foutmelding naar Claude in Cowork — dan lossen we het samen op!
