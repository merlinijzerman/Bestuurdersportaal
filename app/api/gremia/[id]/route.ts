import { organenPatch } from "@/core/lib/organen-route";

export const { PATCH } = organenPatch({
  tabel: "gremia",
  entiteit: "gremium",
  heeftType: true,
  label: "gremia",
});
