/* toast.tsx — A6 cross-cutting: system-level notifications.
   Error UX taxonomy: system errors → toast (here); form errors → inline;
   critical → full-screen (ErrorState fullScreen). */
"use client";

import React from "react";

type ToastKind = "success" | "error" | "info";
/** An optional link in a toast, opened in a new tab (e.g. the PR an export just opened). */
export interface ToastLink {
  href: string;
  label: string;
}
export interface ToastOptions {
  link?: ToastLink;
}
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  link?: ToastLink;
}

/** Plain toasts auto-dismiss after 4 s; a toast with a link stays 8 s so it can be clicked. */
export const TOAST_MS = 4000;
export const LINK_TOAST_MS = 8000;

/** Only http(s) links are rendered: never `javascript:`, `data:` or a relative URL. */
function safeLink(link: ToastLink | undefined): ToastLink | undefined {
  return link && /^https?:\/\//i.test(link.href) ? link : undefined;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind, opts?: ToastOptions) => void;
  success: (m: string, opts?: ToastOptions) => void;
  error: (m: string, opts?: ToastOptions) => void;
  info: (m: string, opts?: ToastOptions) => void;
}

const ToastCtx = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* Module-level bridge so non-React code (e.g. the React Query cache) can raise
   toasts without the hook. The mounted <ToastProvider> registers its pusher. */
type Pusher = (message: string, kind?: ToastKind, opts?: ToastOptions) => void;
let activePusher: Pusher | null = null;
export const notify = {
  toast: (m: string, k?: ToastKind, o?: ToastOptions) => activePusher?.(m, k, o),
  success: (m: string, o?: ToastOptions) => activePusher?.(m, "success", o),
  error: (m: string, o?: ToastOptions) => activePusher?.(m, "error", o),
  info: (m: string, o?: ToastOptions) => activePusher?.(m, "info", o),
};

const COLORS: Record<ToastKind, { bg: string; border: string; icon: string }> = {
  success: { bg: "var(--ok-bg, #052e1c)", border: "var(--ok)", icon: "✓" },
  error: { bg: "var(--crit-bg, #2e0a0a)", border: "var(--crit)", icon: "✕" },
  info: { bg: "var(--bg-elevated)", border: "var(--border-strong)", icon: "ℹ" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const seq = React.useRef(1);

  const push = React.useCallback((message: string, kind: ToastKind = "info", opts?: ToastOptions) => {
    const id = seq.current++;
    const link = safeLink(opts?.link);
    setItems((prev) => [...prev, { id, kind, message, link }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), link ? LINK_TOAST_MS : TOAST_MS);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      toast: push,
      success: (m, o) => push(m, "success", o),
      error: (m, o) => push(m, "error", o),
      info: (m, o) => push(m, "info", o),
    }),
    [push],
  );

  // Expose this provider's pusher to the module-level `notify` bridge.
  React.useEffect(() => {
    activePusher = push;
    return () => {
      if (activePusher === push) activePusher = null;
    };
  }, [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 380,
        }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => {
          const c = COLORS[t.kind];
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 9,
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: "var(--text-primary)",
                fontSize: 14,
                boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
                animation: "ddToastIn .16s ease-out",
              }}
            >
              <span style={{ color: c.border, fontWeight: 700 }}>{c.icon}</span>
              <span style={{ flex: 1 }}>
                {t.message}
                {t.link && (
                  <>
                    {" "}
                    <a
                      href={t.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent-text)", fontWeight: 600, textDecoration: "underline" }}
                    >
                      {t.link.label}
                    </a>
                  </>
                )}
              </span>
              <button
                onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
