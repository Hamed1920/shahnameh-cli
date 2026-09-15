# Startup Guide

How to get the Shahnameh project running on a Windows computer. No technical knowledge needed.
Follow the steps in order and don't skip any.

---

## What you are starting

The project has **two programs**, and both need to be running at once:

| Program | What it does | Where you see it |
|---|---|---|
| **The Panel** | A web page where you look at generated images and videos and click **Accept** or **Deny** | In your web browser at `http://localhost:3000` |
| **The Worker** | Works in the background. Sends prompts to Higgsfield, downloads the results, and files away everything you accepted or denied | A black window full of text that scrolls |

The panel only *records* your decisions. The worker is what *acts* on them. **If the worker is
not running, nothing gets generated and nothing you click gets filed.**

> **Money warning.** The worker spends real Higgsfield credits. It checks the price of every job
> before running it, and it holds (does not run) any job over the limits in
> `10_PANEL\worker\config.json`: **250 credits for one job** and **1500 credits in total**. The
> total is remembered between starts, so restarting the worker does not reset it. Still, only
> leave it running when you mean to generate.

---

## Part 1 — One-time setup

Do this once per computer. If the computer is already set up, skip to **Part 2**.

### Step 1. Install Node.js

Node.js is the engine both programs run on.

1. Go to **https://nodejs.org**
2. Click the big **LTS** download button (LTS means the stable version).
3. Open the downloaded file and click **Next** on every screen, then **Install**, then **Finish**.
   The default choices are fine.
4. **Restart the computer.**

### Step 2. Learn how to open a command window in a folder

You will do this a lot, so learn it once:

1. Open **File Explorer** (the yellow folder icon on the taskbar).
2. Go to the folder you need, for example `D:\Digianzu\Shahnameh MODERN\Shahnameh CLI\10_PANEL`.
3. Click once on the **address bar** at the top, where the folder path is shown. The path turns
   blue.
4. Type `powershell` and press **Enter**.

A blue or black window opens. This is **PowerShell**, where you type commands. It is already
"inside" that folder.

**How to type a command:** type it (or copy it from this guide and right-click inside the
window to paste), then press **Enter**. Wait for it to finish before you type the next one.

### Step 3. Check that Node.js installed

Open PowerShell anywhere (Step 2) and type:

```
node -v
```

You should see a version number like `v24.19.0`. If you see *"not recognized"* instead, go back to
Step 1 and make sure you restarted the computer.

### Step 4. Install the Higgsfield tool

This is the program that talks to Higgsfield. In PowerShell, type:

```
npm.cmd install -g @higgsfield/cli
```

Wait until it finishes and you can type again. Check it worked:

```
higgsfield.cmd --version
```

You should see something like `higgsfield 1.1.24`.

### Step 5. Sign in to Higgsfield

```
higgsfield.cmd auth login
```

Your web browser opens a Higgsfield sign-in page. Sign in with the project's Higgsfield account
and approve access. Then go back to PowerShell and check:

```
higgsfield.cmd account status
```

It should show the account email, the plan, and how many credits are left, for example
`ultra plan, 7700.5 credits`.

> **Team workspaces only:** if the project runs under a shared Higgsfield workspace, run
> `higgsfield.cmd workspace list`. Copy the ID of the right workspace and run
> `higgsfield.cmd workspace set THE-ID`. If you use a personal account, skip this.

### Step 6. Install the panel's parts

Open PowerShell **inside the `10_PANEL` folder** (Step 2) and type:

```
npm.cmd install
```

This downloads everything the panel needs. It can take a few minutes, and warnings are
normal. You are done when you can type again.

**Setup is finished.** You never need to repeat Part 1 on this computer.

---

## Part 2 — Starting everything (every time)

You need **two PowerShell windows**, both opened inside the `10_PANEL` folder.

### Window 1: start the Panel

1. Open PowerShell in `D:\Digianzu\Shahnameh MODERN\Shahnameh CLI\10_PANEL`
2. Type:

   ```
   npm.cmd run dev
   ```

3. Wait until you see **`Ready`**. It takes about 10 seconds.
4. Open your web browser and go to **http://localhost:3000**

   The first page load can take 10–20 seconds. After that it's fast.

**Leave this window open.** Closing it shuts down the panel.

### Window 2: start the Worker

1. Open a **second** PowerShell window in the same `10_PANEL` folder.
2. Type:

   ```
   npm.cmd run worker
   ```

3. You should see a line saying `worker started`. After that it prints a line every time it does
   something: `COST` (the price it checked), `GENERATE` (it started a job), and `DOWNLOADED`
   (the result is ready to review).

**Leave this window open too.** A video can take several minutes to generate, and the window
may look like nothing is happening. That's normal.

### Everything is running when

- [ ] Window 1 says `Ready`
- [ ] Window 2 says `worker started`
- [ ] http://localhost:3000 shows the panel in your browser

---

## Part 3 — Using the Panel

The menu on the left has five pages:

| Page | What it's for |
|---|---|
| **Review** | New videos waiting for your decision, one at a time, in scene order. Watch it, choose **Accept** or **Deny** in the panel on the right, and click the button. If you deny, write a note saying what's wrong, for example *"they went to the wrong building, should be LOC-007"*. The worker uses your note to try again. |
| **Decided** | Everything you already accepted or denied, and where each file ended up. |
| **Index** | Every character, location, prop and so on in the project, with its ID number. |
| **Learnings** | Rules taken from your review notes. Nothing here is used until you **approve** it. Only approve rules you agree with. |
| **Queue** | What is waiting to be generated, and totals for generated, accepted and denied. |

**How videos work:** each video is first made as a cheap, low-quality **draft**. When you
**Accept** a draft, the worker automatically makes the same shot again in full quality (this costs
more). That full-quality version then shows up in **Review** for a final check.

### The References page

**References** in the menu shows every character, location, prop and so on, with all its
pictures ("looks": V01, V02…). The gold star marks the main look.

- **Find things:** pick a category on the left, type in the search box, or filter by status.
- **Open one:** click a card. A large window shows all its pictures big. Click pictures to select
  them; the buttons at the bottom act on what you selected.
- **Right-click** any picture or card for everything you can do with just that one (copy its
  reference, show in folder, make main, change role, move, archive, retire…). No selecting needed.
- **Select:** tick the box on a card to select the whole entity. Hover a picture and tick its box
  to select just that look. A bar appears at the bottom with what you can do:

| Selected | You can |
|---|---|
| Entities | **Retire** (hide it and stop it being used; nothing is deleted), **Restore**, set **Status**, **Copy @refs** |
| Looks | **Move to…** another entity, set **Role**, **Set as main** (one look), **Archive** (put away, can be restored), **Show in folder**, **Copy @refs** |
| Archived looks | **Restore** |

- **Edit** (pencil on a card): change the name, the words in the ID, the description, and the main
  look. The number (like `PRP-016`) never changes, so `@PRP-016` keeps working everywhere.
- **Add references** (top right), or **+** on a card: upload pictures as a new look of something,
  or as a brand-new entity.

Changes take a few seconds, even while a video is being made. The worker applies them, and a
message in the top-right corner says **Done** or explains what went wrong. Problem messages stay
until you close them with **×**.

Under each picture in the large window, **Used by** shows which videos use it:
- **generating now** or **queued**: that picture can't be archived or moved until the video is
  finished, so those menu items are greyed out and say *in use*.
- **waiting for review**: you can still archive or move it. The confirmation says what happens:
  that video switches to the entity's main look (or follows the picture to its new place), so
  redoing or finalising it still works. The **Done** message names every video that changed.

The worker must be running for changes to happen. If a red message says the worker isn't running,
or asks you to restart it, do that (Part 5, then Part 2, Window 2) and the waiting changes apply
straight away.

### The Review page, step by step

- **Top row:** every video waiting (P01, P03…), in scene order. Click one to jump to it. A dot is
  gold for a draft, green for a full-quality final, red if your last decision on it failed. `×3`
  means it is the 3rd attempt.
- **Left:** the video, its reference pictures numbered in the order the model receives them,
  and, for a retry, **Earlier attempts**: the old videos and the notes that sent them back. Click
  **Compare** on one to play the old and new video side by side.
- **Right:** the decision. It shows what the choice will cost, for example *"Regenerates this
  draft · ≈ 37.5 credits"*.
- **Undo:** after you submit, the next video appears and a message shows **Undo** for 6 seconds.
  Nothing is saved or spent until those seconds run out, so Undo really cancels it.
- New videos from the worker appear on their own. There's no need to refresh.

**Keyboard shortcuts** (when you're not typing in a box):

| Key | Does |
|---|---|
| **A** | Accept |
| **D** | Deny |
| **J** / **K** | Next / previous video |
| **Ctrl + Enter** | Submit (this one works while typing too) |

### Writing in Farsi

You can write the note and the tags in **Farsi** or English, all in the one box. The box switches to
right-to-left on its own. The note goes to the video model exactly as you wrote it.

### Pointing at a reference with @

Type **@** in the note, or click the small **@ Reference** button under it. A list opens with a
search box, showing **only the pictures under "References for the regeneration"**, numbered in the
order the video model receives them (#1, #2, #3…).

1. Type part of a name or ID to search, for example `flag`, `palace` or `LOC-007`.
2. Click the one you mean, or press **Enter**.

It goes into your note as its ID, like `@PRP-016/V01`, and a small gold label under the box shows
which picture it is. For example: *پرچم باید دقیقاً مثل @PRP-016/V01 باشد*.

When the video is made, the system tells the model exactly which attached picture you mean
(for example *"@Image3 (PRP-016 V01, Perisan (Iranian) Flag)"*), so it isn't guessing.

To point at a picture that isn't in the list yet, first add it under **References** (Add from
index, or Upload image). Then it appears in the **@** list. A red label under the box means you
typed a reference the job doesn't have. Add it or remove it before you submit.

### Changing the reference images

After you choose **Accept** or **Deny**, a **References** box appears under the note. The
reference images are the pictures the video model copies from. Here is what you can do with them:

| To | Do this |
|---|---|
| Stop using a picture | Hover over it and click **✕**. Click **Restore** if you change your mind. |
| Swap a picture for another one | Hover over it and click the **circular arrows**, then pick the new one. |
| Add a picture from the project | Click **Add from index**, search (for example `LOC-007` or `palace`), and click it. If it has several looks (V01, V02...), click the one you want. |
| Use a brand-new picture from your computer | Click **Upload image**, or drag the image into the box. PNG, JPG or WEBP only. |

For every uploaded picture, fill in the small form below it:

1. **New look of an existing entity:** the picture shows something the project already has,
   like a better picture of the palace. Click **Choose entity** and pick it.
   **A new entity:** it's something the project doesn't have yet. Choose the kind and type an
   English name.
2. **Role:** leave it as PLATE if you're not sure.
3. **Short description:** a few English words, like `night facade`. This becomes part of the
   file name.

The worker gives the picture its proper ID number and files it in the right folder. You never
have to name or move files yourself.

When the box says **Upload references for later**, the change can't affect this video: you
denied without *Regenerate*, or you accepted a finished full-quality video. Uploads are still
filed in the project for later use.

If the worker can't file an upload (for example, that name already exists), nothing is spent.
The video goes back to **Review** with a red message explaining why, so you can decide again.

---

## Part 4 — Checking the cost before generating (optional, recommended)

To see what the worker *would* spend **without spending anything**, stop the worker (Part 5),
then in the `10_PANEL` folder type:

```
npm.cmd run worker:dry
```

The last line shows the total, for example
`DRY-RUN TOTAL: 1 job(s), 37.5 credits`. If that number looks right, start the worker normally.

---

## Part 5 — Stopping everything

For **each** of the two PowerShell windows:

1. Click inside the window.
2. Hold **Ctrl** and press **C**.
3. If it asks `Terminate batch job (Y/N)?`, type `Y` and press **Enter**.

You can also just close the windows. That's safe too.

---

## Part 6 — Adding new prompts

New prompts are written in **Claude Chat** or **Claude Cowork** and then handed to
**Claude Code**, which runs inside this project folder. Claude Code gives out all the ID numbers,
so never make up an ID yourself.

In Claude Code, opened in the `Shahnameh CLI` folder:

| You want to | Type |
|---|---|
| See where the project stands | `/project-log` |
| Give a list of prompts, or a PDF/Word file of prompts | `/run-prompts`, then paste them or say which file |
| Send the project's current state to Claude Chat / Cowork | `/sync-out` |
| Bring prompt jobs back from Claude Chat / Cowork | `/sync-in`, then paste them |
| Check nothing is broken or misnamed | `/sync-check` |
| Turn your review notes into rules | `/learn` (then approve them on the **Learnings** page) |

New jobs go into the queue. The running worker picks them up by itself.

---

## Part 7 — Working from another computer

The whole project, every image and video included, is kept on GitHub, so another computer can
get a full copy and work on it.

### Getting the project onto a new computer (once)

1. Install **Git** from **https://git-scm.com**. Click **Next** on every screen. It includes
   *Git LFS*, the part that downloads the images and videos.
2. Open PowerShell in the folder where the project should live (Part 1, Step 2) and type:

   ```
   git lfs install
   git clone https://github.com/Hamed1920/shahnameh-cli.git "Shahnameh CLI"
   ```

   If it asks you to sign in to GitHub, use an account that has access to the project.
3. Do **Part 1** on that computer.

### The one rule: only one worker at a time

The **panel** can be open on as many computers as you like. The **worker** must run on **one
computer at a time**. Two workers would file the same things twice and can spend credits twice.

Open PowerShell in the `Shahnameh CLI` folder (not `10_PANEL`).

**Before starting the worker**, get the latest from the other computers:

```
git pull
```

**After stopping the worker**, and whenever you've made decisions in the panel, send your work:

```
git add -A
git commit -m "Review session"
git push
```

Decisions you click on a computer where the worker isn't running are only recorded there. Send
them (the commands above), run `git pull` on the worker's computer, and that worker acts on them.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| **"running scripts is disabled on this system"** | You typed `npm` or `higgsfield` without `.cmd`. Use `npm.cmd` / `higgsfield.cmd` as written in this guide. To fix it for good, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and type `Y`. |
| **"'node' is not recognized"** or **"'npm.cmd' is not recognized"** | Node.js isn't installed, or the computer wasn't restarted after installing. Redo Part 1, Step 1. |
| **Browser says "This site can't be reached"** at localhost:3000 | Window 1 isn't running, or hasn't said `Ready` yet. Start it (Part 2) and wait. |
| **"Port 3000 is in use"** | The panel is already running in another window. Use that one, or close all PowerShell windows and start again. |
| **"Cannot find module"** or **"next is not recognized"** | The panel's parts are missing. Do Part 1, Step 6 (`npm.cmd install` in `10_PANEL`). |
| **Worker says `HOLD ... not authenticated`** | The Higgsfield sign-in expired. Do Part 1, Step 5 again, then restart the worker. |
| **Worker says `A worker is already running`** | A worker is already open in another window. Only run one at a time. If you're sure no other worker window is open, try again. The worker clears a leftover lock by itself. |
| **Worker is quiet for a long time** | Usually normal, because videos take minutes. The full history is in `00_PROJECT\queue\worker.log`, which you can open with Notepad. |
| **Worker says `HOLD ... exceeds` or `would exceed costCeilingCredits`** | That's the safety limit working, and nothing was spent. Restarting won't change it. Once you've decided the spend is OK, ask Claude Code to raise the limit or reset the spent-credits counter. |
| **References page says "restart the worker"** | The worker was started before the panel was last updated, so it's missing the newest features. Wait until the worker isn't in the middle of a video (its last line isn't `GENERATE`), stop it (Part 5) and start it again (Part 2, Window 2). |
| **Nothing new appears in Review** | Check the worker window for a line starting with `ERROR`, and press **F5** in the browser. |
| **`git pull` or `git push` says "conflict" or "rejected"** | Two computers changed the same thing. Don't start the worker. Open Claude Code in the `Shahnameh CLI` folder and ask it to sort out the git conflict. |
| **Something else is wrong** | Open Claude Code in the `Shahnameh CLI` folder, paste the error text, and ask it to fix it. |

---

## Quick reference card

```
EVERY TIME — two PowerShell windows, both in ...\Shahnameh CLI\10_PANEL

  Window 1:   npm.cmd run dev          then open http://localhost:3000
  Window 2:   npm.cmd run worker

  Price only, spend nothing:   npm.cmd run worker:dry
  Stop a window:               Ctrl + C, then Y
  Credits left:                higgsfield.cmd account status
```
