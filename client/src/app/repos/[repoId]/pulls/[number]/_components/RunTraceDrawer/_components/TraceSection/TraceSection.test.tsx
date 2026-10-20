import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TraceSection } from "./TraceSection";

afterEach(cleanup);

describe("TraceSection", () => {
  it("renders the header as a button whose aria-expanded follows the open state", () => {
    render(
      <TraceSection icon="FileText" title="Prompt assembly" defaultOpen={false}>
        <p>section body</p>
      </TraceSection>,
    );
    const head = screen.getByRole("button", { name: "Prompt assembly" });
    expect(head).toHaveAttribute("type", "button");
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("section body")).toBeNull();

    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("section body")).toBeInTheDocument();

    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("section body")).toBeNull();
  });

  it("is open by default and keeps the right-hand badge inside the header", () => {
    render(
      <TraceSection icon="Wrench" title="Tool calls" right={<span>3</span>}>
        <p>calls</p>
      </TraceSection>,
    );
    const head = screen.getByRole("button", { name: "Tool calls 3" });
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("calls")).toBeInTheDocument();
  });
});
