import * as orm from "drizzle-orm"
import { Column, is, sql, type SQL, type SQLWrapper } from "drizzle-orm"

/*
 * Lists in queries, at any size. Drizzle's inArray writes one parameter per value
 * (`id in ($1, $2, …)`), and Postgres takes at most 65,535 parameters in a query, so a list
 * that grows with an organization (its members, a whole audience) fails once it is big
 * enough, and inserting many rows fails sooner (each row's columns count). These send the
 * whole list as one array parameter instead (`id = any($1::uuid[])`), which has no such limit
 * and uses the same indexes. 200,000 ids take about a third of a second.
 *
 * `sql.inArray` and `sql.notInArray` from this package are these, so every query gets them.
 */

type Values = readonly unknown[] | SQLWrapper

/**
 * The column's array type, for the cast: uuid[], text[], integer[], an enum's name[]. (Every
 * type in schema.ts has an array type; a serial column would need its base type instead.)
 */
function arrayType(column: Column) {
  return sql.raw(`${column.getSQLType()}[]`)
}

/** `column = any($1::type[])`: true when the column's value is in the list. */
export function anyOf(
  column: Column | SQL.Aliased | SQLWrapper,
  values: Values
): SQL {
  if (!is(column, Column) || !Array.isArray(values)) {
    // A subquery, or an expression whose type isn't known: Drizzle's own form.
    return orm.inArray(column as Column, values as never)
  }
  return sql`${column} = any(${sql.param(values)}::${arrayType(column)})`
}

/** `not (column = any($1::type[]))`: the opposite, as notInArray. */
export function noneOf(
  column: Column | SQL.Aliased | SQLWrapper,
  values: Values
): SQL {
  if (!is(column, Column) || !Array.isArray(values)) {
    return orm.notInArray(column as Column, values as never)
  }
  return sql`not (${column} = any(${sql.param(values)}::${arrayType(column)}))`
}
