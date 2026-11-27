"use client"

import { ArrowRightIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { DAYS, SLOTS, WEEKS, type Audience, type Period } from "../content"

/*
 * The first viewport: a week, for a college or a coaching institute. A title bar holds the switch and
 * names the class and the week; the headline sits in merged cells of Mon–Thu, periods 1–2;
 * every other period is a toggle that shows what GretLab does there. On load (and on each
 * switch) the "now" marker steps through a few periods and rests on the lab; touching the
 * grid stops it, and with reduced motion it starts at rest. Phones get the headline, the
 * switch, then one day at a time.
 */

const ROW: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 6, 5: 7 }
const label = (p: Period) => `${DAYS[p.day]} · P${p.slot} · ${SLOTS[p.slot - 1]!.time}`

export function TimetableHero({ headline }: { headline: ReactNode }) {
  const [audience, setAudience] = useState<Audience>("college")
  const week = WEEKS[audience]
  const [selected, setSelected] = useState<string>(week.tour[0]!)
  const [day, setDay] = useState(0)
  const touring = useRef(true)

  useEffect(() => {
    const tour = WEEKS[audience].tour
    const rest = tour.at(-1)!
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      touring.current = false
      setSelected(rest)
      return
    }
    touring.current = true
    setSelected(tour[0]!)
    let step = 0
    const timer = window.setInterval(() => {
      step += 1
      if (!touring.current || step >= tour.length) return window.clearInterval(timer)
      setSelected(tour[step]!)
    }, 1100)
    return () => window.clearInterval(timer)
  }, [audience])

  const pick = (id: string | undefined) => {
    touring.current = false
    if (id) setSelected(id)
  }
  const current = week.periods.find((p) => p.id === selected) ?? week.periods[0]!

  return (
    <section aria-labelledby="landing-title" className="relative">
      {/* The week's title bar: who it's for, and which week. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:mb-0 lg:border-b lg:border-l lg:border-hairline lg:px-3 lg:py-2">
        <ToggleGroup
          aria-label="Show the week for"
          value={[audience]}
          onValueChange={(v) => v[0] && setAudience(v[0] as Audience)}
          variant="outline"
          spacing={0}
        >
          {(Object.keys(WEEKS) as Audience[]).map((a) => (
            <ToggleGroupItem
              key={a}
              value={a}
              className="px-4 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-canvas"
            >
              {WEEKS[a].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-caption text-muted-foreground">
          <span className="font-medium text-ink">{week.group}</span> · {week.when}
        </p>
      </div>

      <div className="grid gap-y-8 lg:grid-cols-[6.75rem_repeat(5,minmax(0,1fr))] lg:gap-0 lg:border-l lg:border-hairline">
        {/* Day names. */}
        <div aria-hidden className="hidden h-9 border-r border-b border-hairline lg:block" />
        {DAYS.map((d) => (
          <div
            key={d}
            aria-hidden
            className="hidden h-9 items-end border-r border-b border-hairline px-3 pb-2 font-mono text-caption text-muted-foreground lg:flex"
          >
            {d}
          </div>
        ))}
        {/* Period times, and the lunch band. */}
        {SLOTS.map((s) => (
          <div
            key={s.n}
            aria-hidden
            style={{ gridRow: ROW[s.n] }}
            className="hidden flex-col border-r border-b border-hairline px-3 py-3 font-mono text-caption text-muted-foreground lg:col-start-1 lg:flex"
          >
            <span>P{s.n}</span>
            <span>{s.time}</span>
          </div>
        ))}
        <div
          aria-hidden
          style={{ gridRow: 5 }}
          className="hidden h-8 items-center border-b border-hairline bg-[repeating-linear-gradient(135deg,var(--color-hairline-soft)_0_6px,transparent_6px_12px)] px-3 font-mono text-caption text-muted-foreground lg:col-span-6 lg:col-start-1 lg:flex"
        >
          Lunch · 12:15–13:00
        </div>

        {/* The headline, set into the week. */}
        <div className="lg:col-span-4 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:border-r lg:border-b lg:border-hairline lg:px-8 lg:pt-6 lg:pb-6">
          {headline}
        </div>

        {/* The week's periods (laptop and up). */}
        <ToggleGroup
          aria-label={`An example week: ${week.group}`}
          value={[selected]}
          onValueChange={(v) => pick(v[0])}
          className="hidden lg:contents"
        >
          {week.periods.map((p) => (
            <ToggleGroupItem
              key={`${audience}-${p.id}`}
              value={p.id}
              aria-label={`${DAYS[p.day]}, period ${p.slot}: ${p.title}, ${p.status}`}
              onPointerEnter={() => pick(p.id)}
              onFocus={() => pick(p.id)}
              style={{ gridColumn: p.day + 2, gridRow: ROW[p.slot] }}
              className={cn(
                "relative h-auto min-h-18 animate-in flex-col items-start justify-start gap-1 rounded-none border-r border-b border-hairline bg-card px-3 py-3 text-left whitespace-normal transition-colors duration-150 fade-in-0 hover:bg-canvas-soft",
                "data-[pressed]:bg-card aria-pressed:bg-card"
              )}
            >
              <span className="text-body-sm font-semibold text-ink">{p.title}</span>
              <span
                className={cn(
                  "text-caption text-muted-foreground",
                  p.tone === "ok" && "text-success",
                  p.tone === "bad" && "text-destructive"
                )}
              >
                {p.status}
              </span>
              {/* The selection box: the marker that walks the week. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 ring-[1.5px] ring-primary ring-inset transition-opacity duration-150 ease-out group-aria-pressed/toggle:opacity-100"
              >
                <span className="absolute -top-px left-[-1.5px] -translate-y-full rounded-t-sm bg-primary px-1.5 py-0.5 font-mono text-caption leading-none text-primary-foreground">
                  {DAYS[p.day]} · P{p.slot}
                </span>
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/* Phones and tablets: one day at a time. */}
        <div className="lg:hidden">
          <ToggleGroup
            aria-label="Day"
            value={[String(day)]}
            onValueChange={(v) => v[0] && setDay(Number(v[0]))}
            variant="outline"
            spacing={0}
            className="w-full"
          >
            {DAYS.map((d, i) => (
              <ToggleGroupItem key={d} value={String(i)} className="flex-1">
                {d}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ol className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {SLOTS.map((s) => {
              const p = week.periods.find((x) => x.day === day && x.slot === s.n)
              return (
                <li key={s.n} className="grid grid-cols-[4.5rem_minmax(0,1fr)] border-b border-hairline last:border-0">
                  <span className="border-r border-hairline px-3 py-3 font-mono text-caption text-muted-foreground">
                    P{s.n}
                    <br />
                    {s.time}
                  </span>
                  <span className="px-3 py-3">
                    {p ? (
                      <>
                        <span className="block text-body-sm font-semibold text-ink">{p.title}</span>
                        <span
                          className={cn(
                            "block text-caption text-muted-foreground",
                            p.tone === "ok" && "text-success",
                            p.tone === "bad" && "text-destructive"
                          )}
                        >
                          {p.status}
                        </span>
                        <span className="mt-1.5 block text-caption text-body">{p.detail}</span>
                      </>
                    ) : (
                      <span className="text-caption text-muted-foreground">{s.n === 1 ? "Lecture" : "Tutorial"}</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      {/* What the chosen period is (laptop and up). */}
      <div
        aria-live="polite"
        className="hidden min-h-24 grid-cols-[6.75rem_minmax(0,1fr)_auto] items-start border-b border-l border-hairline lg:grid"
      >
        <span className="border-r border-hairline px-3 py-4 font-mono text-caption text-primary-active">Now</span>
        <p className="px-6 py-4 text-body-sm text-body">
          <span className="font-mono text-caption text-muted-foreground">{label(current)}</span>
          <span className="mt-1 block max-w-[68ch]">
            <strong className="font-semibold text-ink">{current.title}.</strong> {current.detail}
          </span>
        </p>
        <a
          href="#lab"
          className="group/see m-4 inline-flex items-center gap-1.5 text-body-sm font-medium text-ink underline-offset-4 hover:underline"
        >
          The coding lab
          <ArrowRightIcon aria-hidden className="size-4 transition-transform duration-150 group-hover/see:translate-x-0.5" />
        </a>
      </div>
    </section>
  )
}
