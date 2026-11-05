"use client"

import { Button } from "@workspace/ui/components/button"

import { useQuestionSession } from "../hooks/use-question-session"
import styles from "./problem-view.module.scss"

export function SampleCard({
  number,
  input,
  output,
}: {
  number: number
  input: string
  output: string
}) {
  const { applySampleInput } = useQuestionSession()
  const columns = [
    ["Input", input],
    ["Output", output],
  ]

  return (
    <div className={styles.sample}>
      <div className={styles.sampleCaption}>
        <span>Sample {number}</span>
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => applySampleInput(input)}
        >
          Try this case
        </Button>
      </div>
      <div className={styles.sampleIo}>
        {columns.map(([label, value]) => (
          <div key={label}>
            <div className={`${styles.label} mb-1`}>{label}</div>
            <pre>{value}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}
