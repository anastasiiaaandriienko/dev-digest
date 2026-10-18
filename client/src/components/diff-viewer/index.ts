/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, and
   CodeLine + Line for rendering a computed diff (e.g. skill versions) without comments. */
export { DiffViewer } from "./DiffViewer";
export { CodeLine } from "./CodeLine";
export type { DiffCommentApi } from "./comments";
export type { Line } from "./helpers";
export { hasNewSideLine } from "./helpers";
export type { DiffFindingsApi } from "./findings";
export { UnanchoredFindings } from "./UnanchoredFindings";
