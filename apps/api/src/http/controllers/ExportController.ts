import type { Request, Response } from "express";
import type { ExportService } from "../../domain/services/ExportService.ts";
import { toUserSummary } from "../../domain/models.ts";
import { requireAuth } from "../context.ts";
import { ok } from "../response.ts";
import { createExportSchema, parse, uuid } from "../validate.ts";

export class ExportController {
  constructor(private readonly exports: ExportService) {}

  templates = async (_req: Request, res: Response) => {
    requireAuth(_req);
    ok(res, await this.exports.listTemplates());
  };

  /**
   * The one endpoint that does not answer with the JSON envelope on success:
   * the body is the generated file. Errors still use the envelope.
   */
  create = async (req: Request, res: Response) => {
    const { actor, user } = requireAuth(req);
    const input = parse(createExportSchema, req.body);
    const result = await this.exports.export(actor, toUserSummary({ uuid: user.uuid, name: user.name, email: user.email, avatar_url: user.avatarUrl }), parse(uuid, req.params.projectUuid), input);

    res.status(200);
    res.setHeader("Content-Type", result.file.contentType);
    res.setHeader("Content-Length", String(result.file.buffer.byteLength));
    res.setHeader("Content-Disposition", contentDisposition(result.fileName));
    res.setHeader("X-Export-Template", encodeURIComponent(result.template.name));
    res.setHeader("X-Export-Sections", String(result.sectionCount));
    res.setHeader("X-Export-Tasks", String(result.taskCount));
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Export-Template, X-Export-Sections, X-Export-Tasks");
    res.end(result.file.buffer);
  };
}

/** RFC 6266 attachment header with an ASCII fallback and a UTF-8 `filename*`. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
