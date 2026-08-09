"use client";

import { Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { STATE_COLORS, type StateNodeData } from "@/lib/fsm-types";
import { useCanvasStore } from "@/stores/canvas-store";
import {
  AggregateCard,
  ConditionsCard,
  GenerativeConfigCard,
  GuardrailsCard,
  HttpCard,
  HumanCard,
  ScriptEditorCard,
  SpawnCard,
  SystemFunctionCard,
  ValidateCard,
  ExternalAICard,
  VerifiabilityCard,
} from "./inspector-cards";

const EMPTY_NODES: import("@/lib/fsm-types").StateNode[] = [];
const EMPTY_EDGES: import("@/lib/fsm-types").TransitionEdge[] = [];

/** Sliding inspector drawer (Bento Grid per §10.3) */
export function InspectorPanel({ projectId }: { projectId: string }) {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes) ?? EMPTY_NODES;
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges) ?? EMPTY_EDGES;
  const selectNode = useCanvasStore((s) => s.selectNode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);

  const node = nodes.find((n) => n.id === selectedNodeId);
  const open = Boolean(node);

  const patch = (partial: Partial<StateNodeData>) => {
    if (node) updateNodeData(projectId, node.id, partial);
  };

  return (
    <aside
      className={cn(
        "absolute top-4 right-4 bottom-4 z-20 w-[min(380px,92vw)] transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-[110%]"
      )}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/90 backdrop-blur-md">
        {node && (
          <>
            <div className="flex items-center justify-between gap-2 p-4 pb-3">
              <Badge
                variant="outline"
                className={cn(
                  "border-current/40 font-mono text-[10px] tracking-widest",
                  STATE_COLORS[node.data.stateType].text
                )}
              >
                {node.data.stateType}
              </Badge>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-red-400/10 hover:text-red-300"
                  onClick={() => removeNode(projectId, node.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => selectNode(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2 px-4 pb-3">
              <Input
                value={node.data.label}
                onChange={(e) => patch({ label: e.target.value })}
                className="h-9 border-foreground/10 bg-foreground/5 text-sm font-semibold"
              />
              <Textarea
                value={node.data.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="What does this state do?"
                className="min-h-[52px] border-foreground/10 bg-foreground/5 text-xs"
              />
            </div>

            <Separator className="bg-foreground/10" />

            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                {node.data.stateType === "SCRIPT" && (
                  <ScriptEditorCard node={node} patch={patch} />
                )}
                {node.data.stateType === "AI" && (
                  <GenerativeConfigCard node={node} patch={patch} />
                )}
                {node.data.stateType === "SPAWN" && (
                  <SpawnCard node={node} patch={patch} />
                )}
                {node.data.stateType === "AGGREGATE" && (
                  <AggregateCard
                    node={node}
                    patch={patch}
                    allNodes={nodes}
                    projectId={projectId}
                  />
                )}
                {node.data.stateType === "HTTP" && (
                  <HttpCard node={node} patch={patch} />
                )}
                {node.data.stateType === "VALIDATE" && (
                  <ValidateCard node={node} patch={patch} />
                )}
                {node.data.stateType === "HUMAN" && (
                  <HumanCard node={node} patch={patch} />
                )}
                {node.data.stateType === "EXTERNAL_AI" && (
                  <ExternalAICard node={node} patch={patch} />
                )}
                {node.data.stateType === "SYSTEM_FUNCTION" && (
                  <SystemFunctionCard
                    node={node}
                    patch={patch}
                    allNodes={nodes}
                    allEdges={edges}
                  />
                )}
                {[
                  "SCRIPT",
                  "AI",
                  "SPAWN",
                  "HTTP",
                  "VALIDATE",
                  "EXTERNAL_AI",
                  "HUMAN",
                ].includes(node.data.stateType) && (
                  <>
                    <VerifiabilityCard node={node} patch={patch} />
                    <GuardrailsCard node={node} patch={patch} />
                  </>
                )}

                <ConditionsCard
                  node={node}
                  allNodes={nodes}
                  allEdges={edges}
                  projectId={projectId}
                />
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </aside>
  );
}
