import { Suspense } from "react";
import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (Skills Lab → Eval Dashboard, L06). Thin route entry; the view
   reads `?agent=` / `?run=` with useSearchParams, which a static route must wrap
   in Suspense. */
export default function EvalDashboardPage() {
  return (
    <Suspense fallback={null}>
      <EvalDashboardView />
    </Suspense>
  );
}
