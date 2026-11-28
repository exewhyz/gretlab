import { route } from "@/lib/api/route"
import { saveSemester, semesterSchema } from "@/features/university/syllabus"

/** Sets one semester of one program; affiliated colleges' classes on it get new courses. */
export const PUT = route(
  { access: "user", body: semesterSchema },
  ({ user, params, body }) =>
    saveSemester(
      params.slug ?? "",
      user,
      params.programId ?? "",
      Number(params.semester),
      body
    )
)
