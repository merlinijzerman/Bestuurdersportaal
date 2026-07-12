import { organenPatch } from "@/core/lib/organen-route";

export const { PATCH } = organenPatch({
  tabel: "expertises",
  entiteit: "expertise",
  heeftType: false,
  label: "expertises",
});
