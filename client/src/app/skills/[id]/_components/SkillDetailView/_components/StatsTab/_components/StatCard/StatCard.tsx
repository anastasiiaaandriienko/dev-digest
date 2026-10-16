/* StatCard — one metric tile of the Stats tab (design: SkillStat): an
   uppercase label and either a value (+ suffix) or a dash with a muted note
   when the metric is not available. */
import React from "react";
import { s } from "./styles";

export function StatCard({
  label,
  value,
  suffix,
  note,
}: {
  label: string;
  value?: number;
  suffix?: string;
  /** Shown next to a dash instead of a value (e.g. "Not tracked yet"). */
  note?: string;
}) {
  return (
    <div style={s.card} role="group" aria-label={label}>
      <span style={s.label}>{label}</span>
      <div style={s.valueRow}>
        {value != null ? (
          <>
            <span className="tnum" style={s.value}>
              {value}
            </span>
            {suffix && <span style={s.suffix}>{suffix}</span>}
          </>
        ) : (
          <>
            <span style={s.dash} aria-hidden="true">
              —
            </span>
            {note && <span style={s.note}>{note}</span>}
          </>
        )}
      </div>
    </div>
  );
}
