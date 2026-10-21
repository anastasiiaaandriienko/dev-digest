/** RootsPanel (A2): collapsed by default, toggles the unchanged RootsEditor, keeps itself open on save errors. */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/context.json";
import { RootsPanel } from "./RootsPanel";

afterEach(cleanup);

function view(props: Partial<React.ComponentProps<typeof RootsPanel>> = {}) {
  const onSave = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <RootsPanel roots={["docs", ".devdigest/specs"]} saving={false} onSave={onSave} {...props} />
    </NextIntlClientProvider>,
  );
  return { ...utils, onSave };
}

describe("RootsPanel", () => {
  it("AC-CTX-121 collapsed: toggle aria-expanded=false, summary shown, no textarea", () => {
    view();
    const toggle = screen.getByRole("button", { name: messages.roots.toggle });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/specs")).toBeInTheDocument();
    expect(screen.queryByLabelText(messages.roots.label)).toBeNull();
  });

  it("AC-CTX-122 toggle expands RootsEditor and collapses again", () => {
    view();
    const toggle = screen.getByRole("button", { name: messages.roots.toggle });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(messages.roots.label)).toHaveValue("docs\n.devdigest/specs");
    expect(screen.getByRole("button", { name: messages.roots.save })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(messages.roots.label)).toBeNull();
  });

  it("AC-CTX-123 a save error keeps the panel expanded and shows the alert", () => {
    const { rerender, onSave } = view();
    fireEvent.click(screen.getByRole("button", { name: messages.roots.toggle }));
    fireEvent.change(screen.getByLabelText(messages.roots.label), { target: { value: "specs" } });
    fireEvent.click(screen.getByRole("button", { name: messages.roots.save }));
    expect(onSave).toHaveBeenCalledWith(["specs"]);
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <RootsPanel roots={["docs", ".devdigest/specs"]} saving={false} error="Couldn’t save roots" onSave={onSave} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: messages.roots.toggle })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save roots");
  });
});
