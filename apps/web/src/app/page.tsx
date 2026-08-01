import { desc } from "drizzle-orm";
import { Bell, Brain, Calendar, Workflow } from "lucide-react";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";
import { DotPattern } from "@/components/ui/dot-pattern";
import { ModeToggle } from "@/components/mode-toggle";
import { ProjectList } from "@/components/project-list";
import { db } from "@/db";
import { projects } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Grayscale mini-visuals for the four layered section cards */
const WorkflowVisual = (
  <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-60">
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex items-center gap-3">
        <div className="h-10 w-12 rotate-[-2deg] rounded-[3px] border-2 border-foreground/25 bg-background shadow-sm" />
        {i < 2 && <div className="h-0.5 w-6 bg-foreground/30" />}
      </div>
    ))}
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

const CalendarVisual = (
  <div className="absolute inset-0 grid grid-cols-7 place-items-center gap-1 p-8 opacity-50">
    {Array.from({ length: 28 }).map((_, i) => (
      <div
        key={i}
        className={
          "h-3 w-3 rounded-[2px] border border-foreground/30 " +
          (i === 10 ? "bg-foreground/70" : "bg-transparent")
        }
      />
    ))}
  </div>
);

const NotificationVisual = (
  <svg className="absolute inset-0 h-full w-full opacity-50" viewBox="0 0 200 100">
    {[16, 30, 44].map((r, i) => (
      <circle
        key={i}
        cx="100" cy="50" r={r} fill="none"
        className="stroke-foreground/30"
        strokeWidth="1.5" strokeDasharray="3 5"
      />
    ))}
    <circle cx="100" cy="50" r="5" className="fill-foreground/60" />
  </svg>
);

export default async function HomePage() {
  const projectList = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .limit(50);

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Workflow dot grid background */}
      <DotPattern
        width={22}
        height={22}
        className="fixed inset-0 opacity-50 text-foreground/40 [mask-image:radial-gradient(ellipse_at_center,white,transparent_75%)]"
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-foreground/20 bg-background">
            <Workflow className="h-4.5 w-4.5 text-foreground" />
          </span>
          <span className="text-sm font-bold tracking-wide text-foreground">
            AI HARNESS CREATOR
          </span>
        </div>
        <ModeToggle />
      </header>

      {/* Vertically centered content */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-10 px-4 pb-20 sm:px-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Sketch workflows. Ship harnesses.
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
            Sticky-note FSM canvas, pencil transitions, graph memory — compiled
            to standalone Docker harnesses.
          </p>
        </div>

        {/* The four layered section cards */}
        <BentoGrid className="w-full max-w-5xl auto-rows-[13rem] grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <BentoCard
            name="Workflow"
            description="Sticky-note states, pencil wires, signal grammar."
            href="#projects"
            cta="Open canvas"
            Icon={Workflow}
            background={WorkflowVisual}
            className="sm:col-span-1"
          />
          <BentoCard
            name="Memory"
            description="Graph-organized memory in Turso — facts, artifacts, preferences."
            href="/memory"
            cta="Open graph"
            Icon={Brain}
            background={MemoryVisual}
            className="sm:col-span-1"
          />
          <BentoCard
            name="Calendar"
            description="Scheduled harness triggers (E10, Phase 5)."
            href="#projects"
            cta="Soon"
            Icon={Calendar}
            background={CalendarVisual}
            className="sm:col-span-1"
          />
          <BentoCard
            name="Notifications"
            description="Run alerts and audit-loop signals."
            href="#projects"
            cta="Soon"
            Icon={Bell}
            background={NotificationVisual}
            className="sm:col-span-1"
          />
        </BentoGrid>

        {/* Projects — fixed default height, scrollable beyond */}
        <div className="w-full max-w-3xl">
          <ProjectList projects={projectList} />
        </div>
      </main>
    </div>
  );
}
