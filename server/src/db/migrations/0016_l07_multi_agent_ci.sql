ALTER TABLE "ci_installations" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_url" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "github_run_id" bigint;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "github_repo_id" bigint;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "multi_agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_multi_agent_run_id_multi_agent_runs_id_fk" FOREIGN KEY ("multi_agent_run_id") REFERENCES "public"."multi_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_agent_repo_target_uq" ON "ci_installations" USING btree ("agent_id","repo","target_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_agent_run_id_uq" ON "ci_runs" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_installation_github_run_uq" ON "ci_runs" USING btree ("ci_installation_id","github_run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_multi_agent_run_id_idx" ON "agent_runs" USING btree ("multi_agent_run_id");