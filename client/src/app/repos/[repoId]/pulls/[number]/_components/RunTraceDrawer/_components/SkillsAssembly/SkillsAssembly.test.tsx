import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PromptAssembly } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../../messages/en/runs.json";
import { SkillsAssembly } from "./SkillsAssembly";

afterEach(cleanup);

const SECTION = '## Skills\nApply…\n\n<skill name="breaking-change" version="3">\n# A\n</skill>\n\n<skill name="semver" version="1">\n# B\n</skill>';
const BASE: PromptAssembly = { system: "S", user: "U", skills: SECTION };

function renderIt(assembly: PromptAssembly) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <SkillsAssembly assembly={assembly} />
    </NextIntlClientProvider>,
  );
}

describe("SkillsAssembly (trace, HW2 #19/#20)", () => {
  it("lists the applied skills in prompt order with versions, per-block tokens and the Skills-only token count", () => {
    renderIt({
      ...BASE,
      // stored out of order on purpose: the UI follows `order`
      skill_blocks: [
        { skill_id: "s2", name: "semver", version: 1, order: 1, tokens: 18 },
        { skill_id: "s1", name: "breaking-change", version: 3, order: 0, tokens: 25 },
      ],
      skills_tokens: 97,
    });
    const section = screen.getByTestId("trace-skills");
    expect(section).toHaveTextContent("2 skills applied");
    expect(screen.getByTestId("trace-skills-tokens")).toHaveTextContent("97 tokens (Skills section only)");
    const rows = within(screen.getByRole("list", { name: runsMessages.trace.skills.listLabel })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["#1breaking-changev325 tok", "#2semverv118 tok"]);
    expect(rows.map((r) => r.getAttribute("data-skill-id"))).toEqual(["s1", "s2"]);
    expect(section).toHaveTextContent(runsMessages.trace.skills.sent);
  });

  it("only what the run applied is listed (disabled skills are simply not in the snapshot)", () => {
    renderIt({ ...BASE, skill_blocks: [{ skill_id: "s1", name: "breaking-change", version: 3, order: 0, tokens: 25 }], skills_tokens: 40 });
    expect(screen.getByTestId("trace-skills")).toHaveTextContent("1 skill applied");
    expect(screen.queryByText("semver")).toBeNull();
  });

  it("an old trace without skill_blocks / skills_tokens shows the section text only", () => {
    renderIt(BASE);
    const section = screen.getByTestId("trace-skills");
    expect(section).toHaveTextContent(runsMessages.trace.prompt.skills);
    expect(screen.queryByTestId("trace-skills-tokens")).toBeNull();
    expect(screen.queryByRole("list", { name: runsMessages.trace.skills.listLabel })).toBeNull();
  });

  it("a run without skills renders nothing", () => {
    const { container } = renderIt({ system: "S", user: "U", skills: null, skill_blocks: null, skills_tokens: null });
    expect(container).toBeEmptyDOMElement();
  });
});
