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
import { BookmarkPlus, Trash2 } from "lucide-react";
import type { StateNode, ToolLanguage } from "@/lib/fsm-types";
import { useCredentialStore } from "@/stores/credential-store";
import { useScriptTemplateStore } from "@/stores/script-template-store";

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
        <Select onValueChange={(v) => v && loadTemplate(v)}>
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

/** Card 2 — Generative Instructions (§10.3) */
export function GenerativeConfigCard({ node, patch }: CardProps) {
  const ai = node.data.ai;
  const credentials = useCredentialStore((s) => s.credentials);
  const activeId = useCredentialStore((s) => s.activeId);
  const discovered = credentials.find((c) => c.id === activeId)?.models;
  const models = discovered && discovered.length > 0 ? discovered : FALLBACK_MODELS;

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Generative Instructions
      </h3>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Model {discovered?.length ? "(BYOK discovered)" : "(default list)"}
          </Label>
          <Select
            value={ai.model}
            onValueChange={(v) => patch({ ai: { ...ai, model: v } })}
          >
            <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-popover text-foreground">
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

/** SPAWN-state config (§6.3) */
export function SpawnCard({ node, patch }: CardProps) {
  const spawn = node.data.spawn;
  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Subagent Fan-Out
      </h3>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Child FSM</Label>
          <Input
            value={spawn.childFsm}
            onChange={(e) =>
              patch({ spawn: { ...spawn, childFsm: e.target.value } })
            }
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
                patch({ spawn: { ...spawn, count: Number(e.target.value) } })
              }
              className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Strategy</Label>
            <Select
              value={spawn.strategy}
              onValueChange={(v) =>
                patch({
                  spawn: {
                    ...spawn,
                    strategy: v as typeof spawn.strategy,
                  },
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
        </div>
      </div>
    </div>
  );
}

/** SYSTEM_FUNCTION-state config (§7.2) */
export function SystemFunctionCard({ node, patch }: CardProps) {
  const sf = node.data.systemFunction;
  return (
    <div className="rounded-xl border border-foreground/10 bg-background/80 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Checkpoint Boundary
      </h3>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Summary strategy (Q11)</Label>
        <Select
          value={sf.summaryStrategy}
          onValueChange={(v) =>
            patch({
              systemFunction: {
                ...sf,
                summaryStrategy: v as typeof sf.summaryStrategy,
              },
            })
          }
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
        Dehydrate → Mask Swap → Hydrate runs at this boundary (§7.2).
      </p>
    </div>
  );
}
