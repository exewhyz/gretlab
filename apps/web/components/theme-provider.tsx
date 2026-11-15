"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

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
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

/*
 * Anywhere a key press means something else: typing (fields, the code editor, which types
 * into a div rather than a textarea), choosing (selects, comboboxes, menus and lists, where a
 * letter jumps to an item) and adjusting (sliders, spin buttons, grids). The theme key never
 * fires inside one. Add data-hotkeys="off" to an area for anything else that needs letters.
 */
const KEYS_IN_USE = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="grid"]',
  '[role="tree"]',
  ".monaco-editor",
  '[data-hotkeys="off"]',
].join(", ")

/** Whether the key press happened in, or focus sits in, something that uses keys itself. */
function keysInUse(event: KeyboardEvent) {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.matches(KEYS_IN_USE)) return true
  }
  const focused = document.activeElement
  return focused instanceof Element && focused.closest(KEYS_IN_USE) !== null
}

/** "d" switches light and dark, but only when no field, editor or menu is using the keyboard. */
function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }

      // Autofill fires keydown events without a key.
      if (event.key !== "d") {
        return
      }

      if (keysInUse(event)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
