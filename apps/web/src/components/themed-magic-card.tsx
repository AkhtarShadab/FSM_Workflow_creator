"use client";

import { useTheme } from "next-themes";
import { MagicCard } from "@/components/ui/magic-card";

/**
 * MagicCard with a theme-aware hover glow.
 * The stock card paints a #262626 blob at the cursor — replaced with a soft
 * violet/sky wash that reads as a glow in dark mode and a tint in light mode.
 */
export function ThemedMagicCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  return (
    <MagicCard
      gradientSize={220}
      gradientFrom="#A07CFE"
      gradientTo="#38bdf8"
      gradientColor={dark ? "#8b5cf6" : "#c4b5fd"}
      gradientOpacity={dark ? 0.16 : 0.28}
      className={className}
    >
      {children}
    </MagicCard>
  );
}
