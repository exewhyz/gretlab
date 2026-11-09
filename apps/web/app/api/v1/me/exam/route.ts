import { route } from "@/lib/api/route"
import { myActiveExam } from "@/features/exams/server"

/** `{ exam }`: the exam you're sitting right now, or null. The site locks to it until it ends. */
export const GET = route({ access: "user" }, async ({ user }) => ({
  exam: await myActiveExam(user),
}))
