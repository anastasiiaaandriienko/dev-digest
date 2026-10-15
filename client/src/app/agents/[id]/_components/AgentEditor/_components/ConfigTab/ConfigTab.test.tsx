/**
 * Agent ConfigTab (design: Agent Editor · Config): fields from the agent,
 * provider-dependent model list (OpenRouter included), token count, Save sends
 * only the changed fields, Cancel restores, a failed save or invalid input
 * keeps every edit, the unsaved-edits guard, and an outside enabled toggle
 * that does not make the form dirty. Hooks and the toast are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { UnsavedGuard } from "@/lib/unsaved-guard";
import messages from "../../../../../../../../messages/en/agents.json";

const mutateAsync = vi.fn();
const modelsFor = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutateAsync, isPending: false }),
  useProviderModels: (provider: string) => ({ data: modelsFor(provider) }),
}));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => ({ success, error: vi.fn(), info: vi.fn() }) }));

import { ConfigTab } from "./ConfigTab";

const C = messages.config;
const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 2,
};

beforeEach(() => {
  modelsFor.mockImplementation((p: string) =>
    p === "openrouter"
      ? [{ id: "deepseek/deepseek-v4-flash", provider: "openrouter", label: "DeepSeek V4 Flash", pricing: { promptPerM: 0.091, completionPerM: 0.182 } }]
      : [{ id: "gpt-4.1", provider: "openai" }],
  );
});
afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
  success.mockReset();
});

function renderTab(agent: Agent = AGENT) {
  const guardRef: React.MutableRefObject<UnsavedGuard | null> = { current: null };
  const ui = (a: Agent) => (
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ConfigTab agent={a} guardRef={guardRef} />
    </NextIntlClientProvider>
  );
  const r = render(ui(agent));
  return { guardRef, rerender: (a: Agent) => r.rerender(ui(a)) };
}
const nameInput = () => screen.getByDisplayValue(/^Security Reviewer/) as HTMLInputElement;
const save = () => screen.getByRole("button", { name: C.save });

describe("Agent ConfigTab", () => {
  it("shows the agent's fields, the prompt token count, and Save / Cancel disabled until something changes", () => {
    renderTab();
    expect(screen.getByRole("heading", { level: 2, name: C.title })).toBeInTheDocument();
    expect(nameInput()).toBeInTheDocument();
    expect(screen.getByDisplayValue("Flags secrets")).toBeInTheDocument();
    expect(screen.getByDisplayValue("You are a security reviewer.")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-tokens")).toHaveTextContent("~7 tokens");
    expect(save()).toBeDisabled();
    expect(screen.getByRole("button", { name: C.cancel })).toBeDisabled();
    expect(screen.getByText(C.noChanges)).toBeInTheDocument();
  });

  it("the model list follows the provider (OpenRouter models load when OpenRouter is picked)", () => {
    renderTab();
    expect(modelsFor).toHaveBeenLastCalledWith("openai");
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "openrouter" } });
    expect(modelsFor).toHaveBeenLastCalledWith("openrouter");
  });

  it("Save sends only the changed fields and confirms; Cancel restores the saved values", async () => {
    mutateAsync.mockResolvedValue({ ...AGENT, name: "Sec", version: 2 });
    renderTab();
    fireEvent.change(nameInput(), { target: { value: "  Sec  " } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mutateAsync).toHaveBeenCalledWith({ id: "ag1", patch: { name: "Sec" } });
    expect(success).toHaveBeenCalled();

    fireEvent.change(screen.getByDisplayValue("Flags secrets"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: C.cancel }));
    expect(screen.getByDisplayValue("Flags secrets")).toBeInTheDocument();
  });

  it("a failed save keeps every edit", async () => {
    mutateAsync.mockRejectedValue(new Error("500"));
    renderTab();
    fireEvent.change(nameInput(), { target: { value: "Security Reviewer v2" } });
    fireEvent.change(screen.getByDisplayValue("You are a security reviewer."), { target: { value: "New prompt" } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(nameInput().value).toBe("Security Reviewer v2");
    expect(screen.getByDisplayValue("New prompt")).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
  });

  it("empty name or system prompt is refused inline and nothing is sent", async () => {
    renderTab();
    fireEvent.change(nameInput(), { target: { value: "  " } });
    fireEvent.change(screen.getByDisplayValue("You are a security reviewer."), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(C.errors.name)).toBeInTheDocument();
    expect(screen.getByText(C.errors.system_prompt)).toBeInTheDocument();
  });
});

describe("Agent ConfigTab — unsaved-edits guard", () => {
  it("reports dirty; guard.save() is true after a save and false (edits kept) on failure", async () => {
    const { guardRef } = renderTab();
    expect(guardRef.current?.dirty).toBe(false);
    fireEvent.change(nameInput(), { target: { value: "Renamed" } });
    expect(guardRef.current?.dirty).toBe(true);

    mutateAsync.mockRejectedValueOnce(new Error("500"));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await guardRef.current!.save();
    });
    expect(ok).toBe(false);
    expect(screen.getByDisplayValue("Renamed")).toBeInTheDocument();

    mutateAsync.mockResolvedValueOnce({ ...AGENT, name: "Renamed" });
    await act(async () => {
      ok = await guardRef.current!.save();
    });
    expect(ok).toBe(true);
    expect(mutateAsync).toHaveBeenLastCalledWith({ id: "ag1", patch: { name: "Renamed" } });
  });

  it("an outside enabled toggle (list card) updates the form without making it dirty", () => {
    const { guardRef, rerender } = renderTab();
    rerender({ ...AGENT, enabled: false });
    expect(screen.getByRole("switch", { name: "Enable Security Reviewer" })).toHaveAttribute("aria-checked", "false");
    expect(guardRef.current?.dirty).toBe(false);
  });

  it("asks the browser to confirm a reload / close only while there are unsaved edits", () => {
    renderTab();
    const before = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(before()).toBe(false);
    fireEvent.change(nameInput(), { target: { value: "x" } });
    expect(before()).toBe(true);
  });
});
