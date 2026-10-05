import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import type { Ctx } from "./context";

export type SearchHitKind = "item" | "type" | "case" | "project" | "rental_house" | "document";

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  title: string;
  subtitle: string | null;
  score: number;
  /** Owning project for cases (cases have no page of their own yet). */
  parentId: string | null;
}

/**
 * Global search across equipment, identifiers, cases, projects, rental houses and documents.
 * Uses normalized text (accents/case removed), substring match and trigram similarity, so
 * aliases ("A35"), compact serials ("sn77812") and small typos ("Alexxa") all find results.
 */
export async function globalSearch(db: DbOrTx, ctx: Ctx, rawQuery: string, limitPerKind = 8): Promise<SearchHit[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const ws = ctx.workspaceId;
  const rows = await db.execute<{ kind: SearchHitKind; id: string; title: string; subtitle: string | null; score: number; parent_id: string | null }>(sql`
    WITH params AS (SELECT search_normalize(${q}) AS nq, search_compact(${q}) AS cq),
    items AS (
      SELECT 'item'::text AS kind, i.id,
        t.name || coalesce(' · SN ' || i.serial_number, '') ||
          CASE WHEN i.tracking_mode = 'bulk' AND i.quantity > 1 THEN ' × ' || i.quantity ELSE '' END AS title,
        concat_ws(' · ', nullif(concat_ws(' ', 'Asset', i.asset_number), 'Asset'), rh.name, p.name, replace(i.status::text, '_', ' ')) AS subtitle,
        GREATEST(
          CASE WHEN i.search_text LIKE '%' || params.nq || '%' THEN 1.0 ELSE 0 END,
          CASE WHEN params.cq <> '' AND i.search_text LIKE '%' || params.cq || '%' THEN 0.95 ELSE 0 END,
          word_similarity(params.nq, t.search_text) * 0.8
        ) AS score,
        NULL::uuid AS parent_id
      FROM equipment_item i
      JOIN equipment_type t ON t.id = i.equipment_type_id
      LEFT JOIN rental_house rh ON rh.id = i.rental_house_id
      LEFT JOIN project p ON p.id = i.project_id, params
      WHERE i.workspace_id = ${ws} AND (
        i.search_text LIKE '%' || params.nq || '%'
        OR (params.cq <> '' AND length(params.cq) >= 3 AND i.search_text LIKE '%' || params.cq || '%')
        OR params.nq <% t.search_text
      )
      ORDER BY score DESC, title LIMIT ${limitPerKind}
    ),
    types AS (
      SELECT 'type'::text, t.id, t.name, coalesce(c.name, 'Uncategorized') ||
          ' · ' || (SELECT count(*) FROM equipment_item i WHERE i.equipment_type_id = t.id) || ' items',
        GREATEST(CASE WHEN t.search_text LIKE '%' || params.nq || '%' THEN 1.0 ELSE 0 END, word_similarity(params.nq, t.search_text)), NULL::uuid
      FROM equipment_type t LEFT JOIN category c ON c.id = t.category_id, params
      WHERE t.workspace_id = ${ws} AND t.archived_at IS NULL
        AND (t.search_text LIKE '%' || params.nq || '%' OR params.nq <% t.search_text)
      ORDER BY 5 DESC LIMIT ${limitPerKind}
    ),
    cases AS (
      SELECT 'case'::text, c.id, c.name, concat_ws(' · ', c.code, p.name),
        GREATEST(CASE WHEN search_normalize(concat_ws(' ', c.name, c.code, c.barcode)) LIKE '%' || params.nq || '%' THEN 1.0 ELSE 0 END,
                 word_similarity(params.nq, search_normalize(concat_ws(' ', c.name, c.code)))), c.project_id
      FROM equipment_case c JOIN project p ON p.id = c.project_id, params
      WHERE c.workspace_id = ${ws} AND c.archived_at IS NULL
        AND (search_normalize(concat_ws(' ', c.name, c.code, c.barcode)) LIKE '%' || params.nq || '%'
             OR params.nq <% search_normalize(concat_ws(' ', c.name, c.code)))
      ORDER BY 5 DESC LIMIT ${limitPerKind}
    ),
    projects AS (
      SELECT 'project'::text, p.id, p.name, concat_ws(' · ', p.code, p.status::text, p.production_company),
        GREATEST(CASE WHEN search_normalize(concat_ws(' ', p.name, p.code, p.production_company)) LIKE '%' || params.nq || '%' THEN 1.0 ELSE 0 END,
                 word_similarity(params.nq, search_normalize(concat_ws(' ', p.name, p.code)))), NULL::uuid
      FROM project p, params
      WHERE p.workspace_id = ${ws} AND p.archived_at IS NULL
        AND (search_normalize(concat_ws(' ', p.name, p.code, p.production_company)) LIKE '%' || params.nq || '%'
             OR params.nq <% search_normalize(concat_ws(' ', p.name, p.code)))
      ORDER BY 5 DESC LIMIT ${limitPerKind}
    ),
    houses AS (
      SELECT 'rental_house'::text, r.id, r.name, nullif(array_to_string(r.aliases, ', '), ''),
        GREATEST(CASE WHEN r.search_text LIKE '%' || params.nq || '%' THEN 1.0 ELSE 0 END, word_similarity(params.nq, r.search_text)), NULL::uuid
      FROM rental_house r, params
      WHERE r.workspace_id = ${ws} AND r.archived_at IS NULL
        AND (r.search_text LIKE '%' || params.nq || '%' OR params.nq <% r.search_text)
      ORDER BY 5 DESC LIMIT ${limitPerKind}
    ),
    docs AS (
      SELECT 'document'::text, d.id,
        CASE d.kind WHEN 'delivery_note' THEN 'Delivery note ' WHEN 'return_note' THEN 'Return note ' ELSE 'Document ' END || coalesce(d.document_number, ''),
        concat_ws(' · ', rh.name, p.name, d.document_date::text),
        CASE WHEN search_compact(d.document_number) LIKE '%' || params.cq || '%' THEN 1.0 ELSE 0.5 END, NULL::uuid
      FROM document d LEFT JOIN rental_house rh ON rh.id = d.rental_house_id LEFT JOIN project p ON p.id = d.project_id, params
      WHERE d.workspace_id = ${ws} AND d.status <> 'discarded'
        AND ((params.cq <> '' AND search_compact(d.document_number) LIKE '%' || params.cq || '%')
             OR search_normalize(d.title) LIKE '%' || params.nq || '%')
      ORDER BY 5 DESC LIMIT ${limitPerKind}
    )
    SELECT * FROM items UNION ALL SELECT * FROM types UNION ALL SELECT * FROM cases
    UNION ALL SELECT * FROM projects UNION ALL SELECT * FROM houses UNION ALL SELECT * FROM docs
  `);
  return rows.map(({ parent_id, ...r }) => ({ ...r, score: Number(r.score), parentId: parent_id }));
}
