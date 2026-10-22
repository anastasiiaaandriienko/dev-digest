import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
// The modal (and its mutation hook) is covered by AddToEvalModal.test.tsx; stub it here.
vi.mock("../AddToEvalModal", () => ({
  AddToEvalModal: ({ finding }: { finding: FindingRecord }) => <div data-testid="add-to-eval-modal-stub">{finding.id}</div>,
}));

import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept / reject actions (A1: labels are Accept / Reject; Reject = dismiss)", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: messages.finding.accept }));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByRole("button", { name: messages.finding.dismiss }));
    expect(onAction).toHaveBeenCalledWith("dismiss");
    expect(messages.finding.dismiss).toBe("Reject");
    expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
  });
});

describe("FindingCard — decision states", () => {
  const accept = () => screen.getByRole("button", { name: messages.finding.accept });
  const reject = () => screen.getByRole("button", { name: messages.finding.dismiss });

  it("an accepted finding: tag shown, Accept pressed + disabled (no undo), Reject available", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, accepted_at: "t" }} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText(messages.finding.accepted)).toBeInTheDocument();
    expect(accept()).toBeDisabled();
    expect(accept()).toHaveAttribute("aria-pressed", "true");
    expect(reject()).toBeEnabled();
  });

  it("a rejected finding: 'rejected' tag, Reject disabled, Accept available", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, dismissed_at: "t" }} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText(messages.finding.dismissed)).toBeInTheDocument();
    expect(reject()).toBeDisabled();
    expect(accept()).toBeEnabled();
  });

  it("pending: both disabled and 'Saving decision…' is announced", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded decision="pending" onAction={() => {}} />);
    expect(accept()).toBeDisabled();
    expect(reject()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(messages.finding.decision.pending);
  });

  it("error: the message shows and the buttons are usable again", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded decision="error" onAction={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(messages.finding.decision.error);
    expect(accept()).toBeEnabled();
    expect(reject()).toBeEnabled();
  });

  it("success: 'Decision saved'", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, accepted_at: "t" }} defaultExpanded decision="success" onAction={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(messages.finding.decision.success);
  });
});

describe("FindingCard — Turn into eval case (L06)", () => {
  const E = messages.finding.evalCase;
  const turnInto = () => screen.queryByRole("button", { name: E.turnInto });
  const accept = () => screen.getByRole("button", { name: messages.finding.accept });
  const reject = () => screen.getByRole("button", { name: messages.finding.dismiss });

  it("is not offered for undecided findings or without an agent", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded canTurnIntoEvalCase onAction={() => {}} />);
    expect(turnInto()).toBeNull();
    cleanup();
    renderWithIntl(<FindingCard f={{ ...FINDING, accepted_at: "t" }} defaultExpanded onAction={() => {}} />);
    expect(turnInto()).toBeNull();
    expect(screen.queryByTestId("eval-kind-pill")).toBeNull();
  });

  it("accepted → must find: the button, its title and the pill", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, accepted_at: "t" }} defaultExpanded canTurnIntoEvalCase onAction={() => {}} />);
    expect(turnInto()).toHaveAttribute("title", E.titleMustFind);
    expect(screen.getByTestId("eval-kind-pill")).toHaveTextContent(E.kind.must_find);
  });

  it("dismissed → must not flag: the button, its title and the pill", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, dismissed_at: "t" }} defaultExpanded canTurnIntoEvalCase onAction={() => {}} />);
    expect(turnInto()).toHaveAttribute("title", E.titleMustNotFlag);
    expect(screen.getByTestId("eval-kind-pill")).toHaveTextContent(E.kind.must_not_flag);
  });

  it("opens the modal on click", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, accepted_at: "t" }} defaultExpanded canTurnIntoEvalCase onAction={() => {}} />);
    expect(screen.queryByTestId("add-to-eval-modal-stub")).toBeNull();
    fireEvent.click(turnInto()!);
    expect(screen.getByTestId("add-to-eval-modal-stub")).toHaveTextContent("f1");
  });

  it("shows In eval set instead of the button once a case exists (no second creation)", () => {
    renderWithIntl(
      <FindingCard f={{ ...FINDING, accepted_at: "t", eval_case_id: "case-1" }} defaultExpanded canTurnIntoEvalCase onAction={() => {}} />,
    );
    expect(turnInto()).toBeNull();
    expect(screen.getByTestId("eval-case-badge")).toHaveTextContent(E.inEvalSet);
    expect(screen.getByTestId("eval-kind-pill")).toHaveTextContent(E.kind.must_find);
  });

  it("keeps Accept / Reject working next to the eval action", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={{ ...FINDING, dismissed_at: "t" }} defaultExpanded canTurnIntoEvalCase onAction={onAction} />);
    fireEvent.click(accept());
    expect(onAction).toHaveBeenCalledWith("accept");
    expect(reject()).toBeDisabled();
  });
});
