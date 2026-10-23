/* /repos/:repoId/multi-agent?pr=<prId> — Configure run (L07 Multi-Agent Review). */
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { ConfigureRun } from "./_components/ConfigureRun";

export default function ConfigureRunPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const prParam = useSearchParams().get("pr");
  return <ConfigureRun repoId={repoId} prParam={prParam} />;
}
