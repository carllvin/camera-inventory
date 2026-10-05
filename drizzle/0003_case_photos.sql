ALTER TABLE "photo" ADD COLUMN "thumbnail_key" text;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "removed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_removed_by_id_user_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_expected_item" ADD CONSTRAINT "case_expected_item_target_ck" CHECK (num_nonnulls("case_expected_item"."equipment_type_id", "case_expected_item"."category_id") = 1);--> statement-breakpoint
ALTER TABLE "case_template_item" ADD CONSTRAINT "case_template_item_target_ck" CHECK (num_nonnulls("case_template_item"."equipment_type_id", "case_template_item"."category_id") = 1);