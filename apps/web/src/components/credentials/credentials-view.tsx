"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DotPattern } from "@/components/ui/dot-pattern";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemedMagicCard } from "@/components/themed-magic-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShineBorder } from "@/components/ui/shine-border";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { SparklesText } from "@/components/ui/sparkles-text";
import { ModeToggle } from "@/components/mode-toggle";
import { cn } from "@/lib/utils";
import { useCredentialStore } from "@/stores/credential-store";

const MOCK_DISCOVERY: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  "openai-compatible": ["llama-3.3-70b", "qwen-2.5-coder-32b", "deepseek-v3"],
};

export function CredentialsView() {
  const { credentials, activeId, addCredential, removeCredential, setModels, setActive } =
    useCredentialStore();

  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<"openai" | "anthropic" | "openai-compatible">("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [discovering, setDiscovering] = useState<string | null>(null);

  const handleAdd = () => {
    if (!apiKey.trim()) return;
    addCredential({ label: label || `${provider} key`, provider, baseUrl, apiKey });
    setLabel("");
    setApiKey("");
  };

  const discover = (id: string, prov: string) => {
    setDiscovering(id);
    // Mock GET {baseUrl}/v1/models (§9.1) — real adapter lands in Phase 3
    setTimeout(() => {
      setModels(id, MOCK_DISCOVERY[prov] ?? []);
      setDiscovering(null);
    }, 800);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-6 py-16">
      <DotPattern
        width={24}
        height={24}
        className="opacity-40 [mask-image:radial-gradient(ellipse_at_center,white,transparent_70%)]"
      />

      <div className="absolute top-4 right-4 z-20">
        <ModeToggle />
      </div>

      <div className="relative z-10 mx-auto flex max-w-3xl flex-col gap-8">
        <div>
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Projects
          </Link>
          <h1 className="text-3xl font-bold">
            <SparklesText sparklesCount={6} colors={{ first: "#A07CFE", second: "#38bdf8" }}>
              BYOK Credentials
            </SparklesText>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Base URL + API key → dynamic model discovery (§9). Keys are stored in
            local storage for this UI stub; AES-256-GCM server-side storage is §14.
          </p>
        </div>

        <ThemedMagicCard className="rounded-2xl border border-foreground/10 bg-foreground/5 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-purple-300" /> Add credential
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Personal OpenAI"
                className="border-foreground/10 bg-foreground/5"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  const p = v as typeof provider;
                  setProvider(p);
                  setBaseUrl(
                    p === "openai"
                      ? "https://api.openai.com"
                      : p === "anthropic"
                        ? "https://api.anthropic.com"
                        : "http://localhost:4000"
                  );
                }}
              >
                <SelectTrigger className="border-foreground/10 bg-foreground/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-foreground/10 bg-popover text-foreground">
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai-compatible">
                    OpenAI-compatible proxy
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Base URL</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="border-foreground/10 bg-foreground/5 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">API key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                className="border-foreground/10 bg-foreground/5 font-mono text-xs"
              />
            </div>
          </div>
          <div className="mt-5">
            <ShimmerButton
              onClick={handleAdd}
              background="rgba(168,85,247,0.15)"
              shimmerColor="#c084fc"
              className="text-sm text-purple-100"
            >
              Save credential
            </ShimmerButton>
          </div>
        </ThemedMagicCard>

        <div className="flex flex-col gap-3">
          {credentials.length === 0 && (
            <p className="rounded-xl border border-dashed border-foreground/10 p-6 text-center text-sm text-muted-foreground">
              No credentials yet. Add one to unlock model discovery.
            </p>
          )}
          {credentials.map((cred) => (
            <ThemedMagicCard
              key={cred.id}
              className={cn(
                "relative overflow-hidden rounded-2xl border p-5",
                activeId === cred.id
                  ? "border-emerald-400/50 bg-emerald-400/5"
                  : "border-foreground/10 bg-foreground/5"
              )}
            >
              {activeId === cred.id && (
                <ShineBorder
                  shineColor={["#34d399", "#38bdf8", "#A07CFE"]}
                  borderWidth={1.5}
                  duration={8}
                />
              )}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{cred.label}</span>
                    <Badge
                      variant="outline"
                      className="border-foreground/20 text-[10px] text-muted-foreground"
                    >
                      {cred.provider}
                    </Badge>
                    {activeId === cred.id && (
                      <Badge className="border-emerald-400/40 bg-emerald-400/10 text-[10px] text-emerald-300">
                        ACTIVE
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{cred.baseUrl}</p>
                  {cred.models.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {cred.models.map((m) => (
                        <span
                          key={m}
                          className="rounded-md border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 font-mono text-[10px] text-purple-300"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-foreground/10 bg-foreground/5 text-xs text-foreground/80 hover:bg-foreground/10"
                    disabled={discovering === cred.id}
                    onClick={() => discover(cred.id, cred.provider)}
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        discovering === cred.id && "animate-spin"
                      )}
                    />
                    {cred.models.length ? "Re-discover" : "Discover models"}
                  </Button>
                  {activeId !== cred.id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-emerald-400/30 bg-emerald-400/5 text-xs text-emerald-300 hover:bg-emerald-400/15"
                      onClick={() => setActive(cred.id)}
                    >
                      Set active
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-xs text-muted-foreground hover:bg-red-400/10 hover:text-red-300"
                    onClick={() => removeCredential(cred.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>
            </ThemedMagicCard>
          ))}
        </div>
      </div>
    </div>
  );
}
