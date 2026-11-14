---
title: The library desk
description: A catalog of books with copies, lending with due dates and limits, renewals, returns and lost books, and reminders for members.
glance:
  who:
    - role: Librarian
      note: keeps the catalog and lends
    - role: Member
      note: browses and borrows
  where:
    path: /orgs/<slug>/manage/books
    menu: "Campus › Books"
  permissions: [library.manage, library.catalog, library.lend]
  module: library
---

The organization's physical library (the coding lab's content library is a different thing:
[The content library](/features/coding/content-library/)).

## How it works

- **The catalog:** titles with a number of copies, author, category, shelf and ISBN.
- **Lending:** a loan lasts 14 days and each person may hold 3 books, unless the library changes it.
  Nobody can borrow the same book twice, a book with no free copy, or more than the limit. Two desks
  can't lend the last copy at once.
- **Renew, return, or mark lost:** lost closes the loan and removes one copy.
- **Members** see the catalog and their loans at `/orgs/<slug>/books`; the bell reminds them when a book
  is due within a day or overdue. Their books also show on My classes and on parents' child page.

## Edge cases

- Copies can't go below the number on loan, and a book on loan can't be deleted.

## Related

- [Parent accounts](/features/people/parent-accounts/)
