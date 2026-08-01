"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Boxes, Download, Info, LayoutGrid, Workflow } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { cn } from "@/lib/utils";
import { useCredentialStore } from "@/stores/credential-store";

export function ProjectNav({
  projectId,
  projectName,
  onDescribe,
}: {
  projectId: string;
  projectName: string;
  onDescribe?: () => void;
}) {
  const pathname = usePathname();
  const activeCred = useCredentialStore((s) =>
    s.credentials.find((c) => c.id === s.activeId)
  );

  const links = [
    { href: `/project/${projectId}`, label: "Setup", Icon: LayoutGrid },
    { href: `/project/${projectId}/canvas`, label: "Canvas", Icon: Workflow },
    { href: `/project/${projectId}/runs`, label: "Runs", Icon: Boxes },
    { href: `/project/${projectId}/export`, label: "Export", Icon: Download },
  ];

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-4 border-b border-foreground/10 bg-background/90 px-4 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-purple-500/60 via-sky-500/60 to-transparent" />
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Projects
      </Link>
      <span className="text-muted-foreground/50">/</span>
      <h1 className="truncate bg-gradient-to-r from-[#A07CFE] to-sky-400 bg-clip-text text-sm font-bold text-transparent">
        {projectName}
      </h1>

      <nav className="ml-6 flex items-center gap-1">
        {links.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              pathname === href
                ? "bg-foreground/10 text-white"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {onDescribe && (
          <button
            onClick={onDescribe}
            title="Describe this project"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <Info className="h-4 w-4" />
          </button>
        )}
        <ModeToggle />
        <Link
          href="/settings/credentials"
          className="flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1 text-xs text-foreground/80 transition-colors hover:bg-foreground/10"
        >
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              activeCred ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"
            )}
          />
          BYOK: {activeCred ? activeCred.label : "Not configured"}
        </Link>
      </div>
    </header>
  );
}
