CREATE TABLE "planned_need" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"equipment_type_id" uuid,
	"label" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"rental_house_id" uuid,
	"need_from" date NOT NULL,
	"need_until" date NOT NULL,
	"order_by" date,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"fulfilled_document_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_need_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "planned_need_quantity_ck" CHECK ("planned_need"."quantity" >= 1),
	CONSTRAINT "planned_need_dates_ck" CHECK ("planned_need"."need_until" >= "planned_need"."need_from"),
	CONSTRAINT "planned_need_status_ck" CHECK ("planned_need"."status" IN ('open', 'fulfilled', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" text,
	CONSTRAINT "reminder_log_user_key_uq" UNIQUE("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ntfy_server" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ntfy_topic" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ntfy_token" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "reminder_hour" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "reminder_days_before" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "calendar_token" text;--> statement-breakpoint
ALTER TABLE "equipment_case" ADD COLUMN "return_due" date;--> statement-breakpoint
ALTER TABLE "equipment_item" ADD COLUMN "return_due" date;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "return_due" date;--> statement-breakpoint
ALTER TABLE "planned_need" ADD CONSTRAINT "planned_need_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_need" ADD CONSTRAINT "planned_need_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_need" ADD CONSTRAINT "planned_need_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_need" ADD CONSTRAINT "planned_need_type_fk" FOREIGN KEY ("workspace_id","equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_need" ADD CONSTRAINT "planned_need_rental_house_fk" FOREIGN KEY ("workspace_id","rental_house_id") REFERENCES "public"."rental_house"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_need" ADD CONSTRAINT "planned_need_document_fk" FOREIGN KEY ("workspace_id","fulfilled_document_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_need_project_id_status_index" ON "planned_need" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_calendar_token_uq" ON "user" USING btree ("calendar_token");