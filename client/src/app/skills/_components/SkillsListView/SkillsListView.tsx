/* /skills — Skills Lab (design: Skills Lab, list + editor). The list column
   (SkillsSidebar: search, Add Skill menu, cards with enabled toggles) sits
   next to the editor area; picking a skill opens it at /skills/:id. Until one
   is picked the editor area asks to choose a skill. A `?preview=<id>` link
   still opens the read-only preview drawer (HW2 #10), whose "Open skill" goes
   to the editor. */
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills } from "@/lib/hooks/skills";
import { PREVIEW_PARAM } from "../../constants";
import { SkillPreviewDrawer } from "../SkillPreviewDrawer";
import { SkillsSidebar } from "../SkillsSidebar";
import { previewedSkill } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data: skills } = useSkills();

  const previewId = search.get(PREVIEW_PARAM);
  const preview = previewedSkill(skills, previewId);

  const closePreview = React.useCallback(() => {
    const sp = new URLSearchParams(search.toString());
    sp.delete(PREVIEW_PARAM);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, search]);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {preview !== undefined && (
        <SkillPreviewDrawer skill={preview} onClose={closePreview} onOpenPage={(id) => router.push(`/skills/${id}`)} />
      )}
      <div className="dd-skills-lab" style={s.lab}>
        <SkillsSidebar selectedId={previewId} onSelect={(id) => router.push(`/skills/${id}`)} />
        <section style={s.editor}>
          {(skills?.length ?? 0) > 0 && (
            <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
          )}
        </section>
      </div>
    </AppShell>
  );
}
