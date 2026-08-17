"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookMarked, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModeToggle } from "@/components/mode-toggle";
import { exportRegistryBundle, type CustomStateType } from "@/lib/registry";
import type { PaletteGroupId } from "@/lib/fsm-types";
import { useCanvasStore } from "@/stores/canvas-store";
import { useRegistryStore } from "@/stores/registry-store";
import { cn } from "@/lib/utils";

type RegistryTab = "signals" | "states" | "skills";

const TABS: { id: RegistryTab; label: string }[] = [
  { id: "signals", label: "Signals" },
  { id: "states", label: "States" },
  { id: "skills", label: "Skills" },
];

const EMPTY_CANVAS = { nodes: [], edges: [] };

export function RegistryView() {
  const {
    registry,
    addSignal,
    addSkill,
    addCustomState,
    deleteSignal,
    deleteSkill,
    deleteCustomState,
  } = useRegistryStore();
  const canvases = useCanvasStore((s) => s.canvases);

  const [tab, setTab] = useState<RegistryTab>("signals");
  const [signal, setSignal] = useState("::MYAPP.DONE");
  const [signalDescription, setSignalDescription] = useState(
    "Emitted when the custom step completes successfully"
  );
  const [skill, setSkill] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [stateId, setStateId] = useState("review-gate");
  const [stateLabel, setStateLabel] = useState("Review Gate");
  const [stateGroup, setStateGroup] = useState<PaletteGroupId>("custom");
  const [stateExecutor, setStateExecutor] =
    useState<CustomStateType["executorKind"]>("none");
  const [stateSignals, setStateSignals] = useState(
    "::MYAPP.DONE, ::MYAPP.FAIL"
  );
  const [stateDescription, setStateDescription] = useState(
    "Human review gate before continuing the workflow"
  );

  const canvasUnion = Object.values(canvases).reduce(
    (acc, c) => ({
      nodes: [...acc.nodes, ...c.nodes],
      edges: [...acc.edges, ...c.edges],
    }),
    EMPTY_CANVAS
  );

  const onAddSignal = () => {
    try {
      addSignal(signal.trim(), signalDescription.trim());
      setError(null);
      setSignal("::");
      setSignalDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAddSkill = () => {
    try {
      addSkill(skill.trim());
      setError(null);
      setSkill("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAddState = () => {
    try {
      const defaultSignals = stateSignals
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (defaultSignals.length < 2) {
        throw new Error("Provide at least one success and one failure signal");
      }
      if (stateDescription.trim().length < 8) {
        throw new Error("Description is required (min 8 chars)");
      }
      addCustomState({
        id: stateId.trim(),
        label: stateLabel.trim(),
        group: stateGroup,
        executorKind: stateExecutor,
        defaultSignals,
        description: stateDescription.trim(),
        successCondition: { kind: "signal" },
      });
      setError(null);
      setStateId("");
      setStateLabel("");
      setStateSignals("");
      setStateDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDeleteSignal = (sig: string) => {
    try {
      deleteSignal(sig, canvasUnion);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen bg-background px-6 py-16">
      <div className="absolute top-4 right-4 z-20">
        <ModeToggle />
      </div>
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <div>
          <Link
            href="/settings/credentials"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Credentials
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <BookMarked className="h-6 w-6" /> Extension registry
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Register custom signals, state types, and skill ids (FeatureShipping
            013).
          </p>
        </div>

        <div
          className="flex gap-1 rounded-lg border border-foreground/10 bg-foreground/5 p-1"
          data-testid="registry-tabs"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`registry-tab-${t.id}`}
              onClick={() => {
                setTab(t.id);
                setError(null);
              }}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <p
            className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300"
            data-testid="registry-error"
          >
            {error}
          </p>
        )}

        {tab === "signals" && (
          <section className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
            <h2 className="mb-3 text-sm font-semibold">Custom signals</h2>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Signal</Label>
                <Input
                  value={signal}
                  onChange={(e) => setSignal(e.target.value)}
                  placeholder="::MYAPP.DONE"
                  className="h-8 border-foreground/10 bg-background font-mono text-xs"
                  data-testid="registry-signal-input"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Description (min 8 chars)
                </Label>
                <Textarea
                  value={signalDescription}
                  onChange={(e) => setSignalDescription(e.target.value)}
                  placeholder="What does this signal mean when emitted?"
                  className="min-h-[60px] border-foreground/10 bg-background text-xs"
                  data-testid="registry-signal-description"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1"
                onClick={onAddSignal}
                data-testid="registry-signal-add"
              >
                <Plus className="h-3.5 w-3.5" /> Add signal
              </Button>
            </div>
            <ul className="mt-3 space-y-1" data-testid="registry-signal-list">
              {registry.customSignals.map((s) => (
                <li
                  key={s.signal}
                  className="flex items-start justify-between gap-2 rounded border border-foreground/5 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-xs">{s.signal}</span>
                    {s.description ? (
                      <p className="text-[10px] text-muted-foreground">
                        {s.description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteSignal(s.signal)}
                    className="shrink-0 text-muted-foreground hover:text-red-300"
                    data-testid={`registry-signal-delete-${s.signal}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {registry.customSignals.length === 0 && (
                <li className="text-[10px] text-muted-foreground">None yet</li>
              )}
            </ul>
          </section>
        )}

        {tab === "states" && (
          <section className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
            <h2 className="mb-3 text-sm font-semibold">Custom state types</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Id (slug)</Label>
                <Input
                  value={stateId}
                  onChange={(e) => setStateId(e.target.value)}
                  placeholder="review-gate"
                  className="h-8 border-foreground/10 bg-background font-mono text-xs"
                  data-testid="registry-state-id"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Label</Label>
                <Input
                  value={stateLabel}
                  onChange={(e) => setStateLabel(e.target.value)}
                  placeholder="Review Gate"
                  className="h-8 border-foreground/10 bg-background text-xs"
                  data-testid="registry-state-label"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Palette group</Label>
                <Select
                  value={stateGroup}
                  onValueChange={(v) => {
                    if (typeof v === "string" && v) {
                      setStateGroup(v as PaletteGroupId);
                    }
                  }}
                >
                  <SelectTrigger
                    className="h-8 border-foreground/10 bg-background text-xs"
                    data-testid="registry-state-group"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-foreground">
                    <SelectItem value="custom">Custom</SelectItem>
                    <SelectItem value="work">Work</SelectItem>
                    <SelectItem value="generative">Generative</SelectItem>
                    <SelectItem value="control">Control</SelectItem>
                    <SelectItem value="flow">Flow</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Executor kind</Label>
                <Select
                  value={stateExecutor}
                  onValueChange={(v) => {
                    if (
                      v === "script" ||
                      v === "http" ||
                      v === "ai" ||
                      v === "none"
                    ) {
                      setStateExecutor(v);
                    }
                  }}
                >
                  <SelectTrigger
                    className="h-8 border-foreground/10 bg-background text-xs"
                    data-testid="registry-state-executor"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-foreground">
                    <SelectItem value="script">script</SelectItem>
                    <SelectItem value="http">http</SelectItem>
                    <SelectItem value="ai">ai</SelectItem>
                    <SelectItem value="none">none (VALIDATE-like)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  Default signals (comma-separated)
                </Label>
                <Input
                  value={stateSignals}
                  onChange={(e) => setStateSignals(e.target.value)}
                  placeholder="::MYAPP.DONE, ::MYAPP.FAIL"
                  className="h-8 border-foreground/10 bg-background font-mono text-xs"
                  data-testid="registry-state-signals"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  Description (min 8 chars)
                </Label>
                <Textarea
                  value={stateDescription}
                  onChange={(e) => setStateDescription(e.target.value)}
                  className="min-h-[60px] border-foreground/10 bg-background text-xs"
                  data-testid="registry-state-description"
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="mt-3 h-8 gap-1"
              onClick={onAddState}
              data-testid="registry-state-add"
            >
              <Plus className="h-3.5 w-3.5" /> Add state type
            </Button>
            <ul className="mt-3 space-y-1" data-testid="registry-state-list">
              {registry.customStates.map((st) => (
                <li
                  key={st.id}
                  className="flex items-start justify-between gap-2 rounded border border-foreground/5 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-xs font-semibold">{st.label}</span>
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {st.id}
                    </span>
                    <p className="text-[10px] text-muted-foreground">
                      {st.executorKind} · {st.group} · {st.defaultSignals.join(", ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteCustomState(st.id)}
                    className="shrink-0 text-muted-foreground hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {registry.customStates.length === 0 && (
                <li className="text-[10px] text-muted-foreground">None yet</li>
              )}
            </ul>
          </section>
        )}

        {tab === "skills" && (
          <section className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
            <h2 className="mb-3 text-sm font-semibold">Skills</h2>
            <div className="flex gap-2">
              <Input
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                placeholder="ship-feature"
                className="h-8 border-foreground/10 bg-background font-mono text-xs"
                data-testid="registry-skill-input"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1"
                onClick={onAddSkill}
                data-testid="registry-skill-add"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" data-testid="registry-skill-list">
              {registry.skills.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="gap-1 font-mono text-[10px]"
                >
                  {s}
                  <button type="button" onClick={() => deleteSkill(s)}>
                    ×
                  </button>
                </Badge>
              ))}
              {registry.skills.length === 0 && (
                <span className="text-[10px] text-muted-foreground">None yet</span>
              )}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Export bundle</h2>
            <Label className="text-[10px] text-muted-foreground">
              Included in harness export
            </Label>
          </div>
          <pre className="max-h-48 overflow-auto rounded-md bg-background p-3 font-mono text-[10px] text-foreground/80">
            {exportRegistryBundle(registry)}
          </pre>
        </section>
      </div>
    </div>
  );
}
