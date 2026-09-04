# Getting your health data into Personal OS — full beginner walkthrough

## What we're building, in plain terms

Your iPhone already tracks health stuff — steps, heart rate, sleep, weight, whatever you have connected to the built-in **Health** app. That data lives on your phone. Your Personal OS app lives on the internet and doesn't automatically see it.

So we're going to build a little "robot" on your phone using Apple's free **Shortcuts** app (it comes pre-installed on every iPhone — look for an icon that looks like colorful overlapping squares). This robot will, once a day: open the Health app's data, grab the numbers we care about, package them up, and send them over the internet to your Personal OS app. Then set it to run automatically twice a day so you never have to think about it again.

You don't need to install anything. You don't need to pay for anything. Total time: about 15–20 minutes the first time, since we're building it step by step and some of the taps are fiddly.

## Two pieces of information you'll paste in later (step 5)

Keep these two things handy — you'll copy-paste them into the shortcut in step 5. Don't share them with anyone; they act like a password letting something send data into your app.

- **Web address to send to:** `https://personal-os-v2-six.vercel.app/api/ingest/healthkit`
- **Secret code:** `<see HEALTHKIT_INGEST_SECRET in your .env.local>`

## Some vocabulary before we start

- **Shortcut** = the "robot" we're building. It's a little program made of a list of steps.
- **Action** = one single step in that list. Every action does one small thing (e.g. "look up my steps," "do math," "send this to a website"). We'll be adding actions one at a time.
- **Add Action** = the button (a **+** symbol) you tap to add a new step to your shortcut.
- **Variable** = a labeled box holding a piece of information one action produced, so a later action can use it. Think of it like a sticky note with a value written on it that you can point to later. When you tap on the output of one action and drag/insert it into a later action, you're using a variable.

## Step 1 — Open Shortcuts and create a new shortcut

1. On your iPhone home screen, find and tap the **Shortcuts** app (colorful overlapping squares icon). If you can't find it, swipe down on your home screen and type "Shortcuts" into the search bar.
2. You'll land on a screen with tabs at the bottom: **My Shortcuts**, **Automation**, **Gallery**. Make sure you're on **My Shortcuts**.
3. Tap the **+** button, usually in the top-right corner. This creates a new, empty shortcut and opens the shortcut editor — a blank canvas where you'll add actions.
4. At the top of this screen there's a name field (it may say "New Shortcut"). Tap it and rename it to **Sync Health to OS**. This name doesn't affect anything functionally, it's just how you'll find it later.

You're now looking at the shortcut editor. This is where we'll spend the rest of our time. Somewhere on this screen (usually bottom, sometimes floating) is an **Add Action** button, shown as a **+**. You'll tap this many times.

## Step 2 — Get today's date in the right format

We need to tell the app what date this data is for.

1. Tap **Add Action**. A search box appears — this searches through every possible action Shortcuts can do.
2. Type **Date** into the search box. Tap the action simply called **Date** (it represents "right now," and by default it's set to Current Date). It gets added as the first step in your shortcut, shown as a card/box.
3. Tap **Add Action** again. This time type **Format Date** and tap it. This adds a second step below the first.
4. Look at this new "Format Date" step. It needs to know WHICH date to format — tap into its **Date** field and choose the **Current Date** output from step 1 above (Shortcuts usually shows it as a suggestion right above the keyboard, or you can tap the little date-step icon in the field).
5. Still in this Format Date step, find **Date Format** and change it from whatever default to **Custom**.
6. A text field appears for the custom format. Type exactly: `yyyy-MM-dd` (lowercase, no spaces — this turns a date into something like `2026-08-30`).
7. Now, touch and hold (long-press) on the little result icon/pill for this Format Date step (it usually appears attached to the action or you can tap the output shown). A menu pops up — choose **Rename Variable**. Type `date` and confirm.

You've now got a variable named `date` holding today's date as text like `2026-08-30`. We'll use it later.

## Step 3 — Pull in your health numbers (repeat this pattern 10 times)

This is the longest part but every one of the 10 metrics follows the exact same two-move pattern, so once you've done the first one the rest go fast.

**The general pattern for each metric:**

A) Tap **Add Action**, type **Find Health Samples**, tap it to add it as a step.

B) Inside that new step, tap the **Sample Type** field (it might say "Steps" by default) and pick the correct type from the table below.

C) Depending on which "Mode" the table says for that row, do ONE of these two things:

- If it says **"Total, Today":** Inside the same Find Health Samples step, look for a filter/condition area (sometimes shown as "Date" or you tap a small filter icon) and set it so it only includes samples where **Date is Today**. Then tap **Add Action** again, search **Calculate Statistics**, add it, and set its operation to **Sum**. Feed it the result from the Find Health Samples step you just made (tap its input field and select that step's output). This adds up everything from today into one number.
- If it says **"Latest":** No separate action needed — just, inside the Find Health Samples step itself, look for **Sort** and set it to **Start Date**, then **Order: Latest First**, then **Limit** and set it to **1**. This means "just grab the single most recent reading," like your latest weight or heart rate.

D) Whichever action produced your final number (the Calculate Statistics step for "Total, Today" rows, or the Find Health Samples step itself for "Latest" rows), long-press its result → **Rename Variable** → type in exactly the name shown in the "Rename to" column below. Using these exact names now will make step 5 much easier and less error-prone.

Here's the full list — go through it one row at a time:

| # | Sample Type to select | Mode | Rename the result to |
|---|---|---|---|
| 1 | Steps | Total, Today | `steps` |
| 2 | Active Energy | Total, Today | `active_energy_burned` |
| 3 | Dietary Energy (might be labeled *Calories*) | Total, Today | `calories_consumed` |
| 4 | Protein | Total, Today | `protein_grams` |
| 5 | Resting Heart Rate | Latest | `resting_heart_rate` |
| 6 | Heart Rate Variability (confirm it says HRV or SDNN) | Latest | `hrv` |
| 7 | VO₂ Max | Latest | `vo2_max` |
| 8 | Body Mass (might be labeled *Weight*) | Latest | `weight` |
| 9 | Body Fat Percentage | Latest | `body_fat_percentage` |
| 10 | Sleep | Total, Today | `sleep_minutes_raw` |

**One extra move for Sleep only:** Apple stores sleep data in a way that needs converting. After you finish row 10 above (with the result named `sleep_minutes_raw`), tap **Add Action** once more, search **Calculate**, add it, and set it to divide `sleep_minutes_raw` by `60`. Long-press that result → **Rename Variable** → name it `sleep_minutes`. We'll use `sleep_minutes` (not the raw one) in the next step.

Don't worry if this feels slow — you're literally building a small program by hand, one Lego brick at a time. Once you're done, you'll have 11 variables total: `date`, `steps`, `active_energy_burned`, `calories_consumed`, `protein_grams`, `resting_heart_rate`, `hrv`, `vo2_max`, `weight`, `body_fat_percentage`, and `sleep_minutes`.

## Step 4 — What we're about to do: send it to the app

So far, everything we built stays on your phone — nothing has left it yet. This next step is the one that actually sends the data over the internet to your Personal OS app. It works like filling out and mailing an envelope: the address is the web link, the numbers are the letter inside, and there's a "password" attached (the secret) so the app knows the data really came from you and not a stranger.

1. Tap **Add Action**, search **Get Contents of URL**, tap to add it.
2. Tap the **URL** field at the top and paste in: `https://personal-os-v2-six.vercel.app/api/ingest/healthkit`
3. Look for **Show More** (sometimes an arrow or small triangle) and tap it — this reveals extra settings that are hidden by default.
4. Find **Method** and change it from **GET** to **POST**. (GET means "give me something," POST means "here, take this" — we're sending data, so we need POST.)
5. Find **Headers**. Tap to add a new header. For the key/name, type `Authorization`. For the value, type `Bearer ` (the word Bearer, then one space) followed immediately by the secret code from the top of this guide, so the whole value reads: `Bearer <YOUR_HEALTHKIT_INGEST_SECRET>`
6. Find **Request Body** and change it to **JSON**. A JSON body is just a structured way of listing "label: value" pairs — you're about to build that list.
7. You'll now see a way to **Add new field** (tap it once per row below). For each one, set the field name (left side) exactly as shown, set its type (Text vs Number) as shown, and then tap into the value side and insert the matching variable you created earlier (tap the field, and your earlier variables should appear as suggestions — tap the right one to insert it):

   - `date` — Text — insert your `date` variable
   - `source` — Text — don't insert a variable here, just type the literal word `shortcut`
   - `steps` — Number — insert your `steps` variable
   - `active_energy_burned` — Number — insert your `active_energy_burned` variable
   - `calories_consumed` — Number — insert your `calories_consumed` variable
   - `protein_grams` — Number — insert your `protein_grams` variable
   - `resting_heart_rate` — Number — insert your `resting_heart_rate` variable
   - `hrv` — Number — insert your `hrv` variable
   - `vo2_max` — Number — insert your `vo2_max` variable
   - `weight` — Number — insert your `weight` variable
   - `body_fat_percentage` — Number — insert your `body_fat_percentage` variable
   - `sleep_minutes` — Number — insert your `sleep_minutes` variable (the divided-by-60 one, not the raw one)

Don't stress if some day a field is blank or 0 — the app on the receiving end just ignores anything missing and updates whatever it did get.

## Step 5 — (Optional but recommended) See the result on screen

This lets you actually see what happened each time it runs, instead of it running silently.

1. Tap **Add Action**, search **Show Notification**, add it.
2. Tap its text field and insert the result/output of the **Get Contents of URL** step from Step 4 (the response that comes back from the app).
3. That's it — now every time this shortcut runs, a little notification will pop up showing you the app's reply.

## Step 6 — Test it once, right now

1. In the shortcut editor, find the **Run** button — usually a play-style button or "Run" text at the bottom of the screen.
2. Tap it. The very first time, iOS will pop up asking for permission to read your Health data. Tap **Allow**, then you'll likely see a list of categories (Steps, Heart Rate, Sleep, etc.) with toggles — turn ON every one you want synced (or just all of them).
3. If you added Step 5, you should see a notification appear with something like `{"ok":true,...}` — that means it worked and the app received your data.
4. If a number looks wrong later (say, sleep shows as hours instead of minutes, or a field always shows 0), it's almost always because the wrong Sample Type got picked in step 3 — just go back into that specific Find Health Samples action and double check/re-pick the type. Nothing is broken by testing it.

## Step 7 — Make it run automatically, twice a day

Right now this shortcut only runs when you manually tap Run. Let's make it run itself.

1. Go back to the main Shortcuts app screen (leave the editor — there's usually a "Done" or back arrow in the top corner).
2. At the bottom of the app, tap the **Automation** tab (different from "My Shortcuts").
3. Tap **+** to create a new automation.
4. Choose **Time of Day** as the trigger type.
5. Set the time to **11:59 PM**, and make sure it repeats **Daily**.
6. There will be a toggle called **Ask Before Running** — turn it **OFF**. This means it can run silently in the background without you having to approve it every single time.
7. Choose **Run Immediately** (as opposed to "Notify Me," which would just remind you to run it manually — we don't want that).
8. When asked which shortcut to run, pick **Sync Health to OS** — the one you just built.
9. Save it. Now repeat the whole process (steps 3–8 above) a second time, but set the time to **12:01 AM** instead.

Why two runs? The 11:59 PM run captures a nearly-complete day's worth of totals (steps, calories, etc.) right before the calendar flips over. The 12:01 AM run, one minute later, is really just there to refresh your point-in-time numbers (weight, HRV, resting heart rate, VO₂ max) fresh for the new day — its step/calorie totals will read close to 0 since the new day just started, and that's expected, not a bug.

That's the whole thing built and automated. From here it just runs quietly in the background every night.

## One thing worth knowing (not related to the Shortcut)

Separately from all this: Personal OS's AI features (chat, smart routing, voice transcription) are currently set up to talk to a program running on your own computer, which your live website on the internet can't reach — so those specific AI features are running in a simplified fallback mode for now. This doesn't affect the health sync above at all; it's a separate, optional thing to fix later if you want smarter AI responses.
