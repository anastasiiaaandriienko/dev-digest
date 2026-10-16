CREATE TABLE "convention_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"provider" text,
	"model" text,
	"sample_files" jsonb,
	"candidates_found" integer,
	"candidates_added" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" double precision,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "scan_id" uuid;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convention_scans_ws_repo_idx" ON "convention_scans" USING btree ("workspace_id","repo_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "convention_scans_one_running_uq" ON "convention_scans" USING btree ("repo_id") WHERE status = 'running';--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_scan_id_convention_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."convention_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conventions_ws_repo_fingerprint_uq" ON "conventions" USING btree ("workspace_id","repo_id","fingerprint");--> statement-breakpoint
CREATE INDEX "conventions_ws_repo_status_idx" ON "conventions" USING btree ("workspace_id","repo_id","status");
--> statement-breakpoint
-- Data: keep the pending / accepted distinction (accepted=false stays pending, never rejected).
UPDATE "conventions" SET "status" = 'accepted' WHERE "accepted" = true;--> statement-breakpoint
-- Data: fingerprint existing rows exactly like normalizeRule() + sha256 in the app (ASCII-only trim /
-- whitespace collapse / lowercase on both sides, so they always agree); duplicates keep NULL.
UPDATE "conventions" AS c SET "fingerprint" = x.fp
FROM (
  SELECT id, fp, row_number() OVER (PARTITION BY workspace_id, repo_id, fp ORDER BY accepted DESC, id) AS rn
  FROM (
    SELECT id, workspace_id, repo_id, accepted,
      encode(sha256(convert_to(translate(regexp_replace(btrim("rule", ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), '[ \t\n\r\f\v]+', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'UTF8')), 'hex') AS fp
    FROM "conventions" WHERE "fingerprint" IS NULL
  ) s
) x
WHERE c.id = x.id AND x.rn = 1;
