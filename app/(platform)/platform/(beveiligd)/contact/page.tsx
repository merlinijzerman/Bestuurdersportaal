// ============================================================================
//  Platform — Contactaanvragen (back-office voor de publieke voorkant).
// ----------------------------------------------------------------------------
//  Toont de publieke contactinzendingen (public.contact_aanvragen) en biedt
//  status-opvolging. De inbox is NIET tenant-gebonden en hoort daarom hier op de
//  platform-back-office, achter de (beveiligd)-gate (platform-identiteit + AAL2).
//
//  LEESKANT via de service-role-client: contact_aanvragen is voor de anon-key
//  deny-by-default (geen RLS-leespolicy, FO REQ-PV-042). Dit is read-only
//  INZICHT — geen businessmutatie — en is gegate op platform.contact.manage.
//  Zelfde precedent als rechten/page.tsx en lib/platform-auth.ts. Alle MUTATIES
//  lopen uitsluitend via de server-action (acties.ts) achter withPlatform.
// ============================================================================

import { createPlatformSupabase } from "@/lib/supabase-platform";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";
import ContactInboxClient, {
  type ContactAanvraagRij,
} from "./_components/ContactInboxClient";

export const dynamic = "force-dynamic";

export default async function ContactPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const caps = identiteit?.capabilities ?? [];
  const magInzien = caps.includes("platform.contact.manage");

  if (!magInzien) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Contactaanvragen</h1>
        </div>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen recht om de contact-inbox in te zien. Dit vereist{" "}
          <code className="font-mono">platform.contact.manage</code>.
        </div>
      </div>
    );
  }

  const svc = createPlatformSupabase();
  const { data: rijenRaw } = await svc
    .from("contact_aanvragen")
    .select(
      "id, aangemaakt_op, naam, organisatie, rol, email, telefoon, type_verzoek, bericht, herkomst_pagina, status, notificatie_verzonden, mail_error, opgevolgd_door, afgehandeld_op"
    )
    .order("aangemaakt_op", { ascending: false });

  const rijen = (rijenRaw ?? []) as ContactAanvraagRij[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Contactaanvragen</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Inzendingen vanaf de publieke voorkant. Volg ze op via de status
          (nieuw &rarr; in behandeling &rarr; afgehandeld). Elke wijziging wordt
          append-only geaudit met wie en wanneer. Inzendingen kunnen
          persoonsgegevens bevatten &mdash; behandel ze conform de
          privacyverklaring.
        </p>
      </div>

      <ContactInboxClient rijen={rijen} />
    </div>
  );
}
