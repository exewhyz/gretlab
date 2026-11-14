---
title: Hostel
description: Hostels, rooms and lettered beds, allotting beds to residents, and moving them out.
glance:
  who:
    - role: Hostel warden
      note: rooms and residents
    - role: Student and parent
      note: see their room
  where:
    path: /orgs/<slug>/manage/hostel
    menu: "Campus › Hostel"
  permissions: [hostel.manage, hostel.rooms, hostel.allot]
  module: hostel
---

## How it works

- **Hostels** have rooms (added in runs, up to 200 at a time, skipping names already there) and beds
  lettered A, B, C and on past Z.
- **One bed per person, one person per bed.** A race for the same bed ends with one of them told it's
  taken.
- **Allotting:** by hand, or from a pasted list (email, hostel, room, and optionally a bed; with no bed,
  the first free one).
- Someone who may only allot beds sees their own groups' residents by name; other beds show just as
  taken.
- Residents and their parents are told when they get a bed, move or move out.

## Edge cases

- Fewer beds removes the last letters, never an occupied bed. Rooms and hostels can be removed only
  when empty.

## Related

- [Parent accounts](/features/people/parent-accounts/)
