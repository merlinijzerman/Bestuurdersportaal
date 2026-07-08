import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase-server";
import { haalFondsContext } from "@/lib/tenant-context";
import DashboardShell from "@/components/DashboardShell";

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

  // ── T1.2: observerende host→fonds-resolutie (besluit 0040, B4) ────────────
  // Bepaal de fondscontext server-side uit de request-host en log de uitkomst +
  // een eventuele mismatch met het profiel-fonds. OBSERVEREND: nooit blokkeren.
  // De fail-closed afdwinging + dekkende uitrol over alle entrypoints is T1.3;
  // zolang tenant_domains nog niet geseed is voor de pilothosts is `onbekend`
  // het verwachte, niet-blokkerende resultaat. Best-effort: logging mag het
  // renderen van de layout nooit breken.
  try {
    const host = (await headers()).get("host");
    const resolutie = await haalFondsContext(host);
    const hostFondsId = resolutie.type === "gevonden" ? resolutie.fondsId : null;
    const sessieFondsId = profiel.fonds_id ?? null;
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
      });
    }
  } catch (e) {
    console.warn(
      "[TENANT-RESOLVE] observerende resolutie faalde (niet-blokkerend)",
      e instanceof Error ? e.message : e
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

  return (
    <div className="min-h-screen">
      <DashboardShell
        gebruikerNaam={profiel?.naam}
        gebruikerRol={profiel?.rol}
        fondsNaam={fondsNaam}
      />
      <main className="md:ml-64 flex flex-col min-h-screen pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
