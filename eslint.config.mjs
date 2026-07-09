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

  // Basis: TypeScript-parser voor alle .ts/.tsx (zonder eigen regels).
  {
    files: TS_FILES,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
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
];
