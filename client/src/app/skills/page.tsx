import { Suspense } from "react";
import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (Skills Lab → Skills). Thin route entry; the view reads
   `?preview=` with useSearchParams, which a static route must wrap in Suspense. */
export default function SkillsPage() {
  return (
    <Suspense fallback={null}>
      <SkillsListView />
    </Suspense>
  );
}
