import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderIntl } from "../../../../../../../../../test/diff-fixtures";
import { SmartGroup } from "./SmartGroup";

afterEach(cleanup);

describe("SmartGroup", () => {
  it("toggles via the header, reflects aria-expanded and renders children only when open", () => {
    const onToggle = vi.fn();
    renderIntl(
      <SmartGroup groupKey="core" fileCount={3} filesWithFindings={0} open onToggle={onToggle}>
        <div>group body</div>
      </SmartGroup>,
    );
    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("group body")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
    fireEvent.click(header);
    expect(onToggle).toHaveBeenCalledTimes(1);

    cleanup();
    renderIntl(
      <SmartGroup groupKey="core" fileCount={3} filesWithFindings={0} open={false} onToggle={onToggle}>
        <div>group body</div>
      </SmartGroup>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("group body")).not.toBeInTheDocument();
  });

  it("an empty group shows 0 files, is disabled and never expands even when open", () => {
    const onToggle = vi.fn();
    renderIntl(
      <SmartGroup groupKey="docs" fileCount={0} filesWithFindings={0} open onToggle={onToggle}>
        <div>group body</div>
      </SmartGroup>,
    );
    const header = screen.getByRole("button");
    expect(header).toBeDisabled();
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("0 files")).toBeInTheDocument();
    expect(screen.queryByText("group body")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows the files-with-findings count only when > 0", () => {
    renderIntl(<SmartGroup groupKey="docs" fileCount={2} filesWithFindings={1} open={false} onToggle={() => {}} />);
    expect(screen.getByTitle("1 file with findings")).toHaveTextContent("1");
    cleanup();
    renderIntl(<SmartGroup groupKey="docs" fileCount={2} filesWithFindings={0} open={false} onToggle={() => {}} />);
    expect(screen.queryByTitle(/with findings/)).not.toBeInTheDocument();
  });

  it("shows label and hint for the group", () => {
    renderIntl(
      <SmartGroup groupKey="boilerplate" fileCount={1} filesWithFindings={0} open={false} onToggle={() => {}} />,
    );
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
    expect(screen.getByText("Generated / mechanical — skim")).toBeInTheDocument();
  });
});
