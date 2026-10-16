import { describe, it, expect } from "vitest";
import type { ConventionScan } from "@devdigest/shared";
import { relativeAgo, scanActions } from "./helpers";

const scan = (status: ConventionScan["status"]): ConventionScan => ({
  id: "s",
  repo_id: "r",
  status,
  provider: "openai",
  model: "gpt-5.4",
  sample_files: [],
  candidates_found: null,
  candidates_added: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
  error: null,
  started_at: "2026-10-15T10:00:00.000Z",
  finished_at: null,
});

describe("scanActions (HW2 #45: Run Scan vs ReScan)", () => {
  it("never scanned → only Run Scan", () => {
    expect(scanActions(null, false)).toEqual({ canRun: true, canRescan: false });
  });
  it("a successful scan → only ReScan (the server refuses a second Run Scan)", () => {
    expect(scanActions(scan("done"), false)).toEqual({ canRun: false, canRescan: true });
  });
  it("a failed latest scan → both", () => {
    expect(scanActions(scan("failed"), false)).toEqual({ canRun: true, canRescan: true });
  });
  it("running or starting → neither", () => {
    expect(scanActions(scan("running"), false)).toEqual({ canRun: false, canRescan: false });
    expect(scanActions(null, true)).toEqual({ canRun: false, canRescan: false });
  });
});

describe("relativeAgo", () => {
  const now = Date.parse("2026-10-15T12:00:00.000Z");
  it("buckets minutes / hours / days", () => {
    expect(relativeAgo("2026-10-15T11:59:40.000Z", now)).toEqual({ key: "justNow", count: 0 });
    expect(relativeAgo("2026-10-15T11:55:00.000Z", now)).toEqual({ key: "minutesAgo", count: 5 });
    expect(relativeAgo("2026-10-15T09:00:00.000Z", now)).toEqual({ key: "hoursAgo", count: 3 });
    expect(relativeAgo("2026-10-12T12:00:00.000Z", now)).toEqual({ key: "daysAgo", count: 3 });
    expect(relativeAgo("2026-10-16T12:00:00.000Z", now)).toEqual({ key: "justNow", count: 0 }); // clock skew
  });
});
