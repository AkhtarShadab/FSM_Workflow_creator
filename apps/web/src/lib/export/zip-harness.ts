import { and, desc, eq } from "drizzle-orm";
import JSZip from "jszip";
import {
  ExportEngineError,
  generateHarness,
  type FsmDsl,
  type GeneratedFile,
} from "@fsm/export-engine";
import { exportJobs, fsmDefinitions, projects } from "@/db/schema";
import { canvasToDsl, lintCanvas } from "@/lib/canvas-to-dsl";
import { toUpdatedAtMs } from "@/lib/draft-autosave";
import {
  isCanvasData,
  type PersistenceDb,
} from "@/lib/draft-sync";
import type { CanvasData, LintIssue } from "@/lib/fsm-types";

export const ZIP_SIZE_WARN_BYTES = 50 * 1024 * 1024;
export const TOOL_LANGUAGES = ["python", "bash"] as const;
export type ToolLanguage = (typeof TOOL_LANGUAGES)[number];

export type ExportZipRequest = {
  versionId?: number;
  toolLanguage?: ToolLanguage;
  includeMemory?: boolean;
  artifactVersion?: string;
};

export type ExportJobRow = {
  id: number;
  fsmId: number;
  version: number;
  target: string;
  status: string;
  artifactUrl: string | null;
  contentHash: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
};

export type ExportZipResult = {
  bytes: Uint8Array;
  filename: string;
  job: { id: number; contentHash: string; sizeBytes: number; status: string };
  sizeWarning: boolean;
};

export class ExportRouteError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ExportRouteError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return undefined;
}

function toIso(value: Date | number | string | null | undefined): string {
  const ms = toUpdatedAtMs(value);
  return new Date(ms || 0).toISOString();
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/ghp_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/sk-[A-Za-z0-9]+/g, "[redacted]");
}

export function isToolLanguage(value: unknown): value is ToolLanguage {
  return value === "python" || value === "bash";
}

function isScriptState(state: unknown): state is Record<string, unknown> {
  if (!isRecord(state)) return false;
  const kind = state.type ?? state.stateType;
  return kind === "SCRIPT";
}

function scriptLanguageOf(state: Record<string, unknown>): string | undefined {
  const script = isRecord(state.script) ? state.script : undefined;
  const tool = isRecord(state.tool) ? state.tool : undefined;
  const lang = firstString(script?.language, tool?.language);
  return lang?.toLowerCase();
}

export function collectScriptLanguages(dsl: FsmDsl): string[] {
  const states = Array.isArray(dsl.states) ? dsl.states : [];
  const langs = new Set<string>();
  for (const state of states) {
    if (!isScriptState(state)) continue;
    const lang = scriptLanguageOf(state);
    if (lang) langs.add(lang);
  }
  return [...langs].sort();
}

export function enrichScriptSources(dsl: FsmDsl, canvas: CanvasData | null): FsmDsl {
  const byId = new Map(
    (canvas?.nodes ?? []).map((node) => [node.id, node] as const)
  );
  const states = Array.isArray(dsl.states) ? dsl.states : [];
  return {
    ...dsl,
    states: states.map((state) => {
      if (!isScriptState(state)) return state;
      const node =
        typeof state.id === "string" ? byId.get(state.id) : undefined;
      const existingScript = isRecord(state.script) ? state.script : {};
      const existingTool = isRecord(state.tool) ? state.tool : {};
      const code = firstString(
        existingScript.code,
        existingTool.code,
        existingTool.source,
        state.code,
        node?.data.script?.code
      );
      const toolName = firstString(
        existingScript.toolName,
        existingTool.name,
        node?.data.script?.toolName
      );
      const language = firstString(
        existingScript.language,
        existingTool.language,
        node?.data.script?.language
      );
      return {
        ...state,
        script: {
          ...existingScript,
          ...(toolName ? { toolName } : {}),
          ...(language ? { language } : {}),
          ...(code ? { code } : { code: "" }),
        },
      };
    }),
  };
}

export function dslFromPublishedJson(json: string): {
  dsl: FsmDsl;
  canvas: CanvasData | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new ExportRouteError(
      400,
      "INVALID_DSL",
      "Published version JSON is not valid."
    );
  }
  if (!isRecord(parsed)) {
    throw new ExportRouteError(
      400,
      "INVALID_DSL",
      "Published version JSON is not an object."
    );
  }
  const canvas = isCanvasData(parsed.canvas) ? parsed.canvas : null;
  const { canvas: _ignored, ...rest } = parsed;
  let dsl: FsmDsl;
  if (Array.isArray(rest.states)) {
    dsl = rest as FsmDsl;
  } else if (canvas) {
    dsl = canvasToDsl(canvas, {
      name: typeof rest.name === "string" ? rest.name : undefined,
    }) as FsmDsl;
  } else {
    throw new ExportRouteError(
      400,
      "INVALID_DSL",
      "Published version has no DSL states."
    );
  }
  return { dsl: enrichScriptSources(dsl, canvas), canvas };
}

export function zipHarnessFiles(files: GeneratedFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const epoch = new Date(0);
  for (const file of files) {
    zip.file(file.path, file.contents, {
      date: epoch,
      unixPermissions: file.mode ?? 0o644,
    });
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export function harnessFilename(name: string, version: string): string {
  const slug =
    name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "harness";
  return `harness-${slug}-v${version}.zip`;
}

function assertExportOptions(opts: ExportZipRequest): {
  toolLanguage: ToolLanguage;
  includeMemory: boolean;
  artifactVersion?: string;
  versionId?: number;
} {
  if (opts.toolLanguage != null && !isToolLanguage(opts.toolLanguage)) {
    throw new ExportRouteError(
      400,
      "TOOL_LANGUAGE_UNSUPPORTED",
      "Tool language must be python or bash."
    );
  }
  if (
    opts.artifactVersion != null &&
    (typeof opts.artifactVersion !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(opts.artifactVersion))
  ) {
    throw new ExportRouteError(
      400,
      "INVALID_ARTIFACT_VERSION",
      "artifactVersion must be semver (e.g. 1.0.0)."
    );
  }
  if (
    opts.versionId != null &&
    (!Number.isFinite(opts.versionId) || opts.versionId < 1)
  ) {
    throw new ExportRouteError(400, "INVALID_VERSION", "Invalid version id.");
  }
  return {
    toolLanguage: opts.toolLanguage ?? "python",
    includeMemory: Boolean(opts.includeMemory),
    artifactVersion: opts.artifactVersion,
    versionId: opts.versionId,
  };
}

async function recordJob(
  db: PersistenceDb,
  values: {
    fsmId: number;
    status: string;
    contentHash: string | null;
    sizeBytes: number | null;
    error: string | null;
  }
): Promise<{ id: number }> {
  const [row] = await db
    .insert(exportJobs)
    .values({
      fsmId: values.fsmId,
      target: "zip",
      status: values.status,
      artifactUrl: null,
      contentHash: values.contentHash,
      sizeBytes: values.sizeBytes,
      error: values.error,
    })
    .returning({ id: exportJobs.id });
  return row;
}

export async function listExportJobs(
  db: PersistenceDb,
  projectId: number
): Promise<ExportJobRow[]> {
  const rows = await db
    .select({
      id: exportJobs.id,
      fsmId: exportJobs.fsmId,
      version: fsmDefinitions.version,
      target: exportJobs.target,
      status: exportJobs.status,
      artifactUrl: exportJobs.artifactUrl,
      contentHash: exportJobs.contentHash,
      sizeBytes: exportJobs.sizeBytes,
      error: exportJobs.error,
      createdAt: exportJobs.createdAt,
    })
    .from(exportJobs)
    .innerJoin(fsmDefinitions, eq(exportJobs.fsmId, fsmDefinitions.id))
    .where(eq(fsmDefinitions.projectId, projectId))
    .orderBy(desc(exportJobs.createdAt), desc(exportJobs.id));

  return rows.map((row) => ({
    id: row.id,
    fsmId: row.fsmId,
    version: row.version,
    target: row.target,
    status: row.status,
    artifactUrl: row.artifactUrl,
    contentHash: row.contentHash,
    sizeBytes: row.sizeBytes,
    error: row.error,
    createdAt: toIso(row.createdAt),
  }));
}

export async function buildExportZip(
  db: PersistenceDb,
  projectId: number,
  opts: ExportZipRequest = {}
): Promise<ExportZipResult> {
  const parsed = assertExportOptions(opts);

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    throw new ExportRouteError(404, "PROJECT_MISSING", "Project not found.");
  }

  const versionRow = parsed.versionId
    ? (
        await db
          .select()
          .from(fsmDefinitions)
          .where(
            and(
              eq(fsmDefinitions.id, parsed.versionId),
              eq(fsmDefinitions.projectId, projectId)
            )
          )
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(fsmDefinitions)
          .where(eq(fsmDefinitions.projectId, projectId))
          .orderBy(desc(fsmDefinitions.version))
          .limit(1)
      )[0];

  if (!versionRow) {
    throw new ExportRouteError(
      parsed.versionId ? 404 : 409,
      parsed.versionId ? "VERSION_MISSING" : "NO_PUBLISHED_VERSION",
      "Publish a version first"
    );
  }

  const fail = async (
    code: string,
    message: string,
    extra?: Record<string, unknown>
  ): Promise<never> => {
    const sanitized = sanitizeErrorMessage(message);
    await recordJob(db, {
      fsmId: versionRow.id,
      status: "failed",
      contentHash: versionRow.contentHash,
      sizeBytes: null,
      error: sanitized,
    });
    throw new ExportRouteError(422, code, sanitized, extra);
  };

  let published: { dsl: FsmDsl; canvas: CanvasData | null };
  try {
    published = dslFromPublishedJson(versionRow.json);
  } catch (err) {
    if (err instanceof ExportRouteError) {
      await recordJob(db, {
        fsmId: versionRow.id,
        status: "failed",
        contentHash: versionRow.contentHash,
        sizeBytes: null,
        error: err.message,
      });
    }
    throw err;
  }

  if (published.canvas) {
    const issues = lintCanvas(published.canvas).filter(
      (issue: LintIssue) => issue.severity === "error"
    );
    if (issues.length > 0) {
      await fail("LINT_FAILED", "DSL failed validation", { issues });
    }
  }

  const langs = collectScriptLanguages(published.dsl);
  if (langs.includes("cpp")) {
    await fail(
      "TOOL_LANGUAGE_UNSUPPORTED",
      "C++ tool language is not supported in v1 export."
    );
  }
  if (langs.length > 1) {
    await fail(
      "MIXED_LANGUAGES",
      "Mixed SCRIPT languages are rejected in v1; pick one language."
    );
  }

  const artifactVersion = parsed.artifactVersion ?? `${versionRow.version}.0.0`;
  const name =
    project.name.trim() ||
    (typeof published.dsl.name === "string" && published.dsl.name) ||
    "harness";

  let files: GeneratedFile[];
  try {
    files = generateHarness(published.dsl, {
      name,
      version: artifactVersion,
      contentHash: versionRow.contentHash,
      toolLanguage: parsed.toolLanguage,
      includeMemory: parsed.includeMemory,
    });
  } catch (err) {
    const code =
      err instanceof ExportEngineError ? err.code : "EXPORT_FAILED";
    const message =
      err instanceof Error ? err.message : "Harness generation failed";
    return await fail(code, message);
  }

  const bytes = await zipHarnessFiles(files);
  const sizeBytes = bytes.byteLength;
  const job = await recordJob(db, {
    fsmId: versionRow.id,
    status: "complete",
    contentHash: versionRow.contentHash,
    sizeBytes,
    error: null,
  });

  return {
    bytes,
    filename: harnessFilename(name, artifactVersion),
    job: {
      id: job.id,
      contentHash: versionRow.contentHash,
      sizeBytes,
      status: "complete",
    },
    sizeWarning: sizeBytes > ZIP_SIZE_WARN_BYTES,
  };
}
