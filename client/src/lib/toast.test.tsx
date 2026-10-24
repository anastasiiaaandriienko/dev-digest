import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { LINK_TOAST_MS, TOAST_MS, ToastProvider, notify } from "./toast";

/**
 * Toasts: plain messages (every existing caller) auto-dismiss after 4 s; an
 * optional link (L07 AC-CI-15, the PR an export opened) opens in a new tab and
 * keeps the toast for 8 s. Only http(s) links are rendered.
 */

const PR = "https://github.com/acme/widgets/pull/12";

function mount() {
  render(
    <ToastProvider>
      <div />
    </ToastProvider>,
  );
}

const statusText = () => screen.getByRole("status").textContent ?? "";

describe("toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("a plain toast shows the message without a link and is gone after 4 s", () => {
    mount();
    act(() => notify.success("Saved"));
    expect(statusText()).toContain("Saved");
    expect(screen.queryByRole("link")).toBeNull();
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(statusText()).toContain("Saved");
    act(() => vi.advanceTimersByTime(1));
    expect(statusText()).not.toContain("Saved");
    expect(TOAST_MS).toBe(4000);
  });

  it("existing calls without options keep working for every kind", () => {
    mount();
    act(() => {
      notify.toast("A");
      notify.error("B");
      notify.info("C");
    });
    expect(statusText()).toContain("A");
    expect(statusText()).toContain("B");
    expect(statusText()).toContain("C");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a toast with a link renders it, opening in a new tab with noopener noreferrer", () => {
    mount();
    act(() => notify.success("PR ready in acme/widgets.", { link: { href: PR, label: "View PR" } }));
    const link = screen.getByRole("link", { name: "View PR" });
    expect(link).toHaveAttribute("href", PR);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(statusText()).toContain("PR ready in acme/widgets.");
  });

  it("a toast with a link stays 8 s, not 4 s", () => {
    mount();
    act(() => notify.success("PR ready", { link: { href: PR, label: "View PR" } }));
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(screen.getByRole("link", { name: "View PR" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(LINK_TOAST_MS - TOAST_MS - 1));
    expect(screen.getByRole("link", { name: "View PR" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("link", { name: "View PR" })).toBeNull();
    expect(statusText()).not.toContain("PR ready");
    expect(LINK_TOAST_MS).toBe(8000);
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "/repos/r1", "JAVASCRIPT:alert(1)"])(
    "an unsafe link (%s) is not rendered: the message shows as a plain 4 s toast",
    (href) => {
      mount();
      act(() => notify.success("PR ready", { link: { href, label: "View PR" } }));
      expect(screen.queryByRole("link")).toBeNull();
      expect(statusText()).toContain("PR ready");
      act(() => vi.advanceTimersByTime(TOAST_MS));
      expect(statusText()).not.toContain("PR ready");
    },
  );
});
