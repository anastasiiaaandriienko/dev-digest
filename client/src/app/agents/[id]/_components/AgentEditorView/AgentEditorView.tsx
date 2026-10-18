/* /agents/:id — Agent Editor (A2, L03; design: Agents list + editor). The list
   column (AgentsSidebar) stays on the left with this agent highlighted; the
   editor shows the header (name, status, Run on a PR) and the Config / Skills / Context
   tabs (CTX A1), kept in `?tab=`. Picking another card keeps the open tab; if Config
   has unsaved edits, UnsavedChangesModal asks first (Save and continue /
   Discard / Cancel) — also for a just-created agent and for "Run on a PR".
   Deleting the open agent goes back to /agents. Known limit: the breadcrumb
   and the app navigation are not guarded, only a browser reload / close is. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal";
import { ApiError } from "@/lib/api";
import { useAgent } from "@/lib/hooks/agents";
import type { UnsavedGuard } from "@/lib/unsaved-guard";
import { AgentsSidebar } from "../../../_components/AgentsSidebar";
import { AgentEditor } from "../AgentEditor";
import { TAB_KEYS as VALID_TABS } from "../AgentEditor/constants";
import { s } from "./styles";

export function AgentEditorView() {
  const t = useTranslations("agents");
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { data: agent, isLoading, isError, error, refetch } = useAgent(id);
  const [creating, setCreating] = React.useState(false);
  const configGuard = React.useRef<UnsavedGuard | null>(null);
  /** Where the user wanted to go while Config had unsaved edits (the dialog is open). */
  const [leaving, setLeaving] = React.useState<string | null>(null);
  const [savingToLeave, setSavingToLeave] = React.useState(false);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/agents/${id}?${sp.toString()}`);
  };

  /** Leave this agent for `url` — via UnsavedChangesModal when Config has unsaved edits. */
  const leaveTo = (url: string) => {
    if (configGuard.current?.dirty) setLeaving(url);
    else router.push(url);
  };
  const openAgent = (next: string) => {
    if (next !== id) leaveTo(`/agents/${next}?tab=${tab}`);
  };
  const saveAndLeave = async () => {
    if (!leaving) return;
    setSavingToLeave(true);
    const saved = (await configGuard.current?.save()) ?? true;
    setSavingToLeave(false);
    // A failed save stays here with the edits (and its errors / toast) visible.
    if (saved) router.push(leaving);
    else if (tab !== "config") setTab("config");
    setLeaving(null);
  };
  const discardAndLeave = () => {
    if (!leaving) return;
    router.push(leaving);
    setLeaving(null);
  };

  const crumb = [
    { label: t("list.breadcrumbLab") },
    { label: t("list.breadcrumb"), href: "/agents" },
    { label: agent?.name ?? t("editor.agentFallback") },
  ];
  // Error only when there is nothing to show: a failed BACKGROUND refetch keeps the cached agent.
  const failed = (isError && !agent) || (!isLoading && !agent);

  return (
    <AppShell crumb={crumb}>
      {leaving && agent && (
        <UnsavedChangesModal
          name={agent.name}
          saving={savingToLeave}
          onSave={saveAndLeave}
          onDiscard={discardAndLeave}
          onCancel={() => setLeaving(null)}
        />
      )}
      <div className="dd-skills-lab" style={s.lab}>
        <AgentsSidebar
          selectedId={id}
          onSelect={openAgent}
          // Deleting the agent that is open here: leave its (now gone) page.
          onDeleted={(deletedId) => deletedId === id && router.push("/agents")}
          creating={creating}
          onCreatingChange={setCreating}
        />

        <section style={s.editor} aria-label={agent?.name ?? t("editor.agentFallback")}>
          {isLoading && (
            <div style={s.state} aria-busy="true">
              <Skeleton height={24} width={240} />
              <Skeleton height={200} />
            </div>
          )}
          {failed && !isLoading && (
            <div style={s.state}>
              <ErrorState
                title={t("editor.loadErrorTitle")}
                body={error instanceof ApiError ? error.message : t("editor.loadErrorBody")}
                onRetry={() => refetch()}
              />
            </div>
          )}
          {agent && (
            <>
              <div style={s.header}>
                <Icon.Cpu size={18} style={s.headerIcon} />
                <h1 style={s.h1}>{agent.name}</h1>
                {!agent.enabled && <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>}
                <div style={s.headerActions}>
                  <Button kind="secondary" size="sm" icon="GitPullRequest" onClick={() => leaveTo("/")}>
                    {t("editor.runOnPr")}
                  </Button>
                </div>
              </div>
              <AgentEditor agent={agent} tab={tab} onTab={setTab} guardRef={configGuard} />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
