import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

type Ev = { runId: string; seq: number; kind: string; msg: string; t: string };
let live: { events: Ev[]; running: boolean } = { events: [], running: false };
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => live,
}));

import { RunStatus } from "./RunStatus";

afterEach(() => {
  cleanup();
  live = { events: [], running: false };
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

let seq = 0;
const ev = (runId: string, msg: string, kind = "info"): Ev => ({ runId, seq: ++seq, kind, msg, t: "00:00:00" });

/** "C/A/P/F" per phase of the stepper labelled `label`. */
function stepper(label: string): string {
  const wrap = screen.getByText(label).closest('[data-testid="phase-stepper"]')!;
  return Array.from(wrap.querySelectorAll("[data-phase]"))
    .map((li) => ({ pending: "P", active: "A", completed: "C", failed: "F" })[li.getAttribute("data-state")!])
    .join("");
}

describe("RunStatus (smoke)", () => {
  it("renders nothing when there are no run ids", () => {
    const { container } = renderWithIntl(<RunStatus runIds={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("RunStatus — lifecycle phases per live run", () => {
  it("shows one stepper per run, each derived from that run's own events", () => {
    live = {
      running: true,
      events: [
        ev("r1", "Loading PR diff…", "tool"),
        ev("r2", "Loading PR diff…", "tool"),
        ev("r1", "Resolving openai provider done (2ms)", "tool"),
        ev("r1", "Reviewing 1 changed file(s) in one pass"),
        ev("r2", "Resolving openai provider done (2ms)", "tool"),
      ],
    };
    renderWithIntl(<RunStatus runIds={["r1", "r2"]} labels={{ r1: "Security", r2: "Style" }} />);
    expect(stepper("Security")).toBe("CCAPP");
    expect(stepper("Style")).toBe("CAPPP");
    expect(screen.getAllByText(messages.phases.initiation)).toHaveLength(2);
  });

  it("a run whose log already ended is shown as ended while another is still streaming", () => {
    live = {
      running: true,
      events: [
        ev("r1", "Loading PR diff…", "tool"),
        ev("r1", "Resolving openai provider done (2ms)", "tool"),
        ev("r1", "Reviewing 1 changed file(s) in one pass"),
        ev("r1", "Run cancelled by user", "error"),
        ev("r2", "Loading PR diff…", "tool"),
      ],
    };
    renderWithIntl(<RunStatus runIds={["r1", "r2"]} labels={{ r1: "Security", r2: "Style" }} />);
    expect(stepper("Security")).toBe("CCFPP");
    expect(screen.getByLabelText(`${messages.phases.implementation}: ${messages.phases.state.cancelled}`)).toBeInTheDocument();
    expect(stepper("Style")).toBe("APPPP");
  });
});
