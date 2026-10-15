/* hooks.ts — ConfigTab's side effects, kept out of the component. */
"use client";

import React from "react";
import type { ConfigForm, ConfigGuard } from "./helpers";

/**
 * `enabled` can change outside the form (the card toggle in the list). Take the
 * new value unless the user changed the form's own switch, so the form doesn't
 * turn dirty by itself and a later save never puts the old value back.
 */
export function useOutsideEnabled(enabled: boolean, setForm: React.Dispatch<React.SetStateAction<ConfigForm>>) {
  const saved = React.useRef(enabled);
  React.useEffect(() => {
    const prev = saved.current;
    if (enabled === prev) return;
    saved.current = enabled;
    setForm((f) => (f.enabled === prev ? { ...f, enabled } : f));
  }, [enabled, setForm]);
}

/**
 * Unsaved-edits plumbing: keep the page's guard current (latest dirty flag +
 * save) and clear it on unmount; tell the page when edits appear / go away
 * (false again on unmount); let the browser ask before a reload or close while
 * edits are unsaved.
 */
export function useConfigGuard({
  dirty,
  save,
  guardRef,
  onDirtyChange,
}: ConfigGuard & {
  guardRef?: React.MutableRefObject<ConfigGuard | null>;
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
