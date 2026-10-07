import { pgEnum } from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member", "viewer"]);

export const projectStatus = pgEnum("project_status", ["planning", "prep", "shooting", "wrap", "closed"]);

export const trackingMode = pgEnum("tracking_mode", [
  /** One row = one physical object with its own identity (serial / asset number). */
  "serialized",
  /** One row = N interchangeable units (e.g. 20 × sandbags, 6 × BNC cables). */
  "bulk",
]);

/**
 * Where the item is in its lifecycle. Location-type status; physical condition is separate.
 * available / returned  -> not on any project (project_id IS NULL)
 * on_project / in_use / ready_for_return / missing -> on exactly one project
 */
export const equipmentStatus = pgEnum("equipment_status", [
  "available",
  "on_project",
  "in_use",
  "ready_for_return",
  "missing",
  "returned",
]);

export const equipmentCondition = pgEnum("equipment_condition", [
  "unknown",
  "ok",
  "minor_wear",
  "damaged",
  "defective",
]);

export const assignmentEndReason = pgEnum("assignment_end_reason", [
  "returned",
  "removed",
  "split",
  "lost",
]);

export const documentKind = pgEnum("document_kind", ["delivery_note", "return_note", "other", "inventory_list"]);

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "processing",
  "extracted",
  "confirmed",
  "failed",
  "discarded",
]);

export const documentLineResolution = pgEnum("document_line_resolution", [
  "pending",
  "match_existing",
  "create_new",
  "ignore",
  "discrepancy",
]);

export const photoKind = pgEnum("photo_kind", [
  "reference",
  "equipment",
  "case",
  "return_check",
  "damage",
  "other",
]);

export const issueType = pgEnum("issue_type", [
  "missing",
  "damaged",
  "serial_conflict",
  "ai_conflict",
  "return_mismatch",
  "delivery_mismatch",
  "other",
]);

export const issueStatus = pgEnum("issue_status", ["open", "in_progress", "resolved", "dismissed"]);

export const issueSeverity = pgEnum("issue_severity", ["low", "medium", "high", "critical"]);

export const actorType = pgEnum("actor_type", ["user", "system", "ai"]);
