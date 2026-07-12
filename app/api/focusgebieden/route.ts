import { organenLijstCreate } from "@/core/lib/organen-route";

export const { GET, POST } = organenLijstCreate({
  tabel: "kritische_focusgebieden",
  entiteit: "focusgebied",
  heeftType: false,
  label: "focusgebieden",
});
