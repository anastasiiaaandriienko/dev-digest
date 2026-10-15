/* /skills — Skills Lab skills grid (HW2 #9–#12, #23–#24): search, "Add Skill"
   menu (create from scratch, import from a .md / .zip file — #15), skill cards with an
   enabled toggle and a delete button (with a confirmation dialog), a right-side
   preview drawer driven by `?preview=<id>`, and the create and import modals. Data comes
   from the useSkills hooks (server /skills API). */
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { PREVIEW_PARAM } from "../../constants";
import { CreateSkillModal } from "../CreateSkillModal";
import { ImportSkillModal } from "../ImportSkillModal";
import { DeleteSkillModal } from "../DeleteSkillModal";
import { SkillCard } from "../SkillCard";
import { SkillPreviewDrawer } from "../SkillPreviewDrawer";
import { SKELETON_CARDS } from "./constants";
import { filterSkills, previewedSkill } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Skill | null>(null);

  const previewId = search.get(PREVIEW_PARAM);
  const preview = previewedSkill(skills, previewId);
  const list = filterSkills(skills ?? [], query);

  // The preview lives in the URL (shareable, survives reload), like ?trace= on a PR.
  const setPreview = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(search.toString());
      if (id) sp.set(PREVIEW_PARAM, id);
      else sp.delete(PREVIEW_PARAM);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );
  const closePreview = React.useCallback(() => setPreview(null), [setPreview]);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreated={(sk) => setPreview(sk.id)} />}
      {importing && (
        <ImportSkillModal
          onClose={() => setImporting(false)}
          onImported={(created) => created[0] && setPreview(created[0].id)}
        />
      )}
      {preview !== undefined && (
        <SkillPreviewDrawer
          skill={preview}
          onClose={closePreview}
          onOpenPage={(id) => router.push(`/skills/${id}`)}
        />
      )}
      {deleting && (
        <DeleteSkillModal
          skill={deleting}
          onClose={() => setDeleting(null)}
          // A deleted skill's open preview would only say "not found": close it.
          onDeleted={(id) => {
            if (id === previewId) closePreview();
          }}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              aria-label={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={240}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.createFromScratch"), icon: "Edit", onClick: () => setCreating(true) },
              { divider: true },
              { label: t("page.menu.fromFile"), icon: "Upload", hint: t("page.menu.fromFileHint"), onClick: () => setImporting(true) },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid} aria-busy="true">
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} height={128} />
            ))}
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && (skills?.length ?? 0) === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setCreating(true)}
          />
        )}
        {!isLoading && !isError && (skills?.length ?? 0) > 0 && list.length === 0 && (
          <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body", { query })} />
        )}
        {list.length > 0 && (
          <div style={s.grid} data-testid="skills-grid">
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === previewId}
                onOpen={() => setPreview(sk.id)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                onDelete={() => setDeleting(sk)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
