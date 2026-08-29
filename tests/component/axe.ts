import axe from "axe-core";
import { expect } from "vitest";

export async function verwachtGeenErnstigeAxeBevindingen(container: Element) {
  const resultaat = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  });
  const ernstig = resultaat.violations.filter(
    (bevinding) => bevinding.impact === "serious" || bevinding.impact === "critical",
  );
  expect(
    ernstig,
    ernstig
      .map(
        (bevinding) =>
          `${bevinding.id}: ${bevinding.help}\n${bevinding.nodes
            .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
            .join("\n")}`,
      )
      .join("\n"),
  ).toEqual([]);
}
