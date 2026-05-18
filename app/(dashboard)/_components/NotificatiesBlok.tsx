"use client";

// ============================================================
//  NotificatiesBlok — Iteratie 3-A (2026-05-18)
//
//  Client-component die ongelezen + recente notificaties toont
//  binnen het "Uw recente activiteit"-blok op de homepage.
//
//  Patroon: optimistische "mark als gelezen" bij klik, daarna
//  router.refresh() zodat de server-render up-to-date is. Bij
//  fout wordt de UI-state teruggedraaid en een log-melding
//  geschreven (geen disruptive error-toast — een gemiste
//  read-state is een UX-irritatie, geen blokker).
// ============================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  vormNotificatieZin,
  bouwNotificatieLink,
  notificatieIcoon,
  type NotificatieType,
} from "@/lib/notifications";

type NotifRow = {
  id: string;
  type: NotificatieType;
  payload: Record<string, unknown>;
  gerelateerd_aan_type: string | null;
  gerelateerd_aan_id: string | null;
  aangemaakt: string;
  gelezen_op: string | null;
};

function formatRelatief(d: string) {
  const dt = new Date(d);
  const verschil = Date.now() - dt.getTime();
  const min = Math.floor(verschil / 60000);
  const uur = Math.floor(verschil / 3600000);
  const dag = Math.floor(verschil / 86400000);
  if (min < 1) return "zojuist";
  if (min < 60) return `${min} min geleden`;
  if (uur < 24) return `${uur} uur geleden`;
  if (dag === 1) return "gisteren";
  if (dag < 7) return `${dag} dagen geleden`;
  return dt.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

export default function NotificatiesBlok({
  initieelNotificaties,
}: {
  initieelNotificaties: NotifRow[];
}) {
  const router = useRouter();
  const [notificaties, setNotificaties] = useState<NotifRow[]>(initieelNotificaties);
  const [bulkBezig, setBulkBezig] = useState(false);
  const [, startTransition] = useTransition();

  const ongelezen = notificaties.filter((n) => n.gelezen_op === null);
  const ongelezenAantal = ongelezen.length;

  async function markeerGelezen(id: string) {
    // Optimistische update: zet `gelezen_op` lokaal vóór de API-call.
    const nu = new Date().toISOString();
    setNotificaties((prev) =>
      prev.map((n) => (n.id === id ? { ...n, gelezen_op: nu } : n))
    );

    try {
      const res = await fetch(`/api/notificaties/${id}/lezen`, { method: "PATCH" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Server-state synchroniseren — onbelangrijke achtergrond-refresh.
      startTransition(() => router.refresh());
    } catch (e) {
      // Soft-fail: zet lokaal terug; de gebruiker kan opnieuw klikken.
      // Geen toast — dit is geen blokkerende fout.
      console.error("Markeren mislukt:", e);
      setNotificaties((prev) =>
        prev.map((n) => (n.id === id ? { ...n, gelezen_op: null } : n))
      );
    }
  }

  async function markeerAllesGelezen() {
    if (bulkBezig || ongelezenAantal === 0) return;
    setBulkBezig(true);

    const nu = new Date().toISOString();
    const vorigeStaat = notificaties;
    // Optimistische update
    setNotificaties((prev) =>
      prev.map((n) => (n.gelezen_op === null ? { ...n, gelezen_op: nu } : n))
    );

    try {
      const res = await fetch("/api/notificaties/alles-lezen", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (e) {
      console.error("Bulk-markeren mislukt:", e);
      setNotificaties(vorigeStaat);
    } finally {
      setBulkBezig(false);
    }
  }

  if (notificaties.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
          Meldingen{ongelezenAantal > 0 ? ` (${ongelezenAantal})` : ""}
        </div>
        {ongelezenAantal > 0 && (
          <button
            type="button"
            onClick={markeerAllesGelezen}
            disabled={bulkBezig}
            className="text-[11px] text-[#0F2744] hover:text-[#C9A84C] disabled:opacity-50"
          >
            Alles als gelezen
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {notificaties.map((n) => {
          const zin = vormNotificatieZin(n.type, n.payload);
          const link = bouwNotificatieLink(
            n.gerelateerd_aan_type,
            n.gerelateerd_aan_id,
            n.payload
          );
          const isOngelezen = n.gelezen_op === null;
          const icoon = notificatieIcoon(n.type);

          const inhoud = (
            <div className="flex items-center justify-between gap-3 group">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`flex-shrink-0 text-sm ${
                    isOngelezen ? "text-[#C9A84C]" : "text-gray-400"
                  }`}
                  aria-hidden
                >
                  {icoon}
                </span>
                <span
                  className={`text-sm truncate ${
                    isOngelezen ? "text-[#0F2744] font-medium" : "text-gray-500"
                  }`}
                >
                  {zin.length > 70 ? `${zin.substring(0, 70)}…` : zin}
                </span>
              </div>
              <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">
                {formatRelatief(n.aangemaakt)}
              </span>
            </div>
          );

          if (link) {
            return (
              <Link
                key={n.id}
                href={link}
                onClick={() => {
                  if (isOngelezen) {
                    // Voer asynchroon uit; navigatie blokkeert niet.
                    void markeerGelezen(n.id);
                  }
                }}
                className="block hover:text-[#C9A84C] transition-colors"
              >
                {inhoud}
              </Link>
            );
          }
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (isOngelezen) void markeerGelezen(n.id);
              }}
              className="w-full text-left hover:text-[#C9A84C] transition-colors"
            >
              {inhoud}
            </button>
          );
        })}
      </div>
    </div>
  );
}
