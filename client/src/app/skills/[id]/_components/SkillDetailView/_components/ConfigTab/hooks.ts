/* hooks.ts — ConfigTab's side effects (shared with the agent editor via lib/unsaved-guard). */
"use client";

export {
  /** Unsaved-edits plumbing: page guard, dirty reports, beforeunload. */
  useUnsavedGuard as useConfigGuard,
  /** Take an outside `enabled` change (list card toggle) without turning the form dirty. */
  useOutsideEnabled,
} from "@/lib/unsaved-guard";
