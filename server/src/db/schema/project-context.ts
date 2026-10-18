import { pgTable, uuid, text, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Project Context
// Attachments of repo documents to agents / skills. Only the repo-relative path
// is stored — never the document text (it is read from the clone at run time).

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull(),
    createdAt: now(),
  },
  (t) => ({
    uq: uniqueIndex('agent_context_docs_agent_repo_path_uq').on(t.agentId, t.repoId, t.path),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull(),
    createdAt: now(),
  },
  (t) => ({
    uq: uniqueIndex('skill_context_docs_skill_repo_path_uq').on(t.skillId, t.repoId, t.path),
  }),
);

export type AgentContextDocRow = typeof agentContextDocs.$inferSelect;
export type SkillContextDocRow = typeof skillContextDocs.$inferSelect;
