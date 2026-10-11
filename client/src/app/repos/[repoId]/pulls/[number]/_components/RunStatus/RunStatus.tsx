/* RunStatus — live SSE status for in-flight review runs. Subscribes to the
   run event streams, shows the five lifecycle phases of each run (derived from
   its real events) and renders the shared LiveLogStream. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { LiveLogStream, type LogLine } from "@devdigest/ui";
import { useRunEvents } from "../../../../../../../lib/hooks/reviews";
import { phasesFrom } from "@/lib/run-phases";
import { PhaseStepper } from "../PhaseStepper";
import { LOG_HEIGHT } from "./constants";
import { s } from "./styles";

export function RunStatus({
  runIds,
  labels,
  onDone,
}: {
  runIds: string[];
  /** Display name per run id (agent name). */
  labels?: Record<string, string | null | undefined>;
  onDone?: () => void;
}) {
  const t = useTranslations("prReview");
  const { events, running } = useRunEvents(runIds);
  const wasRunning = React.useRef(false);

  React.useEffect(() => {
    if (running) wasRunning.current = true;
    if (!running && wasRunning.current) onDone?.();
  }, [running, onDone]);

  if (runIds.length === 0) return null;

  const log: LogLine[] = events.map((e) => ({
    t: e.t,
    k: e.kind as LogLine["k"],
    m: e.msg,
  }));

  return (
    <div style={s.wrap}>
      {runIds.map((runId) => {
        const own = events.filter((e) => e.runId === runId);
        // A run whose own log already ended (complete / failed / cancelled)
        // reports that; otherwise it is running while the stream is open.
        const fromLog = phasesFrom(own);
        const result = running && fromLog.outcome === "unknown" ? phasesFrom(own, "running") : fromLog;
        return (
          <PhaseStepper
            key={runId}
            result={result}
            label={runIds.length > 1 || labels?.[runId] ? (labels?.[runId] ?? runId.slice(0, 8)) : null}
          />
        );
      })}
      <LiveLogStream
        log={log}
        running={running}
        height={LOG_HEIGHT}
        elapsedLabel={running ? t("runStatus.elapsed", { count: runIds.length }) : undefined}
      />
    </div>
  );
}
