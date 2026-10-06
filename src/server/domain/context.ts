/**
 * Request context passed to every domain service. Services never read
 * cookies or sessions themselves, which keeps them testable and reusable
 * from server actions, API routes and background workers alike.
 */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface Ctx {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

const RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function hasRole(ctx: Ctx, min: WorkspaceRole) {
  return RANK[ctx.role] >= RANK[min];
}

export function requireRole(ctx: Ctx, min: WorkspaceRole) {
  if (!hasRole(ctx, min)) {
    throw new DomainError("FORBIDDEN", "You do not have permission to do this.");
  }
}

export type DomainErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "VALIDATION" | "UNAVAILABLE";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function notFound(what: string): never {
  throw new DomainError("NOT_FOUND", `${what} not found.`);
}

/** Postgres error behind a Drizzle error, if any. */
export function pgErrorOf(err: unknown): { code?: string; constraint_name?: string; message?: string } | undefined {
  let e = err as { cause?: unknown; code?: string } | undefined;
  for (let i = 0; e && i < 5; i++) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e as never;
    e = e.cause as typeof e;
  }
  return undefined;
}
