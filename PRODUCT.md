# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One coordinator at a Malaysian school (an admin or senior teacher) who builds the relief/cover timetable, almost always on a phone. They work before the school day, usually for the next school day, which is the day the app opens on by default. They tick which teachers are free, check that the auto-fill looks fair, fix individual cells, and post the result as an image to the staff group (WhatsApp or Telegram).

Secondary audience: the teachers who only ever see the exported image in a chat thread, usually on a phone. They never open the app.

## Product Purpose

Jadual Blok produces the daily relief/cover timetable for the school's classes (K1 to K15, by default in eight rows: K1/K2 to K14/K15 with K5 alone). It rotates whichever teachers are available that day through the morning slots, from 7.30 to 12.30 with recess at 9.00–9.30. Without it, the coordinator balances this by hand every day.

Success: within a few minutes the coordinator has a timetable that fills every cell and spreads teaching minutes evenly, and a readable image of it is in the staff group.

## Positioning

The app fills the timetable automatically under the school's own rules, and the coordinator can still change any cell by hand. Each teacher takes at most one class before recess and one after. Classes are merged only when there are too few teachers to fill every cell. Teachers preferably get a different class after recess. Workload is balanced in minutes. Results are seeded by date, so a day stays stable until the coordinator presses Regenerate. Manual edits swap teachers instead of creating clashes. The output is an image made for chat apps, not a document or a shared login.

## Operating Context

- Phone first, used in the morning before or at the start of school. Desktop works but is secondary.
- Everything is shared as a PNG in a WhatsApp or Telegram staff group. On phones, the system share sheet attaches the image. On desktop, the app downloads it and opens WhatsApp Web or Telegram's share page.
- The exported image is always rendered light, at full width and with no controls. It is the artifact most people see.
- The coordinator (and anyone else with the admin PIN) edits. One admin PIN, which can be remembered on the device, protects changes to the teacher list and the timetables; without it the app shows the timetable read-only.

## Capabilities and Constraints

- School days only (Mon–Fri). Friday has shorter slots after recess (9.30–10.45, 10.45–12.00 instead of 9.30–11.00, 11.00–12.30). Slots and the default combined classes live in `src/lib/config.ts`.
- The class list is shared and edited like the teacher list. Each day the coordinator ticks which classes are taught (an unticked class has no row) and can combine rows (e.g. "K1/K2", "K1/K12", or any pair and limitless combination of classes, sharing one set of teachers) or split them. New days start with the default combinations.
- The teacher and class lists are stored on the server (Cloudflare D1 behind a Worker). Daily availability and timetables are stored on the server too (a Durable Object) and shared live with every open device; the browser keeps a copy for a fast start.
- Without a connection, the timetable is shown read-only and editing pauses until the app reconnects.
- If the API can't be reached, the app shows the last saved list and pauses editing.
- Manual editing: tap a cell to pick or swap a teacher, and merge or split the two slots on either side of recess. A single slot holds up to 2 names and a merged cell up to 3. Teachers who would repeat a class across recess are flagged, not blocked.
- Events (assembly, sports day and so on) take one slot for every class, like recess: added from a cell's **Add event** tab with just a name, shown as one cell down the column, and left empty by Regenerate.
- A workload summary shows each available teacher's minutes.
- An **Undo** button (and Ctrl/Cmd+Z) next to Regenerate reverses the last change to the day: a cell, availability of a teacher or class, combining or splitting rows, or Regenerate. One step only, no redo. It stays with its day when switching dates, and is dropped when another device changes that day.
- Changes that lose work also show a 10 s toast with Undo: emptying a cell, Regenerate on a day with hand edits, unticking a teacher who had cells, and unticking a class or combining rows when teachers lose their cells. Availability, teacher-list and class-list changes never rebuild the day; they mark it out of date until Regenerate.
- Stack is already in place: Svelte 5 + Vite + TypeScript on Bun, deployed to Cloudflare Workers.
- **Language:** the timetable itself is in Malay (`Bil.`, `Kelas`, `Rehat`, and the exported image). The exported image and its share caption use a Malay date ("Isnin, 12 Oktober 2026", via `longDateMs` in `src/lib/dates.ts`). Empty cells read "Tiada guru", both in the app and in the image. The rest of the app, including the in-app date labels, stays in English.
- **Exported image is monochrome for names:** teacher colours appear only in the app, as an aid while editing. The PNG shows names as plain dark text in neutral cells. Empty cells keep their amber warning look so gaps stand out.

## Brand Commitments

- The product name is **Jadual Blok** (Malay: "block timetable").
- Class codes (K1/K2 … K14/K15) and the time formats (`7.30-8.15`) are school conventions. Keep them as they are.

## Evidence on Hand

- Real product: the working app in `src/` and the scheduler with unit tests in `src/lib/scheduler.test.ts`.
- No testimonials, usage numbers, school name, logo beyond `public/favicon.svg`, or other proof. Do not make any up.

## Product Principles

1. **The image is the deliverable.** Whatever ends up in the staff group has to be legible at chat-thumbnail size on a phone, and correct.
2. **Fair by default, overridable by hand.** Auto-fill follows the school's rules and balances workload. The coordinator always has the final say, and edits never silently create clashes.
3. **Minutes, not menus.** The coordinator does this every school day. Choosing the day, ticking teachers and sharing should take seconds.
4. **Stable until asked.** The same day gives the same timetable until the coordinator presses Regenerate; changing availability does not rebuild it.
5. **Fail safe.** If the network or server is down, the coordinator still sees the last known list and doesn't lose work.
