"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentBlock } from "./_components/IntentBlock";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  return (
    <>
      <IntentBlock prId={prId} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
