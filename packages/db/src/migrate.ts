import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { statementToMarkdown } from "@workspace/judge"
import postgres from "postgres"

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1 })
// The judges' own login may judge, not change tables: migrations are the owner's, run before a
// release (README › How the live site runs). A judge set up with it skips them.
const [who] = await client<{ me: string }[]>`select current_user as me`
if (who?.me === "gretlab_judge") {
  console.log(
    "Migrations skipped: this is the judges' login, and the owner migrates"
  )
  await client.end()
  process.exit(0)
}
await migrate(drizzle(client), {
  migrationsFolder: new URL("../migrations", import.meta.url).pathname,
})
// Problems written before statements were markdown get one made from their old blocks.
const old = await client<
  {
    id: string
    statement: (string | string[][])[]
  }[]
>`select id, statement from problems where description = ''`
for (const row of old) {
  const description = statementToMarkdown(row.statement)
  if (description) {
    await client`update problems set description = ${description} where id = ${row.id}`
  }
}
if (old.length)
  console.log(`Wrote markdown descriptions for ${old.length} problems`)
await client.end()
console.log("Migrations applied")
