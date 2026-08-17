"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Send, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SparklesText } from "@/components/ui/sparkles-text";
import { cn } from "@/lib/utils";
import type { FSMStateType } from "@/lib/fsm-types";
import { useCanvasStore } from "@/stores/canvas-store";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Sketch your workflow with me. I can place sticky notes and wire them up — try a suggestion below or type your own.",
};

const SUGGESTIONS = [
  "Add a script node",
  "Add an AI node",
  "Connect the last two nodes",
  "Clear the canvas",
];

let msgN = 0;
const nextMsgId = () => `m_${++msgN}`;
let placeN = 0;
const nextPlace = () => {
  placeN += 1;
  return {
    x: 200 + (placeN * 73) % 400,
    y: 100 + (placeN * 47) % 300,
  };
};

/** Open chat UI — avatars, suggestion chips, typing indicator (§10.4) */
export function CopilotPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addNode = useCanvasStore((s) => s.addNode);
  const clearCanvas = useCanvasStore((s) => s.clearCanvas);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, typing, open]);

  const reply = (content: string) =>
    setMessages((m) => [...m, { id: nextMsgId(), role: "assistant", content }]);

  const handleCommand = (raw: string) => {
    const text = raw.toLowerCase();

    const addMatch = text.match(/add (?:an? )?(\w+)(?: node)?/);
    if (addMatch) {
      const kind = addMatch[1];
      const map: Record<string, FSMStateType> = {
        start: "START",
        script: "SCRIPT",
        ai: "AI",
        spawn: "SPAWN",
        aggregate: "AGGREGATE",
        system: "SYSTEM_FUNCTION",
        sysfunc: "SYSTEM_FUNCTION",
        end: "END",
      };
      const type = map[kind];
      if (type) {
        const id = addNode(projectId, type, nextPlace());
        reply(`Pinned a ${type} sticky (\`${id}\`) to the board. Drag it into place and wire it up.`);
        return;
      }
    }

    if (text.includes("connect")) {
      const list = nodes ?? [];
      if (list.length < 2) {
        reply("I need at least two stickies on the board before I can wire them.");
        return;
      }
      const [source, target] = list.slice(-2);
      onConnect(projectId, {
        source: source.id,
        target: target.id,
        sourceHandle: null,
        targetHandle: null,
      });
      reply(`Drew a pencil line: ${source.data.label} → ${target.data.label}.`);
      return;
    }

    if (text.includes("clear")) {
      clearCanvas(projectId);
      reply("Board wiped clean. Fresh sheet!");
      return;
    }

    reply(
      "I understand “add a script node”, “add an AI node”, “connect the last two nodes”, and “clear the canvas”. Real tool-calling against the op schema (§10.4) lands in Phase 5."
    );
  };

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || typing) return;
    setMessages((m) => [...m, { id: nextMsgId(), role: "user", content: trimmed }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      handleCommand(trimmed);
      setTyping(false);
    }, 650);
  };

  return (
    <>
      <Button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "absolute bottom-6 z-20 h-11 gap-2 rounded-xl border-2 border-[var(--ink)]/20 bg-[var(--paper)] text-[var(--ink)] shadow-[2px_3px_0_rgba(0,0,0,0.12)] backdrop-blur-sm hover:bg-[var(--paper)] hover:shadow-[3px_4px_0_rgba(0,0,0,0.14)]",
          open ? "right-4 sm:right-[444px]" : "right-4 sm:right-6"
        )}
      >
        {open ? (
          <X className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4 text-[#8a2a63]" />
        )}
        Copilot
      </Button>

      <div
        className={cn(
          "absolute right-4 bottom-20 z-20 flex w-[min(420px,92vw)] flex-col overflow-hidden rounded-2xl border-2 border-[var(--ink)]/15 bg-[var(--paper)] shadow-[5px_6px_0_rgba(0,0,0,0.10)] transition-all duration-300",
          open
            ? "pointer-events-auto h-[540px] opacity-100"
            : "pointer-events-none h-0 opacity-0"
        )}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b-2 border-[var(--ink)]/10 p-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-[#f0b8d9] bg-[#fce7f3] text-[#8a2a63]">
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <SparklesText
              sparklesCount={4}
              className="text-sm font-semibold text-foreground"
            >
              FSM Copilot
            </SparklesText>
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              online · stub mode
            </p>
          </div>
        </div>

        {/* messages */}
        <ScrollArea className="flex-1 p-3" ref={scrollRef}>
          <div className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  className={cn(
                    "flex items-end gap-2",
                    m.role === "user" && "flex-row-reverse"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2",
                      m.role === "user"
                        ? "border-[#a5c4f0] bg-[#dbeafe] text-[#1e4a8a]"
                        : "border-[#f0b8d9] bg-[#fce7f3] text-[#8a2a63]"
                    )}
                  >
                    {m.role === "user" ? (
                      <User className="h-3.5 w-3.5" />
                    ) : (
                      <Bot className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-xl border-2 px-3 py-2 text-xs leading-relaxed",
                      m.role === "user"
                        ? "rounded-br-sm border-[#a5c4f0] bg-[#dbeafe] text-[#1e4a8a]"
                        : "rounded-bl-sm border-[var(--ink)]/15 bg-foreground/5 text-foreground"
                    )}
                  >
                    {m.content}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {typing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-end gap-2"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-[#f0b8d9] bg-[#fce7f3] text-[#8a2a63]">
                  <Bot className="h-3.5 w-3.5" />
                </span>
                <div className="flex items-center gap-1 rounded-xl rounded-bl-sm border-2 border-[var(--ink)]/15 bg-foreground/5 px-3 py-2.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </ScrollArea>

        {/* suggestion chips (shapeof.ai "Suggestions" pattern) */}
        <div className="flex flex-wrap gap-1.5 border-t-2 border-[var(--ink)]/10 px-3 pt-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              disabled={typing}
              className="rounded-full border border-[var(--ink)]/20 bg-foreground/5 px-2.5 py-1 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-foreground/10 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {/* input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2 p-3"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe the workflow…"
            className="h-9 border-[var(--ink)]/20 bg-foreground/5 text-xs"
          />
          <Button
            type="submit"
            size="icon"
            disabled={typing}
            className="h-9 w-9 border-2 border-[#f0b8d9] bg-[#fce7f3] text-[#8a2a63] hover:bg-[#fbd3e9]"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
