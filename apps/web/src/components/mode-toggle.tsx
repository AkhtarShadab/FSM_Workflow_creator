"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { cn } from "@/lib/utils";

export function ModeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className={cn(
          "h-9 w-9 rounded-full border border-foreground/10 bg-foreground/5",
          className
        )}
      />
    );
  }

  return (
    <AnimatedThemeToggler
      theme={resolvedTheme === "light" ? "light" : "dark"}
      onThemeChange={(t) => setTheme(t)}
      variant="circle"
      duration={500}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground [&_svg]:h-4 [&_svg]:w-4",
        className
      )}
    />
  );
}
