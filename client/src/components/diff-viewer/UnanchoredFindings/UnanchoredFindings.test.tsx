import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { finding, renderIntl } from "../../../test/diff-fixtures";
import { UnanchoredFindings } from "./UnanchoredFindings";

afterEach(cleanup);

const api = { items: [], visible: true, renderCard: (f: { id: string }) => <div>card {f.id}</div> };

describe("UnanchoredFindings", () => {
  it("uses the default heading and renders each card", () => {
    renderIntl(<UnanchoredFindings findings={api} items={[finding({ id: "a" })]} />);
    expect(screen.getByText("Findings not on changed lines")).toBeInTheDocument();
    expect(screen.getByText("card a")).toBeInTheDocument();
  });

  it("a custom title overrides the default heading", () => {
    renderIntl(<UnanchoredFindings findings={api} items={[finding({ id: "a" })]} title="Custom" />);
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.queryByText("Findings not on changed lines")).not.toBeInTheDocument();
  });
});
