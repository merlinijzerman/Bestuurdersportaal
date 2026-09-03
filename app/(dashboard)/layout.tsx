import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { haalFondsContext, tenantEnforceAan } from "@/core/lib/tenant-context";
import { beoordeelToegang, type ToegangsOordeel } from "@/core/lib/tenant-enforce";
import { haalFondsConfig } from "@/core/lib/fonds-config";
import DashboardShell from "@/core/components/DashboardShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam, rol, fonds_id, fondsen(naam)")
    .eq("id", user.id)
    .single();

  // 3b-blokkade (wederzijds): een sessie zonder profielen-rij is een
  // platform-identiteit (of een ongeldig account) en hoort niet op de
  // tenant-surface. Stuur door naar de tenant-login; de platform-kant heeft
  // zijn eigen gate in app/(platform)/platform/(beveiligd)/layout.tsx.
  if (!profiel) {
    redirect("/login");
  }

  // ── T1.2/T1.3: host→fonds-resolutie + fail-closed afdwinging ──────────────
  // Bepaal de fondscontext server-side uit de request-host, log de uitkomst +
  // een eventuele mismatch (observe, besluit 0041) en dwing af als
  // TENANT_ENFORCE=on (fail-closed, besluit 0042). De layout is het pagina-
  // chokepoint voor de tenant-surface; API-routes hebben hun eigen enforce
  // (T1.3). Observe blijft ook onder enforce staan. Best-effort voor de LOGGING:
  // een logfout mag de render nooit breken. Het OORDEEL is echter reliable —
  // faalt de resolutie hard, dan weigeren we onder enforce (fail-closed).
  const sessieFondsId = profiel.fonds_id ?? null;
  let oordeel: ToegangsOordeel = { toegestaan: true };
  try {
    const host = (await headers()).get("host");
    const resolutie = await haalFondsContext(host);
    const hostFondsId = resolutie.type === "gevonden" ? resolutie.fondsId : null;
    const mismatch = hostFondsId !== null && hostFondsId !== sessieFondsId;
    // Proportioneel loggen (besluit 0041): alleen de anomalieën — een onbekende
    // host of een host-fonds ≠ profiel-fonds. De happy path (gevonden + match)
    // is de verwachte steady state en blijft stil, zodat afwezigheid-van-warns
    // "host→fonds klopt" aantoont en de UUID-frequentie beperkt blijft.
    if (resolutie.type !== "gevonden" || mismatch) {
      console.warn("[TENANT-RESOLVE]", {
        host,
        resolutie: resolutie.type,
        hostFondsId,
        sessieFondsId,
        mismatch,
        gebruikerId: user.id,
        enforce: tenantEnforceAan(),
      });
    }
    oordeel = beoordeelToegang({
      resolutie,
      sessieFondsId,
      enforce: tenantEnforceAan(),
    });
  } catch (e) {
    console.warn(
      "[TENANT-RESOLVE] resolutie faalde",
      e instanceof Error ? e.message : e
    );
    // Fail-closed: een harde resolutiefout weigeren we alléén onder enforce.
    if (tenantEnforceAan()) {
      oordeel = { toegestaan: false, reden: "onbekende-host" };
    }
  }

  // Fail-closed blokkade (besluit 0042): geen redirect (voorkomt een lus met de
  // login-gate), maar een expliciete mismatch-pagina die de blokker benoemt —
  // conform het UX-principe "maak vereisten en blokkers expliciet".
  if (!oordeel.toegestaan) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold">Geen toegang op dit adres</h1>
          <p className="text-sm text-muted">
            {oordeel.reden === "fonds-mismatch"
              ? "Dit webadres hoort bij een ander fonds dan uw account. Log in via het adres van uw eigen fonds."
              : "Dit webadres is niet gekoppeld aan een bekend fonds. Controleer of u het juiste adres van uw fonds gebruikt."}
          </p>
        </div>
      </main>
    );
  }

  // Supabase kan `fondsen` als array of als enkel object teruggeven,
  // afhankelijk van de relatie en versie van @supabase/supabase-js.
  // Robuust: behandel beide gevallen.
  const fondsenRel = profiel?.fondsen as
    | { naam: string }
    | { naam: string }[]
    | null
    | undefined;
  const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
  const fondsNaam = fondsenObj?.naam || process.env.NEXT_PUBLIC_FONDS_NAAM;

  // ── T8: fonds-config (theming + manifest + branding) ──────────────────────
  // Server-side afgeleid uit profiel.fonds_id (nooit uit de request). De theming-
  // CSS is een gevalideerde, veilige :root-override (allowlist in fonds-config-
  // core); ontbreekt config, dan valt alles terug op globals.css (fail-safe). Het
  // manifest bepaalt UITSLUITEND welke nav-items zichtbaar zijn — de autorisatie
  // blijft server-side (requireCapability/RLS + module-guard per route).
  let themingCss = "";
  let beschikbareModules: string[] | undefined;
  let logoLetter: string | undefined;
  let logoUrl: string | undefined;
  if (profiel.fonds_id) {
    try {
      const config = await haalFondsConfig(profiel.fonds_id);
      themingCss = config.themingCss;
      beschikbareModules = [...config.beschikbareModules];
      logoLetter = config.branding.logoLetter;
      logoUrl = config.branding.logoUrl;
    } catch (e) {
      // Fail-safe: config-fout mag de tenant-render nooit breken → defaults.
      console.warn("[FONDS-CONFIG] laden faalde", e instanceof Error ? e.message : e);
    }
  }

  return (
    <div className="min-h-screen">
      {themingCss && (
        <style
          // Veilige, server-gevalideerde tokens (allowlist: alleen RGB-triples →
          // CSS-vars). Geen gebruikersinvoer belandt ongefilterd in deze <style>.
          dangerouslySetInnerHTML={{ __html: themingCss }}
        />
      )}
      <DashboardShell
        gebruikerNaam={profiel?.naam}
        gebruikerRol={profiel?.rol}
        fondsNaam={fondsNaam}
        beschikbareModules={beschikbareModules}
        logoLetter={logoLetter}
        logoUrl={logoUrl}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
