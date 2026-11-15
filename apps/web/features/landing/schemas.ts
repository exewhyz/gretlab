import { z } from "zod"

/*
 * The landing page's forms, shared by the browser (the contact form) and the API. Loaded in
 * the browser, so: zod only, never the database or a server module.
 */

export const ENQUIRY_KINDS = [
  { value: "college", label: "College or university" },
  { value: "cohort", label: "Cohort program or bootcamp" },
  { value: "school", label: "School" },
  { value: "other", label: "Something else" },
] as const

export const LEARNER_SIZES = ["Under 100", "100–500", "500–2,000", "Over 2,000"] as const

export const enquirySchema = z.object({
  name: z.string().trim().min(2, "Tell us your name").max(120),
  email: z.email("Use an email address we can reply to").trim().max(200),
  organization: z.string().trim().min(2, "Name your college, program or school").max(160),
  kind: z.enum(ENQUIRY_KINDS.map((k) => k.value) as ["college", "cohort", "school", "other"]),
  learners: z.enum(LEARNER_SIZES),
  message: z.string().trim().max(2000).default(""),
  /** A field people never see; anything in it means a bot filled the form. */
  website: z.string().max(200).default(""),
})

export type EnquiryInput = z.input<typeof enquirySchema>

export const PARTNER_KINDS = ["college", "cohort", "school", "other"] as const

export const partnerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(PARTNER_KINDS),
})

export const testimonialSchema = z.object({
  quote: z.string().trim().min(20, "A quote of at least a sentence").max(400),
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().min(2).max(120),
  institution: z.string().trim().min(2).max(160),
})
