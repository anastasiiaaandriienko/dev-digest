import type { CiPostAs, CiTarget, CiTrigger } from "@devdigest/shared";

/** The one editable generated file (AC-CI-07). */
export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

/** Edited-workflow limit in UTF-8 bytes, same as the server (AC-CI-83). */
export const MAX_WORKFLOW_BYTES = 65_536;

/** A read-only file larger than this (the runner bundle) is shown truncated in Preview. */
export const PREVIEW_MAX_CHARS = 20_000;

/** Wizard steps, in order (AC-CI-02). */
export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;

/** Target cards (AC-CI-03, 04): only GitHub Actions is available. */
export const TARGETS: readonly { key: CiTarget; available: boolean }[] = [
  { key: "gha", available: true },
  { key: "circle", available: false },
  { key: "jenkins", available: false },
  { key: "cli", available: false },
];

/** Configure defaults (AC-CI-09, 12): opened + synchronize, PR comment. */
export const DEFAULT_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize"];
export const DEFAULT_POST_AS: CiPostAs = "pr_comment";
