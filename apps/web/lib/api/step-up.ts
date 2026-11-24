/*
 * Step-up two-factor in the browser (packages/judge/src/step-up.ts): when a protected action is
 * refused with `step_up_required`, api() asks here, the dialog mounted in the root layout
 * (components/step-up-dialog.tsx) asks the person for a code, and api() repeats the request once
 * the session has a fresh one. Several refused requests at once share one dialog.
 */

type Asker = () => Promise<boolean>

let asker: Asker | null = null
let asking: Promise<boolean> | null = null

/** The dialog registers itself; without one (a page outside the layout), nothing is asked. */
export function setStepUpAsker(next: Asker | null) {
  asker = next
}

/** Resolves true once a fresh code was given, false if the person closed the dialog. */
export function askForStepUp(): Promise<boolean> {
  if (!asker) return Promise.resolve(false)
  asking ??= asker().finally(() => {
    asking = null
  })
  return asking
}
