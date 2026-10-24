import { Suspense } from "react";
import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs (L07, specs/export-to-ci.md §6.3 "CI Runs page"). Thin route entry;
   the view reads `?agent_id=` / `?repo=` with useSearchParams, which a static route
   must wrap in Suspense. */
export default function CiRunsPage() {
  return (
    <Suspense fallback={null}>
      <CiRunsView />
    </Suspense>
  );
}
