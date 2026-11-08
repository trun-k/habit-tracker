# Habits

A single-user habit tracker. It installs on your phone and laptop, and every
entry lives in a Google Sheet you own.

The rules it is built on:

- One value per habit per day: a tick, a number, or blank.
- Logging is the win. No day is ever marked passed or failed.
- Blank means *not done* for yes/no habits and *no data* for numbers, so a
  missing number is a gap in the chart, never a zero.
- A benchmark is a reference line and a shading scale, nothing more.
- Days run midnight to midnight, and any past day stays editable.

## What is in here

```
app/                 the web app, deploy this folder as-is
  index.html
  app.css
  app.js
  sw.js              service worker, makes it work offline
  manifest.webmanifest
  icon-*.png
Code.gs              the Google Apps Script bridge
make-icons.py        regenerates the icons if you want to change them
verify.js            headless browser check of every screen
```

There is no build step. The `app/` folder is the finished site.

## Setup

### 1. The sheet

Create a blank Google Sheet. The script creates the `Habits` and `Entries`
tabs on its first run, so there is nothing to set up by hand.

### 2. The script

From inside that sheet, open **Extensions → Apps Script**. Replace the
contents of `Code.gs` with this repository's `Code.gs` and save.

Then **⚙ Project Settings → Script properties → Add script property**:

| Property | Value |
| --- | --- |
| `TOKEN` | a long random string you invent, 30+ characters |

Keep a copy of it. This is the only thing standing between the internet and
your data, so treat it like a password.

### 3. Deploy

**Deploy → New deployment → ⚙ → Web app**:

- Execute as: **Me**
- Who has access: **Anyone**

"Anyone" is required. Apps Script cannot answer the browser's CORS preflight
for a signed-in deployment, so "Anyone with a Google account" breaks the app.
Nothing is exposed by this: every request has to carry your token, and the
script refuses anything else.

Approve the permission prompts. Google will warn that the app is unverified
because you wrote it yourself; choose **Advanced → Go to project**.

Copy the **Web app URL** ending in `/exec`. Opening it in a browser should
show `{"ok":true,"service":"habit-tracker",...}`.

### 4. Host the app

The `app/` folder is plain static files. Any of these work and are free:

- **Cloudflare Pages** — create a project, drag the `app/` folder in.
- **GitHub Pages** — push `app/` to a repo, enable Pages on that branch.
- **Netlify Drop** — drag the `app/` folder onto netlify.com/drop.

It must be served over **https**, or the service worker and home-screen
install will not work.

### 5. Connect

Open the hosted URL. The setup screen asks for the web app URL and the token.
They are saved on that device and sent only to your own script.

Do the same on your laptop. Each device is set up once.

### 6. Install it

- **iPhone**: open in Safari, Share → Add to Home Screen.
- **Android**: open in Chrome, menu → Install app.
- **Laptop**: Chrome shows an install icon in the address bar.

## How it behaves

**Logging.** Today lists your habits in your order. A yes/no habit is one tap.
A number opens a small sheet with a keypad. The arrows at the top step back to
any earlier day, and the same editor works there.

**Offline.** The app opens from its own cache and keeps working with no
signal. Changes queue up on the device and sync when you are back; the
header says how many are waiting. Nothing is lost by closing the app.

**Look back.** Each habit has its own heatmap at three zoom levels, all of
them daily squares:

| Range | Layout |
| --- | --- |
| Month | A calendar, one square per day, with month arrows |
| 3 months | Thirteen weeks as columns |
| Year | Twelve month rows by day-of-month columns |

Yes/no habits are filled or empty. Numbers are shaded: against the benchmark
when there is one, otherwise across that habit's own low and high in view.
Days that have not happened yet are left out, not drawn as misses.

Below each heatmap, numbers with a benchmark get a bar chart with the
benchmark as a dashed line. Numbers without one get a dot-and-average chart.
Over a long span the dots are dropped and the 7-day average line carries it
alone. Tap any square to open that day for editing.

**Colour** is assigned automatically from a palette of ten, skipping red and
green so no colour ever reads as good or bad.

## The data

`Habits` tab, one row per habit:

`id`, `name`, `type` (`bool` or `number`), `unit`, `benchmark`, `color`,
`position`, `archived`

`Entries` tab, one row per habit per day:

`date` (`YYYY-MM-DD`), `habit_id`, `value`, `updated_at`

A blank day has no row at all; clearing a day deletes its row. Correcting a
day overwrites the existing row rather than adding a second one. Long format
means adding a habit never changes the sheet's shape.

The app is the only thing that should write to the sheet. You can read it
freely, and the three columns export anywhere.

## Backups

The sheet keeps Google's own version history. For a second copy, `Code.gs`
also includes `backupToDrive`, which writes both tabs as CSV files to a
"Habit tracker backups" folder in your Drive. To run it weekly: Apps Script →
**Triggers** → Add trigger → function `backupToDrive`, time-driven, week
timer.

## If something goes wrong

**"Bad token."** The token in the app does not match the `TOKEN` script
property. Habits → Connection settings to re-enter it.

**"Failed to fetch" or a CORS error.** The deployment is probably not set to
"Anyone". Check it, then **create a new deployment version** — editing an
existing one does not always take effect. The URL stays the same.

**Changes are not syncing.** The header says how many are waiting and offers
Retry. They stay on the device until they land, so nothing is lost.

**You changed the script.** Deploy → Manage deployments → edit → New version.
Otherwise the old code keeps serving.

**Rotating the token.** Change the `TOKEN` script property, then re-enter it
on each device under Connection settings.

## Checking the build

`verify.js` drives the real app in a headless browser against a stubbed
bridge, exercises every screen, and writes screenshots to `shots/`:

```
npm install playwright && npx playwright install chromium
node verify.js
```

## Notes on a few choices

**No framework and no build step.** The whole app is one HTML file, one
stylesheet and one script, so deploying is copying a folder, and there is no
toolchain to maintain or re-learn in six months. The architecture doc
suggested Preact with Vite; this is lighter and does the same job at this
size.

**localStorage, not IndexedDB.** A decade of daily entries for a dozen habits
is well under a megabyte, and the synchronous API keeps the code small. If
you ever outgrow it, the sheet remains the source of truth.

**Fonts load from Google Fonts.** Offline or on a slow connection the app
falls back to the system font stack and stays readable. To remove the
third-party request entirely, download Inter and Space Grotesk as woff2 into
`app/`, add `@font-face` rules to `app.css`, drop the `<link>` tags from
`index.html`, and add the font files to `SHELL` in `sw.js`.
