"use client"

import { signIn } from "next-auth/react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

export function SignInForm({
  callbackUrl,
  devLogin,
}: {
  callbackUrl: string
  devLogin: boolean
}) {
  const [email, setEmail] = useState("")
  return (
    <div className="grid gap-3">
      <div>
        <Button onClick={() => signIn("google", { callbackUrl })}>
          Continue with Google
        </Button>
      </div>
      {devLogin && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-hairline-strong p-3">
          <Input
            aria-label="Development login email"
            placeholder="anyone@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-8 min-w-0 flex-1 bg-card"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => signIn("dev", { email, callbackUrl })}
          >
            Dev login
          </Button>
        </div>
      )}
    </div>
  )
}
