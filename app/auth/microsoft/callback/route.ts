import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { haalProfiel } from "@/core/lib/profiel";
import { microsoftPilotActief, registreerKoppelfout, voltooiKoppeling } from "@/core/lib/microsoft-connector";
import { veiligeMicrosoftReturnUrl } from "@/core/lib/microsoft-config";
export const dynamic = "force-dynamic";
/** OAuth-uitzondering: Entra initieert deze navigatie. De callback herleidt de
 * gebruiker uitsluitend uit de bestaande Supabase-sessie en de eenmalige private transactie. */
export async function GET(req: NextRequest) {
  const fallback = new URL("/profiel?microsoft=fout", req.url);
  let auditContext: { fondsId: string; gebruikerId: string } | null = null;
  const state = req.nextUrl.searchParams.get("state"), code = req.nextUrl.searchParams.get("code"), providerError = req.nextUrl.searchParams.get("error");
  if (!state || !code || providerError) return NextResponse.redirect(fallback, { headers: { "Cache-Control": "no-store" } });
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(fallback, { headers: { "Cache-Control": "no-store" } });
    const profiel = await haalProfiel(supabase, user.id);
    if (!profiel?.fondsId || !(await microsoftPilotActief(supabase, profiel.fondsId))) return NextResponse.redirect(fallback, { headers: { "Cache-Control": "no-store" } });
    auditContext = { fondsId: profiel.fondsId, gebruikerId: user.id };
    const returnTo = veiligeMicrosoftReturnUrl(await voltooiKoppeling({ fondsId: profiel.fondsId, gebruikerId: user.id, state, code }));
    const bestemming = new URL(returnTo, req.url);
    bestemming.searchParams.set("microsoft", "gekoppeld");
    return NextResponse.redirect(bestemming, { headers: { "Cache-Control": "no-store" } });
  } catch {
    if (auditContext) await registreerKoppelfout(auditContext).catch(() => undefined);
    return NextResponse.redirect(fallback, { headers: { "Cache-Control": "no-store" } });
  }
}
