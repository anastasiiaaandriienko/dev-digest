import { describe, it, expect } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import messages from "../../messages/en/multiAgent.json";
import {
  AGENT_COLORS,
  MAX_AGENTS_PER_RUN,
  MAX_LIVE_STREAMS,
  agentColor,
  configureRunHref,
  hasRunningColumn,
  isTerminalStatus,
  liveRunIds,
  multiAgentResultsHref,
} from "./multi-agent";

/** L07 T7 — pure Multi-Agent Review helpers and the multiAgent namespace. */

describe("routes and limits (T8)", () => {
  it("builds the Results and Configure run URLs (A1)", () => {
    expect(multiAgentResultsHref("repo-1", 482)).toBe("/repos/repo-1/pulls/482/multi-agent");
    expect(configureRunHref("repo-1", "pr-1")).toBe("/repos/repo-1/multi-agent?pr=pr-1");
    expect(configureRunHref("repo-1")).toBe("/repos/repo-1/multi-agent");
    expect(configureRunHref("repo 1", "a&b")).toBe("/repos/repo%201/multi-agent?pr=a%26b");
  });

  it("mirrors the server limit of 8 agents per run", () => {
    expect(MAX_AGENTS_PER_RUN).toBe(8);
  });
});

const col = (run_id: string, status: "done" | "failed" | "running" | "cancelled") => ({ run_id, status });

describe("liveRunIds (A-T3)", () => {
  it("streams only non-terminal columns, at most MAX_LIVE_STREAMS (4), in column order", () => {
    expect(MAX_LIVE_STREAMS).toBe(4);
    const cols = [
      col("a", "done"),
      col("b", "running"),
      col("c", "failed"),
      col("d", "running"),
      col("e", "running"),
      col("f", "cancelled"),
      col("g", "running"),
      col("h", "running"),
    ];
    expect(liveRunIds(cols)).toEqual(["b", "d", "e", "g"]);
    expect(liveRunIds(cols, 2)).toEqual(["b", "d"]);
    expect(liveRunIds([col("a", "done")])).toEqual([]);
  });

  it("terminal = done, failed, cancelled; running drives polling", () => {
    expect(["done", "failed", "cancelled"].every((s) => isTerminalStatus(s as "done"))).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    expect(hasRunningColumn([col("a", "done"), col("b", "running")])).toBe(true);
    expect(hasRunningColumn([col("a", "done")])).toBe(false);
    expect(hasRunningColumn(undefined)).toBe(false);
  });
});

describe("agentColor (A-T5)", () => {
  it("is stable per agent id and always a theme colour", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(agentColor(id)).toBe(agentColor(id));
    for (const s of ["a", "b", "agent-3", id, ""]) expect(AGENT_COLORS).toContain(agentColor(s));
  });

  it("spreads different agents over the palette", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `agent-${i}`);
    expect(new Set(ids.map(agentColor)).size).toBeGreaterThan(1);
  });
});

describe("multiAgent messages (en)", () => {
  const t = () =>
    renderHook(() => useTranslations("multiAgent"), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(NextIntlClientProvider, { locale: "en", messages: { multiAgent: messages }, children }),
    }).result.current;

  it("formats the spec's labels and counts", () => {
    const tr = t();
    expect(tr("picker.heading")).toBe("PICK AGENTS TO RUN");
    expect(tr("picker.run", { count: 2 })).toBe("Run multi-agent review (2)");
    expect(tr("configure.pickPrFirst")).toBe("Pick a pull request first");
    expect(tr("results.findings", { count: 1 })).toBe("1 finding");
    expect(tr("results.findings", { count: 3 })).toBe("3 findings");
    expect(tr("results.selectedAgents", { count: 4 })).toBe("4 selected agents · parallel");
    expect(tr("disagree.heading")).toBe("WHERE AGENTS DISAGREE");
    expect(tr("disagree.didNotFlag")).toBe("did not flag");
  });

  it("AC-MAR-40 / AC-MAR-49: Learn tooltip text and 'parallel', never 'worktrees'", () => {
    const tr = t();
    expect(tr("actions.learnUnavailable")).toBe("Learning from findings is not available yet");
    expect(tr("results.summary", { count: 3, duration: "8.2s", cost: "$0.20" })).toBe(
      "3 agents · parallel · 8.2s total · $0.20"
    );
    expect(JSON.stringify(messages).toLowerCase()).not.toContain("worktree");
  });

  it("has no empty strings and no 'Reply to author' (AC-MAR-41)", () => {
    const values: string[] = [];
    const walk = (o: unknown) => {
      if (typeof o === "string") values.push(o);
      else if (o && typeof o === "object") Object.values(o).forEach(walk);
    };
    walk(messages);
    expect(values.every((v) => v.trim().length > 0)).toBe(true);
    expect(values.some((v) => /reply to author/i.test(v))).toBe(false);
  });
});
