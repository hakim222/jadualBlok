# Jadual Blok

Single-page school timetable builder. Pick a school day and tick the teachers and classes for that day. Press **Regenerate** and the timetable fills with balanced workloads; you can then adjust it and share it as an image.

**Stack:** Svelte 5 + Vite + TypeScript, run with Bun. Teachers and classes are stored in Cloudflare D1 behind a small Cloudflare Worker (`worker/index.ts`), which also serves the built app. Each day's availability and timetable live in a Durable Object (`worker/schedule.ts`, SQLite storage) and are shared live with every open copy of the app over a WebSocket; the browser keeps a copy in `localStorage` for a fast start.

## Run

```bash
bun install
bun run preview    # build + app and API together at http://localhost:8787 (wrangler dev)
bun run dev        # Vite with hot reload at :5173; run `bun run dev:api` alongside it for /api
bun test           # scheduler unit tests
bun run check      # type-check
bun run deploy     # build + deploy to Cloudflare
```

Local development needs `.dev.vars` containing `ADMIN_PIN=...`, and the local tables created with `bunx wrangler d1 execute jadualblok --local --file=./schema.sql`. Production needs the same command with `--remote`, plus `bunx wrangler secret put ADMIN_PIN`. The file is safe to run again: it seeds K1–K15 only while the `classes` table is empty.

## Teacher and class API

`:list` is `teachers` or `classes` (class names are at most 20 characters, teacher names 40).

| Method | Path | PIN (`x-admin-pin` header) |
|---|---|---|
| GET | `/api/:list` | no |
| POST | `/api/:list` `{"name"}` | yes |
| PATCH | `/api/:list/:id` `{"name"}` | yes |
| DELETE | `/api/:list/:id` | yes |

The app asks for the PIN the first time you add, rename or remove a teacher or class. It can remember the PIN on the device; the lock button forgets it. If the API can't be reached, the app shows the last saved list and pauses editing.

## Live timetable sync

`GET /api/live` opens a WebSocket to the `Schedule` Durable Object, which holds every day's timetable (days older than 120 days are dropped). Messages are documented at the top of `src/lib/sync.svelte.ts`.

- **Everyone sees the same timetable, live.** A change on one device shows on every other open device within a second.
- **Editing needs the admin PIN** (the same one as the teacher list), sent in the first WebSocket message. Without it the timetable is read-only, with an **Unlock to edit** button.
- **Offline pauses editing.** The badge next to the date shows *Live*, *Live · read-only* or *Offline: editing paused*; the app reconnects by itself and loads the latest copy.
- **Whole-day writes with versions.** If two devices change the same day at once, the first write wins and the other device switches to it, with a message.
- After a teacher or class is added, renamed or removed, the Worker tells every device to fetch the lists again.

## How it works

- **Date**: Mon–Fri only. Friday uses the shorter Friday slots; times are in `src/lib/config.ts`.
- **Teachers**: add one or many (comma-separated); they're saved to the server. Tick or untick for the selected day. Availability is saved per date on the server and shared live (see below). Changing it, or the teacher list changing, never rebuilds the timetable: a teacher who becomes unavailable (or is deleted) just leaves her cells (Undo is offered for availability), and the timetable is marked out of date until you press **Regenerate**. A day you open for the first time starts empty: set availability, then press **Generate** (the button reads **Regenerate** once the day has been generated).
- **Classes**: a shared list (seeded K1–K15), edited like teachers. Tick or untick for the selected day; it's saved per date and shared live. An unticked class leaves its row (a combined row keeps its other classes and teachers; a row left with no class goes, with Undo offered for its teachers). A ticked class gets its own empty row back in list order. Adding a class gives it a row on every day; deleting one takes it out of every day.
- **Combined rows**: classes in one row share its teachers and count as one class for the rules below. Tap a class name in the timetable to combine it with another row (the selected row's teachers stay; the other row's fill only a side of recess the selected row left empty) or to split it (the first class keeps the teachers; individual classes can also be separated). A new day starts with K1/K2, K3/K4, K6/K7, K8/K9, K10/K11, K12/K13 and K14/K15 combined and K5 alone (`DEFAULT_COMBINED` in `src/lib/config.ts`). Regenerate keeps the rows and refills the teachers. Days saved before classes could change are converted on load (`migrateDay` in `src/lib/classes.ts`).
- **Auto-fill** (`src/lib/scheduler.ts`):
  - **Rules:**
    - Each teacher teaches at most **one class before recess and one after**.
    - Normally that class is a single slot. A teacher stays in the same class for both slots (a merged block, which counts as one class) **only when needed**: with fewer than twice as many available teachers as rows, exactly enough classes are merged to fill every cell (e.g. 8 rows and 12 teachers → 4 merged blocks per side).
    - Teachers preferably get a **different class after recess**.
  1. Units (single slots or merged blocks) are filled longest first. Each gets the eligible teacher with the fewest minutes so far.
  2. A hill-climbing pass evens out minutes without breaking the rules.
  3. Swaps between same-shaped units (which don't change anyone's minutes) remove class repeats.
  4. Results are seeded by date, so the same day gives the same result until you press **Regenerate**.
- **Edit**: tap a cell to choose a teacher. Anyone can be picked: a teacher who already has a class on that side of recess swaps with the current teacher, whether in the same slot, the other slot (7.30 ↔ 8.15, 9.30 ↔ 10.45/11.00) or a merged cell. Into an empty cell she simply moves. Teachers who'd repeat a class across recess are marked amber and listed last. The **Merge / Split** button merges or splits the 2 slots.
- **Cells with several names** (manual only), shown as "Ainol / Sakinah": a single slot holds up to **2 names**, a merged cell up to **3**. A single cell with one name has two tabs: **Change teacher** (replace or swap, as before) and **Add teacher** (add a second name). In a merged cell's menu you remove names with × and tap teachers to add them. Adding a teacher moves her out of her other cell on that side of recess. There's no time split: every name counts the whole cell in the workload. Merging keeps every name, so it's blocked when the two slots hold more than 3 names between them. Splitting gives the first two names one slot each and a third joins the first slot.
- **Events** (e.g. assembly): a cell's **Add event** tab, beside Change teacher and Add teacher, needs only a name. The event takes that slot for every class, like recess, and shows as one cell down the column (in the image too). Teachers in that slot are taken out (Undo is offered); a merged cell on that side keeps its names in the other slot, and that side can't be merged while the event is there. An event can take one slot or both slots on its side of recess (choose **Both slots** when adding it, or tap it and **Merge**; a two-slot event can be shortened to either slot). It never crosses recess. Generate/Regenerate leave its slots empty. Tap the event to rename, merge, shorten or remove it; slots it gives back come back as empty cells. Saved per day in `DayData.events` (first slot index → `{ name, span? }`).
- **Share**:
  - **Download PNG** saves the timetable as an image.
  - On phones, **WhatsApp** and **Telegram** open the system share sheet with the image attached; pick the app there. The web can't attach an image to a specific app directly.
  - On desktop they download the image and open WhatsApp Web or Telegram's share page.
