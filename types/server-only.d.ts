// Ambient declaratie zodat `import "server-only"` type-checkt onder
// moduleResolution: bundler. `server-only` wordt door Next.js meegeleverd
// (node_modules/next/dist/compiled/server-only) en via een bundler-alias
// geresolved, maar is in deze install niet naar de top-level node_modules
// gehoist. Deze declaratie is PUUR type-only (wordt geërased bij build); de
// build-time guard van Next — die een import vanuit een client component laat
// falen — blijft volledig werken.
declare module "server-only";
