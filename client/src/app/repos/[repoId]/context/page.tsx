/* /repos/:repoId/context — Project Context folder (read-only docs browser). */
"use client";

import { useParams } from "next/navigation";
import { ContextView } from "./_components/ContextView";

export default function ContextPage() {
  const { repoId } = useParams<{ repoId: string }>();
  return <ContextView repoId={repoId} />;
}
