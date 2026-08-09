"use client";

import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { useTheme } from "next-themes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BorderBeam } from "@/components/ui/border-beam";
import { Meteors } from "@/components/ui/meteors";
import { Button } from "@/components/ui/button";
import { BookmarkPlus, Plus, Trash2 } from "lucide-react";
import type {
  AggregationStrategy,
  SpawnConfig,
  StateNode,
  ToolLanguage,
  TransitionEdge,
} from "@/lib/fsm-types";
import {
  defaultExternalAiConfig,
  defaultHttpConfig,
  defaultHumanConfig,
  defaultRouterHead,
  defaultValidateConfig,
  normalizeAggregate,
  normalizeSpawn,
  normalizeSystemFunction,
  primaryProfile,
} from "@/lib/fsm-types";
import { useCredentialStore } from "@/stores/credential-store";
import { useScriptTemplateStore } from "@/stores/script-template-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_SIGNALS } from "@/lib/fsm-types";

const LANGUAGE_EXTENSIONS = {
  python: [python()],
  cpp: [cpp()],
  bash: [StreamLanguage.define(shell)],
};

const FALLBACK_MODELS = [
  "claude-sonnet-4-5",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-opus-4-1",
];

interface CardProps {
  node: StateNode;
  patch: (partial: Record<string, unknown>) => void;
}

/** Card 1 — Execution Script Editor, enclosed with BorderBeam (§10.3) */
export function ScriptEditorCard({ node, patch }: CardProps) {
  const script = node.data.script;
  const { resolvedTheme } = useTheme();
  const custom = useScriptTemplateStore((s) => s.custom);
  const allTemplates = useScriptTemplateStore((s) => s.all);
  const saveTemplate = useScriptTemplateStore((s) => s.saveTemplate);
  const removeTemplate = useScriptTemplateStore((s) => s.removeTemplate);
  const templates = allTemplates();

  const loadTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    patch({
      script: { ...script, language: tpl.language, code: tpl.code },
    });
  };

  const saveAsTemplate = () => {
    const name = window.prompt("Template name:", script.toolName);
    if (!name?.trim()) return;
    saveTemplate({ name: name.trim(), language: script.language, code: script.code });
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-foreground/10 bg-background/80 p-4">
      <BorderBeam size={80} duration={8} colorFrom="#38bdf8" colorTo="#6366f1" />
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Execution Script
        </h3>
        <Select
          value={script.language}
          onValueChange={(v) =>
            patch({ script: { ...script, language: v as ToolLanguage } })
          }
        >
          <SelectTrigger className="h-7 w-[110px] border-foreground/10 bg-foreground/5 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-foreground/10 bg-popover text-foreground">
            <SelectItem value="python">Python</SelectItem>
            <SelectItem value="cpp">C++</SelectItem>
            <SelectItem value="bash">Bash</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Custom script templates — save yours, reuse anywhere */}
      <div className="mb-3 flex items-center gap-2">
        <Select onValueChange={(v) => { if (typeof v === "string" && v) loadTemplate(v); }}>
          <SelectTrigger className="h-7 flex-1 border-foreground/10 bg-foreground/5 text-xs">
            <SelectValue placeholder="Load a script template…" />
          </SelectTrigger>
          <SelectContent className="border-foreground/10 bg-popover text-foreground">
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                {t.name}
                {t.builtin ? "" : " · custom"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          title="Save current script as template"
          onClick={saveAsTemplate}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <BookmarkPlus className="h-4 w-4" />
        </Button>
        {custom.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            title="Delete latest custom template"
            onClick={() => removeTemplate(custom[custom.length - 1].id)}
            className="h-7 w-7 text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="mb-3 space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tool name</Label>
        <Input
          value={script.toolName}
          onChange={(e) =>
            patch({ script: { ...script, toolName: e.target.value } })
          }
          className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-foreground/10">
        <CodeMirror
          value={script.code}
          height="200px"
          theme={resolvedTheme === "light" ? "light" : "dark"}
          extensions={LANGUAGE_EXTENSIONS[script.language]}
          onChange={(value) => patch({ script: { ...script, code: value } })}
          basicSetup={{ lineNumbers: true, foldGutter: false }}
        />
      </div>
    </div>
  );
}

/** Card 2 — Generative Instructions (§10.3 + C3 multi-BYOK union) */
export function GenerativeConfigCard({ node, patch }: CardProps) {
  const ai = node.data.ai;
  const credentials = useCredentialStore((s) => s.credentials);
  const activeCreds = credentials.filter((c) => c.active);
  const boundCred = credentials.find((c) => c.id === ai.credentialId);
  const brokenRef = Boolean(ai.credentialId) && !boundCred;

  const unionModels = activeCreds.flatMap((c) =>
    c.models.map((m) => ({
      credentialId: c.id,
      modelId: m,
      label: `${c.label} · ${m}`,
    }))
  );

  const modelsForCred = boundCred?.active
    ? boundCred.models
    : activeCreds.flatMap((c) => c.models);
  const modelOptions =
    modelsForCred.length > 0 ? modelsForCred : FALLBACK_MODELS;
  const modelMissing =
    Boolean(ai.model) &&
    boundCred &&
    boundCred.models.length > 0 &&
    !boundCred.models.includes(ai.model);

  // Union items carry a composite `credId:modelId` value so that the same
  // model name exposed by two credentials binds to the correct API key
  // (credential ids never contain ":", model ids may).
  const compositeValue =
    unionModels.length > 0 && ai.model
      ? (unionModels.find(
          (m) => m.credentialId === ai.credentialId && m.modelId === ai.model
        ) ?? unionModels.find((m) => m.modelId === ai.model))
      : undefined;
  const selectedModelValue =
    unionModels.length > 0
      ? compositeValue
        ? `${compositeValue.credentialId}:${compositeValue.modelId}`
        : undefined
      : ai.model;

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Generative Instructions
      </h3>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Credential (BYOK)</Label>
          <Select
            value={ai.credentialId || undefined}
            onValueChange={(v) =>
              patch({
                ai: {
                  ...ai,
                  credentialId: typeof v === "string" ? v : "",
                },
              })
            }
          >
            <SelectTrigger
              className={cn(
                "h-8 border-foreground/10 bg-foreground/5 text-xs",
                brokenRef && "border-red-400/50"
              )}
              data-testid="ai-credential-select"
            >
              <SelectValue placeholder="Select credential…" />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              {credentials.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No credentials — add in Settings
                </SelectItem>
              ) : (
                credentials.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label || c.provider}
                    {!c.active ? " (inactive)" : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {brokenRef && (
            <p className="text-[10px] text-red-300">
              Credential reference is broken (deleted).
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Model{" "}
            {unionModels.length
              ? `(union of ${activeCreds.length} active key${activeCreds.length === 1 ? "" : "s"})`
              : "(default list)"}
          </Label>
          <Select
            value={selectedModelValue}
            onValueChange={(v) => {
              if (typeof v !== "string") return;
              if (unionModels.length > 0) {
                const sep = v.indexOf(":");
                const credentialId = v.slice(0, sep);
                const model = v.slice(sep + 1);
                patch({ ai: { ...ai, model, credentialId } });
              } else {
                patch({ ai: { ...ai, model: v } });
              }
            }}
          >
            <SelectTrigger
              className={cn(
                "h-8 border-foreground/10 bg-foreground/5 text-xs",
                modelMissing && "border-amber-400/50"
              )}
              data-testid="ai-model-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              {unionModels.length > 0
                ? activeCreds.map((c) =>
                    c.models.map((m) => (
                      <SelectItem key={`${c.id}:${m}`} value={`${c.id}:${m}`}>
                        {c.label} · {m}
                      </SelectItem>
                    ))
                  )
                : modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
          {modelMissing && (
            <p className="text-[10px] text-amber-300">
              Model not in this credential&apos;s discovered list (may be stale).
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Temperature</Label>
            <span className="font-mono text-xs text-purple-300">
              {ai.temperature.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[ai.temperature]}
            onValueChange={(v) =>
              patch({
                ai: { ...ai, temperature: Array.isArray(v) ? (v[0] ?? 0) : v },
              })
            }
            min={0}
            max={1}
            step={0.05}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Max tokens</Label>
          <Input
            type="number"
            value={ai.maxTokens}
            onChange={(e) =>
              patch({ ai: { ...ai, maxTokens: Number(e.target.value) } })
            }
            className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">System prompt</Label>
          <Textarea
            value={ai.systemPrompt}
            onChange={(e) =>
              patch({ ai: { ...ai, systemPrompt: e.target.value } })
            }
            placeholder="You are a deterministic extraction engine…"
            className="min-h-[90px] border-foreground/10 bg-foreground/5 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Output schema (JSON Schema, optional)
          </Label>
          <Textarea
            value={ai.outputSchema}
            onChange={(e) =>
              patch({ ai: { ...ai, outputSchema: e.target.value } })
            }
            placeholder='{"type":"object","properties":{…}}'
            className="min-h-[70px] border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
}

/** Input/output schemas + verify + onError (FeatureShipping 001 C1) */
export function VerifiabilityCard({ node, patch }: CardProps) {
  const verify = node.data.verify ?? { kind: "schema" as const };
  const onError = node.data.onError ?? { signal: "::SCRIPT.ERROR" };

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Verifiability
      </h3>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Input schema (JSON)</Label>
          <Textarea
            value={node.data.inputSchema ?? ""}
            onChange={(e) => patch({ inputSchema: e.target.value })}
            placeholder='{"type":"object"}'
            className="min-h-[56px] border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Output schema (JSON)</Label>
          <Textarea
            value={node.data.outputSchema ?? ""}
            onChange={(e) => patch({ outputSchema: e.target.value })}
            placeholder='{"type":"object"}'
            className="min-h-[56px] border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Verify</Label>
            <Select
              value={verify.kind}
              onValueChange={(v) =>
                patch({
                  verify: {
                    kind: v === "script" ? "script" : "schema",
                    scriptRef: verify.scriptRef,
                  },
                })
              }
            >
              <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-foreground/10 bg-popover text-foreground">
                <SelectItem value="schema">schema</SelectItem>
                <SelectItem value="script">script</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">On-error signal</Label>
            <Input
              value={onError.signal}
              onChange={(e) =>
                patch({ onError: { ...onError, signal: e.target.value } })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        </div>
        {verify.kind === "script" && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Verify script ref</Label>
            <Input
              value={verify.scriptRef ?? ""}
              onChange={(e) =>
                patch({ verify: { ...verify, scriptRef: e.target.value } })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Card 3 — Guardrails & Fallback Logic; Meteors when in error state (§10.3) */
export function GuardrailsCard({ node, patch }: CardProps) {
  const g = node.data.guardrails;
  const hasError =
    g.timeoutMs < 500 ||
    (node.data.stateType === "SCRIPT" && node.data.script.code.trim() === "") ||
    (node.data.stateType === "AI" && node.data.ai.systemPrompt.trim() === "");

  return (
    <div
      className={
        "relative overflow-hidden rounded-xl border bg-background/80 p-4 " +
        (hasError ? "border-red-400/40" : "border-foreground/10")
      }
    >
      {hasError && <Meteors number={10} />}
      <div className="relative">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Guardrails</h3>
          {hasError && (
            <span className="rounded-full border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
              NEEDS ATTENTION
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Timeout (ms)</Label>
            <Input
              type="number"
              value={g.timeoutMs}
              onChange={(e) =>
                patch({
                  guardrails: { ...g, timeoutMs: Number(e.target.value) },
                })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Retries</Label>
            <Input
              type="number"
              value={g.retryMax}
              onChange={(e) =>
                patch({
                  guardrails: { ...g, retryMax: Number(e.target.value) },
                })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Backoff (ms)</Label>
            <Input
              type="number"
              value={g.retryBackoffMs}
              onChange={(e) =>
                patch({
                  guardrails: { ...g, retryBackoffMs: Number(e.target.value) },
                })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        </div>

        {hasError && (
          <p className="mt-3 text-xs text-red-300/90">
            {g.timeoutMs < 500
              ? "Timeout below 500 ms will starve the tool runtime."
              : node.data.stateType === "SCRIPT"
                ? "Script body is empty — the tool would exit without a signal."
                : "System prompt is empty — the AI state has no instructions."}
          </p>
        )}
      </div>
    </div>
  );
}

const SPAWN_TABS = [
  "Topology",
  "Tools",
  "Skills",
  "Models",
  "Aggregation",
] as const;

type SpawnTab = (typeof SPAWN_TABS)[number];

function csvToList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** SPAWN-state config — Topology | Tools | Skills | Models | Aggregation */
export function SpawnCard({ node, patch }: CardProps) {
  const [tab, setTab] = useState<SpawnTab>("Topology");
  const spawn = normalizeSpawn(node.data.spawn);
  const profile = primaryProfile(spawn);

  const setSpawn = (next: SpawnConfig) => patch({ spawn: next });

  const patchProfile = (partial: Partial<typeof profile>) => {
    const profiles = [...spawn.profiles];
    profiles[0] = { ...profile, ...partial };
    setSpawn({ ...spawn, profiles });
  };

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Subagent Fan-Out
      </h3>

      <div className="mb-3 flex flex-wrap gap-1">
        {SPAWN_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide uppercase",
              tab === t
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Topology" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <Select
              value={spawn.mode}
              onValueChange={(v) =>
                setSpawn({
                  ...spawn,
                  mode: v === "heterogeneous" ? "heterogeneous" : "homogeneous",
                })
              }
            >
              <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-foreground/10 bg-popover text-foreground">
                <SelectItem value="homogeneous">homogeneous</SelectItem>
                <SelectItem value="heterogeneous">heterogeneous</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Child FSM</Label>
            <Input
              value={profile.childFsm}
              onChange={(e) => patchProfile({ childFsm: e.target.value })}
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Count</Label>
              <Input
                type="number"
                value={spawn.count}
                onChange={(e) =>
                  setSpawn({ ...spawn, count: Number(e.target.value) })
                }
                className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="spawn-max-concurrency"
                className="text-xs text-muted-foreground"
              >
                Max concurrency
              </Label>
              <Input
                id="spawn-max-concurrency"
                type="number"
                min={1}
                value={spawn.maxConcurrency}
                onChange={(e) =>
                  setSpawn({
                    ...spawn,
                    maxConcurrency: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-foreground/10 px-3 py-2">
            <Label className="text-xs text-muted-foreground">
              Cancel on parent halt
            </Label>
            <Switch
              checked={spawn.cancelOnParentHalt}
              onCheckedChange={(v) =>
                setSpawn({ ...spawn, cancelOnParentHalt: Boolean(v) })
              }
            />
          </div>
        </div>
      )}

      {tab === "Tools" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Tool pack (comma / newline separated)
          </Label>
          <Textarea
            value={profile.toolPack.join(", ")}
            onChange={(e) => patchProfile({ toolPack: csvToList(e.target.value) })}
            placeholder="fetch_pages, write_report"
            className="min-h-[80px] border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
      )}

      {tab === "Skills" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Skill pack (opaque skill ids)
          </Label>
          <Textarea
            value={profile.skillPack.join(", ")}
            onChange={(e) =>
              patchProfile({ skillPack: csvToList(e.target.value) })
            }
            placeholder="ship-feature, code-review"
            className="min-h-[80px] border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
      )}

      {tab === "Models" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Child credential id
            </Label>
            <Input
              value={profile.credentialId ?? ""}
              onChange={(e) =>
                patchProfile({ credentialId: e.target.value || undefined })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Child model id</Label>
            <Input
              value={profile.modelId ?? ""}
              onChange={(e) =>
                patchProfile({ modelId: e.target.value || undefined })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        </div>
      )}

      {tab === "Aggregation" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Strategy</Label>
            <Select
              value={spawn.strategy}
              onValueChange={(v) =>
                setSpawn({
                  ...spawn,
                  strategy: (v as AggregationStrategy) || "waitAll",
                })
              }
            >
              <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-foreground/10 bg-popover text-foreground">
                <SelectItem value="waitAll">waitAll</SelectItem>
                <SelectItem value="quorum">quorum</SelectItem>
                <SelectItem value="firstSuccess">firstSuccess</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {spawn.strategy === "quorum" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quorum k</Label>
              <Input
                type="number"
                value={spawn.quorumK ?? 1}
                onChange={(e) =>
                  setSpawn({ ...spawn, quorumK: Number(e.target.value) })
                }
                className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Aggregate to (state id)
            </Label>
            <Input
              value={spawn.aggregateTo}
              onChange={(e) =>
                setSpawn({ ...spawn, aggregateTo: e.target.value })
              }
              placeholder="AGG_1"
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** HTTP state inspector (FeatureShipping 001 C4) */
export function HttpCard({ node, patch }: CardProps) {
  const http = node.data.http ?? defaultHttpConfig();
  const [headerKey, setHeaderKey] = useState("");
  const [headerVal, setHeaderVal] = useState("");
  const [signalDraft, setSignalDraft] = useState("");

  const patchHttp = (partial: Partial<typeof http>) =>
    patch({ http: { ...http, ...partial } });

  const headers = http.headers ?? {};

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">HTTP Request</h3>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Method</Label>
            <Select
              value={http.method}
              onValueChange={(v) => {
                if (typeof v === "string" && v) {
                  patchHttp({ method: v as typeof http.method });
                }
              }}
            >
              <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-foreground/10 bg-popover text-foreground">
                {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map(
                  (m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="http-url" className="text-xs text-muted-foreground">
              URL template
            </Label>
            <Input
              id="http-url"
              value={http.urlTemplate}
              onChange={(e) => patchHttp({ urlTemplate: e.target.value })}
              placeholder="https://api.example.com/{{payload.id}}"
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Auth credential id</Label>
          <Input
            value={http.authCredentialId ?? ""}
            onChange={(e) =>
              patchHttp({ authCredentialId: e.target.value || undefined })
            }
            className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Headers</Label>
          <div className="flex gap-1.5">
            <Input
              value={headerKey}
              onChange={(e) => setHeaderKey(e.target.value)}
              placeholder="Authorization"
              className="h-8 border-foreground/10 bg-foreground/5 text-xs"
            />
            <Input
              value={headerVal}
              onChange={(e) => setHeaderVal(e.target.value)}
              placeholder="Bearer …"
              className="h-8 border-foreground/10 bg-foreground/5 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 shrink-0"
              onClick={() => {
                if (!headerKey.trim()) return;
                patchHttp({
                  headers: { ...headers, [headerKey.trim()]: headerVal },
                });
                setHeaderKey("");
                setHeaderVal("");
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="space-y-1">
            {Object.entries(headers).map(([k, v]) => (
              <li
                key={k}
                className="flex items-center justify-between rounded border border-foreground/5 bg-foreground/5 px-2 py-1 font-mono text-[10px]"
              >
                <span>
                  {k}: {v}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-red-300"
                  onClick={() => {
                    const next = { ...headers };
                    delete next[k];
                    patchHttp({ headers: next });
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Body template</Label>
          <Textarea
            value={http.bodyTemplate ?? ""}
            onChange={(e) =>
              patchHttp({ bodyTemplate: e.target.value || undefined })
            }
            className="min-h-[60px] border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Success signals</Label>
          <div className="flex gap-1.5">
            <Input
              value={signalDraft}
              onChange={(e) => setSignalDraft(e.target.value)}
              placeholder="::HTTP.NEXT"
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                if (!signalDraft.trim()) return;
                patchHttp({
                  successSignals: [
                    ...(http.successSignals ?? []),
                    signalDraft.trim(),
                  ],
                });
                setSignalDraft("");
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="space-y-1" data-testid="http-success-signals">
            {(http.successSignals ?? []).map((sig) => (
              <li
                key={sig}
                className="flex items-center justify-between rounded border border-foreground/5 bg-foreground/5 px-2 py-1 font-mono text-[10px]"
              >
                {sig}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-red-300"
                  onClick={() =>
                    patchHttp({
                      successSignals: (http.successSignals ?? []).filter(
                        (s) => s !== sig
                      ),
                    })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** VALIDATE state inspector — executor-less gate (§10.1) */
export function ValidateCard({ node, patch }: CardProps) {
  const v = node.data.validate ?? defaultValidateConfig();
  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-1 text-sm font-semibold text-foreground">Validation</h3>
      <p className="mb-3 text-[10px] text-muted-foreground">
        Executor-less gate. Configure verify below (required). Do not attach
        script/AI/HTTP bodies.
      </p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Kind</Label>
          <Select
            value={v.kind}
            onValueChange={(val) => {
              if (typeof val === "string" && val) {
                patch({
                  validate: { ...v, kind: val as typeof v.kind },
                });
              }
            }}
          >
            <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              <SelectItem value="schema">schema</SelectItem>
              <SelectItem value="predicate">predicate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {v.kind === "schema" ? (
          <div className="space-y-1.5">
            <Label htmlFor="validate-schema" className="text-xs text-muted-foreground">
              JSON Schema
            </Label>
            <Textarea
              id="validate-schema"
              value={v.schema ?? ""}
              onChange={(e) =>
                patch({ validate: { ...v, schema: e.target.value } })
              }
              className="min-h-[80px] border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Predicate ref</Label>
            <Input
              value={v.predicateRef ?? ""}
              onChange={(e) =>
                patch({ validate: { ...v, predicateRef: e.target.value } })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** HUMAN approval state (§10.4) */
export function HumanCard({ node, patch }: CardProps) {
  const human = node.data.human ?? defaultHumanConfig();
  const patchHuman = (partial: Partial<typeof human>) =>
    patch({ human: { ...human, ...partial } });

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Human approval</h3>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Prompt</Label>
          <Textarea
            value={human.prompt}
            onChange={(e) => patchHuman({ prompt: e.target.value })}
            className="min-h-[72px] border-foreground/10 bg-foreground/5 text-xs"
            data-testid="human-prompt"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Approval signals (comma-separated)
          </Label>
          <Input
            value={(human.approvalSignals ?? []).join(", ")}
            onChange={(e) =>
              patchHuman({
                approvalSignals: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Assign to</Label>
          <Input
            value={human.assignTo ?? ""}
            onChange={(e) => patchHuman({ assignTo: e.target.value })}
            className="h-8 border-foreground/10 bg-foreground/5 text-xs"
            placeholder="role or user ref"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Timeout (ms)</Label>
          <Input
            type="number"
            value={human.timeoutMs ?? ""}
            onChange={(e) =>
              patchHuman({
                timeoutMs: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="h-8 border-foreground/10 bg-foreground/5 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

/** AGGREGATE pairing card (§10.3) */
export function AggregateCard({
  node,
  patch,
  allNodes,
  projectId,
}: CardProps & { allNodes: StateNode[]; projectId: string }) {
  const aggregate = normalizeAggregate(node.data.aggregate);
  const spawns = allNodes.filter((n) => n.data.stateType === "SPAWN");
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const patchAgg = (partial: Partial<typeof aggregate>) =>
    patch({ aggregate: { ...aggregate, ...partial } });

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-1 text-sm font-semibold text-foreground">
        Aggregate (X→1)
      </h3>
      <p className="mb-3 text-[10px] text-muted-foreground">
        Pair with exactly one SPAWN via fromSpawnId. SPAWN.aggregateTo must
        point back here.
      </p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">From SPAWN</Label>
          <Select
            value={aggregate.fromSpawnId || undefined}
            onValueChange={(v) => {
              if (typeof v !== "string" || !v) return;
              const spawn = spawns.find((s) => s.id === v);
              const strategy = spawn
                ? normalizeSpawn(spawn.data.spawn).strategy
                : aggregate.strategy;
              patchAgg({ fromSpawnId: v, strategy });
              // Clear the back-ref on any previously paired SPAWN so only
              // one SPAWN ever points at this AGGREGATE.
              for (const s of spawns) {
                if (s.id === v) continue;
                const cfg = normalizeSpawn(s.data.spawn);
                if (cfg.aggregateTo === node.id) {
                  updateNodeData(projectId, s.id, {
                    spawn: { ...cfg, aggregateTo: "" },
                  });
                }
              }
              if (spawn) {
                updateNodeData(projectId, spawn.id, {
                  spawn: {
                    ...normalizeSpawn(spawn.data.spawn),
                    aggregateTo: node.id,
                  },
                });
              }
            }}
          >
            <SelectTrigger
              className="h-8 border-foreground/10 bg-foreground/5 text-xs"
              data-testid="aggregate-from-spawn"
            >
              <SelectValue placeholder="Select SPAWN" />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              {spawns.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {s.data.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Strategy</Label>
          <Select
            value={aggregate.strategy}
            onValueChange={(v) => {
              if (
                v === "waitAll" ||
                v === "quorum" ||
                v === "firstSuccess"
              ) {
                patchAgg({ strategy: v });
              }
            }}
          >
            <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              <SelectItem value="waitAll">waitAll</SelectItem>
              <SelectItem value="quorum">quorum</SelectItem>
              <SelectItem value="firstSuccess">firstSuccess</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

/** Uncapped outgoing conditions (transition kind only) — §10.5 */
export function ConditionsCard({
  node,
  allNodes,
  allEdges,
  projectId,
}: {
  node: StateNode;
  allNodes: StateNode[];
  allEdges: TransitionEdge[];
  projectId: string;
}) {
  const addTransition = useCanvasStore((s) => s.addTransition);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const updateEdgeSignal = useCanvasStore((s) => s.updateEdgeSignal);

  const conditions = allEdges.filter(
    (e) =>
      e.source === node.id &&
      (e.data?.kind ?? "transition") === "transition"
  );
  const targets = allNodes.filter((n) => n.id !== node.id);

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Conditions</h3>
          <p className="text-[10px] text-muted-foreground">
            Unlimited transition conditions. Self-loops and router heads are
            edited separately.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="conditions-add"
          onClick={() => {
            const target = targets[0]?.id ?? node.id;
            addTransition(
              projectId,
              node.id,
              target,
              DEFAULT_SIGNALS[node.data.stateType] ?? "::SCRIPT.NEXT"
            );
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {conditions.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No transition conditions yet.</p>
      ) : (
        <div className="space-y-2">
          {conditions.map((e) => (
            <div
              key={e.id}
              className="grid grid-cols-[1fr_1fr_auto] gap-1.5"
              data-testid={`condition-row-${e.id}`}
            >
              <Input
                value={String(e.data?.signal ?? "")}
                onChange={(ev) =>
                  updateEdgeSignal(projectId, e.id, ev.target.value)
                }
                className="h-7 border-foreground/10 bg-foreground/5 font-mono text-[10px]"
              />
              <Select
                value={e.target}
                onValueChange={(v) => {
                  if (typeof v !== "string" || !v) return;
                  // Replace edge with new target via remove + add
                  const signal = String(e.data?.signal ?? "::SCRIPT.NEXT");
                  removeEdge(projectId, e.id);
                  addTransition(projectId, node.id, v, signal);
                }}
              >
                <SelectTrigger className="h-7 border-foreground/10 bg-foreground/5 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-foreground/10 bg-popover text-foreground">
                  {allNodes.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.data.label}
                      {t.id === node.id ? " (self)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-red-300"
                onClick={() => removeEdge(projectId, e.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** EXTERNAL_AI state inspector */
export function ExternalAICard({ node, patch }: CardProps) {
  const ea = node.data.externalAi ?? defaultExternalAiConfig();
  const patchEa = (partial: Partial<typeof ea>) =>
    patch({ externalAi: { ...ea, ...partial } });

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        External AI Endpoint
      </h3>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Credential kind</Label>
          <Select
            value={ea.credentialKind}
            onValueChange={(v) => {
              if (typeof v === "string" && v) {
                patchEa({
                  credentialKind: v as typeof ea.credentialKind,
                });
              }
            }}
          >
            <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              <SelectItem value="openai_compatible">openai_compatible</SelectItem>
              <SelectItem value="anthropic">anthropic</SelectItem>
              <SelectItem value="custom">custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Base URL</Label>
          <Input
            value={ea.baseUrl}
            onChange={(e) => patchEa({ baseUrl: e.target.value })}
            className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Credential id</Label>
          <Input
            value={ea.credentialId}
            onChange={(e) => patchEa({ credentialId: e.target.value })}
            className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Model</Label>
          <Input
            value={ea.model}
            onChange={(e) => patchEa({ model: e.target.value })}
            className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">System prompt</Label>
          <Textarea
            value={ea.systemPrompt}
            onChange={(e) => patchEa({ systemPrompt: e.target.value })}
            className="min-h-[60px] border-foreground/10 bg-foreground/5 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

interface SystemFunctionCardProps extends CardProps {
  allNodes: StateNode[];
  allEdges: TransitionEdge[];
}

function toggleId(list: string[], id: string, on: boolean): string[] {
  if (on) return list.includes(id) ? list : [...list, id];
  return list.filter((x) => x !== id);
}

/** SYSTEM_FUNCTION-state config (§7.2 + FeatureShipping 001 C2 enable map) */
export function SystemFunctionCard({
  node,
  patch,
  allNodes,
  allEdges,
}: SystemFunctionCardProps) {
  const sf = normalizeSystemFunction(node.data.systemFunction);
  const otherStates = allNodes.filter((n) => n.id !== node.id);
  const conflictIds = sf.enabledStateIds.filter((id) =>
    sf.disabledStateIds.includes(id)
  );

  const edgeSignals = Array.from(
    new Set(
      allEdges.map((e) => e.data?.signal ?? "::SCRIPT.NEXT").filter(Boolean)
    )
  );

  const patchSf = (partial: Partial<typeof sf>) =>
    patch({ systemFunction: { ...sf, ...partial } });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Checkpoint Boundary
        </h3>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Summary strategy (Q11)
          </Label>
          <Select
            value={sf.summaryStrategy}
            onValueChange={(v) => {
              if (typeof v === "string" && v) {
                patchSf({
                  summaryStrategy: v as typeof sf.summaryStrategy,
                });
              }
            }}
          >
            <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              <SelectItem value="template">template (free, lossy)</SelectItem>
              <SelectItem value="llm">llm (costs, better)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Dehydrate → Mask Swap → Hydrate runs at this boundary (§7.2). Router
          heads attach components; enable map still controls the mask.
        </p>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Heads</h3>
            <p className="text-[10px] text-muted-foreground">
              One head per attached component (router topology).
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            data-testid="sysfunc-head-add"
            onClick={() =>
              patchSf({
                heads: [
                  ...sf.heads,
                  defaultRouterHead({
                    id: `head-${Date.now().toString(36)}`,
                    label: `Head ${sf.heads.length + 1}`,
                    direction: "out",
                    componentRef: otherStates[0]?.id ?? "",
                  }),
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add head
          </Button>
        </div>
        {sf.heads.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No heads yet — add at least two for a proper router.
          </p>
        ) : (
          <div className="space-y-2" data-testid="sysfunc-heads-table">
            {sf.heads.map((head, idx) => (
              <div
                key={head.id}
                className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5"
              >
                <Input
                  value={head.label}
                  onChange={(e) => {
                    const next = sf.heads.map((h, i) =>
                      i === idx ? { ...h, label: e.target.value } : h
                    );
                    patchSf({ heads: next });
                  }}
                  className="h-7 border-foreground/10 bg-foreground/5 text-[10px]"
                  placeholder="label"
                />
                <Select
                  value={head.direction}
                  onValueChange={(v) => {
                    if (
                      v !== "in" &&
                      v !== "out" &&
                      v !== "bidirectional"
                    )
                      return;
                    const next = sf.heads.map((h, i) =>
                      i === idx ? { ...h, direction: v } : h
                    );
                    patchSf({ heads: next });
                  }}
                >
                  <SelectTrigger className="h-7 border-foreground/10 bg-foreground/5 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-foreground">
                    <SelectItem value="in">in</SelectItem>
                    <SelectItem value="out">out</SelectItem>
                    <SelectItem value="bidirectional">bidirectional</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={head.componentRef || undefined}
                  onValueChange={(v) => {
                    if (typeof v !== "string" || !v) return;
                    const next = sf.heads.map((h, i) =>
                      i === idx ? { ...h, componentRef: v } : h
                    );
                    patchSf({ heads: next });
                  }}
                >
                  <SelectTrigger className="h-7 border-foreground/10 bg-foreground/5 text-[10px]">
                    <SelectValue placeholder="component" />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-foreground">
                    {otherStates.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.data.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-red-300"
                  onClick={() =>
                    patchSf({
                      heads: sf.heads.filter((_, i) => i !== idx),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          Enable map
        </h3>
        <p className="mb-3 text-[10px] text-muted-foreground">
          Disabled wins when a state is listed in both. Empty enabled list =
          no enable filter.
        </p>

        {conflictIds.length > 0 && (
          <p
            className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-300"
            data-testid="sysfunc-conflict-hint"
          >
            Conflict: {conflictIds.length} state(s) in both lists — treated as
            disabled.
          </p>
        )}

        <div className="space-y-3">
          <StateToggleList
            title="Enabled states"
            states={otherStates}
            selected={sf.enabledStateIds}
            onToggle={(id, on) =>
              patchSf({ enabledStateIds: toggleId(sf.enabledStateIds, id, on) })
            }
            testIdPrefix="sysfunc-enabled"
          />
          <StateToggleList
            title="Disabled states"
            states={otherStates}
            selected={sf.disabledStateIds}
            onToggle={(id, on) =>
              patchSf({
                disabledStateIds: toggleId(sf.disabledStateIds, id, on),
              })
            }
            testIdPrefix="sysfunc-disabled"
          />
        </div>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Rewire</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            data-testid="sysfunc-rewire-add"
            onClick={() =>
              patchSf({
                rewire: [
                  ...sf.rewire,
                  {
                    from: otherStates[0]?.id ?? "",
                    on: edgeSignals[0] ?? "::SCRIPT.NEXT",
                    to: otherStates[1]?.id ?? otherStates[0]?.id ?? "",
                  },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add row
          </Button>
        </div>

        {sf.rewire.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No rewire overrides. Add a row to remap (from, signal) → to when
            the mask is active.
          </p>
        ) : (
          <div className="space-y-2" data-testid="sysfunc-rewire-table">
            {sf.rewire.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5"
              >
                <Select
                  value={row.from || undefined}
                  onValueChange={(v) => {
                    if (typeof v !== "string" || !v) return;
                    const next = sf.rewire.map((r, i) =>
                      i === idx ? { ...r, from: v } : r
                    );
                    patchSf({ rewire: next });
                  }}
                >
                  <SelectTrigger className="h-7 border-foreground/10 bg-foreground/5 text-[10px]">
                    <SelectValue placeholder="from" />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-foreground">
                    {otherStates.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.data.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.on || undefined}
                  onValueChange={(v) => {
                    if (typeof v !== "string" || !v) return;
                    const next = sf.rewire.map((r, i) =>
                      i === idx ? { ...r, on: v } : r
                    );
                    patchSf({ rewire: next });
                  }}
                >
                  <SelectTrigger className="h-7 border-foreground/10 bg-foreground/5 font-mono text-[10px]">
                    <SelectValue placeholder="on" />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-foreground">
                    {(edgeSignals.length > 0
                      ? edgeSignals
                      : ["::SCRIPT.NEXT", "::SCRIPT.ERROR"]
                    ).map((sig) => (
                      <SelectItem key={sig} value={sig} className="font-mono text-xs">
                        {sig}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.to || undefined}
                  onValueChange={(v) => {
                    if (typeof v !== "string" || !v) return;
                    const next = sf.rewire.map((r, i) =>
                      i === idx ? { ...r, to: v } : r
                    );
                    patchSf({ rewire: next });
                  }}
                >
                  <SelectTrigger className="h-7 border-foreground/10 bg-foreground/5 text-[10px]">
                    <SelectValue placeholder="to" />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-foreground">
                    {otherStates.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.data.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-red-300"
                  onClick={() =>
                    patchSf({
                      rewire: sf.rewire.filter((_, i) => i !== idx),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StateToggleList({
  title,
  states,
  selected,
  onToggle,
  testIdPrefix,
}: {
  title: string;
  states: StateNode[];
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
  testIdPrefix: string;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs text-muted-foreground">{title}</Label>
      <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-foreground/5 bg-foreground/[0.03] p-1.5">
        {states.length === 0 ? (
          <p className="px-1 py-2 text-[10px] text-muted-foreground">
            No other states on the canvas yet.
          </p>
        ) : (
          states.map((s) => {
            const on = selected.includes(s.id);
            return (
              <label
                key={s.id}
                className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-foreground/5"
                data-testid={`${testIdPrefix}-${s.id}`}
              >
                <span className="min-w-0 truncate text-xs text-foreground">
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {s.data.stateType}
                  </span>{" "}
                  {s.data.label}
                </span>
                <Switch
                  checked={on}
                  onCheckedChange={(checked) => onToggle(s.id, Boolean(checked))}
                  aria-label={`${title}: ${s.data.label}`}
                />
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
