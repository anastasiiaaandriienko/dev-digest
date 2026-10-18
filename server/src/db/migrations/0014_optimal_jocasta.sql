CREATE TABLE "agent_context_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_context_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_context_docs_agent_repo_path_uq" ON "agent_context_docs" USING btree ("agent_id","repo_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_context_docs_skill_repo_path_uq" ON "skill_context_docs" USING btree ("skill_id","repo_id","path");