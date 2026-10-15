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
  it("shows 'needs vetting' only for an untrusted source that is still disabled (HW2 #15)", () => {
    const vetting = () => screen.queryByTestId("needs-vetting");
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillCard skill={{ ...SKILL, source: "imported", enabled: false }} onOpen={vi.fn()} onToggle={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(vetting()).toHaveTextContent(messages.listItem.needsVetting);
    expect(vetting()).toHaveAttribute("title", messages.listItem.vettingTitle);
    expect(screen.getByText(messages.listItem.source.imported)).toBeInTheDocument();
    unmount();
    for (const skill of [{ ...SKILL, source: "imported" as const, enabled: true }, { ...SKILL, enabled: false }]) {
      const r = render(
        <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
          <SkillCard skill={skill} onOpen={vi.fn()} onToggle={vi.fn()} />
        </NextIntlClientProvider>,
      );
      expect(vetting()).toBeNull();
      r.unmount();
    }
  });

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

  it("no interactive control is nested in another (name, toggle, delete are siblings)", () => {
    renderCard({ onDelete: vi.fn() });
    expect(screen.getAllByRole("button")).toHaveLength(2); // name + delete
    for (const el of screen.getAllByRole("button").concat(screen.getAllByRole("switch"))) {
      expect(el.parentElement!.closest("button, [role='button'], a")).toBeNull();
    }
  });
});

describe("SkillCard — delete", () => {
  it("the delete button asks to delete WITHOUT opening the preview", () => {
    const onDelete = vi.fn();
    const { onOpen } = renderCard({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "Delete breaking-change" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is hidden when no onDelete handler is given", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: "Delete breaking-change" })).not.toBeInTheDocument();
  });
});
