"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, RefreshCw, RotateCw, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useCredentialStore } from "@/stores/credential-store";

export function CredentialsView() {
  const {
    credentials,
    hydrate,
    addCredential,
    rotateCredential,
    revokeCredential,
    setModels,
    toggleActive,
    showReentryBanner,
    dismissReentryBanner,
    loadError,
  } = useCredentialStore();

  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<
    "openai" | "anthropic" | "openai-compatible"
  >("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  const [rotateKey, setRotateKey] = useState("");
  const [discoveringIds, setDiscoveringIds] = useState<Record<number, true>>(
    {}
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const handleAdd = async () => {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await addCredential({
        label: label || `${provider} key`,
        provider,
        baseUrl,
        apiKey,
      });
      setLabel("");
      setApiKey("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRotate = async (id: number) => {
    if (!rotateKey.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await rotateCredential(id, rotateKey);
      setRotatingId(null);
      setRotateKey("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: number, name: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Revoke “${name}”? The stored key is cleared and cannot be recovered.`)
    ) {
      return;
    }
    setFormError(null);
    try {
      await revokeCredential(id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const discover = async (id: number) => {
    const cred = credentials.find((c) => c.id === id);
    if (!cred) return;
    setDiscoveringIds((s) => ({ ...s, [id]: true }));
    try {
      const res = await fetch("/api/credentials/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: id }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        models?: string[];
        discoveredAt?: number;
      };
      if (!res.ok || !data.ok) {
        setModels(id, cred.models, {
          status: "error",
          error: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setModels(id, data.models ?? [], {
        status: "ok",
        discoveredAt: data.discoveredAt ?? Date.now(),
      });
    } catch (err) {
      setModels(id, cred.models, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDiscoveringIds((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  };

  const activeCount = credentials.filter((c) => c.active).length;

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
            <SparklesText
              sparklesCount={6}
              colors={{ first: "#A07CFE", second: "#38bdf8" }}
            >
              BYOK Credentials
            </SparklesText>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-active pool · runtime model discovery. {activeCount} active
            key{activeCount === 1 ? "" : "s"}.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keys are stored encrypted on the server. This browser only keeps a
            redacted summary.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Link href="/settings/registry" className="underline">
              Extension registry
            </Link>{" "}
            for custom signals &amp; skills.
          </p>
        </div>

        {showReentryBanner && (
          <div
            className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100"
            data-testid="credential-reentry-banner"
          >
            <p>
              Previously saved keys were removed from this browser and were not
              uploaded. Re-enter each key to store it encrypted on the server.
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 h-7 px-2 text-xs text-amber-100 hover:bg-amber-400/10"
              onClick={dismissReentryBanner}
            >
              Dismiss
            </Button>
          </div>
        )}

        {(formError || loadError) && (
          <p className="rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">
            {formError ?? loadError}
          </p>
        )}

        <ThemedMagicCard className="rounded-2xl border border-foreground/10 bg-foreground/5 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-sky-300" /> Add credential
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
                autoComplete="off"
                className="border-foreground/10 bg-foreground/5 font-mono text-xs"
              />
            </div>
          </div>
          <div className="mt-5">
            <ShimmerButton
              onClick={() => void handleAdd()}
              background="rgba(56,189,248,0.15)"
              shimmerColor="#38bdf8"
              className="text-sm text-sky-100"
              disabled={saving}
            >
              Save credential
            </ShimmerButton>
          </div>
        </ThemedMagicCard>

        <div className="flex flex-col gap-3" data-testid="credential-list">
          {credentials.length === 0 && (
            <p className="rounded-xl border border-dashed border-foreground/10 p-6 text-center text-sm text-muted-foreground">
              No credentials yet. Add one to unlock model discovery.
            </p>
          )}
          {credentials.map((cred) => {
            const discovering = Boolean(discoveringIds[cred.id]);
            const status = discovering ? "discovering" : cred.discoveryStatus;
            return (
              <div key={cred.id} data-testid={`credential-card-${cred.id}`}>
              <ThemedMagicCard
                className={cn(
                  "relative overflow-hidden rounded-2xl border p-5",
                  cred.active
                    ? "border-emerald-400/50 bg-emerald-400/5"
                    : "border-foreground/10 bg-foreground/5"
                )}
              >
                {cred.active && (
                  <ShineBorder
                    shineColor={["#34d399", "#38bdf8", "#78716c"]}
                    borderWidth={1.5}
                    duration={8}
                  />
                )}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {cred.label}
                      </span>
                      <Badge
                        variant="outline"
                        className="border-foreground/20 text-[10px] text-muted-foreground"
                      >
                        {cred.provider}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] uppercase",
                          status === "ok" &&
                            "border-emerald-400/40 text-emerald-300",
                          status === "error" &&
                            "border-red-400/40 text-red-300",
                          status === "discovering" &&
                            "border-sky-400/40 text-sky-300",
                          status === "idle" &&
                            "border-foreground/20 text-muted-foreground"
                        )}
                        data-testid={`discovery-status-${cred.id}`}
                      >
                        {status}
                      </Badge>
                      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        Active
                        <Switch
                          checked={cred.active}
                          onCheckedChange={(on) =>
                            toggleActive(cred.id, Boolean(on))
                          }
                          aria-label={`Active ${cred.label}`}
                        />
                      </label>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {cred.baseUrl}
                    </p>
                    <p
                      className="mt-1 font-mono text-xs text-muted-foreground"
                      data-testid={`credential-last4-${cred.id}`}
                    >
                      •••• {cred.last4}
                    </p>
                    {cred.discoveryError && (
                      <p className="mt-1 text-[10px] text-red-300">
                        {cred.discoveryError}
                      </p>
                    )}
                    {cred.models.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {cred.models.map((m) => (
                          <span
                            key={m}
                            className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 font-mono text-[10px] text-sky-200"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                    {rotatingId === cred.id && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Input
                          type="password"
                          value={rotateKey}
                          onChange={(e) => setRotateKey(e.target.value)}
                          placeholder="New API key"
                          autoComplete="off"
                          className="border-foreground/10 bg-foreground/5 font-mono text-xs"
                          data-testid={`rotate-input-${cred.id}`}
                        />
                        <Button
                          size="sm"
                          onClick={() => void handleRotate(cred.id)}
                          disabled={saving}
                          data-testid={`rotate-save-${cred.id}`}
                        >
                          Save new key
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRotatingId(null);
                            setRotateKey("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-foreground/10 bg-foreground/5 text-xs text-foreground/80 hover:bg-foreground/10"
                      disabled={discovering || !cred.active}
                      onClick={() => void discover(cred.id)}
                      data-testid={`discover-${cred.id}`}
                    >
                      <RefreshCw
                        className={cn(
                          "h-3.5 w-3.5",
                          discovering && "animate-spin"
                        )}
                      />
                      {cred.models.length ? "Re-discover" : "Discover models"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-foreground/10 bg-foreground/5 text-xs text-foreground/80 hover:bg-foreground/10"
                      disabled={!cred.active}
                      onClick={() => {
                        setRotatingId(cred.id);
                        setRotateKey("");
                      }}
                      data-testid={`rotate-${cred.id}`}
                    >
                      <RotateCw className="h-3.5 w-3.5" /> Rotate
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-xs text-muted-foreground hover:bg-red-400/10 hover:text-red-300"
                      onClick={() => void handleRevoke(cred.id, cred.label)}
                      data-testid={`revoke-${cred.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </Button>
                  </div>
                </div>
              </ThemedMagicCard>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
