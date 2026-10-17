/* Shared fixtures/render helper for the Smart Diff (Files changed) tests. */
import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import prReview from "../../messages/en/prReview.json";
import shell from "../../messages/en/shell.json";

export function renderIntl(ui: React.ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ prReview, shell }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

export function finding(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: `Title ${over.id}`,
    file: "src/a.ts",
    start_line: 2,
    end_line: 2,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

/** Patch: hunk, ctx(new1), add(new2), add(new3). */
export const PATCH = ["@@ -1,1 +1,3 @@", " keep", "+added two", "+added three"].join("\n");

export function prFile(path: string, over: Partial<PrFile> = {}): PrFile {
  return { path, additions: 2, deletions: 0, patch: PATCH, ...over };
}
