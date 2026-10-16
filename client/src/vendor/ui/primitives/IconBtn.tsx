import React from "react";
import { Icon, type IconName } from "../icons";

export function IconBtn({
  icon,
  label,
  size = 30,
  active,
  onClick,
  danger,
  disabled,
}: {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
  onClick?: () => void;
  danger?: boolean;
  /** Shown but not actionable (native `disabled`, dimmed, no hover). */
  disabled?: boolean;
}) {
  const I = Icon[icon];
  const [h, setH] = React.useState(false);
  const hover = h && !disabled;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: size,
        height: size,
        display: "inline-grid",
        placeItems: "center",
        borderRadius: 6,
        border: "1px solid transparent",
        background: hover ? "var(--bg-hover)" : active ? "var(--bg-hover)" : "transparent",
        color: danger && hover ? "var(--crit)" : active || hover ? "var(--text-primary)" : "var(--text-secondary)",
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .12s, color .12s",
      }}
    >
      <I size={Math.round(size * 0.52)} />
    </button>
  );
}
