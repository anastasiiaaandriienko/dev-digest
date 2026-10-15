/**
 * Agent Skills tab (HW2 #13, #30, #31, #37): every skill listed, attached ones
 * in prompt order; attach / detach / per-agent toggle / ↑↓ / drag & drop each
 * PUT the whole ordered list; only enabled skills reorder; agent-level vs
 * global disabled states are distinct. Hooks are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";

type Q<T> = { data?: T; isLoading: boolean; isError: boolean; refetch: () => void };
let skillsQ: Q<Skill[]>;
let linksQ: Q<AgentSkillLink[]>;
const mutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({ useSkills: () => skillsQ }));
vi.mock("@/lib/hooks/agents", () => ({
  useAgentSkills: () => linksQ,
  useSetAgentSkills: () => ({ mutate, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

const sk = (id: string, o: Partial<Skill> = {}): Skill => ({
  id,
  name: id,
  description: "",
  type: "rubric",
  source: "manual",
  body: "# x",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 0,
  ...o,
});
const link = (skill_id: string, order: number, enabled = true): AgentSkillLink => ({ agent_id: "ag1", skill_id, order, enabled });

const SKILLS = [
  sk("breaking-change", { type: "security" }),
  sk("response-schema"),
  sk("semver", { type: "convention" }),
  sk("deprecation", { enabled: false }), // disabled globally
  sk("imported-rule", { source: "imported_url", type: "custom" }),
];
const LINKS = [link("response-schema", 0), link("breaking-change", 1), link("semver", 2, false), link("deprecation", 3)];
const AGENT = { id: "ag1", name: "API Contract Reviewer" } as Agent;
const S = agentsMessages.skills;

beforeEach(() => {
  skillsQ = { data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() };
  linksQ = { data: LINKS, isLoading: false, isError: false, refetch: vi.fn() };
});
afterEach(() => {
  cleanup();
  mutate.mockReset();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, skills: skillsMessages }}>
      <SkillsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

const rowOf = (id: string) => document.querySelector(`[data-skill-id="${id}"]`) as HTMLElement;
const ids = (testId: string) =>
  Array.from(screen.getByTestId(testId).querySelectorAll("[data-skill-id]")).map((el) => el.getAttribute("data-skill-id"));
const sent = () => (mutate.mock.calls.at(-1)![0] as { skill_id: string; enabled: boolean }[]).map((i) => `${i.skill_id}:${i.enabled ? "on" : "off"}`);

describe("SkillsTab — listing", () => {
  it("shows ALL skills: attached in prompt order, then the unattached ones", () => {
    renderTab();
    expect(ids("attached-skills")).toEqual(["response-schema", "breaking-change", "semver", "deprecation"]);
    expect(ids("available-skills")).toEqual(["imported-rule"]);
  });

  it("each row has its type and a per-agent checkbox; the count shows enabled (applied) / total", () => {
    renderTab();
    expect(within(rowOf("breaking-change")).getByText("security")).toHaveAttribute("data-skill-type", "security");
    for (const s of SKILLS) {
      expect(screen.getByRole("checkbox", { name: `Use ${s.name} for this agent` })).toBeInTheDocument();
    }
    // applied = response-schema + breaking-change (semver off for agent, deprecation off globally)
    expect(screen.getByTestId("applied-count")).toHaveTextContent("2 of 5 enabled");
  });

  it("distinguishes 'off for this agent' from 'disabled globally'; only applied skills are marked applied", () => {
    renderTab();
    expect(within(rowOf("semver")).getByText(S.offForAgent)).toBeInTheDocument();
    expect(within(rowOf("semver")).queryByText(S.offGlobally)).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Use semver for this agent" })).toHaveAttribute("aria-checked", "false");

    expect(within(rowOf("deprecation")).getByText(S.offGlobally)).toBeInTheDocument();
    expect(within(rowOf("deprecation")).queryByText(S.offForAgent)).toBeNull();
    // enabled for the agent, but not applied because it is off globally
    expect(screen.getByRole("checkbox", { name: "Use deprecation for this agent" })).toHaveAttribute("aria-checked", "true");

    const applied = (id: string) => rowOf(id).getAttribute("data-applied") === "true";
    expect(["response-schema", "breaking-change", "semver", "deprecation"].map(applied)).toEqual([true, true, false, false]);
  });

  it("loading, error and empty attached list", () => {
    linksQ = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const r1 = renderTab();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    r1.unmount();
    linksQ = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    const r2 = renderTab();
    expect(screen.getByText(S.loadError)).toBeInTheDocument();
    r2.unmount();
    linksQ = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText(S.attachedEmpty)).toBeInTheDocument();
  });
});

describe("SkillsTab — changes (each PUTs the whole ordered list)", () => {
  it("turning on an unattached skill attaches it at the end, enabled", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use imported-rule for this agent" }));
    expect(sent()).toEqual(["response-schema:on", "breaking-change:on", "semver:off", "deprecation:on", "imported-rule:on"]);
  });

  it("turning an attached skill off keeps its place (disabled for this agent only)", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use breaking-change for this agent" }));
    expect(sent()).toEqual(["response-schema:on", "breaking-change:off", "semver:off", "deprecation:on"]);
  });

  it("× detaches a skill", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Detach semver" }));
    expect(sent()).toEqual(["response-schema:on", "breaking-change:on", "deprecation:on"]);
  });

  it("keyboard ↑ / ↓ reorder enabled skills; the ends are disabled", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Move breaking-change up" }));
    expect(sent()).toEqual(["breaking-change:on", "response-schema:on", "semver:off", "deprecation:on"]);
    expect(screen.getByRole("button", { name: "Move response-schema up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move deprecation down" })).toBeDisabled();
  });

  it("a skill disabled for this agent cannot be moved (buttons disabled)", () => {
    renderTab();
    expect(screen.getByRole("button", { name: "Move semver up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move semver down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move semver up" }));
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("SkillsTab — drag & drop", () => {
  const dt = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" });

  it("only enabled, attached skills are draggable", () => {
    renderTab();
    expect(rowOf("response-schema")).toHaveAttribute("draggable", "true");
    expect(rowOf("breaking-change")).toHaveAttribute("draggable", "true");
    expect(rowOf("semver")).toHaveAttribute("draggable", "false"); // off for this agent
    expect(rowOf("imported-rule")).toHaveAttribute("draggable", "false"); // not attached
  });

  it("dropping an enabled skill on another row moves it there", () => {
    renderTab();
    fireEvent.dragStart(rowOf("deprecation"), { dataTransfer: dt() });
    fireEvent.dragOver(rowOf("response-schema"), { dataTransfer: dt() });
    fireEvent.drop(rowOf("response-schema"), { dataTransfer: dt() });
    expect(sent()).toEqual(["deprecation:on", "response-schema:on", "breaking-change:on", "semver:off"]);
  });

  it("a disabled skill cannot be dragged: the drag is cancelled and a drop changes nothing", () => {
    renderTab();
    const start = fireEvent.dragStart(rowOf("semver"), { dataTransfer: dt() });
    expect(start).toBe(false); // preventDefault → no drag
    fireEvent.drop(rowOf("response-schema"), { dataTransfer: dt() });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("dropping a skill on itself sends nothing", () => {
    renderTab();
    fireEvent.dragStart(rowOf("breaking-change"), { dataTransfer: dt() });
    fireEvent.drop(rowOf("breaking-change"), { dataTransfer: dt() });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("SkillsTab — search", () => {
  it("filters attached and available skills by name, and pauses reordering while filtering", () => {
    renderTab();
    fireEvent.change(screen.getByRole("textbox", { name: S.searchLabel }), { target: { value: "SCHEMA" } });
    expect(ids("attached-skills")).toEqual(["response-schema"]);
    expect(ids("available-skills")).toEqual([]);
    expect(rowOf("response-schema")).toHaveAttribute("draggable", "false");
    expect(screen.getByText(S.reorderPausedHint)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: S.searchLabel }), { target: { value: "zzz" } });
    expect(screen.getByText("No skill matches “zzz”.")).toBeInTheDocument();
  });
});
