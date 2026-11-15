import { getSettings } from "@/features/settings/server"
import { siteSettings } from "@/lib/seo/config"

/*
 * What the landing page needs from the settings, worked out on the server so its buttons
 * only ever lead somewhere that works:
 * - School sign-up open or reviewed: "Register your college" (/schools/new).
 * - Otherwise: "Talk to us", the page's contact form (#contact). Enquiries are kept for
 *   Dashboard › Landing page and emailed to the organizations contact when one is set
 *   (Dashboard › Settings › Landing page); the legal contact, a privacy inbox, never is.
 * The coding lab's link follows the practice switch.
 */

export type PrimaryAction =
  | { kind: "register"; label: string; href: string; note: string }
  | { kind: "contact"; label: string; href: string; note: string }

export interface LandingFacts {
  site: string
  docsUrl: string
  primary: PrimaryAction
  /** The organizations contact, shown under the form when set. */
  email: string
  /** The coding lab's public page, or null when practice is switched off. */
  lab: { href: string; label: string } | null
}

export async function landingFacts(): Promise<LandingFacts> {
  const [site, settings] = await Promise.all([siteSettings(), getSettings().catch(() => null)])
  const signup = settings?.["orgs.self_signup"] ?? "off"
  const primary: PrimaryAction =
    signup !== "off"
      ? {
          kind: "register",
          label: "Register your college",
          href: "/schools/new",
          note:
            signup === "review"
              ? "We look over each new organization before it opens."
              : "Your organization is ready as soon as you've set it up.",
        }
      : { kind: "contact", label: "Talk to us", href: "#contact", note: "Tell us about your college or program; we'll set it up with you." }
  const practice = settings?.["practice.enabled"] ?? true
  return {
    site: site.name,
    docsUrl: site.docsUrl,
    primary,
    email: settings?.["landing.contact_email"] ?? "",
    lab: practice ? { href: "/problems", label: "Try the coding lab" } : null,
  }
}
