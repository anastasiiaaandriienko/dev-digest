/* /repos/:repoId/pulls/:number/multi-agent — Multi-Agent Review results (L07). */
"use client";

import { useParams } from "next/navigation";
import { ResultsView } from "./_components/ResultsView";

export default function MultiAgentResultsPage() {
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  return <ResultsView repoId={repoId} prNumber={Number(number)} />;
}
