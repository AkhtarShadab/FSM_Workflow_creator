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
    <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-foreground/10 bg-background/90 px-2 backdrop-blur-sm sm:gap-4 sm:px-4">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-purple-500/60 via-sky-500/60 to-transparent" />
      <Link
        href="/"
        title="All projects"
        className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Projects</span>
      </Link>
      <span className="hidden text-muted-foreground/50 sm:inline">/</span>
      <h1 className="hidden max-w-[10rem] min-w-0 truncate bg-gradient-to-r from-[#A07CFE] to-sky-400 bg-clip-text text-sm font-bold text-transparent md:block lg:max-w-[16rem]">
        {projectName}
      </h1>

      {/* Tabs: icon-only on phones, labels from sm up; scrolls rather than
          overflowing the page (which made mobile browsers zoom out). */}
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] sm:ml-2 sm:gap-1 sm:flex-none [&::-webkit-scrollbar]:hidden">
        {links.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
              pathname === href
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {onDescribe && (
          <button
            onClick={onDescribe}
            title="Describe this project"
            aria-label="Describe this project"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <Info className="h-4 w-4" />
          </button>
        )}
        <ModeToggle />
        <Link
          href="/settings/credentials"
          title={activeCred ? `BYOK: ${activeCred.label}` : "BYOK: Not configured"}
          className="flex h-9 items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 text-xs text-foreground/80 transition-colors hover:bg-foreground/10"
        >
          <span
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              activeCred ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"
            )}
          />
          <span className="hidden max-w-[9rem] truncate lg:inline">
            BYOK: {activeCred ? activeCred.label : "Not configured"}
          </span>
          <span className="lg:hidden">BYOK</span>
        </Link>
      </div>
    </header>
  );
}
