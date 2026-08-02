"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookMarked, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModeToggle } from "@/components/mode-toggle";
import { exportRegistryBundle } from "@/lib/registry";
import { useRegistryStore } from "@/stores/registry-store";

export function RegistryView() {
  const {
    registry,
    addSignal,
    addSkill,
    deleteSignal,
    deleteSkill,
  } = useRegistryStore();
  const [signal, setSignal] = useState("::MYAPP.DONE");
  const [skill, setSkill] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onAddSignal = () => {
    try {
      addSignal(signal.trim());
      setError(null);
      setSignal("::");
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
            Custom signals and skill ids for canvas lint (FeatureShipping 001 C6).
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <section className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
          <h2 className="mb-3 text-sm font-semibold">Custom signals</h2>
          <div className="flex gap-2">
            <Input
              value={signal}
              onChange={(e) => setSignal(e.target.value)}
              placeholder="::MYAPP.DONE"
              className="h-8 border-foreground/10 bg-background font-mono text-xs"
              data-testid="registry-signal-input"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1"
              onClick={onAddSignal}
              data-testid="registry-signal-add"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <ul className="mt-3 space-y-1" data-testid="registry-signal-list">
            {registry.customSignals.map((s) => (
              <li
                key={s.signal}
                className="flex items-center justify-between rounded border border-foreground/5 px-2 py-1 font-mono text-xs"
              >
                {s.signal}
                <button
                  type="button"
                  onClick={() => deleteSignal(s.signal)}
                  className="text-muted-foreground hover:text-red-300"
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
