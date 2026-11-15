"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/*
 * Light, dark or the system's choice, switched with the header's theme button.
 * There's deliberately no keyboard shortcut: shadcn's template toggled on a bare "d", which
 * fired while people typed in the code editor, menus and other fields (and single-letter
 * shortcuts fail WCAG 2.1.4).
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
