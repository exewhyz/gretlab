/** ADMIN_EMAILS always get in and are the platform's owners. It's how the first admin exists. */
export function isAdminEmail(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes(email.toLowerCase())
}
