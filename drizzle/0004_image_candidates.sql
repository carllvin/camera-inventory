CREATE TABLE "image_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"equipment_type_id" uuid NOT NULL,
	"query" text NOT NULL,
	"source" text NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"page_url" text,
	"title" text,
	"source_domain" text,
	"width" integer,
	"height" integer,
	"rank" integer NOT NULL,
	"score" real,
	"ai_note" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_candidate" ADD CONSTRAINT "image_candidate_type_fk" FOREIGN KEY ("workspace_id","equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_candidate_equipment_type_id_rank_index" ON "image_candidate" USING btree ("equipment_type_id","rank");