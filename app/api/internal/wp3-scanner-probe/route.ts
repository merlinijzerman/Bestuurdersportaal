import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const WACHT_MS = 5_000;

/**
 * Tijdelijke W0-probe voor het volledige beheer → Deployment Protection →
 * scanner-pad. De route bestaat uitsluitend in Preview en stuurt het Vercel
 * OIDC-token door zonder het ooit te loggen of terug te geven.
 */
export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  const oidc = req.headers.get("x-vercel-oidc-token");
  const basis = valideerScannerUrl(process.env.WP3_SCANNER_URL);
  if (!oidc || !basis) {
    return NextResponse.json(
      { ok: false, code: !oidc ? "oidc_ontbreekt" : "scanner_url_ongeldig" },
      { status: 503 }
    );
  }

  let healthStatus = 0;
  for (let poging = 0; poging < 4; poging += 1) {
    const health = await fetch(new URL("/health", basis), {
      cache: "no-store",
      headers: { "x-vercel-oidc-token": oidc },
      signal: AbortSignal.timeout(10_000),
    });
    healthStatus = health.status;
    if (health.ok) break;
    if (health.status !== 503 || poging === 3) break;
    await new Promise((resolve) => setTimeout(resolve, WACHT_MS));
  }

  if (healthStatus !== 200) {
    return NextResponse.json(
      { ok: false, code: "scanner_niet_gereed", healthStatus },
      { status: 502 }
    );
  }

  // Een opzettelijk niet-toegestane hostname test de volledige OIDC-keten
  // zonder documentbytes of een echte signed URL te gebruiken. Alleen een
  // geaccepteerd token bereikt de URL-policy en levert deze gesloten 400 op.
  const scan = await fetch(new URL("/scan", basis), {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${oidc}`,
      "content-type": "application/json",
      "x-vercel-oidc-token": oidc,
    },
    body: JSON.stringify({
      signedUrl:
        "https://niet-toegestaan.invalid/storage/v1/object/sign/documenten-quarantaine/test.pdf",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const lichaam = (await scan.json().catch(() => null)) as { code?: string } | null;
  const oidcGeaccepteerd =
    scan.status === 400 && lichaam?.code === "hostname_niet_toegestaan";

  console.log(
    JSON.stringify({
      tag: "wp3-scanner-preview-probe",
      health_status: healthStatus,
      scan_status: scan.status,
      oidc_geaccepteerd: oidcGeaccepteerd,
    })
  );

  return NextResponse.json(
    {
      ok: oidcGeaccepteerd,
      healthStatus,
      scanStatus: scan.status,
      oidcGeaccepteerd,
    },
    { status: oidcGeaccepteerd ? 200 : 502 }
  );
}

function valideerScannerUrl(waarde: string | undefined): URL | null {
  if (!waarde) return null;
  try {
    const url = new URL(waarde);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      !url.hostname.endsWith(".vercel.app")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}
