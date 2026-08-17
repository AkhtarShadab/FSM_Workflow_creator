"use client"

import React, { useMemo, useSyncExternalStore } from "react"

import { cn } from "@/lib/utils"

interface MeteorsProps {
  number?: number
  minDelay?: number
  maxDelay?: number
  minDuration?: number
  maxDuration?: number
  angle?: number
  className?: string
}

const subscribeNever = () => () => {}
const getInnerWidth = () => window.innerWidth
const getServerWidth = () => 0

function unitRand(seed: number) {
  const t = Math.sin(seed) * 43758.5453123
  return t - Math.floor(t)
}

export const Meteors = ({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 2,
  maxDuration = 10,
  angle = 215,
  className,
}: MeteorsProps) => {
  const innerWidth = useSyncExternalStore(
    subscribeNever,
    getInnerWidth,
    getServerWidth
  )

  const meteorStyles = useMemo(() => {
    if (innerWidth === 0) return []
    return Array.from({ length: number }, (_, i) => ({
      "--angle": -angle + "deg",
      top: "-5%",
      left: `calc(0% + ${Math.floor(unitRand(i * 4 + 1) * innerWidth)}px)`,
      animationDelay: unitRand(i * 4 + 2) * (maxDelay - minDelay) + minDelay + "s",
      animationDuration:
        Math.floor(
          unitRand(i * 4 + 3) * (maxDuration - minDuration) + minDuration
        ) + "s",
    }))
  }, [number, minDelay, maxDelay, minDuration, maxDuration, angle, innerWidth])

  return (
    <>
      {meteorStyles.map((style, idx) => (
        // Meteor Head
        <span
          key={idx}
          style={{ ...style }}
          className={cn(
            "animate-meteor pointer-events-none absolute size-0.5 rotate-(--angle) rounded-full bg-zinc-500 shadow-[0_0_0_1px_#ffffff10]",
            className
          )}
        >
          {/* Meteor Tail */}
          <div className="pointer-events-none absolute top-1/2 -z-10 h-px w-12.5 -translate-y-1/2 bg-linear-to-r from-zinc-500 to-transparent" />
        </span>
      ))}
    </>
  )
}
