/**
 * OverviewTab layout — the PR Brief card sits above the Intent / Blast Radius row.
 * The blocks themselves are stubbed (they have their own tests).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("./_components/BriefCard", () => ({ BriefCard: () => <section data-testid="brief" /> }));
vi.mock("./_components/IntentBlock", () => ({ IntentBlock: () => <section data-testid="intent" /> }));
vi.mock("./_components/BlastRadiusBlock", () => ({ BlastRadiusBlock: () => <section data-testid="blast" /> }));

import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

describe("OverviewTab", () => {
  it("AC-BRIEF-30 brief card renders above Intent/Blast row", () => {
    render(<OverviewTab prBody="body" prId="pr1" />);
    const brief = screen.getByTestId("brief");
    const intent = screen.getByTestId("intent");
    const blast = screen.getByTestId("blast");
    // Brief precedes the row in document order; Intent and Blast share the row after it.
    expect(brief.compareDocumentPosition(intent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(brief.compareDocumentPosition(blast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(brief.parentElement).not.toBe(intent.parentElement);
    expect(intent.parentElement).toBe(blast.parentElement);
  });
});
