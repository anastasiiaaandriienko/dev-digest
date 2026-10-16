import type { ConventionScan } from "@devdigest/shared";

/**
 * Which scan action is possible now: "Run Scan" until a scan has succeeded
 * (the server answers 409 afterwards), "ReScan" once any scan exists; neither
 * while one runs or is being started.
 */
export function scanActions(scan: ConventionScan | null, starting: boolean): { canRun: boolean; canRescan: boolean } {
  const busy = starting || scan?.status === "running";
  return { canRun: !busy && scan?.status !== "done", canRescan: !busy && !!scan };
}

export type AgoKey = "justNow" | "minutesAgo" | "hoursAgo" | "daysAgo";

/** "3 hours ago"-style bucket for an ISO time (message key + count). */
export function relativeAgo(iso: string, now: number): { key: AgoKey; count: number } {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return { key: "justNow", count: 0 };
  if (minutes < 60) return { key: "minutesAgo", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hoursAgo", count: hours };
  return { key: "daysAgo", count: Math.floor(hours / 24) };
}
