import { Suspense } from "react";
import { SkillDetailView } from "./_components/SkillDetailView";

/* Route: /skills/:id (Skills Lab → Skill: Config / Preview / Versioning). Thin
   route entry; the view reads `?tab=` with useSearchParams (Suspense boundary). */
export default function SkillPage() {
  return (
    <Suspense fallback={null}>
      <SkillDetailView />
    </Suspense>
  );
}
