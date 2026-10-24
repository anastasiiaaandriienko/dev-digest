/* ColumnsView — Columns mode of the Results page (AC-MAR-33, 58): one
   fixed-width column per child run in server order; more than 4 scroll
   horizontally. Only the first MAX_LIVE_STREAMS running columns stream SSE. */
"use client";

import React from "react";
import type { AgentColumn } from "@devdigest/shared";
import { MAX_LIVE_STREAMS, liveRunIds } from "@/lib/multi-agent";
import { AgentColumnCard } from "./_components/AgentColumnCard";
import { s } from "./styles";

export function ColumnsView({
  columns,
  onViewTrace,
  onRunDone,
  maxLive = MAX_LIVE_STREAMS,
}: {
  columns: AgentColumn[];
  onViewTrace: (runId: string) => void;
  onRunDone: () => void;
  /** SSE budget for the columns (lowered while the trace drawer streams one). */
  maxLive?: number;
}) {
  const live = new Set(liveRunIds(columns, maxLive));
  return (
    <div style={s.strip} data-testid="columns-strip">
      {columns.map((c) => (
        <AgentColumnCard
          key={c.run_id}
          column={c}
          live={live.has(c.run_id)}
          onViewTrace={() => onViewTrace(c.run_id)}
          onRunDone={onRunDone}
        />
      ))}
    </div>
  );
}
