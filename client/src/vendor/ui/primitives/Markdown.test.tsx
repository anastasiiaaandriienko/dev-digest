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

  // Observed: img is a void element, so unwrapDisallowed leaves nothing — the alt text is dropped.
  it("does not render images (no remote fetch); surrounding text survives", () => {
    const { container } = render(<Markdown>{"before ![alt text](http://x/y.png) after"}</Markdown>);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("before after");
    expect(container.innerHTML).not.toContain("http://x/y.png");
  });

  it("keeps a linked image's link and drops only the img", () => {
    const { container } = render(<Markdown>{"[![logo](http://x/y.png)](https://e.com)"}</Markdown>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toHaveAttribute("href", "https://e.com");
  });

  const TABLE = "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |";

  it("AC-CTX-141 renders a GFM table with bordered cells in an overflow-x wrapper", () => {
    const { container } = render(<Markdown>{TABLE}</Markdown>);
    const table = container.querySelector("table")!;
    expect(table.parentElement).toHaveStyle({ overflowX: "auto" });
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(container.querySelectorAll("tbody td")).toHaveLength(3);
    expect(container.querySelector("td")).toHaveStyle({ border: "1px solid var(--border)", padding: "6px 10px" });
    expect(container.querySelector("th")).toHaveStyle({ background: "var(--bg-hover)" });
  });

  it("AC-CTX-142 keeps column alignment on th/td", () => {
    const { container } = render(<Markdown>{TABLE}</Markdown>);
    const th = container.querySelectorAll("th");
    const td = container.querySelectorAll("td");
    expect([th[0], th[1], th[2]].map((e) => e!.style.textAlign)).toEqual(["left", "center", "right"]);
    expect([td[0], td[1], td[2]].map((e) => e!.style.textAlign)).toEqual(["left", "center", "right"]);
  });

  it("AC-CTX-143 table cells drop images and neutralise javascript: links", () => {
    const { container } = render(
      <Markdown>{"| a | b |\n|---|---|\n| ![x](http://x/y.png) | [c](javascript:alert(1)) |"}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("http://x/y.png");
    expect(container.querySelector("a")?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });

  it("neutralises javascript: hrefs on links", () => {
    const { container } = render(<Markdown>{"[click](javascript:alert(1))"}</Markdown>);
    const href = container.querySelector("a")?.getAttribute("href") ?? "";
    expect(href).not.toMatch(/^javascript:/i);
    expect(container).toHaveTextContent("click");
  });
});
