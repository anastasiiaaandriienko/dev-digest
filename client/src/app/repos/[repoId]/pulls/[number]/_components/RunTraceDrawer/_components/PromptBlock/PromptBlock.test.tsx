import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runsMessages from "../../../../../../../../../../messages/en/runs.json";
import { PromptBlock } from "./PromptBlock";

afterEach(cleanup);

function renderIt() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <PromptBlock label="Project context as sent" text="[placeholder line]" color="red" />
    </NextIntlClientProvider>,
  );
}

describe("PromptBlock", () => {
  it("toggles the prompt text from a labelled button with aria-expanded", () => {
    renderIt();
    const toggle = screen.getByRole("button", { name: "Project context as sent" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("[placeholder line]")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("[placeholder line]")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("[placeholder line]")).toBeNull();
  });

  it("still toggles from the row text, and the copy button does not toggle", () => {
    renderIt();
    fireEvent.click(screen.getByText(runsMessages.trace.expand));
    expect(screen.getByText("[placeholder line]")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: runsMessages.trace.prompt.copy }));
    expect(screen.getByText("[placeholder line]")).toBeInTheDocument();
  });
});
