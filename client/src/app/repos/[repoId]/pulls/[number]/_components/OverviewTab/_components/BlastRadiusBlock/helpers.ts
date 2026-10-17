import type { BlastRadius, DownstreamImpact } from "@devdigest/shared";
import { CALLABLE_KINDS, SHORT_SHA_LENGTH } from "./constants";

export function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}

/** `name()` for functions/methods, the bare name otherwise. */
export function symbolLabel(name: string, kind: string | undefined): string {
  return kind && CALLABLE_KINDS.has(kind) ? `${name}()` : name;
}

/** `file:line` (just `file` when the line is unknown). */
export function location(file: string, line: number | null | undefined): string {
  return line && line > 0 ? `${file}:${line}` : file;
}

/** The `changed_symbols` entry of a downstream row (same name + file): kind, line, link. */
export function declarationOf(blast: BlastRadius, impact: DownstreamImpact) {
  return blast.changed_symbols.find((s) => s.name === impact.symbol && (!impact.file || s.file === impact.file));
}

/** Distinct callers of an entry (the server's count; falls back to the listed rows). */
export function callerCount(impact: DownstreamImpact): number {
  return impact.caller_count ?? impact.callers.length;
}

/** Totals from the server, or derived for payloads that predate them. */
export function totalsOf(blast: BlastRadius) {
  if (blast.totals) return blast.totals;
  return {
    symbols: blast.changed_symbols.length,
    callers: blast.downstream.reduce((n, d) => n + callerCount(d), 0),
    endpoints: new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size,
    crons: new Set(blast.downstream.flatMap((d) => d.crons_affected)).size,
  };
}

/** Stable row id for expand/collapse state. */
export function impactId(impact: DownstreamImpact, index: number): string {
  return `${index}:${impact.file ?? ""}:${impact.symbol}`;
}

/** Initially expanded rows: the first symbol that has callers (as in the design). */
export function initialExpanded(blast: BlastRadius): Set<string> {
  const i = blast.downstream.findIndex((d) => d.callers.length > 0);
  return i < 0 ? new Set() : new Set([impactId(blast.downstream[i]!, i)]);
}
