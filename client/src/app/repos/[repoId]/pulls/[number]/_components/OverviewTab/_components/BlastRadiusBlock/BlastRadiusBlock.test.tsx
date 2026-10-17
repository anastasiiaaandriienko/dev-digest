/**
 * HW-04 BlastRadiusBlock — data, tree expand/collapse, source links pinned to the
 * indexed commit, and every state. The blast + pull-settled hooks are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastCaller, BlastRadius, DownstreamImpact } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";

let query: { data?: BlastRadius; isLoading: boolean; isError: boolean };
const refetch = vi.fn();
let enabledArg: boolean | undefined;
let settled = true;

vi.mock("@/lib/hooks/blast", async (orig) => {
  const actual = await orig<typeof import("@/lib/hooks/blast")>();
  return {
    ...actual,
    useBlastRadius: (_id: string | null, enabled?: boolean) => {
      enabledArg = enabled;
      return { ...query, refetch };
    },
  };
});
vi.mock("@/lib/hooks/intent", async (orig) => {
  const actual = await orig<typeof import("@/lib/hooks/intent")>();
  return { ...actual, usePullSettled: () => settled };
});

import { BlastRadiusBlock } from "./BlastRadiusBlock";

const REPO = "acme/dev-digest";
const SHA = "45ce6b9adc1dbc433275cb6d79b8bc6000f127dd";
const blob = (file: string, line: number) => `https://github.com/${REPO}/blob/${SHA}/${file}#L${line}`;
const caller = (name: string, file: string, line: number, url: string | null = blob(file, line)): BlastCaller => ({
  name,
  file,
  line,
  url,
});

function impact(over: Partial<DownstreamImpact> = {}): DownstreamImpact {
  return {
    symbol: "toAgentDto",
    file: "server/agents/helpers.ts",
    callers: [caller("list", "server/agents/service.ts", 62), caller("create", "server/agents/service.ts", 90)],
    caller_count: 2,
    truncated: false,
    endpoints_affected: ["GET /agents", "POST /agents"],
    crons_affected: ["job:sync_agents"],
    ...over,
  };
}

function blast(over: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [
      { name: "toAgentDto", file: "server/agents/helpers.ts", kind: "function", line: 12, url: blob("server/agents/helpers.ts", 12) },
      { name: "isConfigChange", file: "server/agents/helpers.ts", kind: "function", line: 61, url: null },
    ],
    downstream: [
      impact(),
      impact({
        symbol: "isConfigChange",
        callers: [caller("update", "server/agents/repository.ts", 163)],
        caller_count: 1,
        endpoints_affected: [],
        crons_affected: [],
      }),
    ],
    summary: "2 changed symbols, 3 callers; potentially affected: 2 endpoints, 1 cron/job.",
    totals: { symbols: 2, callers: 3, endpoints: 2, crons: 1 },
    degraded: false,
    reason: null,
    source: { repo_full_name: REPO, ref: SHA },
    ...over,
  };
}

beforeEach(() => {
  query = { data: blast(), isLoading: false, isError: false };
  settled = true;
  enabledArg = undefined;
});
afterEach(() => {
  cleanup();
  refetch.mockReset();
});

function renderBlock() {
  render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusBlock prId="pr1" />
    </NextIntlClientProvider>,
  );
}

const toggle = (name: string) => screen.getByRole("button", { name: `Show callers of ${name}` });

describe("BlastRadiusBlock — data", () => {
  it("shows the summary and the four metrics, with endpoints worded as potentially affected", () => {
    renderBlock();
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("2 changed symbols, 3 callers; potentially affected: 2 endpoints, 1 cron/job.")).toBeInTheDocument();
    expect(screen.getByText("changed symbols")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("potentially affected endpoints")).toBeInTheDocument();
    expect(screen.getByText("cron/job")).toBeInTheDocument();
    expect(screen.getByText(/file-level import graph/)).toBeInTheDocument();
  });

  it("expands the first symbol with callers: file:line links to the INDEXED commit, endpoints and crons", () => {
    renderBlock();
    expect(toggle("toAgentDto")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("toAgentDto()")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "server/agents/service.ts:62" });
    expect(link).toHaveAttribute("href", blob("server/agents/service.ts", 62));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain(SHA);
    expect(screen.getByText("list")).toBeInTheDocument();
    // The declaration of the changed symbol is linked too.
    expect(screen.getByRole("link", { name: "server/agents/helpers.ts:12" })).toHaveAttribute(
      "href",
      blob("server/agents/helpers.ts", 12),
    );

    expect(screen.getByText("Potentially affected endpoints")).toBeInTheDocument();
    expect(screen.getByText("GET /agents")).toBeInTheDocument();
    expect(screen.getByText("POST /agents")).toBeInTheDocument();
    expect(screen.getByText("job:sync_agents")).toBeInTheDocument();
  });

  it("shows caller counts per symbol and expands / collapses on click", () => {
    renderBlock();
    expect(screen.getByText("2 callers")).toBeInTheDocument();
    expect(screen.getByText("1 caller")).toBeInTheDocument();
    expect(toggle("isConfigChange")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("server/agents/repository.ts:163")).not.toBeInTheDocument();

    fireEvent.click(toggle("isConfigChange"));
    expect(toggle("isConfigChange")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "server/agents/repository.ts:163" })).toBeInTheDocument();
    // A declaration without a URL is plain text, not a link.
    expect(screen.queryByRole("link", { name: "server/agents/helpers.ts:61" })).not.toBeInTheDocument();
    expect(screen.getByText("server/agents/helpers.ts:61")).toBeInTheDocument();

    fireEvent.click(toggle("toAgentDto"));
    expect(toggle("toAgentDto")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("server/agents/service.ts:62")).not.toBeInTheDocument();
  });

  it("says when not all callers are shown", () => {
    const callers = Array.from({ length: 20 }, (_, i) => caller(`f${i}`, `src/c${i}.ts`, i + 1));
    query.data = blast({ downstream: [impact({ callers, caller_count: 23, truncated: true })] });
    renderBlock();
    expect(screen.getByText("23 callers")).toBeInTheDocument();
    expect(screen.getByText("Showing 20 of 23 callers")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^src\/c\d+\.ts:\d+$/ })).toHaveLength(20);
  });

  it("tells that source links follow the indexed commit, which may differ from the PR head", () => {
    renderBlock();
    expect(screen.getByText(/which may differ from the PR head/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "45ce6b9" })).toHaveAttribute(
      "href",
      `https://github.com/${REPO}/commit/${SHA}`,
    );
    // Short SHA badge next to the title.
    expect(screen.getAllByText("45ce6b9").length).toBeGreaterThanOrEqual(2);
  });

  it("renders callers without a URL as plain text", () => {
    query.data = blast({
      source: { repo_full_name: REPO, ref: "" },
      downstream: [impact({ callers: [caller("list", "src/a.ts", 3, null)], caller_count: 1 })],
    });
    renderBlock();
    expect(screen.getByText("src/a.ts:3")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "src/a.ts:3" })).not.toBeInTheDocument();
    expect(screen.getByText(/indexed commit is unknown/)).toBeInTheDocument();
  });
});

describe("BlastRadiusBlock — states", () => {
  it("loading (also while waiting for the PR detail to settle)", () => {
    query = { data: undefined, isLoading: false, isError: false };
    settled = false;
    renderBlock();
    expect(screen.getByRole("status")).toHaveTextContent("Loading blast radius…");
    expect(enabledArg).toBe(false);
  });

  it("error with a retry that re-reads (GET)", () => {
    query = { data: undefined, isLoading: false, isError: true };
    renderBlock();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the blast radius.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("no stored PR files: only the reason, no metrics or tree", () => {
    query.data = blast({
      changed_symbols: [],
      downstream: [],
      summary: "No changed symbols found in the indexed code.",
      totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      degraded: true,
      reason: "no_files",
      source: { repo_full_name: REPO, ref: "" },
    });
    renderBlock();
    expect(screen.getByRole("note", { name: "Partial analysis" })).toHaveTextContent(/changed files of this PR are not stored yet/);
    expect(screen.queryByText("changed symbols")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show callers/ })).not.toBeInTheDocument();
  });

  it("degraded (no index): explains the reason and still shows what was found", () => {
    query.data = blast({ degraded: true, reason: "no_data" });
    renderBlock();
    expect(screen.getByRole("note", { name: "Partial analysis" })).toHaveTextContent(/not indexed yet/);
    expect(toggle("toAgentDto")).toBeInTheDocument();
  });

  it("partial index reason", () => {
    query.data = blast({ degraded: true, reason: "index_partial" });
    renderBlock();
    expect(screen.getByRole("note")).toHaveTextContent(/index is partial/);
  });

  it("no changed symbols", () => {
    query.data = blast({
      changed_symbols: [],
      downstream: [],
      summary: "No changed symbols found in the indexed code.",
      totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    });
    renderBlock();
    expect(screen.getByText(/No changed symbols were found/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show callers/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("no callers: says so overall and inside an expanded symbol", () => {
    query.data = blast({
      downstream: [impact({ callers: [], caller_count: 0, endpoints_affected: [], crons_affected: [] })],
      summary: "1 changed symbol, no downstream callers found.",
      totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
    });
    renderBlock();
    expect(screen.getByText("No direct callers found for the changed symbols.")).toBeInTheDocument();
    expect(toggle("toAgentDto")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle("toAgentDto"));
    expect(screen.getByText("No direct callers found.")).toBeInTheDocument();
    expect(screen.queryByText("Potentially affected endpoints")).not.toBeInTheDocument();
  });
});
