// ============================================================================
//  ESLint flat-config — code-scheiding boundaries (T9, besluit 0040 §B5)
// ----------------------------------------------------------------------------
//  Dwingt de EENRICHTINGSAFHANKELIJKHEID tussen de lagen af:
//
//    core/       ← gedeeld product. Mag NOOIT uit fondsen/* of platform/*.
//    platform/   ← back-office. Mag core/* wel; fondsen/* niet.
//    fondsen/<a> ← fonds-specifiek. Mag core/*; NIET fondsen/<b> (ander fonds).
//
//  Dit is een ONDERHOUDS-/REVIEW-/IP-maatregel, GEEN runtime-isolatie: alle
//  fonds-code draait in dezelfde build/runtime (bridge-ready pool, 0040 B1/B5).
//  Harde runtime-isolatie = niveau 3/4 = betaalde TP2-variant, buiten scope.
//
//  BEWUST MINIMAAL: deze config zet ALLEEN `no-restricted-imports` (core-regel,
//  geen plugin nodig) op de laaggrenzen. Het is expliciet NIET de volledige
//  next/recommended-ruleset — die zou honderden buiten-scope-bevindingen op de
//  bestaande code geven. `next build` linting staat daarom uit
//  (next.config.ts → eslint.ignoreDuringBuilds). Deze gate draait los, via
//  `npm run lint:boundaries` en (fase 2) een eigen CI-job.
//
//  NIEUW FONDS TOEVOEGEN: map `fondsen/<slug>/` aanmaken én de slug hieronder
//  aan FONDS_SLUGS toevoegen, anders geldt de onderlinge-scheidingsregel niet.
// ============================================================================

import tsParser from "@typescript-eslint/parser";

/** Bekende fonds-slugs. Houd in sync met de submappen onder `fondsen/`. */
const FONDS_SLUGS = ["pgb", "horizon"];

const TS_FILES = ["**/*.ts", "**/*.tsx"];

// No-op stub-rules zodat bestaande `eslint-disable`-comments voor de next/
// react-hooks-ruleset (die deze minimale, boundary-only config bewust NIET laadt)
// oplossen naar een bekende regel i.p.v. "Definition for rule not found" te
// geven. De regels doen niets — ze laten de gate alleen niet struikelen over
// directieven die voor `next lint` bedoeld zijn. Boundary T9 fase 2.
const noopRule = { meta: { schema: [] }, create: () => ({}) };
function stubPlugin(ruleNames) {
  return { rules: Object.fromEntries(ruleNames.map((r) => [r, noopRule])) };
}

/** Glob-varianten die één laag-/fondsprefix afdekken: alias (@/x) én relatief (../x). */
function laagGlobs(prefix) {
  return [`@/${prefix}`, `@/${prefix}/**`, `**/${prefix}`, `**/${prefix}/**`];
}

function verbied(patterns) {
  return { "no-restricted-imports": ["error", { patterns }] };
}

export default [
  {
    ignores: ["node_modules/**", ".next/**"],
  },

  // Basis: TypeScript-parser voor alle .ts/.tsx (zonder eigen regels). De
  // stub-plugins laten bestaande next/react-hooks `eslint-disable`-comments
  // schoon oplossen; reportUnusedDisableDirectives uit zodat die no-op-directieven
  // geen "unused"-ruis geven. De boundary-regel zelf staat los hieronder.
  {
    files: TS_FILES,
    plugins: {
      "@next/next": stubPlugin(["no-img-element"]),
      "react-hooks": stubPlugin(["exhaustive-deps"]),
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    // F0.6 (bouwticket async-ingest v2.1): `no-unreachable` als harde regel.
    // Aanleiding: in embeddings-backfill/route.ts stond een rate-limitcheck ná
    // een `return` binnen een if-blok — nooit uitgevoerd, terwijl een comment
    // claimde dat bevinding M-06 was opgelost. `tsc` ziet dit niet en de
    // boundary-only config laadde geen ruleset die het ving. Dit is een
    // KERN-ESLint-regel (geen plugin nodig) en draait dus mee in
    // `npm run lint:boundaries`.
    rules: {
      "no-unreachable": "error",
    },
  },

  // core/ — mag niet uit fondsen/* en niet uit platform/*.
  {
    files: ["core/**/*.ts", "core/**/*.tsx"],
    rules: verbied([
      {
        group: laagGlobs("fondsen"),
        message:
          "core mag NIET uit fondsen/* importeren (eenrichting: core kent geen fonds). Boundary T9.",
      },
      {
        group: laagGlobs("platform"),
        message:
          "core mag NIET uit platform/* importeren (platform is consument van core). Boundary T9.",
      },
    ]),
  },

  // platform/ — mag core/* wel, fondsen/* niet.
  {
    files: ["platform/**/*.ts", "platform/**/*.tsx"],
    rules: verbied([
      {
        group: laagGlobs("fondsen"),
        message:
          "platform mag NIET uit fondsen/* importeren (platform is fonds-overstijgend). Boundary T9.",
      },
    ]),
  },

  // fondsen/<slug>/ — mag core/*, NIET een ander fonds.
  ...FONDS_SLUGS.map((slug) => ({
    files: [`fondsen/${slug}/**/*.ts`, `fondsen/${slug}/**/*.tsx`],
    rules: verbied([
      {
        group: FONDS_SLUGS.filter((s) => s !== slug).flatMap((ander) =>
          laagGlobs(`fondsen/${ander}`),
        ),
        message:
          "Een fonds mag NIET uit een ander fonds importeren (gebruik core/*). Boundary T9.",
      },
    ]),
  })),

  // ── App-route-boundary (T9 fase 2) ────────────────────────────────────────
  // App Router-routes wonen fysiek in app/ (Next-vereiste), maar volgen dezelfde
  // eenrichting. De tenant- en publieke surface mogen NOOIT uit platform/*
  // importeren — dat is de service-role-laag (RLS-bypass). Dit is de statische
  // tegenhanger van scripts/check-service-role-leak.sh: geen platform-laag op de
  // internet-facing surface. fondsen/* is ook verboden (surface is fonds-agnost).
  {
    files: [
      "app/(dashboard)/**/*.ts", "app/(dashboard)/**/*.tsx",
      "app/(public)/**/*.ts", "app/(public)/**/*.tsx",
    ],
    rules: verbied([
      {
        group: laagGlobs("platform"),
        message:
          "De tenant/publieke surface mag NIET uit platform/* importeren (service-role-laag, RLS-bypass). Boundary T9.",
      },
      {
        group: laagGlobs("fondsen"),
        message:
          "De tenant/publieke surface mag NIET uit fondsen/* importeren (surface is fonds-agnostisch). Boundary T9.",
      },
    ]),
  },

  // De platform-surface mag core/* + platform/*, maar NIET fondsen/* (platform is
  // fonds-overstijgend, spiegelt de platform/lib-regel).
  {
    files: ["app/(platform)/**/*.ts", "app/(platform)/**/*.tsx"],
    rules: verbied([
      {
        group: laagGlobs("fondsen"),
        message:
          "De platform-surface mag NIET uit fondsen/* importeren (fonds-overstijgend). Boundary T9.",
      },
    ]),
  },
];
