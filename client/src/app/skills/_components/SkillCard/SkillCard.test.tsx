import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "breaking-change",
  description: "Flag removed or renamed response fields",
  type: "security",
  source: "manual",
  body: "# Breaking change",
  enabled: true,
  version: 3,
  evidence_files: null,
  agent_count: 2,
};

function renderCard(props: Partial<React.ComponentProps<typeof SkillCard>> = {}) {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillCard skill={SKILL} onOpen={onOpen} onToggle={onToggle} {...props} />
    </NextIntlClientProvider>,
  );
  return { onOpen, onToggle };
}

describe("SkillCard", () => {
  it("shows name, description, type, source, version and agent count", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Preview breaking-change" })).toHaveTextContent("breaking-change");
    expect(screen.getByText("Flag removed or renamed response fields")).toBeInTheDocument();
    expect(screen.getByText("security")).toHaveAttribute("data-skill-type", "security");
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByTestId("skill-version")).toHaveTextContent("v3");
    expect(screen.getByTestId("skill-agent-count")).toHaveTextContent("2 agents");
  });

  it("pluralises the agent count and falls back when there is no description", () => {
    renderCard({ skill: { ...SKILL, description: "", agent_count: 1 } });
    expect(screen.getByText(messages.card.noDescription)).toBeInTheDocument();
    expect(screen.getByTestId("skill-agent-count")).toHaveTextContent("1 agent");
  });

  it("the enabled switch reflects state and toggles WITHOUT opening the preview", () => {
    const { onOpen, onToggle } = renderCard();
    const toggle = screen.getByRole("switch", { name: "Enable breaking-change" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("clicking the card body or the name button opens the preview once", () => {
    const { onOpen } = renderCard();
    fireEvent.click(screen.getByText("Flag removed or renamed response fields"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Preview breaking-change" }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("no interactive control is nested in another", () => {
    renderCard();
    for (const el of screen.getAllByRole("button").concat(screen.getAllByRole("switch"))) {
      expect(el.parentElement!.closest("button, [role='button'], a")).toBeNull();
    }
  });
});
