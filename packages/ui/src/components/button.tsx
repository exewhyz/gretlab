import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"

const buttonClasses = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-button whitespace-nowrap transition-colors outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-active active:bg-primary-active",
        outline:
          "border-hairline-strong bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary: "bg-ink text-canvas hover:bg-ink/90 aria-expanded:bg-ink/90",
        ghost: "text-body hover:bg-muted hover:text-foreground",
        destructive:
          "border-destructive/40 bg-card text-destructive hover:bg-destructive/10",
        link: "text-foreground underline underline-offset-2 hover:text-body",
      },
      size: {
        default: "h-10 gap-1.5 px-4.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-sm px-3",
        lg: "h-11 gap-1.5 px-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-sm",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * The button's classes, merged. cva only joins strings, so on its own a variant's
 * `border-hairline-strong` would sit beside the base's `border-transparent`, and the
 * transparent one would win: links styled as outline buttons lost their border.
 */
function buttonVariants(...args: Parameters<typeof buttonClasses>) {
  return cn(buttonClasses(...args))
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonClasses>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
