"use client"

import { Button } from "@workspace/ui/components/button"

export function PrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  )
}
