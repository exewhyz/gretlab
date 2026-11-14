---
title: Transport
description: Bus routes with vehicles, drivers, seats and stops in order, and who rides which route.
glance:
  who:
    - role: Transport manager
      note: routes and riders
    - role: Student and parent
      note: see their bus
  where:
    path: /orgs/<slug>/manage/transport
    menu: "Campus › Transport"
  permissions: [transport.manage, transport.routes, transport.assign]
  module: transport
  demo:
    as: the transport manager
    email: transport@greenwood.demo.invalid
    path: /orgs/greenwood/manage/transport
---

## How it works

- **A route** has a vehicle, a driver and a number of seats (or no limit), and stops in pick-up order,
  each with an optional morning pick-up and afternoon drop-off time. Pick-ups run forward along the
  route and drop-offs run back.
- **A rider** has one route and stop per organization. Two people can't take a bus's last seat at once.
- Riders can be added from a pasted list (email, route, stop) with a report per line.
- Riders and their parents are told when they're put on a route or taken off; the bus shows on My
  classes and the parent's child page.

## Edge cases

- Seats can't go below the number of riders, and a stop someone uses can't be removed.

## Related

- [Parent accounts](/features/people/parent-accounts/)
