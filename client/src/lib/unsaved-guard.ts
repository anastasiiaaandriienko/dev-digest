/* lib/unsaved-guard.ts — shared "unsaved edits" plumbing for editor forms
   (Skill Config, Agent Config): the form reports whether it has unsaved edits
   and how to save them; the page asks before leaving (UnsavedChangesModal). */
"use client";

import React from "react";

/** What an editor form tells its page about unsaved edits. */
export interface UnsavedGuard {
  /** The form differs from the saved record. */
  dirty: boolean;
  /** Validate and save; resolves true once saved, false when it failed (edits are kept). */
  save: () => Promise<boolean>;
}

/**
 * Keep the page's guard current (latest dirty flag + save) and clear it on
 * unmount; tell the page when edits appear / go away (false again on
 * unmount); let the browser ask before a reload or close while edits are
 * unsaved.
 */
export function useUnsavedGuard({
  dirty,
  save,
  guardRef,
  onDirtyChange,
}: UnsavedGuard & {
  guardRef?: React.MutableRefObject<UnsavedGuard | null>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  React.useEffect(() => {
    if (guardRef) guardRef.current = { dirty, save };
  });
  React.useEffect(
    () => () => {
      if (guardRef) guardRef.current = null;
    },
    [guardRef],
  );

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/**
 * `enabled` can change outside an editor form (the card toggle in the list).
 * Take the new value unless the user changed the form's own switch, so the
 * form doesn't turn dirty by itself and a later save never puts the old value
 * back.
 */
export function useOutsideEnabled<F extends { enabled: boolean }>(
  enabled: boolean,
  setForm: React.Dispatch<React.SetStateAction<F>>,
) {
  const saved = React.useRef(enabled);
  React.useEffect(() => {
    const prev = saved.current;
    if (enabled === prev) return;
    saved.current = enabled;
    setForm((f) => (f.enabled === prev ? { ...f, enabled } : f));
  }, [enabled, setForm]);
}
