"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Download, FileArchive, GitBranch } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { ThemedMagicCard } from "@/components/themed-magic-card";
import { RainbowButton } from "@/components/ui/rainbow-button";
import {
  AnimatedSpan,
  Terminal,
  TypingAnimation,
} from "@/components/ui/terminal";
import { ProjectNav } from "@/components/nav/project-nav";
import { cn } from "@/lib/utils";
import { canvasToDsl } from "@/lib/canvas-to-dsl";
import { useCanvasStore } from "@/stores/canvas-store";

const LANGUAGES = [
  { id: "python", label: "Python", desc: "grpcio server, module-per-tool" },
  { id: "cpp", label: "C++", desc: "gRPC C++ server, compiled registry" },
  { id: "bash", label: "Bash", desc: "Python shim execs bash scripts" },
] as const;

const STORES = [
  { id: "redis", label: "Redis", desc: "Default checkpoint store (24h TTL)" },
  { id: "mongo", label: "MongoDB", desc: "Document checkpoint store" },
  { id: "sql", label: "SQL", desc: "Relational checkpoint store" },
] as const;

const TARGETS = [
  { id: "zip", label: "ZIP bundle", desc: "Downloadable harness archive", Icon: FileArchive },
  { id: "git", label: "Git push", desc: "Direct commit to your repo (Q24)", Icon: GitBranch },
] as const;

const COMPOSE_PREVIEW = `services:
  fsm-controller:
    build: { dockerfile: Dockerfile.controller }
    environment:
      - CHECKPOINT_STORE_URL=redis://store:6379
  tools-python:
    build: { dockerfile: Dockerfile.tools-python }
  store:
    image: redis:7
  byok-gateway:
    build: { dockerfile: Dockerfile.gateway }
    env_file: .env   # BYOK base URL + key`;

function Section({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground/80 uppercase">
        <span className={cn("h-2 w-2 rounded-full", accent)} />
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ExportWizard({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [language, setLanguage] = useState<string>("python");
  const [store, setStore] = useState<string>("redis");
  const [target, setTarget] = useState<string>("zip");
  const [downloaded, setDownloaded] = useState(false);

  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes);
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges);

  const dsl = useMemo(
    () =>
      canvasToDsl(
        { nodes: nodes ?? [], edges: edges ?? [] },
        { name: projectName }
      ),
    [nodes, edges, projectName]
  );

  const downloadDsl = () => {
    const blob = new Blob([JSON.stringify(dsl, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fsm.json";
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <ProjectNav projectId={projectId} projectName={projectName} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <BlurFade delay={0.05} inView>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Export harness</h1>
              <p className="text-sm text-muted-foreground">
                Compile the canvas into a standalone Docker bundle (§11).
              </p>
            </div>
          </BlurFade>

          <BlurFade delay={0.1} inView>
          <Section title="1 · Tool language (Q17)" accent="bg-sky-400">
            <div className="grid gap-3 sm:grid-cols-3">
              {LANGUAGES.map((l) => (
                <button key={l.id} onClick={() => setLanguage(l.id)}>
                  <ThemedMagicCard
                    className={cn(
                      "rounded-xl border p-4 text-left",
                      language === l.id
                        ? "border-sky-400/60 bg-sky-400/10"
                        : "border-foreground/10 bg-foreground/5"
                    )}
                  >
                    <p className="font-semibold text-foreground">{l.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{l.desc}</p>
                  </ThemedMagicCard>
                </button>
              ))}
            </div>
          </Section>
          </BlurFade>

          <BlurFade delay={0.15} inView>
          <Section title="2 · Checkpoint store" accent="bg-[#A07CFE]">
            <div className="grid gap-3 sm:grid-cols-3">
              {STORES.map((s) => (
                <button key={s.id} onClick={() => setStore(s.id)}>
                  <ThemedMagicCard
                    className={cn(
                      "rounded-xl border p-4 text-left",
                      store === s.id
                        ? "border-purple-400/60 bg-purple-400/10"
                        : "border-foreground/10 bg-foreground/5"
                    )}
                  >
                    <p className="font-semibold text-foreground">{s.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
                  </ThemedMagicCard>
                </button>
              ))}
            </div>
          </Section>
          </BlurFade>

          <BlurFade delay={0.2} inView>
          <Section title="3 · Target" accent="bg-emerald-400">
            <div className="grid gap-3 sm:grid-cols-2">
              {TARGETS.map(({ id, label, desc, Icon }) => (
                <button key={id} onClick={() => setTarget(id)}>
                  <ThemedMagicCard
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-4 text-left",
                      target === id
                        ? "border-emerald-400/60 bg-emerald-400/10"
                        : "border-foreground/10 bg-foreground/5"
                    )}
                  >
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-semibold text-foreground">{label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </ThemedMagicCard>
                </button>
              ))}
            </div>
          </Section>
          </BlurFade>

          <BlurFade delay={0.25} inView>
          <Section title="4 · docker-compose preview" accent="bg-amber-400">
            <Terminal className="max-w-full border-foreground/10 bg-background text-left">
              <TypingAnimation className="text-emerald-400">
                $ docker compose config
              </TypingAnimation>
              {COMPOSE_PREVIEW.split("\n").map((line, i) => (
                <AnimatedSpan key={i} className="text-muted-foreground">
                  {line}
                </AnimatedSpan>
              ))}
              <TypingAnimation className="text-sky-400">
                ✓ harness topology valid — 4 services
              </TypingAnimation>
            </Terminal>
          </Section>
          </BlurFade>

          <BlurFade delay={0.3} inView>
          <div className="flex items-center gap-3 pb-10">
            <RainbowButton onClick={downloadDsl} className="gap-2">
              {downloaded ? (
                <Check className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloaded ? "Downloaded!" : "Download fsm.json"}
            </RainbowButton>
            <span className="text-xs text-muted-foreground">
              {dsl.states.length} states · full ZIP/git export lands in Phase 5
            </span>
          </div>
          </BlurFade>
        </div>
      </main>
    </div>
  );
}
