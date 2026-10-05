-- Extensions used by the schema. All three are "trusted" extensions in PG13+,
-- so a database owner without superuser rights can install them.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
