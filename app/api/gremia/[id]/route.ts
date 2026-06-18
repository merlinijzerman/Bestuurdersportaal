import { organenPatch } from "@/lib/organen-route";

export const { PATCH } = organenPatch({
  tabel: "gremia",
  entiteit: "gremium",
  heeftType: true,
  label: "gremia",
});
