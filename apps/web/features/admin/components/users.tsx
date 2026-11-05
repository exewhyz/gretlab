"use client"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { User } from "@workspace/db"
import { useState } from "react"

import { ConfirmDialog } from "@/components/confirm"
import { SelectInput, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"

import { Loading, PageTitle, Table } from "./shell"

export function AdminUsers() {
  const [search, setSearch] = useState("")
  const [blocking, setBlocking] = useState<User | null>(null)
  const queryClient = useQueryClient()
  const { data: viewer } = useViewer()
  const { data, error } = useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () =>
      api<User[]>(`/admin/users?search=${encodeURIComponent(search)}`),
  })
  const update = useMutation({
    mutationFn: ({ id, ...change }: { id: string } & Partial<User>) =>
      api(`/admin/users/${id}`, { method: "PATCH", body: change }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  })

  return (
    <>
      <PageTitle
        action={
          <TextInput
            aria-label="Search users"
            placeholder="Search name or email"
            className="w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        }
      >
        Users
      </PageTitle>
      {update.error && (
        <p role="alert" className="mb-3 text-body-sm text-destructive">
          {update.error.message}
        </p>
      )}
      {!data ? (
        <Loading error={error} />
      ) : (
        <Table headers={["Email", "Name", "Role", "Access"]}>
          {data.map((user) => {
            const isSelf = user.id === viewer?.user?.id
            return (
              <tr key={user.id}>
                <td>{user.email}</td>
                <td>{user.name ?? "—"}</td>
                <td>
                  <SelectInput
                    aria-label={`Role for ${user.email}`}
                    className="w-32 py-1"
                    value={user.role}
                    disabled={isSelf}
                    onChange={(event) =>
                      update.mutate({
                        id: user.id,
                        role: event.target.value as User["role"],
                      })
                    }
                  >
                    <option value="student">Student</option>
                    <option value="teacher">Teacher</option>
                    <option value="admin">Admin</option>
                  </SelectInput>
                </td>
                <td>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={user.disabled}
                      disabled={isSelf}
                      aria-label={`Block ${user.email}`}
                      onCheckedChange={(checked) =>
                        // Blocking signs them out at once, so it asks first; unblocking doesn't.
                        checked
                          ? setBlocking(user)
                          : update.mutate({ id: user.id, disabled: false })
                      }
                    />
                    Blocked
                  </label>
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      {blocking && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setBlocking(null)}
          title={`Block ${blocking.email}?`}
          description="They're signed out at once and can't sign in until unblocked. Their work stays."
          confirmLabel="Block"
          onConfirm={() => update.mutate({ id: blocking.id, disabled: true })}
        />
      )}
    </>
  )
}
