import { z } from "zod";

/** Trimmed string; empty strings become null (forms submit "" for blank inputs). */
export const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
    z.string().max(max).nullable().optional(),
  );

export const requiredText = (max = 200) => z.string().trim().min(1, "Required").max(max);

export const optionalUuid = z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional());

export const optionalDate = z.preprocess(
  (v) => (v === "" ? null : v),
  z.iso.date().nullable().optional(),
);

/** Comma/newline separated list -> string[] (for alias inputs). */
export const stringList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z.array(z.string().max(200)).max(50).default([]),
);

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}
