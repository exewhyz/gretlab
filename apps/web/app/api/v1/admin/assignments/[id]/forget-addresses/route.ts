import { route } from "@/lib/api/route"
import { forgetExamAddresses } from "@/features/assignments/server"

/** Drops the network addresses an exam recorded. */
export const POST = route({ access: "platform.work.manage" }, ({ params }) =>
  forgetExamAddresses(params.id ?? "", null)
)
