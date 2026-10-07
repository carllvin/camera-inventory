ALTER TYPE "public"."document_line_resolution" ADD VALUE 'create_set';--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "is_container" boolean DEFAULT false NOT NULL;