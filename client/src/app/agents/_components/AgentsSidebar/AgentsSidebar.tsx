/* AgentsSidebar — the Agents list column (design: Agents, left of the editor):
   "Agents" heading, the "Add Agent" menu (create from scratch), search, and
   the scrollable agent cards with their enabled toggles, skill counts and
   delete (confirmation via DeleteAgentModal). Shared by /agents and
   /agents/:id; with no agents at all it shows only the heading (the page
   shows the empty state). Templates are not offered: none exist yet. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useAgents, useUpdateAgent } from "@/lib/hooks/agents";
import { AgentCard } from "../AgentCard";
import { CreateAgentModal } from "../CreateAgentModal";
import { DeleteAgentModal } from "../DeleteAgentModal";
import { SKELETON_CARDS } from "./constants";
import { filterAgents } from "./helpers";
import { s } from "./styles";

export function AgentsSidebar({
  selectedId,
  onSelect,
  onDeleted,
  creating,
  onCreatingChange,
}: {
  /** The agent open in the editor (highlighted card). */
  selectedId?: string | null;
  /** Open an agent (also called with an agent just created). */
  onSelect: (id: string) => void;
  /** After a confirmed delete. */
  onDeleted?: (id: string) => void;
  /** The create modal is open (owned by the page, so its empty state can open it too). */
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
}) {
  const t = useTranslations("agents");
  const { data: agents, isLoading, isError, refetch } = useAgents();
  const update = useUpdateAgent();
  const [query, setQuery] = React.useState("");
  const [deleting, setDeleting] = React.useState<Agent | null>(null);
  const list = filterAgents(agents ?? [], query);
  // A failed BACKGROUND refetch keeps the cached list (React Query leaves `data`): no error screen then.
  const failed = isError && !agents;
  const none = !isLoading && !!agents && agents.length === 0;

  return (
    <aside className="dd-skills-lab-list" style={s.column} aria-label={t("list.title")}>
      {creating && (
        <CreateAgentModal onClose={() => onCreatingChange(false)} onCreated={(agent) => onSelect(agent.id)} />
      )}
      {deleting && <DeleteAgentModal agent={deleting} onClose={() => setDeleting(null)} onDeleted={onDeleted} />}
      <div style={s.head}>
        <div style={s.titleRow(none)}>
          <h2 style={s.h2}>{t("list.title")}</h2>
          {!none && (
            <Dropdown
              width={210}
              align="right"
              trigger={
                <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                  {t("list.addAgent")}
                </Button>
              }
              items={[{ label: t("list.createFromScratch"), icon: "Edit", onClick: () => onCreatingChange(true) }]}
            />
          )}
        </div>
        {!none && (
          <label className="dd-skills-lab-search" style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              aria-label={t("list.searchPlaceholder")}
              style={s.searchInput}
            />
          </label>
        )}
      </div>

      <div style={s.scroll}>
        {isLoading && (
          <div style={s.stack} aria-busy="true">
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} height={96} />
            ))}
          </div>
        )}
        {failed && <ErrorState body={t("list.loadError")} onRetry={() => refetch()} />}
        {!isLoading && (agents?.length ?? 0) > 0 && list.length === 0 && (
          <EmptyState icon="Search" title={t("list.noMatchTitle")} body={t("list.noMatchBody", { query })} />
        )}
        {list.length > 0 && (
          <div style={s.stack} data-testid="agents-list">
            {list.map((a) => (
              <AgentCard
                key={a.id}
                ag={a}
                active={a.id === selectedId}
                skillCount={a.skill_count}
                onClick={() => onSelect(a.id)}
                onToggle={(enabled) => update.mutate({ id: a.id, patch: { enabled } })}
                onDelete={() => setDeleting(a)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
