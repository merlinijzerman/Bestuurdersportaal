"use client";

import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PlatformUitloggen() {
  const router = useRouter();
  const [bezig, setBezig] = useState(false);

  async function uitloggen() {
    setBezig(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/platform/login");
    router.refresh();
  }

  return (
    <button
      onClick={uitloggen}
      disabled={bezig}
      className="rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white hover:bg-white/10 disabled:opacity-50"
    >
      {bezig ? "Uitloggen…" : "Uitloggen"}
    </button>
  );
}
