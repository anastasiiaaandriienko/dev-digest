import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(cleanup);

/** Block elements are styled explicitly (the global reset strips their defaults). */
describe("Markdown", () => {
  it("renders headings, lists and fenced code as real block elements", () => {
    const { container } = render(
      <Markdown>{"# Title\n\n## Bad\n\n```ts\nreturn { id };\n```\n\n- one\n- two\n\n1. first"}</Markdown>,
    );
    expect(container.querySelector("h1")).toHaveTextContent("Title");
    expect(container.querySelector("h2")).toHaveTextContent("Bad");
    expect(container.querySelector("ul")).toHaveStyle({ listStyle: "disc" });
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("ol")).toHaveStyle({ listStyle: "decimal" });
    const pre = container.querySelector("pre")!;
    expect(pre.querySelector("code")).toHaveTextContent("return { id };");
    expect(pre.querySelector("code")).toHaveClass("language-ts");
    // Block code is not styled as an inline chip.
    expect(pre.querySelector("code")).not.toHaveStyle({ padding: "1px 6px" });
  });

  it("keeps inline code, bold and links styled as before; empty input renders nothing", () => {
    const { container } = render(<Markdown>{"Use **bold** and `x` [here](https://e.com)"}</Markdown>);
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("code")).toHaveStyle({ padding: "1px 6px" });
    expect(container.querySelector("a")).toHaveAttribute("href", "https://e.com");
    cleanup();
    expect(render(<Markdown>{""}</Markdown>).container).toBeEmptyDOMElement();
  });
});
