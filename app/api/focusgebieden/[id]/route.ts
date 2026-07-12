import { organenPatch } from "@/core/lib/organen-route";

export const { PATCH } = organenPatch({
  tabel: "kritische_focusgebieden",
  entiteit: "focusgebied",
  heeftType: false,
  label: "focusgebieden",
});
