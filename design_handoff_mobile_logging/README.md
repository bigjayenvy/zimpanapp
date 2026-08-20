# Handoff: Zimpan mobile — progressive logging flow

## Overview
A mobile app for ZIMPAN (`bigjayenvy/zimpanapp`) whose core interaction is a **single progressive "add anything" form** — one flow that logs both time and money, 2–3 decisions per step, plus a live timer, an end-of-day gap review, first-run setup, insights, entry detail, and a donate path.

The goal is fewer than 10 seconds to log something, and **no keyboard unless the user chooses to type**. Every value the flow collects maps onto columns that already exist in `server/schema.sql`.

## About the design files
`Zimpan Mobile.dc.html` (plus its runtime `support.js`) in this bundle is a **design reference created in HTML** — a working prototype of the intended look and behavior, not production code to paste in. The task is to **recreate it inside the existing ZIMPAN app**: vanilla ES5-flavoured JS template strings in `app.js`, styled with the `ds/styles.css` token/class system, no build step, no framework. Do not introduce React or a bundler.

Open the file in a browser to drive the real flow; every screen described below is reachable by clicking.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and shadows are final and taken from `ds/styles.css`. Recreate pixel-for-pixel using the existing design-system classes wherever they cover the need (`.btn`, `.btn-primary`, `.card`, `.input`, `.tag`, `.seg`) and inline/token CSS only for what they don't (the timer card, the drag track, the gap bars).

Prototype canvas: a 393×852 phone viewport (iPhone 14/15 logical size). The dark desk background and device bezel in the file are presentation chrome — not part of the app.

---

## Screens / views

### 1. Sign in
- **Purpose**: entry point for new and returning users.
- **Layout**: full-bleed column, `padding: 0 28px 34px`, vertically centered, `gap: 26px`. Background `linear-gradient(180deg,#f8f7fb 0%,#efedf6 100%)`.
- **Components**:
  - **Brand lockup**: horizontal flex, `gap: 13px`. The 56×56 mark is `ds/favicon.svg` verbatim (rounded-28 rect filled with a `#a78bfa → #7856f5 → #4f46e5` diagonal gradient, white Z stroke `width 10`, two white `r=7.5` end caps), with `drop-shadow(0 10px 24px rgba(79,70,229,.34))`. Beside it the wordmark: `ZIMPAN` in Playfair Display 600, 30px, `letter-spacing: .02em`, `#16131f`, followed by a period in `#5f3ac9` — identical to `app.js` lines ~61 / ~3150 / ~3281.
  - **Headline**: "Where did / it all go?" — Playfair 700, 38px, `line-height: 1.05`, `letter-spacing: -.01em`.
  - **Sub**: Barlow 15.5px, `#575168`, `line-height: 1.5`, `max-width: 31ch`. Copy: "Log your time and money in a few taps. Zimpan finds the pattern for you."
  - **Primary button**: "Create an account" — full width, `min-height: 52px`, pill, brand gradient, `box-shadow: 0 6px 18px rgba(79,70,229,.34)`, Playfair 700 16px, white.
  - **Secondary button**: "Continue with Google" — white, `1px solid rgba(120,86,245,.42)`, text `#5f3ac9`.
  - **Footnote**: "Free forever · no ads · your data stays yours" — 12.5px `#756f88`.
- **Behavior**: **both** buttons go to first-run setup. (Google users need currency, categories, and sleep time just as much as email users; only auth differs.)

### 2. First-run setup — 3 steps
Chrome shared with the add flow: a 44px header row (back chevron `←` left, `STEP n OF 3` centered in 12px uppercase `.1em` `#756f88`, spacer right) above a 3-segment progress bar (`height: 4px`, pill, filled segments carry the brand gradient, empty are `#e0dce9`, `gap: 5px`). Body scrolls; the primary button is pinned in a `padding: 10px 22px 26px` footer.

Per-step heading: Playfair 700 26px; hint paragraph Barlow 14px `#756f88` with `margin-bottom: 22px`.

- **Step 1 — "First, the basics"** / "Two things and we are done with settings."
  - *Your name*: tap-to-type. Closed state is a left-aligned button, `min-height: 50px`, radius 16, white, `1px solid rgba(47,28,102,.12)`, placeholder text "Add your name" in `#756f88`. Tapping swaps it for a focused text input (`1.5px solid #7856f5`, `0 0 0 3px rgba(120,86,245,.18)`, autofocus).
  - *Currency for money tracking*: 3×2 grid, `gap: 8px`, `min-height: 46px`, radius 14. Options in order: **Dhs AED (default, selected)**, `$ USD`, `₱ PHP`, `€ EUR`, `S$ SGD`, `HK$ HKD`. Selected = brand gradient + white; unselected = white, `1px solid rgba(47,28,102,.12)`, text `#3b3648`.
  - Advance requires a currency (always satisfied by the default).
- **Step 2 — "What do you want to watch?"** / "Pick what Zimpan asks you about. Change it any time."
  - *Track cards*: full-width stacked rows, `gap: 10px`, `padding: 15px`, radius 16. Each has a 26px circular check (gradient + white ✓ when on, `#e8e6ef` when off), Playfair 700 16px title, 12.5px sub. Cards: Time / "Hours by activity", Money / "In and out", Steps / "From your phone", Meals / "What you ate". **Time and Money default on.** Selected card: background `#f2eefe`, border `1.5px solid #7856f5`.
  - *Starting categories*: wrapping pill chips with a 9px color dot. Defaults selected: Work, Health, Food, Rest (available: those plus Family, Learning). Dot color is the category color when unselected, white when selected.
  - *"+ Add category"*: dashed pill (`1px dashed rgba(120,86,245,.55)`, text `#7450e4`). Tapping reveals a row below: focused text input + a gradient "Add" button. Submitting appends the name to the chip list **already selected**, clears the input, and hides the row. Empty submit just closes it.
  - Advance requires ≥1 track.
- **Step 3 — "Two optional extras"** / "Both can stay empty — nothing here is required."
  - *Weight*: **text input** (`inputMode="decimal"`, digits and one dot only), placeholder "e.g. 68", with a static `kg` suffix label to its right. Helper: "Only used to estimate calories burned." → `users.weight_kg`.
  - *"What time do you usually sleep?"*: **text input**, placeholder "e.g. 10:30pm". Helper: "Sets where Zimpan stops counting your day." This is a new user setting (see Data mapping).
  - Footer shows "Start tracking" plus a "Skip both" ghost button; both land on Today **with an empty entry list**.

### 3. Today (home)
Scrolling column, `padding: 6px 22px 108px` (bottom clears the tab bar).
- **Header**: kicker "TUESDAY, 19 AUG" (12px, `.1em`, `#7450e4`, 600) over "Today" (Playfair 700 29px); 38px circular avatar `#e4dcfd` / `#472b97` initials on the right.
- **Logged-today card**: radius 20, brand gradient, `box-shadow: 0 14px 34px rgba(79,70,229,.3)`, white text. Two figures baseline-aligned — "LOGGED TODAY" + total duration (Playfair 700 32px) on the left, "MONEY OUT" + total on the right. Below, a **day-split bar**: `height: 9px`, pill, `gap: 3px`, one flex segment per time category sized by `flex-grow: <minutes>`, tinted white at descending opacity (`.94`, `.81`, `.68`…) largest-first, plus a final `rgba(255,255,255,.22)` segment for the unlogged remainder. Footer row: "Xh unlogged" and "N entries" at 11.5px. **This must be derived from the entries — an empty day shows only the faint remainder.**
- **Timer**: mutually exclusive states.
  - *Idle*: a **full-width gradient card** (same purple as the card above, radius 20, `padding: 18px`, same shadow) with a 46px translucent circle containing `▶`, "Start timer" in Playfair 700 21px, and sub "Track it live, name it after".
  - *Running*: white card, `1.5px solid #7856f5`, `0 8px 22px rgba(120,86,245,.18)`. A 10px `#7856f5` dot pulsing on a 1.4s ease-in-out loop; elapsed time in Playfair 700 30px with `font-variant-numeric: tabular-nums`; sub "Tracking since 2:18pm"; a pill "Stop" button on the right. Past 4h a third line appears in `#a8631a`: "Still going? You can trim it when you stop."
- **Quick actions**: two equal cards, `gap: 10px` — "Log time" (30px tile `#f2eefe`, `◷`, `#5f3ac9`) and "Log money" (tile `#eceefe`, **the active currency symbol**, `#3f4bc4`). Both Playfair 700 15px.
- **Gap banner** (only when gaps exist): `#efedf6` row, `1px solid rgba(120,86,245,.22)`, 34px hatched tile (`repeating-linear-gradient(115deg,#cbbcfa 0 6px,#e4dcfd 6px 12px)`), headline "Xh unaccounted for", sub "Review the day and fill the blanks", `→` in `#7450e4`. Opens the day review.
- **"Your day"** section header (Playfair 700 19px) with the entry count on the right.
- **Entry rows**: white, radius 16, `padding: 13px 14px`, `gap: 9px` between rows. Each has a 9×38px pill in the category color, title (600 15px, ellipsized), meta line (12.5px `#756f88` — `Category · 9am – 10:45am` for time, `Category · money out` for money), and a right-aligned value in Playfair 700 15px: duration for time, `−Dhs 22` / `+Dhs 3,200` for money (money-in renders `#1c8a63`). Tapping opens entry detail.
- **Empty state** (no entries): white card with `1px dashed rgba(120,86,245,.35)`, centered 46px `#f2eefe` tile with `◷`, "Nothing logged yet" (Playfair 700 19px), and "Start a timer for what you are doing now, or log something that already happened."
- **Donate card** at the bottom (see §7).

### 4. The add flow — "add anything", 4 steps
Same header/progress chrome as setup but 4 segments; label "STEP n OF 4". Step content is wrapped in a keyed container animating `zStep` (`opacity 0→1`, `translateY(10px)→0`, `.28s ease`) so each step slides in. Footer holds a pinned "Continue" (Playfair 700 16.5px, `min-height: 54px`, gradient pill); it reads "Save entry" on step 4 and "Back to today" on the success screen. When the step's requirement isn't met the button drops to `opacity: .42` and does nothing.

- **Step 1 — "What are you logging?"** / "Pick one — you can add the details next."
  - Two large tap cards, `padding: 16px`, radius 18, with a 44px icon tile: **Time** (`◷`, "Something you did") and **Money** (active currency glyph, "Something you spent or earned"). Selected card inverts to the brand gradient with white text and `0 10px 26px rgba(79,70,229,.3)`.
  - Below, "WHEN" pills: Today (default) / Yesterday / Earlier.
  - Requires a kind.
- **Step 2 — depends on kind.**
  - *Time — "What were you doing?"* / "Choose a category, then the activity." A 2-column grid of category cards (`min-height: 86px`, radius 16, 11px color dot, Playfair 700 15.5px name, 11.5px sub such as "deep + shallow"); selected = `#f2eefe` + `1.5px solid #7856f5`. Then "<CATEGORY> — USUAL ONES" activity pills drawn from that category (Work → Client call, Focus block, Email, Standup; etc.), plus a dashed **"Type it"** pill that reveals a focused text input ("What was it?"). Typing clears any picked pill and vice versa. Requires a category.
  - *Money — "How much?"* / "Tap the amount. No keyboard needed." A 2-option segmented pill (`#e8e6ef` track, gradient thumb): **Money out** (default) / Money in. Then the amount, centered, Playfair 700 52px — `#c3bfd0` at zero, `#16131f` for out, `#1c8a63` for in — with a hint line "Going out" / "Coming in". Below, a 3-column **numpad**: 1–9, `.`, 0, `⌫`; keys `min-height: 56px`, radius 16, white, Playfair 700 22px, active `#e4dcfd`. Rules: max 8 digits, only one decimal point. Requires amount > 0.
- **Step 3 — depends on kind.**
  - *Money — "What was it for?"* / "Purpose keeps the weekly split honest." Same category-card grid, purposes instead: Food, Transport, Bills, Health, Fun, Income. Requires a purpose.
  - *Time — "When was that?"* / "Start time and how long it ran."
    - **Warning strip** (conditional): `#fdf3e6`, `1px solid rgba(224,145,58,.35)`, text `#7a4a13`, with a "Halve it" button that rounds duration to the nearest 15 min of half its value. Shown when duration > 4h ("That is a long stretch. If the timer kept running after you stopped, trim it here.") or when `start + duration > 1440` ("This crosses midnight — Zimpan will split it across the two days.").
    - **Range card**: white, radius 20. Playfair 700 26px range label ("9am – 10:45am") with the duration in 13px `#7450e4` on the right.
    - **Draggable track** — the centerpiece. A 38px-tall hit area (`touch-action: none`, `user-select: none`, `cursor: grab`) containing: a 10px `#e8e6ef` rail at `top: 14px`; a gradient fill (`90deg, #8b5cf6 → #4f46e5`) positioned `left: (start-360)/1080` and `width: duration/1080`; and a 28px white handle with `2.5px solid #7856f5` and `0 4px 12px rgba(79,70,229,.35)`, centered on the fill's left edge. `pointerdown` on the track jumps the start time to that x and begins a drag; `pointermove` on `window` maps x across the 6am–12am span (1080 min) to a **1-minute** resolution, clamped so `start + duration ≤ 1439`; `pointerup` ends it. Under the rail, tick labels 6a / 12p / 6p / 12a in 10.5px `#9995ab`.
    - **"STARTED — HOUR"** with a "Use now" link (snaps to the current clock): 6-column grid of compact chips `6a…10p`, `min-height: 40px`, radius 12. Picking an hour preserves the current minutes.
    - **"MINUTES"** with a `−` / value / `+` control on the same row (34px circular buttons, `1px solid rgba(120,86,245,.4)`, `#5f3ac9`; value in Playfair 700 16px tabular-nums) stepping **1 minute** at a time, plus a 6-column grid of `:00`–`:55` chips at 5-minute steps.
    - **"FOR HOW LONG"**: wrapping chips 15m, 30m, 45m, 1h, 1h 30m, 2h, 3h.
    - Everything is bidirectional: dragging updates the hour chips and minute value live; chips and steppers move the handle.
- **Step 4 — "Look right?"** / "Tap anything to change it."
  - **Review card**: white, radius 20, one row per field — label 13px `#756f88` left, value 14.5px 600 right followed by a small `#7450e4` "edit" affordance. Tapping a row jumps back to the step that owns it. Time rows: What / Category / Time / When. Money rows: What / Amount / Purpose / When.
  - **Note**: dashed full-width "+ Add a note" button; tapping swaps it for a focused textarea (`min-height: 88px`, radius 16, placeholder "Anything worth remembering?"). A "Skip for now" ghost sits under the primary button while the note is closed.
  - Saving prepends the entry and moves to the success screen.
- **Success**: 78px gradient circle with a white ✓ (`zPop`: `scale(.9)→1`, `.3s`), "Time logged" / "Money logged" in Playfair 700 26px, and a contextual line — time: "You have logged 4h 30m today. 19h 30m still unaccounted for."; money: "That is Dhs 56 out today. Zimpan folded it into your week."

### 5. Day review (end-of-day gap fill)
- **Purpose**: close out the day by filling or dismissing unlogged stretches.
- Back link "← Today"; kicker "CLOSE OUT THE DAY"; headline "Xh unaccounted for" (Playfair 700 28px); sub "N stretches with nothing logged. Fill what you remember, mark the rest untracked."
- **Gap computation**: over time entries only, sorted by start, walking a cursor from **6:00am (360)** to **10:00pm (1320)**; any span ≥ **30 minutes** not covered by an entry is a gap. Overlapping entries advance the cursor by `max`.
- **Gap card** per stretch: white, radius 18. Range in Playfair 700 19px, length in 13px `#7450e4`; a hatched progress bar (`repeating-linear-gradient(115deg,#cbbcfa 0 7px,#e4dcfd 7px 14px)`) whose width is the gap length over a 4h reference; then two buttons — **"Fill this in"** (gradient pill; opens the add flow at step 2 with kind=time and that gap's exact start and duration prefilled) and **"Untracked"** (white pill; writes a `Rest`-category entry titled "Unlogged" with note "Marked as untracked" covering the span).
- **Cleared state**: `#efedf6` panel, ✓, "Nothing left open", "Every stretch from 6am is accounted for."

### 6. Insights
- Kicker "LAST 7 DAYS" over "The pattern" (Playfair 700 29px).
- **Time / Money segmented control** (`#e8e6ef` track, `padding: 4px`, gradient thumb, Playfair 700 14px).
- **Weekly bars card**: white, radius 20. Header row — metric label ("Hours logged per day" / "Spent per day") left, total right in Playfair 700 22px. Seven bars in a 118px-tall flex row, `gap: 8px`, `border-radius: 8px 8px 4px 4px`, heights normalized to the max; the last (today) is the gradient, the rest `#e4dcfd`; day initials beneath in 10.5px `#9995ab`.
- **"Where it went" card**: per-row label + value, then an 8px `#e8e6ef` track with a fill in the category color, widths normalized to the largest row.
- **"Noticed" panel**: `#efedf6`, one plain-language observation — e.g. "Work took 48% of your logged week, and every one of your four gym sessions started before 11am. Tuesdays are your longest days." Written as sentences, never a stat grid.
- **Donate card** at the bottom.

### 7. Donate
- **Card** (identical on Today and Insights): white, radius 20, `1px solid rgba(120,86,245,.25)`. "Zimpan is free, and stays free" (Playfair 700 19px); body "No ads, no paid tier, and nothing you log is ever sold. If it has been worth something to you, a small gift keeps it being built."; full-width gradient "Donate" pill.
- **Sheet**: bottom-anchored over `rgba(36,31,48,.5)`, white, `border-radius: 28px 28px 0 0`, `padding: 24px 22px 30px`, `0 -18px 44px rgba(47,28,102,.24)`, 38×4 grab handle, `zStep` entry. "Keep Zimpan going" + "Voluntary, one-off, and it buys no extra features — everyone gets the same app. Thank you either way." Then a 4-column amount grid (20 / 50 / 100 / 250 **in the active currency**, 50 preselected), a gradient "Give Dhs 50" button, and a "Not now" ghost.
- **Thanks state**: 66px gradient circle with ♥, "Thank you", "You will get a receipt by email. Nothing about your app changes — that is the point.", and "Back to Zimpan".
- **Wiring**: the real donate link is a plain PayPal checkout that reports nothing back. Tapping the primary button should increment `users.donate_clicks` and stamp `donated_click_at`, then hand off to PayPal; the thanks state stands in for the return trip. Actual money is still reconciled by hand into the `donations` table via the admin dashboard — keep `donate_clicks` (interest) and `donations` (money) separate, as the schema comment insists.

### 8. Entry detail
Back link "← Today"; white card, radius 22. A tag pill ("Time · Work" on `#f2eefe`/`#472b97`, or "Money · Food" on `#eceefe`/`#2f3893`), title in Playfair 700 27px, value in Playfair 700 40px (`#1c8a63` for money-in), a hairline `rgba(22,19,31,.12)`, then label/value rows — time: Category, Started, Ended, Date, Note; money: Purpose, Direction, Date, Note (empty notes render `—`). Below the card: "Edit" (white/violet pill) and "Delete" (white pill, `#8a2f4a` text, `1px solid rgba(138,47,74,.3)`).

### 9. Tab bar
Absolutely positioned, 92px tall, `padding: 0 26px 22px`, `linear-gradient(180deg, transparent, rgba(248,247,251,.96) 42%)` with `backdrop-filter: blur(8px)`. Three targets: **Today** (`◱`) — **center 58px gradient FAB `+`** raised 12px with `0 10px 24px rgba(79,70,229,.4)`, opening the add flow at step 1 — **Insights** (`◲`). Labels 11px 600; active `#7450e4`, inactive `#9995ab`. Hidden on setup, the flow, review, and detail.

---

## Interactions & behavior
- **Timer**: `▶` records `Date.now()` and the current wall-clock start minute, then ticks every 1s. Stop rounds elapsed to whole minutes (min 1) and opens the add flow at **step 2** with kind=time, start, and duration prefilled — so the only remaining work is naming it. A timer running > 4h warns on the card and again on step 3.
- **Keyboard discipline**: no input is focused unless the user taps a dashed "type" affordance, "+ Add a note", "+ Add category", the name field, or the weight/sleep fields. Everything else is taps, chips, the numpad, and the drag track.
- **Validation**: step 1 needs a kind; step 2 needs a category (time) or amount > 0 (money); step 3 needs a purpose (money) or duration > 0 (time); step 4 always passes. Disabled = `opacity: .42` + no-op, never a hard block or an error message.
- **Back**: chevron steps back one; from step 1 it exits and resets the draft. `✕` always exits and resets.
- **Animations**: `zStep` (.28s) per step; `zPop` (.3s) on the success check; `zPulse` (1.4s loop) on the timer dot; `.26s` `zStep` on sheets.
- **Currency**: one setting drives every formatted amount — entry rows, totals, detail, numpad display, insights, donate chips, and the two currency glyph tiles. Symbols: `Dhs ` (trailing space for amounts, trimmed for tiles), `$`, `₱`, `€`, `S$`, `HK$`. Amounts use `toLocaleString('en-US')` with 0–2 decimals.

## State
`screen` (signin | setup | home | insights | flow | review | detail) · `step` 1–5 · `setupStep` 1–3 · draft: `kind, day, cat, activity, activityText, typing, dir, amount, startMin, durMin, note, noteOpen` · timer: `timerStart, tick` · setup: `name, nameTyping, currency, tracks[], setupCats[], customCats[], catTyping, catText, weight, sleep` · `entries[]`, `selected` · `insightTab` · donate: `donateOpen, donateAmt, donateThanks`.

In the real app, `entries` comes from the existing local store (`zimpan.v1`) and the sync layer, not component state. Times are **minutes since midnight** throughout; format only at the edges.

## Data mapping (`server/schema.sql`)
| Design field | Column |
| --- | --- |
| Kind = Time | `entries` row |
| Activity / typed text | `entries.activity` |
| Category | `entries.category` (FK by name to `categories`) |
| Start / duration | `entries.from_min`, `entries.to_min` (both minutes since midnight) |
| Kind = Money | `money_entries` row |
| Amount + direction | `money_entries.amount_in` / `amount_out` (DECIMAL — never a float) |
| Purpose | `money_entries.purpose` |
| When (Today/Yesterday/Earlier) | `date` CHAR(10) `YYYY-MM-DD`, verbatim |
| Note | `entries.note` / `money_entries.note` |
| Onboarding categories incl. custom | `categories` rows (`name`, `color`, `position`) |
| Currency | `users.currency` (add `AED`, `SGD`, `HKD` to whatever the picker validates against) |
| Weight | `users.weight_kg` |
| Untracked gap | ordinary `entries` row, category `Rest` |
| Donate tap | `users.donate_clicks` + `donated_click_at` |
| Actual gift | `donations` (admin-entered) |

**Needs new columns:**
- *Sleep time* — no column exists. Add e.g. `sleep_min SMALLINT UNSIGNED NULL` on `users` and use it as the day-end bound for gap review (the prototype hardcodes 10pm/1320).
- *Running timer* — optional. Keeping it device-local is fine (it only becomes an `entries` row on stop). To have it survive a reload or show as running on the web, add `timer_start BIGINT NULL` and `timer_cat VARCHAR(60) NULL` on `users`.
- *Track toggles (Steps/Meals)* — if they should persist, one small JSON or bitfield column on `users`.

Everything else syncs with **no server work**: `sync.js` already resolves by `updated_at` (ms, last-write-wins) with `deleted` tombstones, and ids are client-minted, so the phone can log offline and reconcile later. Stamp `updated_at = Date.now()` on every write.

## Design tokens (from `ds/styles.css`)
- **Ground**: bg `#f8f7fb`, surface `#efedf6`, white panels, text `#16131f`, divider `rgba(22,19,31,.14)`.
- **Accent**: `#7856f5`, `#4f46e5`; brand gradient `linear-gradient(115deg,#8b5cf6 0%,#6d54f0 45%,#4f46e5 100%)`.
- **Accent ramp**: 100 `#f2eefe` · 200 `#e4dcfd` · 300 `#cbbcfa` · 600 `#7450e4` · 700 `#5f3ac9` · 800 `#472b97`.
- **Neutrals**: 200 `#e8e6ef` · 300 `#d5d2df` · 400 `#b8b4c6` · 500 `#9995ab` · 600 `#756f88` · 700 `#575168` · 800 `#3b3648`.
- **Category colors**: Work `#7856f5`, Health `#22a67a`, Food `#e0913a`, Family `#e05a8a`, Learning `#4f46e5`, Rest `#9995ab`; purposes Transport `#3f4bc4`, Bills `#756f88`, Fun `#e05a8a`, Income `#7856f5`.
- **Semantic**: money-in `#1c8a63`; warning `#fdf3e6` / border `rgba(224,145,58,.35)` / text `#7a4a13` / icon `#a8631a`; destructive `#8a2f4a`.
- **Type**: Playfair Display 600/700 for headings, numbers, and buttons; Barlow 400/500/600 for body. Sizes in use: 52 / 40 / 38 / 32 / 30 / 29 / 27 / 26 / 25 / 23 / 22 / 21 / 19 / 17 / 16.5 / 15.5 / 15 / 14.5 / 14 / 13.5 / 13 / 12.5 / 12 / 11.5 / 10.5. Uppercase micro-labels: 11.5–12px, `letter-spacing: .1em`, `#756f88`.
- **Radii**: pill `999px` for buttons/chips/segmented; 12 / 14 / 16 (controls, rows) / 18 / 20 / 22 (cards) / 28 (sheets).
- **Shadows**: sm `0 1px 2px rgba(47,28,102,.09)`; md `0 4px 14px rgba(47,28,102,.09)`; brand `0 6px 18px rgba(79,70,229,.32)`; card-lift `0 14px 34px rgba(79,70,229,.3)`; sheet `0 -18px 44px rgba(47,28,102,.24)`.
- **Hit targets**: nothing below 44px.

## Assets
- `ds/favicon.svg` — the brand mark, used verbatim on sign-in. Already in the repo.
- No other images. Glyphs (`◷ ▶ ✓ ♥ ← ✕ → ⌫ ◱ ◲ !`) are Unicode text; swap them for the repo's icon approach if one exists.

## Files
- `Zimpan Mobile.dc.html` — the full interactive prototype (all nine screens; every flow is clickable).
- `support.js` — the prototype's runtime. Needed only to open the HTML locally; **do not port it**.
