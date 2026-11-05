import type { StatementBlock } from "../types"
import { InlineCode } from "./inline-code"
import styles from "./problem-view.module.scss"

export function Statement({ blocks }: { blocks: StatementBlock[] }) {
  return blocks.map((block, blockIndex) =>
    typeof block === "string" ? (
      <p key={blockIndex}>
        <InlineCode text={block} />
      </p>
    ) : (
      <div key={blockIndex} className={styles.table}>
        <table>
          <tbody>
            {block.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => {
                  const Cell = rowIndex === 0 ? "th" : "td"
                  return (
                    <Cell key={cellIndex}>
                      <InlineCode text={cell} />
                    </Cell>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  )
}
