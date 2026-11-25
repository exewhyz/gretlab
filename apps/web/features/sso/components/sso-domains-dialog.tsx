"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { FormMessage, TextArea } from "@/components/form"
import type { ssoDomainsOf } from "@/features/sso/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

/**
 * Admin › Organizations › SSO domains: the email domains an organization's single sign-on may
 * sign in. Only platform staff set them, after checking the college owns them.
 */
export function SsoDomainsDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const { data } = useQuery({
    queryKey: ["admin", "sso-domains", orgId],
    queryFn: () =>
      api<ApiResult<typeof ssoDomainsOf>>(
        `/admin/organizations/${orgId}/sso-domains`
      ),
  })
  const [text, setText] = useState<string | null>(null)
  const value = text ?? data?.domains.join("\n") ?? ""
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/organizations/${orgId}/sso-domains`, {
        method: "PUT",
        body: { domains: value.split(/[\s,]+/).filter(Boolean) },
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["admin", "sso-domains", orgId],
      })
      onOpenChange(false)
    },
    meta: { quiet: true, success: "Single sign-on domains saved." },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Single sign-on domains</DialogTitle>
          <DialogDescription>
            The email domains this organization&apos;s single sign-on may sign
            in, one per line. Add only domains you&apos;ve checked it owns: its
            identity provider can sign in anyone with these addresses. Public
            mail (gmail.com, outlook.com) is refused.
          </DialogDescription>
        </DialogHeader>
        <TextArea
          aria-label="Domains"
          rows={4}
          placeholder="college.edu"
          value={value}
          onChange={(e) => setText(e.target.value)}
        />
        {data?.enabled && (
          <p className="text-caption text-body">
            Single sign-on is on for this organization.
          </p>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
