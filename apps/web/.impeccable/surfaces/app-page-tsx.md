---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: []
---

# Landing page (/)

Scope: the public landing page visitors see at `/` (signed-in people still go to /home). Mode: Persuade.

Audience and job: colleges (CS departments, deans, faculty) and cohort programs (bootcamps, training batches) deciding whether to run their coding labs on GretLab; schools and other kinds get one line; learners have a clear second path. The owner rejected a first build as text-heavy and unclear: say one thing first (the coding lab that grades itself) and let the screens explain. Action: register your school when school sign-up is open, otherwise talk to us; second action: try the coding lab. No pricing (fees are on hold). Proof is the product itself: no customers, testimonials or usage figures exist, so none are shown. Every example school, person and figure is demo content and is labelled as an example.

Breadth: the coding lab first, with what surrounds it for a college (attendance by course, semesters and SGPA, CO–PO, LTI) and a cohort (runs, pods and mentors, GitHub projects, peer review, graduation).

## Direction contract

THESIS: The page is a week, switchable between a college's semester and a cohort's run. A ruled timetable carries the story, and each period shows the part of GretLab that runs it; the coding lab is a period like any other, so a real judge sits inside the school day. It refuses the centred headline over a product screenshot and a row of feature cards.

OWN-WORLD: The Lab Notebook as it is: Lab Cream page, Sheet White cells, warm ink, hairline rules for every line of the grid, one Signal Orange for the main action and the "now" period, Ledger Green only for accepted results, JetBrains Mono only for times and code.

STORY: Visitors see a familiar object (the timetable) filled with real work (registers, a judged lab exam, marks, report cards), understand that one product runs the whole day including coding, then register their school or try the lab.

FIRST VIEWPORT: A title bar with the College / Cohort switch and the class and week, then a full-width week (Mon–Fri, five periods and a lunch band) under a 64px header. The headline (display, two weights), one line of copy and the two actions sit inside merged cells of Mon–Thu, periods 1–2; the primary action is in the grid's first band. Other periods show a register, the lab exam's Accepted result, marks due, a library book, a bus. Phones: the headline first, then one day as a column.

FORM: Surface structure "The timetable is the page", position 5 on the re-ranked list, second hand. seed:6dc68aa779a27097

SIGNATURE: The "now" period steps through the week once on load, then rests on the lab exam; hovering or focusing any period opens what GretLab does there, and that period's detail leads into the section that explains it. Motion: one stepped highlight (150 ms ease-out per step), no scattered effects; reduced motion shows the resting state.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
