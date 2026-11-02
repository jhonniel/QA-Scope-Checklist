import type { AdminErrorLog, AdminErrorQuery, ClientErrorReport, Paginated } from "@scope/contracts";
import type { Database } from "../../db/database.ts";
import { NotFoundError } from "../errors.ts";
import { toErrorLog, type Actor } from "../models.ts";
import { repositories, type ErrorLogInput } from "../repositories/index.ts";
import { AdminService } from "./AdminService.ts";

/**
 * Keeps the error log. Recording is best-effort by design: a failure to
 * persist an error must never turn into a second error for the user, so
 * `record` swallows database problems and reports them to the server log.
 */
export class ErrorLogService {
  constructor(
    private readonly db: Database,
    private readonly log: (message: string, error?: unknown) => void = console.error,
  ) {}

  /** Store a failure caught by the API. Resolves to the entry uuid, or null when storing failed. */
  async record(input: ErrorLogInput): Promise<string | null> {
    try {
      return await repositories(this.db).errorLogs.record(input);
    } catch (error) {
      this.log("Could not persist error log entry", error);
      return null;
    }
  }

  /** Store a failure reported by the web app. Anonymous reports are kept too — the login page can crash as well. */
  async reportFromClient(actor: Actor | null, report: ClientErrorReport, meta: { userAgent: string | null }): Promise<void> {
    await this.record({
      source: "web",
      code: report.name ?? null,
      message: report.message,
      stack: report.stack ?? null,
      path: report.path ?? null,
      actorId: actor?.id ?? null,
      userAgent: meta.userAgent,
      context: report.context ?? null,
    });
  }

  async list(actor: Actor, query: AdminErrorQuery): Promise<Paginated<AdminErrorLog>> {
    AdminService.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.max(1, Math.min(100, query.perPage ?? 25));
    const { rows, total } = await repositories(this.db).errorLogs.page({
      page,
      perPage,
      source: query.source && query.source !== "all" ? query.source : undefined,
      search: query.search?.trim() || undefined,
    });
    return { items: rows.map(toErrorLog), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  async show(actor: Actor, uuid: string): Promise<AdminErrorLog> {
    AdminService.assertAdmin(actor);
    const row = await repositories(this.db).errorLogs.findByUuid(uuid);
    if (!row) throw new NotFoundError("Error log entry was not found.");
    return toErrorLog(row);
  }
}
