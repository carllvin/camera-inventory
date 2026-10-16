ALTER TABLE "document" ADD COLUMN "extraction_batch_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "extraction_batch_at" timestamp with time zone;