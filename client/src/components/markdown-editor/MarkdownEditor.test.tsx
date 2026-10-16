/**
 * MarkdownEditor (Skill Editor · Config body): one gutter number per line,
 * the highlighted copy mirrors the textarea, header file name / unsaved /
 * tokens, edits reach onChange, and invalid state is exposed to assistive tech.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/common.json";
import { MarkdownEditor } from "./MarkdownEditor";

afterEach(cleanup);

function renderEditor(props: Partial<React.ComponentProps<typeof MarkdownEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ common: messages }}>
      <MarkdownEditor value={"# Title\n\n- item"} onChange={onChange} filename="rule.md" dirty={false} label="Skill body" {...props} />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

const gutter = () =>
  Array.from(document.querySelectorAll("[data-testid='skill-body-editor'] [aria-hidden='true'] > div")).map(
    (row) => row.firstElementChild?.textContent,
  );

describe("MarkdownEditor", () => {
  it("numbers every line (empty lines included) and mirrors the text", () => {
    renderEditor();
    expect(gutter()).toEqual(["1", "2", "3"]);
    expect(screen.getByTestId("skill-body-editor")).toHaveTextContent("# Title");
    expect(screen.getByTestId("skill-body-editor")).toHaveTextContent("- item");
  });

  it("header: file name, token count; 'unsaved' only when dirty", () => {
    renderEditor();
    expect(screen.getByText("rule.md")).toBeInTheDocument();
    expect(screen.getByTestId("body-tokens")).toHaveTextContent("~4 tokens");
    expect(screen.queryByTestId("body-unsaved")).toBeNull();
    cleanup();
    renderEditor({ dirty: true });
    expect(screen.getByTestId("body-unsaved")).toHaveTextContent(messages.markdownEditor.unsaved);
  });

  it("typing goes to onChange; the textarea is labelled and marks invalid input", () => {
    const { onChange } = renderEditor({ invalid: true });
    const box = screen.getByRole("textbox", { name: "Skill body" });
    expect(box).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(box, { target: { value: "new" } });
    expect(onChange).toHaveBeenCalledWith("new");
  });
});
