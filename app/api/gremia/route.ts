import { organenLijstCreate } from "@/core/lib/organen-route";

export const { GET, POST } = organenLijstCreate({
  tabel: "gremia",
  entiteit: "gremium",
  heeftType: true,
  label: "gremia",
});
