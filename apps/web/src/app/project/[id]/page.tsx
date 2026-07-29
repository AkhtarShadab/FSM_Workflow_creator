import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Boxes,
  Brain,
  Download,
  Workflow,
} from "lucide-react";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";
import { DotPattern } from "@/components/ui/dot-pattern";
import { ModeToggle } from "@/components/mode-toggle";
import { db } from "@/db";
import { projects } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Grayscale mini-visuals for the project setup cards */
const CanvasVisual = (
  <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-60">
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex items-center gap-3">
        <div className="h-10 w-12 rotate-[-2deg] rounded-[3px] border-2 border-foreground/25 bg-background shadow-sm" />
        {i < 2 && (
          <div className="relative h-0.5 w-6 bg-foreground/30">
            <div className="absolute -right-1 -top-[3px] h-2 w-2 rotate-45 border-t-2 border-r-2 border-foreground/30" />
          </div>
        )}
      </div>
    ))}
  </div>
);

const RunsVisual = (
  <svg className="absolute inset-0 h-full w-full opacity-50" viewBox="0 0 200 100">
    <polyline
      points="20,70 60,45 100,60 140,30 180,42"
      fill="none"
      className="stroke-foreground/40"
      strokeWidth="2"
      strokeLinecap="round"
      strokeDasharray="5 5"
    />
    {[20, 60, 100, 140, 180].map((x, i) => (
      <circle
        key={i}
        cx={x}
        cy={[70, 45, 60, 30, 42][i]}
        r="4"
        className="fill-background stroke-foreground/40"
        strokeWidth="2"
      />
    ))}
  </svg>
);

const ExportVisual = (
  <div className="absolute inset-0 flex items-center justify-center opacity-60">
    <div className="flex flex-col items-center gap-1.5">
      {[3, 2, 1].map((i) => (
        <div
          key={i}
          className="rounded-[3px] border-2 border-foreground/25 bg-background"
          style={{ width: `${52 + i * 16}px`, height: "12px" }}
        />
      ))}
      <div className="mt-1 h-4 w-4 rotate-45 border-r-2 border-b-2 border-foreground/40" />
    </div>
  </div>
);

const MemoryVisual = (
  <svg className="absolute inset-0 h-full w-full opacity-50" viewBox="0 0 200 100">
    {[[40, 50], [100, 25], [160, 50], [100, 78]].map(([x, y], i, pts) => (
      <g key={i}>
        {pts.filter((_, j) => j > i).map(([x2, y2], j) => (
          <line
            key={j}
            x1={x} y1={y} x2={x2} y2={y2}
            stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 4"
            className="text-foreground/30"
          />
        ))}
        <circle cx={x} cy={y} r="7" className="fill-background stroke-foreground/40" strokeWidth="2" />
      </g>
    ))}
  </svg>
);

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = Number(id);
  if (Number.isNaN(projectId)) notFound();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound();

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <DotPattern
        width={22}
        height={22}
        className="fixed inset-0 opacity-50 text-foreground/40 [mask-image:radial-gradient(ellipse_at_center,white,transparent_75%)]"
      />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Projects
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <h1 className="font-hand text-2xl leading-none font-bold text-foreground">
            {project.name}
          </h1>
        </div>
        <ModeToggle />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-20 sm:px-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Project setup
          </h2>
          {project.description ? (
            <p className="max-w-xl text-sm text-muted-foreground">
              {project.description}
            </p>
          ) : (
            <p className="max-w-xl text-sm text-muted-foreground">
              Pick a section to start working on this harness.
            </p>
          )}
        </div>

        <BentoGrid className="w-full max-w-5xl auto-rows-[13rem] grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <BentoCard
            name="Canvas"
            description="Sticky-note FSM editor — states, pencil wires, signals."
            href={`/project/${id}/canvas`}
            cta="Open canvas"
            Icon={Workflow}
            background={CanvasVisual}
            className="sm:col-span-1"
          />
          <BentoCard
            name="Runs"
            description="Run history and the live beam monitor."
            href={`/project/${id}/runs`}
            cta="Open monitor"
            Icon={Boxes}
            background={RunsVisual}
            className="sm:col-span-1"
          />
          <BentoCard
            name="Export"
            description="Compile to a Docker bundle or push to Git."
            href={`/project/${id}/export`}
            cta="Export harness"
            Icon={Download}
            background={ExportVisual}
            className="sm:col-span-1"
          />
          <BentoCard
            name="Memory"
            description="Graph-organized memory — facts, artifacts, preferences."
            href="/memory"
            cta="Open graph"
            Icon={Brain}
            background={MemoryVisual}
            className="sm:col-span-1"
          />
        </BentoGrid>

        <p className="text-xs text-muted-foreground">
          Created {project.createdAt?.toLocaleString() ?? "—"}
        </p>
      </main>
    </div>
  );
}
