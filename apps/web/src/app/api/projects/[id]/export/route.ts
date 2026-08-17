import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  ExportRouteError,
  buildExportZip,
  isToolLanguage,
  listExportJobs,
  type ExportZipRequest,
  type ToolLanguage,
} from "@/lib/export/zip-harness";

function jsonError(err: ExportRouteError) {
  return NextResponse.json(
    { error: err.message, code: err.code, ...err.extra },
    { status: err.status }
  );
}

function parseProjectId(id: string): number | null {
  const projectId = Number(id);
  return Number.isFinite(projectId) ? projectId : null;
}

function parseBody(raw: unknown): ExportZipRequest {
  if (raw == null || raw === "") return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExportRouteError(400, "INVALID_JSON", "Invalid JSON body.");
  }
  const rec = raw as Record<string, unknown>;
  const opts: ExportZipRequest = {};
  if (rec.versionId != null) {
    const versionId = Number(rec.versionId);
    if (!Number.isFinite(versionId)) {
      throw new ExportRouteError(400, "INVALID_VERSION", "Invalid version id.");
    }
    opts.versionId = versionId;
  }
  if (rec.toolLanguage != null) {
    if (!isToolLanguage(rec.toolLanguage)) {
      throw new ExportRouteError(
        400,
        "TOOL_LANGUAGE_UNSUPPORTED",
        "Tool language must be python or bash."
      );
    }
    opts.toolLanguage = rec.toolLanguage as ToolLanguage;
  }
  if (rec.includeMemory != null) {
    opts.includeMemory = Boolean(rec.includeMemory);
  }
  if (rec.artifactVersion != null) {
    if (typeof rec.artifactVersion !== "string") {
      throw new ExportRouteError(
        400,
        "INVALID_ARTIFACT_VERSION",
        "artifactVersion must be semver (e.g. 1.0.0)."
      );
    }
    opts.artifactVersion = rec.artifactVersion;
  }
  return opts;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const projectId = parseProjectId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const jobs = await listExportJobs(db, projectId);
  return NextResponse.json({ jobs });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const projectId = parseProjectId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  let opts: ExportZipRequest = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const raw: unknown = await request.json();
      opts = parseBody(raw);
    } catch (err) {
      if (err instanceof ExportRouteError) return jsonError(err);
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  try {
    const result = await buildExportZip(db, projectId, opts);
    const headers: Record<string, string> = {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.bytes.byteLength),
      "X-Export-Job-Id": String(result.job.id),
      "X-Content-Hash": result.job.contentHash,
    };
    if (result.sizeWarning) {
      headers["X-Export-Size-Warning"] = "1";
    }
    return new Response(result.bytes, { status: 200, headers });
  } catch (err) {
    if (err instanceof ExportRouteError) return jsonError(err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Export failed",
        code: "EXPORT_FAILED",
      },
      { status: 500 }
    );
  }
}
