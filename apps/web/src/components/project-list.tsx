"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Plus, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createProject, deleteProject } from "@/app/actions";
import { useCanvasStore } from "@/stores/canvas-store";
import type { Project } from "@/db/schema";

/** Auto-fill table — rows stream in one-by-one after mount */
export function ProjectList({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const canvases = useCanvasStore((s) => s.canvases);

  // Auto-fill effect: reveal rows progressively
  useEffect(() => {
    setVisibleCount(0);
    if (projects.length === 0) return;
    const timer = setInterval(() => {
      setVisibleCount((c) => {
        if (c >= projects.length) {
          clearInterval(timer);
          return c;
        }
        return c + 1;
      });
    }, 220);
    return () => clearInterval(timer);
  }, [projects.length]);

  const handleCreate = () => {
    startTransition(async () => {
      const id = await createProject(name);
      setOpen(false);
      setName("");
      router.push(`/project/${id}`);
    });
  };

  const handleDelete = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete "${project.name}"?\n\nThis permanently removes the project and its FSM versions, runs and credentials.`
      )
    )
      return;
    setDeletingId(project.id);
    startTransition(async () => {
      await deleteProject(project.id);
      setDeletingId(null);
    });
  };

  const visible = projects.slice(0, visibleCount);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Your projects</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex items-center gap-2 rounded-lg border border-foreground bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-foreground/90">
            <Plus className="h-4 w-4" /> New Harness
          </DialogTrigger>
          <DialogContent className="border-foreground/10 bg-background text-foreground">
            <DialogHeader>
              <DialogTitle>Create a new harness</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="ingest-and-summarize"
                className="border-foreground/10 bg-foreground/5"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreate}
                disabled={pending}
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {pending ? "Creating…" : "Create & open canvas"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <div className="h-[400px] overflow-auto rounded-xl border border-foreground/10 bg-card shadow-[3px_4px_0_rgba(0,0,0,0.05)]">
          <Table>
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
              <TableRow className="border-foreground/10 bg-foreground/5 hover:bg-foreground/5">
                <TableHead className="w-[38%] text-muted-foreground">Name</TableHead>
                <TableHead className="text-muted-foreground">States</TableHead>
                <TableHead className="text-muted-foreground">Wires</TableHead>
                <TableHead className="text-muted-foreground">Created</TableHead>
                <TableHead className="w-[110px] text-right text-muted-foreground">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
          <TableBody>
            {projects.length === 0 && (
              <TableRow className="border-foreground/5 hover:bg-transparent">
                <TableCell colSpan={5} className="py-12 text-center">
                  <Workflow className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    No projects yet. Create your first harness to open the canvas.
                  </p>
                </TableCell>
              </TableRow>
            )}
            {visible.map((project, i) => {
              const canvas = canvases[String(project.id)];
              const stateCount = canvas?.nodes.length ?? 0;
              const wireCount = canvas?.edges.length ?? 0;
              return (
                <motion.tr
                  key={project.id}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                  onClick={() => router.push(`/project/${project.id}`)}
                  className="group cursor-pointer border-foreground/5 transition-colors hover:bg-foreground/5"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-foreground/20 bg-foreground/5 text-foreground">
                        <Workflow className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {project.name}
                        </p>
                        {project.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {project.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-foreground/80">
                    {stateCount}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-foreground/80">
                    {wireCount}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.createdAt?.toLocaleDateString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="flex items-center gap-1 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={`Delete ${project.name}`}
                        disabled={pending && deletingId === project.id}
                        onClick={(e) => handleDelete(e, project)}
                        className="h-8 w-8 text-muted-foreground/60 hover:bg-red-400/10 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </motion.tr>
              );
            })}
            {visibleCount < projects.length && (
              <TableRow className="border-foreground/5 hover:bg-transparent">
                <TableCell colSpan={5} className="py-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
                    Auto-filling {projects.length - visibleCount} more…
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
        <ProgressiveBlur position="bottom" height="26%" />
      </div>
    </div>
  );
}
