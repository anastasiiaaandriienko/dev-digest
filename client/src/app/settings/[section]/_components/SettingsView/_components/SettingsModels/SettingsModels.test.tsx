/**
 * Settings → Feature Models (HW2 #53): the Conventions row has a searchable
 * model dropdown fed by the live provider list; choosing a model saves it to
 * `feature_models.conventions` (which the server's conventions scan resolves).
 * Hooks are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/settings.json";

let settings: Record<string, unknown> | undefined;
let models: { id: string; provider: string }[] | undefined;
const mutate = vi.fn();
vi.mock("../../../../../../../lib/hooks", () => ({
  useSettings: () => ({ data: settings }),
  useUpdateSettings: () => ({ mutate }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({ useProviderModels: () => ({ data: models }) }));

import { SettingsModels } from "./SettingsModels";

beforeEach(() => {
  settings = { feature_models: { risk_brief: { provider: "openrouter", model: "z-ai/glm-4.6" } } };
  models = [
    { id: "deepseek/deepseek-v4", provider: "openrouter" },
    { id: "z-ai/glm-4.6", provider: "openrouter" },
    { id: "minimax/minimax-m2", provider: "openrouter" },
  ];
});
afterEach(() => {
  cleanup();
  mutate.mockReset();
});

function renderModels() {
  render(
    <NextIntlClientProvider locale="en" messages={{ settings: messages }}>
      <SettingsModels />
    </NextIntlClientProvider>,
  );
}
/** The FormField block of one feature, found by its label. */
const row = (label: string) => screen.getByText(label).closest("div")!.parentElement as HTMLElement;

describe("SettingsModels — Conventions", () => {
  it("has a Conventions row showing the registry default until one is chosen", () => {
    renderModels();
    const conv = row("Conventions");
    expect(conv).toHaveTextContent("Extracts coding conventions from the repo.");
    expect(within(conv).getByText(messages.models.usingDefault)).toBeInTheDocument();
    expect(within(conv).getByText("gpt-5.4")).toBeInTheDocument();
  });

  it("the dropdown is searchable and the choice is saved to feature_models.conventions (other features kept)", () => {
    renderModels();
    const conv = row("Conventions");
    fireEvent.click(within(conv).getByText("gpt-5.4"));
    const search = within(conv).getByPlaceholderText(messages.models.search);
    fireEvent.change(search, { target: { value: "deepseek" } });
    expect(within(conv).queryByRole("button", { name: /glm/ })).toBeNull();
    fireEvent.click(within(conv).getByRole("button", { name: /deepseek\/deepseek-v4/ }));
    expect(mutate).toHaveBeenCalledWith({
      feature_models: {
        risk_brief: { provider: "openrouter", model: "z-ai/glm-4.6" },
        conventions: { provider: "openrouter", model: "deepseek/deepseek-v4" },
      },
    });
  });

  it("a saved choice is shown on reload, without the default tag", () => {
    settings = { feature_models: { conventions: { provider: "openrouter", model: "minimax/minimax-m2" } } };
    renderModels();
    const conv = row("Conventions");
    expect(within(conv).getByText(/minimax\/minimax-m2/)).toBeInTheDocument();
    expect(within(conv).queryByText(messages.models.usingDefault)).toBeNull();
  });

  it("without an OpenRouter key the list is empty and a note says so; the current model stays selectable", () => {
    models = [];
    renderModels();
    expect(screen.getByText(messages.models.noKeyNote)).toBeInTheDocument();
    const conv = row("Conventions");
    fireEvent.click(within(conv).getByText("gpt-5.4"));
    expect(within(conv).getByRole("button", { name: /gpt-5\.4/ })).toBeInTheDocument();
  });
});
