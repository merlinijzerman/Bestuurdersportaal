import type { NextConfig } from "next";

// ============================================================================
// Security Headers — Route A WP1 (zie SECURITY-ROUTE-A-PLAN.md §3.WP1)
// ----------------------------------------------------------------------------
// Doel: het portaal in één keer van securityheaders.com-grade F naar grade A
// brengen door alle nul-kosten browser-side hardening-headers expliciet te
// zetten. Iedere header heeft een specifieke pen-test-bevinding die hij
// voorkomt — zie comments per regel.
//
// CSP-keuze (zie SECURITY-ROUTE-A-PLAN.md §3.WP1 "Let op CSP"): `unsafe-inline`
// en `unsafe-eval` in script-src zijn een tijdelijke concessie omdat Next.js
// inline scripts gebruikt voor hydratatie. Strikt CSP via nonces hoort in
// Route B. Voor Route A is dit een evidence-based "good enough".
//
// connect-src whitelist:
// - 'self'                           → eigen API-routes
// - https://*.supabase.co            → Supabase REST + Auth
// - https://api.anthropic.com        → AI-calls vanuit server (niet vanuit
//                                       browser, maar Next.js fetches uit
//                                       Server Components komen ook op de
//                                       client-CSP terecht via inline scripts)
// - https://*.vercel-insights.com    → Vercel Web Analytics + Speed Insights
//
// Custom domain: per gebruikersvoorkeur (mei 2026) alleen Vercel-default URL
// in deze ronde. Bij toevoegen van custom domain moet `connect-src` worden
// uitgebreid en de CSRF-allowlist in middleware.ts (WP5) ook.
// ============================================================================

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel-insights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://api.anthropic.com https://*.vercel-insights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  // Voorkomt clickjacking via iframe-embed door derden. Sluit aan op
  // frame-ancestors 'none' in CSP — die is de moderne variant, X-Frame-Options
  // de fallback voor oudere browsers.
  { key: "X-Frame-Options", value: "DENY" },

  // Voorkomt MIME-type-sniffing-aanvallen waarbij een browser een geüpload
  // .jpg-bestand als executable interpreteert.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Voorkomt referrer-leakage naar derden bij externe links. Eigen domein
  // behoudt volledige URL, ander domein krijgt alleen scheme + host.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Schakelt browser-features uit die we niet gebruiken — kan niet via JS
  // overschreven worden, dus prompt-injectie kan geen camera/mic/locatie
  // forceren.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },

  // Dwingt HTTPS af voor 2 jaar inclusief subdomeinen. `preload`-token meldt
  // het portaal aan voor de browser-HSTS-lijst (handmatig submitten via
  // hstspreload.org als productie-URL stabiel is — niet automatisch).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },

  // Content Security Policy — de zwaarste hardening-header. Beperkt waar
  // scripts/styles/connections vandaan mogen komen. Zie comment-blok boven.
  { key: "Content-Security-Policy", value: cspDirectives },
];

const nextConfig: NextConfig = {
  // Document-extractie packages moeten als externe Node-packages geladen worden in
  // server components, anders crasht de build. In Next.js 15+ heet deze optie
  // `serverExternalPackages`.
  // - unpdf: PDF-tekstextractie (modern pdfjs onder de motorkap, Vercel-vriendelijk)
  // - mammoth: Word (.docx) tekstextractie
  // - xlsx: Excel (.xlsx) parsing
  serverExternalPackages: ["unpdf", "mammoth", "xlsx"],

  // ESLint bewust NIET tijdens `next build` draaien. Sinds T9 staat er een
  // eslint.config.mjs in de repo (alleen code-scheiding-boundaries, geen
  // next/recommended-ruleset). Zonder deze vlag zou `next build` die config
  // oppakken en op de bestaande code gaan linten — buiten scope en risico op
  // een gebroken Vercel-build. De boundary-gate draait bewust los
  // (`npm run lint:boundaries` + eigen CI-job). Zie eslint.config.mjs.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Server-action-payloadlimiet op één lijn met de 25 MB-bestandsvalidatie
  // (lib/bestand-validatie.ts MAX_BESTAND_BYTES). Next.js' default is 1 MB; een
  // upload via FormData (curatieAanmaken/curatieVervangen) sneuvelde daarop
  // vóór de eigen validatie en crashte de client. 30 MB geeft marge voor de
  // overige formuliervelden; de echte poort blijft valideerUpload (25 MB).
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },

  // Security headers — op alle routes. Zie comment-blok bovenaan dit bestand.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  // Korte, deelbare alias voor de EU AI Act-verdiepingspagina. Redirects draaien
  // vóór de middleware (volgorde: headers → redirects → middleware → rewrites),
  // dus /ai-act hoeft NIET in MARKETING_PUBLIEKE_PADEN: de redirect vuurt al
  // voordat de allowlist-check wordt bereikt. Canonieke URL blijft
  // /governance-ai/eu-ai-act (permanent → 308, deelt SEO-signaal).
  async redirects() {
    return [
      {
        source: "/ai-act",
        destination: "/governance-ai/eu-ai-act",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
