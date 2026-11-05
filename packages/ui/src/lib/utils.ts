import type { CnFunction } from "cn"
import { createCn } from "cn/config"

/** cn() with the design system's type scale, which it can't otherwise tell from colors. */
export const cn: CnFunction = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-lg",
            "display-md",
            "display-sm",
            "title-md",
            "title-sm",
            "body-md",
            "body-sm",
            "caption",
            "caption-upper",
            "code",
            "button",
            "nav",
          ],
        },
      ],
    },
  },
})
