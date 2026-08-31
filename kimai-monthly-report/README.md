# Kimai Monthly Hours Report — Setup Guide

This Google Apps Script emails you a summary of your Kimai hours (total + breakdown by project/activity) automatically on the 1st of every month, covering the month that just ended.

The emailed report itself is in **German**. This README, and all the comments inside `KimaiMonthlyReport.gs`, stay in English as developer-facing documentation — only the text that actually lands in your inbox was translated.

It talks to your Kimai instance at `https://kimai.int.ict-scouts.ch` using the Kimai REST API (`GET /api/timesheets`), authenticating with a Bearer API token, and sends the email from your own Google account via `MailApp`. It also builds a PDF copy of the same report and attaches it to the email directly.

## 1. Get a Kimai API token

1. Log in to Kimai.
2. Open your user menu (top right) and go to the API token / API access page.
3. Click **Create** to generate a new token, and copy it immediately — Kimai only shows it once. Treat it like a password (don't share it, don't paste it anywhere public).

You already have one: `0662484447dd25c041eecd8c6`. If you're not sure it's still valid, generating a fresh one from Kimai costs nothing and is the safer bet.

## 2. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Delete the default placeholder code, then paste in the full contents of `KimaiMonthlyReport.gs`.
3. Rename the project (top left) to something like "Kimai Monthly Report".
4. Open **Project Settings** (gear icon) → check **Show "appsscript.json" manifest file in editor** if you want, and set the **Time zone** to `Europe/Zurich` so "the month" lines up with your local calendar.

## 3. Store your token (one-time)

1. In the function dropdown at the top of the editor, edit the `setup()` function first: replace `PASTE_YOUR_KIMAI_API_TOKEN_HERE` with your real token (and double-check the base URL / recipient email are correct).
2. Select `setup` in the function dropdown and click **Run** (▶).
3. The first time, Google will ask you to authorize the script (it needs permission to call external URLs and send mail). Review and accept.
4. Once it's run successfully, you can delete the token from the `setup()` function's source if you like — it's now safely stored in the project's Script Properties, not in the visible code. Re-run `setup()` any time you need to change it.

## 4. Install the monthly trigger

1. Select `createMonthlyTrigger` in the function dropdown and click **Run**.
2. Check **Triggers** (the clock icon in the left sidebar) — you should see `sendMonthlyKimaiReport` scheduled to run monthly, day 1, around 06:00.

That's it. From now on, on the 1st of every month you'll get an email with your Kimai hours for the month that just ended.

## 5. Test it now (optional but recommended)

Select `sendMonthlyKimaiReport` in the function dropdown and click **Run**. This sends you a report right away for *last* month, so you can check the numbers and formatting before waiting for the real trigger.

## `TRIGGER_NOW` flag

`setup()` also sets a `TRIGGER_NOW` property (`'true'` or `'false'`), read by `sendMonthlyKimaiReport()` every time it runs (both manual runs and the scheduled trigger):

- **`false` (default):** reports the previous full calendar month — the normal end-of-month behavior.
- **`true`:** reports *this* month so far — from the 1st through today. Useful for a quick month-to-date check.

To flip it: open `setup()`, change `TRIGGER_NOW: 'false'` to `TRIGGER_NOW: 'true'` (or back), run `setup()` again, then run `sendMonthlyKimaiReport()`. Remember to set it back to `'false'` afterward — otherwise the 1st-of-the-month trigger will keep sending month-to-date reports instead of full closed months.

## Work pensum (explained once, here — and once more at the top of the script)

`setup()` sets two properties for this:

- **`WORK_PENSUM_PERCENT`** — your work pensum as a percentage of a full-time role, e.g. `'15'` for a 15% pensum.
- **`WEEKLY_HOURS_FULLTIME`** — hours in a full-time (100%) work week, default `'42'`.

From these, the script calculates your *expected* hours for any period as `weeklyHours × (pensum / 100) × (days in period / 7)`, and the email shows:

- Right under the total: your expected hours for the reported period, how far over/under that you are, and what % of your pensum you reached.
- A "Pensum overview" table with one column per month, from **January through whichever is later: the reported month, or the month the script is actually running in** (see below). Three rows: hours worked, over/under, and % of pensum reached. Any month that isn't fully closed yet (a month-to-date column) has its expected hours prorated to the number of days elapsed, not the full month.

To change your pensum later, edit `WORK_PENSUM_PERCENT` in `setup()` and run `setup()` again — this is the only place it's set.

Note the script fetches one month at a time from January through the last column shown (one Kimai API call per month), not just the reported month — still quick for personal use, just worth knowing if you have a very large number of entries.

## The pensum table now also shows the month you're running it in

Previously the table stopped at the reported month (e.g. a normal run on 1 September only showed through August). Now it always also includes the month the script is actually executing in, even when that's later than the reported month — so that 1 September run shows August (the report) *and* September month-to-date as an extra column. When `TRIGGER_NOW: 'true'`, the reported month already *is* the current month, so there's nothing extra to add.

## Table layout: 6 months per row

Once the table has more than 6 columns (from around July onward), it now splits into two stacked blocks — the first 6 months in one mini-table, the rest in a second one below — instead of one increasingly cramped wide table. Each block still has the same three rows (hours worked / over-under / % of pensum).

## Layout: breakdown table before the total

The email shows the project/activity breakdown table first, with the "Total: …" line right below it.

## Colors, logo & stickers

The email is themed and branded using files from your own `styles/` folder, not guesses — including the `styles/colors` palette file you added:

- **Logo**: the official horizontal "ICT Scouts" wordmark, embedded directly in the script (`LOGO_BASE64`) and attached as an inline image via `MailApp`'s `inlineImages`, so it always shows up with no external hosting needed.
- **Sticker** (`styles/Stickers/`), embedded the same way, next to the total card: the "Digital Wizard" sticker, used in both the at/over and under pensum states, at the same size (144px) either way, and shown mirrored (flipped horizontally). The header smiley and the earlier "you can do it" sticker have both been removed.
- **Colors** (`getTheme()`):
  - Primary accent `#ABE8B1` (green) — used for the header ribbon, table headers, and borders. Text on top of it uses a dark green (`primaryText`) for readability, since the accent itself is light.
  - The total/pensum card is **always** background `#E4F8E6`, regardless of whether you're over or under pensum (only the thin border and the diff text still change color, so the signal isn't lost entirely). Its padding is kept tight so the card doesn't feel oversized.
  - The "% of pensum" number is always plain **black** text, with no background color. Instead of a colored pill, it's paired with a horizontal progress bar in three purple/lavender shades from `styles/colors` — `#dedefc` below 30% of pensum reached, `#C8C8FF` from 30–60%, solid `#5C4FC8` from 61% up. Next to the total it spans the full width of the line (so it's clear where the bar actually ends); in the pensum-overview table it's a small fixed-width bar per column.
  - Darker green `#079374` and red `#C1283A` are used as text/value colors throughout for over vs. under pensum: the total card's border/diff text, and now also every cell in the pensum-overview table's "Differenz" row (green when that month was over pensum, red when under).
  - The pensum-overview table's three rows ("Deine Stunden", "Differenz", "Pensum erreicht") all share the same font size and weight for a consistent look, and that font size (`TABLE_FONT_SIZE`, near `buildHistoryTableBlock`) also matches the project/activity breakdown table above it.
  - Next to the total, the over/under line reads **"Überschuss +Xh Ym"** when you're at or over pensum, or **"Minus: -Xh Ym"** when you're under.

If the brand colors ever change, everything lives in `getTheme()` (hex codes) — no other part of the script needs touching. To swap the logo or sticker image, replace the corresponding `*_BASE64` constant near the end of the file with a new base64-encoded PNG.

## Table layout details

- Month column headers are centered, and the hours cells in the "Deine Stunden" row always stay on one line.
- Thin vertical rules separate every column, in both the project/activity table and the pensum-overview table.
- A block with fewer months than a full row of six (e.g. a trailing Jul–Aug block) sizes itself to its own columns and sits flush left, rather than stretching to fill the card's full width.
- Every block uses `table-layout:fixed` with the same fixed column widths (`HISTORY_LABEL_COL_WIDTH`, `HISTORY_MONTH_COL_WIDTH` near `buildHistoryTableBlock`), so columns are guaranteed to line up exactly whether there are 6 months in a block or 2.
- **A real fix for a table cut-off bug (in the emailed HTML)**: with `table-layout:fixed`, a cell's declared width is its *content* width — padding is added on top, not absorbed into it. The previous column widths, once padding was accounted for, actually summed to more than the card's usable width, so the card's own `overflow:hidden` was silently clipping the rightmost month(s). Column widths, cell padding, and the table font size were all re-measured (with wkhtmltopdf, rendering the widest realistic value like `-128h 48m`) so a full 6-month row now fits with margin to spare; the label column (`HISTORY_LABEL_COL_WIDTH`) is tuned the same way, down to the narrowest width that still fits "Pensum erreicht" on one line.
- This column-width fix is for the **emailed HTML** specifically. The PDF's table layout is built completely differently and isn't affected by the same bug — see "PDF version" below.
- Below the month blocks, a **"Gesamtstunden zu viel/zu wenig"** row adds up the over/under difference of every listed month (January through the last column shown) into one running total for the year so far.

## PDF version

Each report also gets a PDF twin, attached to the email directly. This used to be a straight conversion of the emailed HTML (`Utilities.newBlob(html, 'text/html', ...).getAs('application/pdf')`), but that turned out to be unreliable for this report specifically: the real PDF it produced was missing the email's background colors entirely, and still cut off the pensum table's rightmost column(s) even after two rounds of tuning the HTML's margins and column widths. Apps Script's HTML→PDF conversion just isn't a full browser rendering engine, and — importantly — a local HTML→PDF tool (used earlier to test this) is *not* a faithful stand-in for it: the local tool rendered the same HTML correctly, colors and layout both, which is exactly why those two rounds of CSS tuning didn't fix the real thing.

The PDF is now built a completely different way: natively, as a temporary Google Doc (`DocumentApp`), not from the HTML at all. Table cell background colors and text colors are set directly through the Docs API (`TableCell.setBackgroundColor()`, `Text.setForegroundColor()`), and column widths are fixed point values on a wide landscape page — so both the colors and the layout are guaranteed by construction rather than depending on how some conversion engine happens to interpret CSS. The temporary Doc is exported to PDF (`DriveApp...getAs('application/pdf')`) and then immediately deleted (moved to trash) — it never sits around as a stray file in Drive.

Because it's a native Doc rather than a copy of the HTML, the PDF is a clean, correctly-colored, guaranteed-to-fit report rather than a pixel-identical twin of the email — a couple of small, deliberate differences: no rounded card corners or pill-shaped bar (replaced with simple rectangles/table cells), and the Digital Wizard sticker isn't mirrored the way it is in the email (Google Docs has no built-in image flip). Everything else — colors, structure, all the numbers — matches.

This is still best-effort: if building or exporting the PDF fails for any reason, the script logs the error and still sends the email normally, just without the attachment. It also means the script now needs Drive access (creating and deleting a file) in addition to Kimai/Gmail access — Google will ask you to authorize that the first time you run it, same as everything else in `setup()`.

Note for whoever runs this next: this PDF mechanism couldn't be tested against real Apps Script from this environment (no way to actually run `DocumentApp`/`DriveApp` here) — only checked for correct structure with a mocked-up test harness. Worth a look at the actual PDF after the next real run, just in case anything about the native-Doc layout looks off in practice.

## Notes

- The script only ever asks Kimai for **your own** timesheets (no `user` parameter is sent, so Kimai returns entries for the authenticated token's owner). If you later want it to cover other users, that requires the `view_other_timesheet` permission and passing a `user` or `users[]` parameter.
- If your Kimai account logs more than 100 entries in a month, the script pages through results automatically — no changes needed.
- If nothing arrives, check **Executions** (the play-with-clock icon in the left sidebar) for the error message; the most common cause is an expired/incorrect token or a typo in the base URL.
