-- ---------------------------------------------------------------------------
-- 1. Audit log is append-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Search text normalization (lower-case, accent-free; serials also compacted
--    so "SN-123 456" matches "sn123456").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(input, '')))
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_compact(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(search_normalize(input), '[^a-z0-9]', '', 'g')
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION equipment_type_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := search_normalize(concat_ws(' ',
    NEW.manufacturer, NEW.model, NEW.name, array_to_string(NEW.aliases, ' '),
    search_compact(NEW.model)));
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER equipment_type_search_text_trg
  BEFORE INSERT OR UPDATE OF manufacturer, model, name, aliases ON equipment_type
  FOR EACH ROW EXECUTE FUNCTION equipment_type_search_text();--> statement-breakpoint

CREATE OR REPLACE FUNCTION rental_house_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := search_normalize(concat_ws(' ',
    NEW.name, NEW.short_name, array_to_string(NEW.aliases, ' ')));
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER rental_house_search_text_trg
  BEFORE INSERT OR UPDATE OF name, short_name, aliases ON rental_house
  FOR EACH ROW EXECUTE FUNCTION rental_house_search_text();--> statement-breakpoint

CREATE OR REPLACE FUNCTION equipment_item_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := search_normalize(concat_ws(' ',
    NEW.serial_number, search_compact(NEW.serial_number),
    NEW.asset_number, search_compact(NEW.asset_number),
    NEW.barcode));
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER equipment_item_search_text_trg
  BEFORE INSERT OR UPDATE OF serial_number, asset_number, barcode ON equipment_item
  FOR EACH ROW EXECUTE FUNCTION equipment_item_search_text();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Category tree must stay acyclic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION category_prevent_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id OR EXISTS (
    WITH RECURSIVE ancestors(id, parent_id) AS (
      SELECT c.id, c.parent_id FROM category c WHERE c.id = NEW.parent_id
      UNION
      SELECT c.id, c.parent_id FROM category c JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'category % cannot be moved below its own descendant', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER category_prevent_cycle_trg
  BEFORE INSERT OR UPDATE OF parent_id ON category
  FOR EACH ROW EXECUTE FUNCTION category_prevent_cycle();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. equipment_item.project_id must agree with the open project_assignment.
--    Deferred to commit time so services can update both rows in any order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_item_assignment(p_item_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_item_project uuid;
  v_open_project uuid;
BEGIN
  SELECT project_id INTO v_item_project FROM equipment_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT project_id INTO v_open_project
    FROM project_assignment WHERE equipment_item_id = p_item_id AND ended_at IS NULL;
  IF v_item_project IS DISTINCT FROM v_open_project THEN
    RAISE EXCEPTION 'equipment_item % is on project % but its open assignment is on project %',
      p_item_id, v_item_project, v_open_project
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION equipment_item_assignment_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM check_item_assignment(NEW.id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_assignment_item_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM check_item_assignment(NEW.equipment_item_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER equipment_item_assignment_consistency
  AFTER INSERT OR UPDATE OF project_id ON equipment_item
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION equipment_item_assignment_trg();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER project_assignment_consistency
  AFTER INSERT OR UPDATE ON project_assignment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION project_assignment_item_trg();--> statement-breakpoint

-- Project assignments are history: rows may be closed but never deleted.
CREATE OR REPLACE FUNCTION project_assignment_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project_assignment rows are history and cannot be deleted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER project_assignment_no_delete_trg
  BEFORE DELETE ON project_assignment
  FOR EACH ROW EXECUTE FUNCTION project_assignment_no_delete();
