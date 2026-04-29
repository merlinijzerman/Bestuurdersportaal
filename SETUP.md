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

## Deployment naar Vercel (optioneel, 10 min)

Om het portaal online te zetten:

1. Maak een account op **https://vercel.com**
2. Installeer de Vercel CLI: `npm i -g vercel`
3. Voer uit in de `mvp` map: `vercel`
4. Volg de stappen en voeg je environment variables toe in het Vercel dashboard

---

## Problemen?

Kom je iets tegen, stuur de foutmelding naar Claude in Cowork — dan lossen we het samen op!
