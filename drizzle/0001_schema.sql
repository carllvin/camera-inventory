CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "public"."assignment_end_reason" AS ENUM('returned', 'removed', 'split', 'lost');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('delivery_note', 'return_note', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_line_resolution" AS ENUM('pending', 'match_existing', 'create_new', 'ignore', 'discrepancy');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'processing', 'extracted', 'confirmed', 'failed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."equipment_condition" AS ENUM('unknown', 'ok', 'minor_wear', 'damaged', 'defective');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('available', 'on_project', 'in_use', 'ready_for_return', 'missing', 'returned');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'in_progress', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('missing', 'damaged', 'serial_conflict', 'ai_conflict', 'return_mismatch', 'delivery_mismatch', 'other');--> statement-breakpoint
CREATE TYPE "public"."photo_kind" AS ENUM('reference', 'equipment', 'case', 'return_check', 'damage', 'other');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planning', 'prep', 'shooting', 'wrap', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tracking_mode" AS ENUM('serialized', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"status" "project_status" DEFAULT 'prep' NOT NULL,
	"production_company" text,
	"description" text,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "project_dates_ck" CHECK ("project"."end_date" IS NULL OR "project"."start_date" IS NULL OR "project"."end_date" >= "project"."start_date")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "equipment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_id" uuid,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_tracking_mode" "tracking_mode" DEFAULT 'serialized' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "equipment_type_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "project_rental_house" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"rental_house_id" uuid NOT NULL,
	"order_reference" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_rental_house_uq" UNIQUE("project_id","rental_house_id")
);
--> statement-breakpoint
CREATE TABLE "rental_house" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"website" text,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "rental_house_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "case_expected_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"equipment_type_id" uuid,
	"category_id" uuid,
	"label" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_expected_item_quantity_ck" CHECK ("case_expected_item"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "case_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "case_template_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "case_template_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"equipment_type_id" uuid,
	"category_id" uuid,
	"label" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_template_item_quantity_ck" CHECK ("case_template_item"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "equipment_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"code" text,
	"barcode" text,
	"description" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "equipment_case_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "equipment_case_project_id_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "equipment_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"equipment_type_id" uuid NOT NULL,
	"tracking_mode" "tracking_mode" DEFAULT 'serialized' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"serial_number" text,
	"asset_number" text,
	"barcode" text,
	"rental_house_id" uuid,
	"project_id" uuid,
	"case_id" uuid,
	"status" "equipment_status" DEFAULT 'available' NOT NULL,
	"condition" "equipment_condition" DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"split_from_item_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_item_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "equipment_item_quantity_ck" CHECK ("equipment_item"."quantity" >= 1),
	CONSTRAINT "equipment_item_serialized_qty_ck" CHECK ("equipment_item"."tracking_mode" = 'bulk' OR "equipment_item"."quantity" = 1),
	CONSTRAINT "equipment_item_case_needs_project_ck" CHECK ("equipment_item"."case_id" IS NULL OR "equipment_item"."project_id" IS NOT NULL),
	CONSTRAINT "equipment_item_status_location_ck" CHECK (("equipment_item"."status" IN ('available', 'returned') AND "equipment_item"."project_id" IS NULL)
        OR ("equipment_item"."status" IN ('on_project', 'in_use', 'ready_for_return', 'missing') AND "equipment_item"."project_id" IS NOT NULL)),
	CONSTRAINT "equipment_item_serial_not_blank_ck" CHECK ("equipment_item"."serial_number" IS NULL OR btrim("equipment_item"."serial_number") <> '')
);
--> statement-breakpoint
CREATE TABLE "project_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"rental_house_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"delivery_document_id" uuid,
	"return_document_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_id" uuid,
	"ended_at" timestamp with time zone,
	"ended_by_id" uuid,
	"end_reason" "assignment_end_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_assignment_quantity_ck" CHECK ("project_assignment"."quantity" >= 1),
	CONSTRAINT "project_assignment_end_ck" CHECK (("project_assignment"."ended_at" IS NULL) = ("project_assignment"."end_reason" IS NULL) AND ("project_assignment"."ended_at" IS NULL OR "project_assignment"."ended_at" >= "project_assignment"."assigned_at"))
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"project_id" uuid,
	"rental_house_id" uuid,
	"document_number" text,
	"document_date" date,
	"title" text,
	"extraction" jsonb,
	"extraction_provider" text,
	"extraction_model" text,
	"extraction_error" text,
	"extracted_at" timestamp with time zone,
	"possible_duplicate_of_id" uuid,
	"uploaded_by_id" uuid,
	"confirmed_by_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "document_confirmed_ck" CHECK ("document"."status" <> 'confirmed' OR ("document"."confirmed_at" IS NOT NULL AND "document"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "document_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"raw_text" text,
	"description" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"serial_number" text,
	"asset_number" text,
	"ai_confidence" real,
	"matched_equipment_type_id" uuid,
	"matched_equipment_item_id" uuid,
	"match_confidence" real,
	"match_reason" text,
	"resolution" "document_line_resolution" DEFAULT 'pending' NOT NULL,
	"confirmed_quantity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_line_number_uq" UNIQUE("document_id","line_number"),
	CONSTRAINT "document_line_quantity_ck" CHECK ("document_line"."quantity" >= 0),
	CONSTRAINT "document_line_confidence_ck" CHECK (("document_line"."ai_confidence" IS NULL OR "document_line"."ai_confidence" BETWEEN 0 AND 1) AND ("document_line"."match_confidence" IS NULL OR "document_line"."match_confidence" BETWEEN 0 AND 1))
);
--> statement-breakpoint
CREATE TABLE "issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "issue_type" NOT NULL,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"severity" "issue_severity" DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_id" uuid,
	"equipment_item_id" uuid,
	"case_id" uuid,
	"document_id" uuid,
	"created_by_id" uuid,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "issue_resolution_ck" CHECK (("issue"."status" IN ('resolved', 'dismissed')) = ("issue"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "photo_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"size_bytes" bigint,
	"sha256" text,
	"caption" text,
	"source_url" text,
	"attribution" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"taken_at" timestamp with time zone,
	"uploaded_by_id" uuid,
	"equipment_type_id" uuid,
	"equipment_item_id" uuid,
	"case_id" uuid,
	"project_id" uuid,
	"issue_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_has_subject_ck" CHECK (num_nonnulls("photo"."equipment_type_id", "photo"."equipment_item_id", "photo"."case_id", "photo"."project_id", "photo"."issue_id") >= 1),
	CONSTRAINT "photo_reference_needs_type_ck" CHECK ("photo"."kind" <> 'reference' OR "photo"."equipment_type_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" DEFAULT 'user' NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"project_id" uuid,
	"equipment_item_id" uuid,
	"case_id" uuid,
	"document_id" uuid,
	"issue_id" uuid,
	"rental_house_id" uuid,
	"summary" text NOT NULL,
	"changes" jsonb,
	"metadata" jsonb,
	"correlation_id" uuid,
	CONSTRAINT "audit_event_actor_ck" CHECK ("audit_event"."actor_type" <> 'user' OR "audit_event"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."category"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_type" ADD CONSTRAINT "equipment_type_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_type" ADD CONSTRAINT "equipment_type_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."category"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_rental_house" ADD CONSTRAINT "project_rental_house_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_rental_house" ADD CONSTRAINT "project_rental_house_rental_house_fk" FOREIGN KEY ("workspace_id","rental_house_id") REFERENCES "public"."rental_house"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_house" ADD CONSTRAINT "rental_house_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_expected_item" ADD CONSTRAINT "case_expected_item_case_fk" FOREIGN KEY ("workspace_id","case_id") REFERENCES "public"."equipment_case"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_expected_item" ADD CONSTRAINT "case_expected_item_type_fk" FOREIGN KEY ("workspace_id","equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_expected_item" ADD CONSTRAINT "case_expected_item_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."category"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template" ADD CONSTRAINT "case_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_item" ADD CONSTRAINT "case_template_item_template_fk" FOREIGN KEY ("workspace_id","template_id") REFERENCES "public"."case_template"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_item" ADD CONSTRAINT "case_template_item_type_fk" FOREIGN KEY ("workspace_id","equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_item" ADD CONSTRAINT "case_template_item_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."category"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_case" ADD CONSTRAINT "equipment_case_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_case" ADD CONSTRAINT "equipment_case_template_fk" FOREIGN KEY ("workspace_id","template_id") REFERENCES "public"."case_template"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_type_fk" FOREIGN KEY ("workspace_id","equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_rental_house_fk" FOREIGN KEY ("workspace_id","rental_house_id") REFERENCES "public"."rental_house"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_case_fk" FOREIGN KEY ("project_id","case_id") REFERENCES "public"."equipment_case"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_split_from_fk" FOREIGN KEY ("workspace_id","split_from_item_id") REFERENCES "public"."equipment_item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_assigned_by_id_user_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_ended_by_id_user_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_item_fk" FOREIGN KEY ("workspace_id","equipment_item_id") REFERENCES "public"."equipment_item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_rental_house_fk" FOREIGN KEY ("workspace_id","rental_house_id") REFERENCES "public"."rental_house"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_delivery_doc_fk" FOREIGN KEY ("workspace_id","delivery_document_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_return_doc_fk" FOREIGN KEY ("workspace_id","return_document_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_confirmed_by_id_user_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_rental_house_fk" FOREIGN KEY ("workspace_id","rental_house_id") REFERENCES "public"."rental_house"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_duplicate_fk" FOREIGN KEY ("workspace_id","possible_duplicate_of_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_file" ADD CONSTRAINT "document_file_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_type_fk" FOREIGN KEY ("workspace_id","matched_equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_item_fk" FOREIGN KEY ("workspace_id","matched_equipment_item_id") REFERENCES "public"."equipment_item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_item_fk" FOREIGN KEY ("workspace_id","equipment_item_id") REFERENCES "public"."equipment_item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_case_fk" FOREIGN KEY ("workspace_id","case_id") REFERENCES "public"."equipment_case"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_type_fk" FOREIGN KEY ("workspace_id","equipment_type_id") REFERENCES "public"."equipment_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_item_fk" FOREIGN KEY ("workspace_id","equipment_item_id") REFERENCES "public"."equipment_item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_case_fk" FOREIGN KEY ("workspace_id","case_id") REFERENCES "public"."equipment_case"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_issue_fk" FOREIGN KEY ("workspace_id","issue_id") REFERENCES "public"."issue"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_item_fk" FOREIGN KEY ("workspace_id","equipment_item_id") REFERENCES "public"."equipment_item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_case_fk" FOREIGN KEY ("workspace_id","case_id") REFERENCES "public"."equipment_case"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."document"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_issue_fk" FOREIGN KEY ("workspace_id","issue_id") REFERENCES "public"."issue"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_rental_house_fk" FOREIGN KEY ("workspace_id","rental_house_id") REFERENCES "public"."rental_house"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_uq" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verification_identifier_index" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "project_workspace_name_uq" ON "project" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_slug_uq" ON "workspace" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "workspace_member_user_id_index" ON "workspace_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_sibling_name_uq" ON "category" USING btree ("workspace_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "category_parent_id_index" ON "category" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_type_model_uq" ON "equipment_type" USING btree ("workspace_id",lower("manufacturer"),lower("model"));--> statement-breakpoint
CREATE INDEX "equipment_type_category_id_index" ON "equipment_type" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "equipment_type_search_trgm_idx" ON "equipment_type" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "project_rental_house_rental_house_id_index" ON "project_rental_house" USING btree ("rental_house_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_house_workspace_name_uq" ON "rental_house" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "rental_house_search_trgm_idx" ON "rental_house" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "case_expected_item_case_id_index" ON "case_expected_item" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_template_name_uq" ON "case_template" USING btree ("workspace_id",lower("name")) WHERE "case_template"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "case_template_item_template_id_index" ON "case_template_item" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_case_name_uq" ON "equipment_case" USING btree ("project_id",lower("name")) WHERE "equipment_case"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_case_barcode_uq" ON "equipment_case" USING btree ("workspace_id","barcode") WHERE "equipment_case"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "equipment_item_workspace_id_equipment_type_id_index" ON "equipment_item" USING btree ("workspace_id","equipment_type_id");--> statement-breakpoint
CREATE INDEX "equipment_item_project_id_status_index" ON "equipment_item" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "equipment_item_case_id_index" ON "equipment_item" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "equipment_item_rental_house_id_index" ON "equipment_item" USING btree ("rental_house_id");--> statement-breakpoint
CREATE INDEX "equipment_item_search_trgm_idx" ON "equipment_item" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_item_serial_uq" ON "equipment_item" USING btree ("workspace_id","equipment_type_id",upper("serial_number")) WHERE "equipment_item"."serial_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_item_asset_uq" ON "equipment_item" USING btree ("workspace_id",coalesce("rental_house_id", '00000000-0000-0000-0000-000000000000'::uuid),upper("asset_number")) WHERE "equipment_item"."asset_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_item_barcode_uq" ON "equipment_item" USING btree ("workspace_id","barcode") WHERE "equipment_item"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_assignment_one_open_uq" ON "project_assignment" USING btree ("equipment_item_id") WHERE "project_assignment"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "project_assignment_project_id_ended_at_index" ON "project_assignment" USING btree ("project_id","ended_at");--> statement-breakpoint
CREATE INDEX "project_assignment_delivery_document_id_index" ON "project_assignment" USING btree ("delivery_document_id");--> statement-breakpoint
CREATE INDEX "project_assignment_return_document_id_index" ON "project_assignment" USING btree ("return_document_id");--> statement-breakpoint
CREATE INDEX "document_project_id_kind_index" ON "document" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "document_number_idx" ON "document" USING btree ("workspace_id","rental_house_id","kind",upper("document_number"));--> statement-breakpoint
CREATE INDEX "document_file_document_id_index" ON "document_file" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_file_workspace_id_sha256_index" ON "document_file" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "document_line_matched_equipment_item_id_index" ON "document_line" USING btree ("matched_equipment_item_id");--> statement-breakpoint
CREATE INDEX "issue_workspace_id_status_index" ON "issue" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "issue_project_id_status_index" ON "issue" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "issue_equipment_item_id_index" ON "issue" USING btree ("equipment_item_id");--> statement-breakpoint
CREATE INDEX "issue_case_id_index" ON "issue" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "issue_document_id_index" ON "issue" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "photo_equipment_type_id_index" ON "photo" USING btree ("equipment_type_id");--> statement-breakpoint
CREATE INDEX "photo_equipment_item_id_index" ON "photo" USING btree ("equipment_item_id");--> statement-breakpoint
CREATE INDEX "photo_case_id_index" ON "photo" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "photo_issue_id_index" ON "photo" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_primary_reference_uq" ON "photo" USING btree ("equipment_type_id") WHERE "photo"."is_primary" AND "photo"."kind" = 'reference';--> statement-breakpoint
CREATE INDEX "audit_event_workspace_id_occurred_at_index" ON "audit_event" USING btree ("workspace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_equipment_item_id_occurred_at_index" ON "audit_event" USING btree ("equipment_item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_project_id_occurred_at_index" ON "audit_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_case_id_occurred_at_index" ON "audit_event" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_document_id_index" ON "audit_event" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "audit_event_issue_id_index" ON "audit_event" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "audit_event_entity_type_entity_id_index" ON "audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_event_correlation_id_index" ON "audit_event" USING btree ("correlation_id");