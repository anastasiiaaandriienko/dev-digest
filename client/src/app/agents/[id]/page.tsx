import { AgentEditorView } from "./_components/AgentEditorView";

/* Route: /agents/:id (Agent Editor). Thin route entry; the view (list column,
   editor, unsaved-changes guard) lives in _components/AgentEditorView. */
export default function AgentEditorPage() {
  return <AgentEditorView />;
}
