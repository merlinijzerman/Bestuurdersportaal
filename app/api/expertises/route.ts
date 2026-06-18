import { organenLijstCreate } from "@/lib/organen-route";

export const { GET, POST } = organenLijstCreate({
  tabel: "expertises",
  entiteit: "expertise",
  heeftType: false,
  label: "expertises",
});
