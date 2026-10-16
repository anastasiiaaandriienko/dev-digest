import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { finding, renderIntl } from "../../../../../../../../../test/diff-fixtures";

const mutate = vi.fn();
const decisions = new Map<string, "pending" | "error" | "success">();
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
  useFindingDecisionStatus: () => decisions,
}));

import { InlineFinding } from "./InlineFinding";

const spyFetch = () => vi.spyOn(globalThis, "fetch");
let fetchSpy: ReturnType<typeof spyFetch>;
beforeEach(() => {
  mutate.mockClear();
  decisions.clear();
  fetchSpy = spyFetch();
});
afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
});

describe("InlineFinding", () => {
  it("shows the agent label and an expanded card (rationale visible)", () => {
    renderIntl(
      <InlineFinding f={finding({ id: "f1", rationale: "deep reason" })} agentName="Security bot" prId="pr1" />,
    );
    expect(screen.getByText("Security bot")).toBeInTheDocument();
    expect(screen.getByText("deep reason")).toBeInTheDocument();
  });

  it("omits the agent label when the agent is unknown", () => {
    renderIntl(<InlineFinding f={finding({ id: "f1" })} agentName={null} prId="pr1" />);
    expect(screen.getByText("Title f1")).toBeInTheDocument();
    expect(screen.queryByText("Security bot")).not.toBeInTheDocument();
  });

  it("x hides the card locally with no mutation and no request", () => {
    renderIntl(<InlineFinding f={finding({ id: "f1" })} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: "Hide this finding" }));
    expect(screen.queryByText("Title f1")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accept and reject call the mutation with the finding and PR id", () => {
    renderIntl(<InlineFinding f={finding({ id: "f1" })} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "f1", action: "dismiss", prId: "pr1" });
  });

  it("sends nothing while a decision for the finding is pending", () => {
    decisions.set("f1", "pending");
    renderIntl(<InlineFinding f={finding({ id: "f1" })} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("dismissed finding is muted and re-dismissing is not sent", () => {
    const f = finding({ id: "f1", dismissed_at: "2026-10-01T00:00:00Z" });
    const { container } = renderIntl(<InlineFinding f={f} prId="pr1" />);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(container.querySelector("[data-finding-id='f1']")).toHaveStyle({ opacity: "0.6" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("accepted finding: re-accepting is not sent but rejecting is", () => {
    const f = finding({ id: "f1", accepted_at: "2026-10-01T00:00:00Z" });
    renderIntl(<InlineFinding f={f} prId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "dismiss", prId: undefined });
  });
});
