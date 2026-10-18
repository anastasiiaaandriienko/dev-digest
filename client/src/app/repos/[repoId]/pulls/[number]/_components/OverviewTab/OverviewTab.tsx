"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { BriefCard } from "./_components/BriefCard";
import { IntentBlock } from "./_components/IntentBlock";
import { BlastRadiusBlock } from "./_components/BlastRadiusBlock";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  return (
    <>
      <BriefCard prId={prId} />
      {/* Intent and Blast Radius side by side; one column on narrow screens. */}
      <div style={s.topRow}>
        <IntentBlock prId={prId} />
        <BlastRadiusBlock prId={prId} />
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
