import { organenPatch } from "@/lib/organen-route";

export const { PATCH } = organenPatch({
  tabel: "expertises",
  entiteit: "expertise",
  heeftType: false,
  label: "expertises",
});
