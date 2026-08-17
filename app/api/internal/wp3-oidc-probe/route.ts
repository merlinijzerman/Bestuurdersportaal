import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Tijdelijke W0-probe. Hiermee kunnen we in Preview vaststellen dat Vercel een
 * workload-identity-token meestuurt zonder CRON_SECRET of het token zelf te
 * hoeven uitlezen. Verwijderen na het WP3-go/no-go-besluit.
 */
export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  const token = req.headers.get("x-vercel-oidc-token");
  let claims: Record<string, unknown> = {};

  try {
    const payload = token?.split(".")[1];
    if (payload) {
      const { iss, aud, sub, owner_id, project_id, environment, exp, iat } = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8")
      );
      claims = {
        iss,
        aud,
        sub,
        owner_id,
        project_id,
        environment,
        levensduur_s:
          typeof exp === "number" && typeof iat === "number" ? exp - iat : null,
      };
    }
  } catch {
    claims = { fout: "onleesbaar" };
  }

  console.log(
    JSON.stringify({
      tag: "wp3-oidc-preview-probe",
      aanwezig: Boolean(token),
      ...claims,
    })
  );

  return NextResponse.json({ ok: true, oidcAanwezig: Boolean(token) });
}
