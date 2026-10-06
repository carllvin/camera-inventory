CREATE TABLE "image_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"scope" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"started_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "image_job_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "image_job_status_ck" CHECK ("image_job"."status" IN ('running', 'done', 'cancelled', 'failed', 'interrupted')),
	CONSTRAINT "image_job_scope_ck" CHECK ("image_job"."scope" IN ('in_use', 'all'))
);
--> statement-breakpoint
CREATE TABLE "image_job_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"equipment_type_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"photo_id" uuid,
	"processed_at" timestamp with time zone,
	CONSTRAINT "image_job_item_result_ck" CHECK ("image_job_item"."result" IN ('pending', 'applied', 'has_image', 'not_confident', 'download_failed', 'error'))
);
--> statement-breakpoint
ALTER TABLE "image_job" ADD CONSTRAINT "image_job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_job" ADD CONSTRAINT "image_job_started_by_id_user_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_job_item" ADD CONSTRAINT "image_job_item_job_fk" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."image_job"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_job_item" ADD CONSTRAINT "image_job_item_type_fk" FOREIGN KEY ("workspace_id","equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_job_one_running_uq" ON "image_job" USING btree ("workspace_id") WHERE "image_job"."status" = 'running';--> statement-breakpoint
CREATE INDEX "image_job_item_job_id_sort_order_index" ON "image_job_item" USING btree ("job_id","sort_order");--> statement-breakpoint
CREATE INDEX "image_job_item_equipment_type_id_index" ON "image_job_item" USING btree ("equipment_type_id");