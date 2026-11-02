import type { Response } from "express";
import type { ApiFailure, ApiFieldError, ApiMeta, ApiSuccess, Paginated } from "@scope/contracts";

/** Every endpoint answers with the shared envelope from `@scope/contracts`. */
export function ok<T>(res: Response, data: T, status = 200, meta?: ApiMeta): void {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  res.status(status).json(body);
}

/** Paginated lists keep `data` as the item array and carry paging in `meta`. */
export function okPage<T>(res: Response, page: Paginated<T>): void {
  ok(res, page.items, 200, { page: page.page, perPage: page.perPage, total: page.total, totalPages: page.totalPages });
}

export function fail(res: Response, status: number, code: string, message: string, fields?: ApiFieldError[]): void {
  const body: ApiFailure = { success: false, error: fields ? { code, message, fields } : { code, message } };
  res.status(status).json(body);
}
