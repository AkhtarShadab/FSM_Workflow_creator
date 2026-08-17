"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function HumanTaskCard({
  runId,
  taskId,
  prompt,
  onResolved,
}: {
  runId: number;
  taskId: number;
  prompt: string;
  onResolved?: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payloadText, setPayloadText] = useState("");

  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError(null);
    let response: unknown;
    const trimmed = payloadText.trim();
    if (trimmed) {
      try {
        response = JSON.parse(trimmed) as unknown;
      } catch {
        setError("Response must be valid JSON");
        setBusy(null);
        return;
      }
    }
    try {
      const res = await fetch(`/api/runs/${runId}/human/${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          response === undefined ? { decision } : { decision, response }
        ),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Resolve failed");
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3"
      data-testid="human-task-card"
    >
      <p className="text-[10px] font-semibold tracking-widest text-amber-200/80 uppercase">
        Awaiting human
      </p>
      <p className="mt-1 text-sm text-foreground/90" data-testid="human-task-prompt">
        {prompt || "Please review and approve to continue."}
      </p>
      <Textarea
        value={payloadText}
        onChange={(e) => setPayloadText(e.target.value)}
        placeholder='Optional JSON payload, e.g. {"note":"lgtm"}'
        className="mt-2 min-h-[56px] border-foreground/10 bg-background/60 font-mono text-xs"
        data-testid="human-task-payload"
      />
      {error ? (
        <p className="mt-1 text-[11px] text-red-300" data-testid="human-task-error">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          data-testid="human-approve"
          disabled={busy != null}
          onClick={() => void decide("approve")}
          className="gap-1.5 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
        >
          <Check className="h-3.5 w-3.5" />
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          data-testid="human-reject"
          disabled={busy != null}
          onClick={() => void decide("reject")}
        >
          <X className="h-3.5 w-3.5" />
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}
