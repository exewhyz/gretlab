import {
  cloneElement,
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { NativeSelect } from "@workspace/ui/components/native-select"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

/*
 * The app's form controls, built on the shared shadcn components so every screen looks
 * and behaves the same. They keep the native event props, so callers stay simple.
 */

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <Input
      type="text"
      className={cn("bg-card text-body-sm text-ink", className)}
      {...props}
    />
  )
}

/** A styled native select: keyboard, mobile pickers and forms work as usual. */
export function SelectInput({
  className,
  ...props
}: Omit<ComponentProps<"select">, "size">) {
  return (
    <NativeSelect
      className={cn("w-full text-body-sm text-ink", className)}
      {...props}
    />
  )
}

export function TextArea({
  mono,
  className,
  ...props
}: ComponentProps<"textarea"> & { mono?: boolean }) {
  return (
    <Textarea
      spellCheck={!mono}
      className={cn(
        "min-h-16 resize-y bg-card text-body-sm text-ink",
        // Code shows != and >= as typed, not joined into symbols.
        mono &&
          "bg-canvas-soft font-mono text-code [font-variant-ligatures:none]",
        className
      )}
      {...props}
    />
  )
}

/**
 * A checkbox with its label. `label` names it for screen readers (and tests); `children`
 * replaces the visible text when it needs more than the name.
 */
export function Check({
  checked,
  onCheckedChange,
  label,
  children,
  indeterminate,
  disabled,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  children?: ReactNode
  indeterminate?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-body-sm text-ink",
        disabled && "opacity-50",
        className
      )}
    >
      <Checkbox
        checked={checked}
        indeterminate={indeterminate}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      {children ?? label}
    </label>
  )
}

export function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: ReactElement<{ id?: string }>
}) {
  const id = useId()
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <Label htmlFor={id} className="text-caption font-semibold text-ink">
        {label}
      </Label>
      {cloneElement(children, { id })}
      {help && <div className="text-xs text-body">{help}</div>}
    </div>
  )
}

export function FormMessage({
  message,
}: {
  message: { text: string; kind?: "ok" | "err" } | null
}) {
  if (!message) return null
  return (
    <span
      role="status"
      className={cn(
        "text-caption",
        message.kind === "ok" && "text-success",
        message.kind === "err" && "text-destructive",
        !message.kind && "text-body"
      )}
    >
      {message.text}
    </span>
  )
}
