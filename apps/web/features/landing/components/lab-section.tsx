"use client"

import { CheckIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { LAB } from "../content"

/*
 * The coding lab, as one submission followed to the student's mark: written, judged, graded,
 * released, each step with a line on what GretLab does there. When the chain scrolls into view
 * its tests pass one by one; with reduced motion, or before the script runs, they show as
 * passed.
 */
export function LabSection() {
  const chain = useRef<HTMLOListElement>(null)
  const [passed, setPassed] = useState(LAB.tests)

  useEffect(() => {
    const node = chain.current
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    setPassed(0)
    let timer = 0
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        seen.disconnect()
        let n = 0
        timer = window.setInterval(() => {
          n += 1
          setPassed(n)
          if (n >= LAB.tests) window.clearInterval(timer)
        }, 90)
      },
      { threshold: 0.4 }
    )
    seen.observe(node)
    return () => {
      seen.disconnect()
      window.clearInterval(timer)
    }
  }, [])

  const done = passed >= LAB.tests

  return (
    <section id="lab" aria-labelledby="lab-title" className="scroll-mt-20 border-b border-hairline py-20 lg:py-24">
      <div className="grid gap-6 px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-10">
        <h2 id="lab-title" className="text-display-md text-balance text-ink lg:text-display-lg">
          A real code judge, <span className="font-semibold">in period three.</span>
        </h2>
        <p className="max-w-[56ch] text-body-md text-body lg:pt-2">
          Students write code in the browser. Every submission is judged on the server against
          tests they never see, and the mark goes where the rest of their marks live, the same
          minute.
        </p>
      </div>

      <ol
        ref={chain}
        aria-label="One submission, from the editor to the student's mark"
        className="relative mt-14 grid gap-10 px-5 lg:mt-16 lg:grid-cols-4 lg:gap-6 lg:px-10"
      >
        {/* The line the work travels along. */}
        <span aria-hidden className="absolute top-1.5 right-10 left-10 hidden h-px bg-hairline-strong lg:block" />

        <Station time="10:31" title="Aarav submits" caption={LAB.captions[0]!} active>
          <pre className="font-mono text-code break-words whitespace-pre-wrap text-body">
            {LAB.code.map((line) => (
              <code key={line} className="block">
                {line}
              </code>
            ))}
          </pre>
          <p className="mt-3 text-caption text-muted-foreground">Python 3.13 · Lab exam · Data structures</p>
        </Station>

        <Station time="10:31" title="Judged in a sandbox" caption={LAB.captions[1]!} active={done}>
          <p
            className={cn(
              "flex items-center gap-1.5 text-title-md transition-colors duration-200",
              done ? "text-success" : "text-muted-foreground"
            )}
          >
            {done && <CheckIcon aria-hidden weight="bold" className="size-5" />}
            {done ? "Accepted" : "Judging…"}
          </p>
          <p className="mt-1 text-caption text-muted-foreground tabular-nums">
            {passed} of {LAB.tests} tests · {LAB.ms} ms
          </p>
          <div aria-hidden className="mt-3 grid grid-cols-6 gap-1.5">
            {Array.from({ length: LAB.tests }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-4 rounded-sm transition-colors duration-200 ease-out",
                  i < passed ? "bg-success/20" : "bg-hairline-soft"
                )}
              />
            ))}
          </div>
        </Station>

        <Station time="10:32" title="The gradebook updates" caption={LAB.captions[2]!} active={done} flush>
          <ul className="text-body-sm tabular-nums">
            {LAB.gradebook.map((row) => (
              <li
                key={row.name}
                className={cn(
                  "flex justify-between gap-3 border-t border-hairline-soft px-4 py-2.5 first:border-0",
                  "me" in row && row.me && "bg-primary/5 font-medium text-ink"
                )}
              >
                <span>{row.name}</span>
                <span className={row.mark === "Not started" ? "text-muted-foreground" : "text-ink"}>{row.mark}</span>
              </li>
            ))}
          </ul>
        </Station>

        <Station time="16:00" title="Aarav sees his mark" caption={LAB.captions[3]!} active={done} flush>
          <ul className="text-caption">
            <li className="px-4 py-3">
              <p className="font-semibold text-ink">Lab exam · Data structures</p>
              <p className="mt-0.5 text-body">48 / 50, released by Prof. Iyer.</p>
            </li>
            <li className="border-t border-hairline-soft px-4 py-3">
              <p className="font-semibold text-ink">Attendance · Operating Systems</p>
              <p className="mt-0.5 text-body">82%, above the 75% minimum</p>
            </li>
          </ul>
        </Station>
      </ol>
      <p className="mt-8 px-5 text-caption text-muted-foreground lg:px-10">
        The same example as above; its people and numbers are made up.
      </p>
    </section>
  )
}

function Station({
  time,
  title,
  caption,
  active,
  flush,
  children,
}: {
  time: string
  title: string
  caption: string
  active?: boolean
  /** Rows that run to the card's edges (lists), rather than padded content. */
  flush?: boolean
  children: ReactNode
}) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className={cn(
          "absolute top-0 left-0 hidden size-3 rounded-full border-2 transition-colors duration-200 lg:block",
          active ? "border-primary bg-primary" : "border-hairline-strong bg-canvas"
        )}
      />
      <p className="text-caption text-muted-foreground lg:pt-7">
        <span className="font-mono">{time}</span> · <span className="font-medium text-ink">{title}</span>
      </p>
      <div className={cn("mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10", !flush && "p-4")}>{children}</div>
      <p className="mt-3 text-body-sm text-body">{caption}</p>
    </li>
  )
}
