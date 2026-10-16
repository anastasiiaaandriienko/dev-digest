import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderIntl } from "../../../../../../../../../test/diff-fixtures";
import { OrderToggle } from "./OrderToggle";

afterEach(cleanup);

describe("OrderToggle", () => {
  it("is a labelled group, marks the current order pressed and reports changes", () => {
    const onChange = vi.fn();
    renderIntl(<OrderToggle value="original" onChange={onChange} />);
    expect(screen.getByRole("group", { name: "File order" })).toBeInTheDocument();
    const smart = screen.getByRole("button", { name: "Smart order" });
    const original = screen.getByRole("button", { name: "Original order" });
    expect(original).toHaveAttribute("aria-pressed", "true");
    expect(smart).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(smart);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("smart");
    fireEvent.click(original);
    expect(onChange).toHaveBeenLastCalledWith("original");
  });

  it("flips aria-pressed when value is smart", () => {
    renderIntl(<OrderToggle value="smart" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Smart order" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Original order" })).toHaveAttribute("aria-pressed", "false");
  });
});
