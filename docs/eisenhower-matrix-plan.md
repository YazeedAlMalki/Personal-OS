# Eisenhower Matrix Module — Architecture Plan

**Alfred Personal OS v2**
**Date:** 2026-06-09
**Status:** Planning (pre-implementation)

---

## 1. Executive Summary

The Eisenhower Matrix module adds a **classification layer on top of the existing task system** — not a separate task store. Every task in `tasks` gets two new numeric scores (`urgency_score`, `importance_score`) and a derived `quadrant`. Classification is hybrid: deterministic rules run first (deadlines, user language, postpone history), AI fills gaps only when rules are ambiguous, and the user can always override. The module surfaces through three interfaces: Telegram (fast capture + quick review), a 2×2 dashboard grid (decision surface), and the Chief of Staff briefing (proactive nudges). MVP is deliberately narrow: schema migration, scoring logic, Telegram `/matrix` flow, and a static dashboard grid. Calendar/email/health integrations come later.

**Why this matters for Alfred specifically:** The existing capture pipeline already classifies by *kind* (task vs. idea vs. risk) and assigns a flat `priority` label. But priority alone doesn't answer "what should I do *right now*?" The Eisenhower Matrix adds a second axis — importance — and the interaction between the two axes is what produces actionable decisions: do, schedule, delegate, or drop.

---

## 2. Design Principles

1. **Classification layer, not a second task store.** The `tasks` table already exists with `priority`, `priority_score`, `due_date`, `postpone_count`, `status`, `source`, goal/project links. The Eisenhower module adds columns to this table. No new `eisenhower_tasks` table.

2. **Rules first, AI second.** A task with `due_date = tomorrow` is urgent — no model needed. A task linked to an active goal is important — deterministic. AI is for the ambiguous middle where language analysis adds value. This keeps classification explainable and auditable.

3. **Alfred doesn't invent facts.** Alfred never fabricates a deadline, never decides something is important without evidence, and never silently deletes or delegates. When Alfred lacks signal, it says so (low confidence) and asks.

4. **Capture stays fast.** The Telegram flow must not add latency or friction. Classification happens *after* the record is created. Clarification questions are batched and optional — Alfred asks only when the answer materially changes the quadrant.

5. **The dashboard is the decision surface; Telegram is the capture and triage surface.** Don't try to build a full task manager inside Telegram. Telegram shows the matrix snapshot; the dashboard lets you drag, reschedule, and batch-process.

6. **Corrections are training data.** Every user override (moving a task between quadrants) is stored and used to calibrate future scoring. The correction isn't just applied — it's explained (what did Alfred get wrong?).

7. **Degrade gracefully without AI.** The regex classifier + rule engine must produce usable quadrant assignments with no LLM running. AI improves accuracy, it doesn't enable the feature.

---

## 3. Proposed Data Model

### 3.1 MVP Fields (add to existing `tasks` table)

| Column | Type | Default | Purpose |
|---|---|---|---|
| `urgency_score` | `smallint` | `50` | 0–100. How time-sensitive. Driven by deadline proximity, explicit user language, external pressure. |
| `importance_score` | `smallint` | `50` | 0–100. How much it matters to goals/values. Driven by goal linkage, consequence weight, user language. |
| `quadrant` | `text` | `null` | One of `do_now`, `schedule`, `delegate`, `drop`. Derived from scores but can be overridden. CHECK constraint. |
| `quadrant_confidence` | `numeric(3,2)` | `0.5` | 0.00–1.00. How confident Alfred is in the quadrant assignment. |
| `quadrant_reason` | `text` | `null` | Human-readable explanation: "Due tomorrow + linked to active goal 'Ship MVP'". |
| `user_corrected_quadrant` | `text` | `null` | If user manually moved the task. Same enum as `quadrant`. |

**Why these six and not more:**

- `urgency_score` and `importance_score` are the two axes. Everything else derives from them.
- `quadrant` is denormalized for query speed (filter tasks by quadrant without computing scores on read).
- `quadrant_confidence` lets the review queue surface low-confidence assignments.
- `quadrant_reason` makes classification explainable — critical for user trust.
- `user_corrected_quadrant` separates the user's judgment from Alfred's. This is the training signal.

**Migration SQL (sketch, not final):**

```sql
alter table tasks
  add column urgency_score    smallint not null default 50 check (urgency_score between 0 and 100),
  add column importance_score smallint not null default 50 check (importance_score between 0 and 100),
  add column quadrant         text check (quadrant in ('do_now','schedule','delegate','drop')),
  add column quadrant_confidence numeric(3,2) not null default 0.50
                              check (quadrant_confidence between 0 and 1),
  add column quadrant_reason  text,
  add column user_corrected_quadrant text
                              check (user_corrected_quadrant in ('do_now','schedule','delegate','drop'));

create index tasks_quadrant_idx on tasks(user_id, quadrant) where status not in ('done','dropped');
```

### 3.2 Later Fields (post-MVP, add only when proven useful)

| Column | When to Add | Purpose |
|---|---|---|
| `consequence_if_missed` | When AI can extract this from context | Text describing what happens if this slips. Feeds importance scoring. |
| `deadline_source` | When calendar/email integrations land | Where the deadline came from: `user`, `calendar`, `email`, `inferred`. Helps audit AI-invented deadlines (which should not happen, but defense in depth). |
| `importance_source` | Same timing | What made it important: `goal_link`, `user_said`, `ai_inferred`, `high_value_contact`. |
| `delegatable` | When delegation workflows exist | Boolean. Alfred's suggestion, not auto-action. |
| `delegated_to` | Same | Contact reference. |
| `automatable` | When automation engine exists | Boolean. Could a script/bot handle this? |
| `snoozed_until` | When snooze UX is built | Date. Task hidden from matrix until then. |
| `energy_level` | When health integration lands | `low`, `medium`, `high`. What energy this task requires. |
| `last_reviewed_at` | When staleness detection runs | Timestamp. When user last looked at this task in the matrix. |
| `classification_version` | When classifier evolves | Int. Which version of the scoring logic produced the current scores. For recalculation. |

**Why delay these:** Each adds a column, migration complexity, and UI surface. None is needed to answer the core question: "What quadrant is this task in?" Add them when the system they depend on (calendar sync, health API, delegation workflow) actually exists.

### 3.3 New Table: `quadrant_corrections`

```sql
create table quadrant_corrections (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id         uuid not null references tasks(id) on delete cascade,
  from_quadrant   text not null,
  to_quadrant     text not null,
  reason          text,            -- optional: why the user disagreed
  created_at      timestamptz not null default now()
);
create index quadrant_corrections_user_idx on quadrant_corrections(user_id, created_at desc);
```

**Why a separate table instead of just `user_corrected_quadrant`?** History. If a user corrects the same task twice, you want both data points. This table is the training signal for improving scoring weights over time. It's also the audit trail that answers "how often does Alfred get it wrong, and in which direction?"

---

## 4. Classification Logic

### 4.1 Architecture: Layered Scoring

Classification runs as a pipeline of signal sources, each contributing evidence to the two scores. The pipeline is ordered from most deterministic to most speculative:

```
Layer 1: Hard rules (deadlines, explicit language)          ← always runs
Layer 2: Contextual rules (goal links, postpone history)    ← always runs
Layer 3: AI classification (language analysis)              ← runs if available
Layer 4: User correction (override)                         ← applied last
```

Each layer can *adjust* the scores set by previous layers. No layer starts from scratch — they're additive/corrective.

### 4.2 Urgency Scoring (0–100)

Urgency = "How soon must this be acted on?" Time is the primary axis.

| Signal | Score Contribution | Source | MVP? |
|---|---|---|---|
| Due today or overdue | Set to 90–100 | `due_date` vs. `now` | Yes |
| Due within 3 days | Set to 70–85 | `due_date` vs. `now` | Yes |
| Due within 7 days | Set to 55–70 | `due_date` vs. `now` | Yes |
| Due within 30 days | Set to 35–50 | `due_date` vs. `now` | Yes |
| No due date | Leave at default 50, reduce to 30 if no urgency language | absence of signal | Yes |
| User said "urgent/asap/now/immediately" | +30 (cap 100) | regex on title/description | Yes |
| User said "today/tonight" | Set to 85 | regex | Yes |
| User said "no rush/someday/eventually" | Set to 15 | regex | Yes |
| Postponed 3+ times | +15 | `postpone_count` | Yes |
| Calendar conflict within 24h | +20 | calendar integration | No |
| Email sender is VIP | +10 | email integration | No |
| Existing `priority` field = "urgent" | +20 | current classification | Yes |

**Pseudocode:**

```typescript
function scoreUrgency(task: Task, now: Date): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  // Layer 1: Deadline proximity (most authoritative)
  if (task.due_date) {
    const daysLeft = daysUntil(task.due_date, now);
    if (daysLeft !== null) {
      if (daysLeft < 0)       { score = 95; reasons.push(`Overdue by ${Math.abs(Math.round(daysLeft))}d`); }
      else if (daysLeft < 1)  { score = 90; reasons.push("Due today"); }
      else if (daysLeft < 3)  { score = 75; reasons.push(`Due in ${Math.round(daysLeft)}d`); }
      else if (daysLeft < 7)  { score = 60; reasons.push(`Due this week`); }
      else if (daysLeft < 30) { score = 40; reasons.push(`Due in ${Math.round(daysLeft)}d`); }
      else                    { score = 25; reasons.push(`Due in ${Math.round(daysLeft)}d — no rush`); }
    }
  }

  // Layer 1: Explicit language
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  if (/\b(asap|urgent|immediately|right now|critical)\b/.test(text)) {
    score = Math.min(100, score + 30);
    reasons.push("Marked urgent in text");
  } else if (/\b(no rush|someday|eventually|when possible|low priority)\b/.test(text)) {
    score = Math.min(score, 20);
    reasons.push("Explicitly low urgency");
  }

  // Layer 2: Postponement history
  if ((task.postpone_count ?? 0) >= 3) {
    score = Math.min(100, score + 15);
    reasons.push(`Postponed ${task.postpone_count}× — becoming urgent by neglect`);
  }

  // Layer 2: Existing priority field as weak signal
  if (task.priority === "urgent" && score < 70) {
    score = Math.max(score, 70);
    reasons.push("Priority set to urgent");
  }

  return { score: clamp(score, 0, 100), reasons };
}
```

### 4.3 Importance Scoring (0–100)

Importance = "How much does this matter to my goals, values, and long-term outcomes?" This is harder to score deterministically.

| Signal | Score Contribution | Source | MVP? |
|---|---|---|---|
| Linked to active goal | +30 | `related_goal_id` → goals.status = 'active' | Yes |
| Linked to active project | +15 | `related_project_id` → projects.status = 'active' | Yes |
| Goal has deadline within 30 days | +10 (on top of goal link) | goals.deadline | Yes |
| User said "important/critical/must/key/essential" | +25 | regex on title/description | Yes |
| User said "optional/nice to have/if time" | −20 | regex | Yes |
| Linked to high-value opportunity | +20 | `related_opportunity_id` → expected_value > Q3 | Yes |
| Category matches a top-3 goal category | +10 | task.category ∩ goals.category | Yes |
| No goal link, no importance language, no project link | Default 40 (below midpoint: ambiguous) | absence of signal | Yes |
| Linked to high-value contact | +15 | contact.relationship_strength ≥ 4 | Later |
| Health/sleep data suggests low capacity | −5 to importance of non-essential tasks | health integration | Later |

**Pseudocode:**

```typescript
function scoreImportance(task: Task, context: ScoringContext): { score: number; reasons: string[] } {
  let score = 40; // Default: slightly below midpoint = "we don't know"
  const reasons: string[] = [];

  // Layer 2: Goal linkage (strongest signal)
  if (task.related_goal_id && context.activeGoalIds.has(task.related_goal_id)) {
    score += 30;
    const goal = context.goals.get(task.related_goal_id);
    reasons.push(`Linked to active goal: "${goal?.title}"`);
    if (goal?.deadline && daysUntil(goal.deadline, context.now) !== null
        && (daysUntil(goal.deadline, context.now) ?? 999) < 30) {
      score += 10;
      reasons.push("Goal deadline within 30 days");
    }
  }

  // Layer 2: Project linkage
  if (task.related_project_id && context.activeProjectIds.has(task.related_project_id)) {
    score += 15;
    reasons.push("Linked to active project");
  }

  // Layer 2: Opportunity linkage
  if (task.related_opportunity_id && context.highValueOppIds.has(task.related_opportunity_id)) {
    score += 20;
    reasons.push("Linked to high-value opportunity");
  }

  // Layer 1: Explicit language
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  if (/\b(important|critical|must|essential|key|strategic|high.?impact)\b/.test(text)) {
    score += 25;
    reasons.push("Marked important in text");
  } else if (/\b(optional|nice to have|if time|low.?impact|minor)\b/.test(text)) {
    score = Math.max(10, score - 20);
    reasons.push("Explicitly optional");
  }

  return { score: clamp(score, 0, 100), reasons };
}
```

### 4.4 Quadrant Assignment

```
                    IMPORTANT (≥ 55)          NOT IMPORTANT (< 55)
URGENT (≥ 55)       Q1: DO NOW                Q3: DELEGATE
NOT URGENT (< 55)   Q2: SCHEDULE              Q4: DROP
```

**Why 55 and not 50?** A task at exactly 50 on both axes is genuinely ambiguous. Biasing the threshold slightly above center means borderline tasks fall into the less-aggressive quadrant (schedule/delegate rather than do-now). This prevents the "everything is Q1" failure mode.

**Confidence calculation:**

```typescript
function assignQuadrant(u: number, i: number): { quadrant: Quadrant; confidence: number } {
  const distFromUrgencyThreshold = Math.abs(u - 55);
  const distFromImportanceThreshold = Math.abs(i - 55);
  const minDist = Math.min(distFromUrgencyThreshold, distFromImportanceThreshold);

  // Confidence is high when both scores are far from the threshold.
  // At the threshold (dist=0), confidence bottoms at ~0.50.
  // At max distance (45 from threshold), confidence peaks at ~0.95.
  const confidence = clamp(0.50 + (minDist / 45) * 0.45, 0.50, 0.95);

  let quadrant: Quadrant;
  if (u >= 55 && i >= 55) quadrant = "do_now";
  else if (u < 55 && i >= 55) quadrant = "schedule";
  else if (u >= 55 && i < 55) quadrant = "delegate";
  else quadrant = "drop";

  return { quadrant, confidence: round(confidence, 2) };
}
```

### 4.5 Why Fixed Thresholds Can Fail

**Problem 1: Score inflation.** If most tasks are linked to goals (because the user is diligent about linking), importance scores cluster at 70–90 and everything is "important." The threshold becomes meaningless.

**Mitigation:** Relative scoring. Once per day (or on dashboard load), compute the user's score distribution and surface a warning if >60% of open tasks are in Q1. Suggest: "You have 15 tasks in Do Now. Consider whether some are actually Schedule."

**Problem 2: Urgency decay.** A task due in 30 days has urgency 40 today. In 27 days it's still 40 (due in 3 days → 75). The jump from 40 to 75 happens suddenly. The user gets no warning.

**Mitigation:** The Chief of Staff briefing already detects overdue tasks. Add a rule: "Task X enters the urgent zone in 3 days. Review now?" This is a *notification*, not an auto-reclassification.

**Problem 3: No deadline ≠ not urgent.** "File taxes" has a legal deadline the user hasn't entered. Alfred scores it as not-urgent because there's no `due_date`.

**Mitigation:** This is a data quality problem, not a classification problem. The clarification flow (§5) should ask about missing deadlines for tasks that look obligation-like. Never *infer* a deadline.

### 4.6 How AI Fits In

AI is used in **one specific place**: when rule-based scoring produces `quadrant_confidence < 0.65` and the task has no deadline, no goal link, and no explicit urgency/importance language. In that case, the AI classifier (already in `lib/ai`) is asked a follow-up:

```
Given this task: "{title}"
On a scale of 0-100:
- How time-sensitive is this? (urgency)
- How much does it matter to someone's long-term goals? (importance)
Output JSON: { urgency: number, importance: number, reasoning: string }
```

The AI's scores are blended with the rule-based scores at 40% weight (rules get 60%). This prevents the AI from overriding clear signals but lets it break ties.

**If no AI is available:** The task stays at its rule-based scores with the lower confidence. It appears in the review queue. The system is fully functional without AI — just less precise on ambiguous inputs.

---

## 5. Telegram UX

### 5.1 Design Constraints

- Capture must complete in one message + one reply. No multi-step wizards during capture.
- Clarification is *deferred* — Alfred files the task, then separately asks if needed.
- Commands are for *review*, not data entry. Nobody wants to type `/create_task --urgency=high --importance=...`.
- Inline keyboards are for quick overrides, not complex forms.

### 5.2 Flow A: Creating a Task from Text

**User sends:** `Call the insurance company tomorrow about employee coverage`

**Alfred replies:**

```
✅ Task created

Call the insurance company tomorrow about employee coverage

📅 Due: 2026-06-10
🔺 Priority: high
📊 Quadrant: DO NOW (87% confidence)
💡 Urgent: due tomorrow | Important: no goal linked (default)

[🔴 Do Now] [📅 Schedule] [👋 Delegate] [🗑 Drop]
[🔄 Review] [↩️ Undo]
```

**Key points:**
- The `quadrant_reason` is shown inline ("Urgent: due tomorrow | Important: no goal linked").
- The quadrant buttons let the user override immediately.
- "No goal linked (default)" is honest — Alfred admits when importance is a guess.

### 5.3 Flow B: Creating a Task from Voice

Identical to Flow A. iOS dictation sends text; the pipeline doesn't know or care that it was spoken.

### 5.4 Flow C: Creating a Vague Task

**User sends:** `Fix the thing`

**Alfred replies:**

```
🔍 Saved for review

Fix the thing

📊 Quadrant: SCHEDULE (52% confidence)
💡 No deadline, no goal link, vague description

Low confidence — I'll ask a follow-up.
```

**Then, 2 seconds later, Alfred sends a clarification:**

```
📋 About "Fix the thing":

What's the deadline?
[Today] [This week] [This month] [No deadline]

Is this linked to a goal?
[Ship MVP] [Health] [Finance] [None]
```

**Why two messages?** The first confirms capture happened (the user's input is safe). The second is optional — if the user ignores it, the task stays in "schedule" with low confidence and appears in the review queue. No data is lost.

### 5.5 Flow D: `/matrix`

**User sends:** `/matrix`

**Alfred replies:**

```
📊 Eisenhower Matrix

🔴 DO NOW (3)
• Call insurance — due tomorrow
• Fix deploy pipeline — overdue 2d
• Review contract — due Wed

📅 SCHEDULE (5)
• Write blog post — linked to "Build Audience"
• Research CRM tools — linked to "Scale Sales"
• + 3 more

👋 DELEGATE (1)
• Order office supplies — low importance

🗑 DROP (2)
• Organize old photos — postponed 5×
• Update LinkedIn — no goal, no deadline

⚠️ 2 tasks need review (low confidence)

[📋 Full list] [🔍 Review unclear] [📊 Stats]
```

### 5.6 Flow E: `/review`

Shows existing review queue (already built) plus low-confidence quadrant assignments:

```
🔍 Review queue (4 items)

1. "Fix the thing" → Schedule (52%)
   [✅ Correct] [🔴 Do Now] [👋 Delegate] [🗑 Drop]

2. "Check with Sarah" → Delegate (58%)
   [✅ Correct] [🔴 Do Now] [📅 Schedule] [🗑 Drop]

3. "Look into that API" → Drop (55%)
   [✅ Correct] [🔴 Do Now] [📅 Schedule] [👋 Delegate]

4. "Important meeting prep" → Do Now (61%)
   [✅ Correct] [📅 Schedule] [👋 Delegate] [🗑 Drop]
```

Each button press fires a callback that updates `user_corrected_quadrant`, logs to `quadrant_corrections`, and recalculates scores.

### 5.7 Flow F: `/correct last`

**User sends:** `/correct last`

**Alfred replies:**

```
Last task: "Call insurance company"
Current quadrant: DO NOW (87%)

Move to:
[📅 Schedule] [👋 Delegate] [🗑 Drop]

Why was I wrong? (optional)
```

If the user taps a button, the correction is applied. If they also type a reason, it's stored in `quadrant_corrections.reason`.

### 5.8 Clarification Triggers

Alfred sends a clarification message **only when all of these are true:**
1. `quadrant_confidence < 0.65`
2. The missing information would change the quadrant (not just the score)
3. The task was created in the last 5 minutes (don't ask about old tasks — that's for `/review`)
4. Alfred hasn't already asked a clarification for this task

**What Alfred asks about (in priority order, pick at most 2):**
1. Missing deadline (if urgency score is in the 40–60 ambiguous zone)
2. Missing goal link (if importance score is in the 35–55 ambiguous zone)
3. Task is too vague to classify (title < 5 words, no verbs, no nouns matched by any regex)

**What Alfred never asks about during capture:**
- Energy level, delegatability, estimated time, category — these are dashboard concerns.
- "Is this a project?" — valid question but not during capture. Surface this in the weekly review.

---

## 6. Dashboard UX

### 6.1 Layout

```
┌────────────────────────────────────┐
│  Eisenhower Matrix    [Filters ▾]  │
├──────────────┬─────────────────────┤
│  🔴 DO NOW   │  📅 SCHEDULE        │
│  (urgent +   │  (not urgent +      │
│   important) │   important)        │
│              │                     │
│  • Task 1    │  • Task 4           │
│  • Task 2    │  • Task 5           │
│  • Task 3    │  • Task 6           │
│              │                     │
├──────────────┼─────────────────────┤
│  👋 DELEGATE  │  🗑 DROP            │
│  (urgent +   │  (not urgent +      │
│   not imp.)  │   not important)    │
│              │                     │
│  • Task 7    │  • Task 8           │
│              │  • Task 9           │
│              │                     │
└──────────────┴─────────────────────┘
│  ⚠️ 3 tasks need review            │
└────────────────────────────────────┘
```

### 6.2 Task Card Contents

Each card in the grid shows:
- **Title** (truncated to 60 chars)
- **Due date** (if set; red if overdue, amber if ≤3 days)
- **Confidence badge** (green ≥80%, amber 65–79%, red <65%)
- **Goal tag** (if linked, shown as a small pill)
- **Postpone indicator** (if ≥2, show a small counter)

On hover/tap: shows `quadrant_reason` as a tooltip.

### 6.3 Interactions

**Drag and drop between quadrants:** This is the primary correction mechanism. When a user drags a task from Schedule to Do Now:
1. `user_corrected_quadrant` is set to `do_now`.
2. A `quadrant_corrections` row is logged.
3. Optionally, a small toast asks "Why? (optional)" with a text field. Most users will skip it.
4. The task card shows a small "manually placed" indicator so the user remembers they overrode Alfred.

**Click to open detail drawer:** Shows full task details, score breakdown (urgency: 72, importance: 45), each contributing factor listed, and edit controls for due date, goal link, description.

**Batch actions per quadrant:**
- **Q1 Do Now:** "Start timer" on a task. No batch action — these need individual attention.
- **Q2 Schedule:** "Schedule all" → opens a calendar view to drag tasks onto time blocks. (Post-MVP.)
- **Q3 Delegate:** "Mark all delegated" → prompts for delegate name. (Post-MVP. MVP: just a label.)
- **Q4 Drop:** "Drop all" → moves to status `dropped` with confirmation. "Snooze all" → sets `snoozed_until`. (MVP: drop only.)

### 6.4 Filters

- **Status:** Open (default), Done, Dropped, All
- **Source:** Telegram, Web, Manual
- **Confidence:** All, High only (≥80%), Low only (<65%)
- **Goal:** filter by linked goal
- **Time range:** Created today, this week, all time

### 6.5 Handling Failure Modes in the Dashboard

**Too many tasks in Q1 (>7):**
Show a yellow banner: "You have {n} tasks in Do Now. That's more than can realistically be done today. Consider moving some to Schedule." This is informational, not blocking.

**Stale tasks (no update in 14+ days, still open):**
Show a dim overlay on the card with "Stale — review?" Clicking opens a quick triage: [Still relevant] [Drop] [Snooze 7 days].

**Low-confidence tasks:**
Show below the grid in a "Needs Review" section (not inside the quadrants). This prevents polluting the matrix with unreliable classifications.

### 6.6 Explanation Panel

On the detail drawer, a section called "Why this quadrant?" lists:

```
Quadrant: DO NOW (87% confidence)

Urgency: 82/100
  + Due tomorrow (+90)
  
Importance: 65/100
  + Linked to goal "Ship MVP" (+30)
  + Linked to active project (+15)
  + Base (no explicit importance language) (+40)
  - Capped at 100

Threshold: Urgent ≥55 ✓  Important ≥55 ✓

Alfred's classification matched your past corrections 91% of the time
for tasks with similar signals.
```

This transparency is what builds trust. The user can see exactly why Alfred made its decision and which signal to change if they disagree (e.g., unlink from the goal, or push out the due date).

---

## 7. Integrations

### 7.1 Calendar (Phase 4)

**What it does:**
- Pulls deadlines from calendar events → creates tasks or updates `due_date` on existing tasks that match by title similarity.
- When user taps "Schedule" on a Q2 task, shows available time blocks from the calendar.
- Detects overpacked days (>6 hours of meetings + tasks) and warns.
- Flags tasks due during a blocked calendar slot.

**What it doesn't do (and why):**
- Auto-create calendar events from tasks. Reason: too aggressive. The user should confirm.
- Move calendar events. Reason: side effects on other attendees.

**MVP:** No calendar integration. Due dates are manually entered.

### 7.2 Email (Phase 5)

**What it does:**
- Surfaces email threads that look like tasks ("Can you send me...", "Please review...", "Deadline is...").
- Creates a *suggested* task (in the review queue, not auto-created).
- Identifies VIP senders (contacts with `relationship_strength ≥ 4`) and boosts urgency for their requests.

**What it doesn't do:**
- Auto-reply to emails.
- Create a task from every email. Reason: email task explosion. Most emails are informational.
- Extract deadlines from email without user confirmation. Reason: "end of week" means different things.

**MVP:** No email integration.

### 7.3 SMS / Bank Messages (Phase 5)

**What it does:**
- Payment deadline detection: "Your bill of X is due on Y" → creates task with due date and Q1 assignment.
- Subscription renewal alerts: "Your subscription renews on Y" → creates task in Q2 (important, not urgent yet).
- Filters out: OTPs, marketing, delivery notifications, balance alerts (these go to finance module, not tasks).

**What it doesn't do:**
- Process every SMS as a task. Reason: most SMS is noise.
- Expose bank account numbers or transaction details in task titles. Reason: security. Task title would be "Pay credit card bill" not "Pay Visa ****1234 SAR 2,500."

**MVP:** No SMS integration.

### 7.4 Health (Phase 5+)

**What it does:**
- Sleep score <60 → reduce urgency of Q3 tasks by 10 (they can wait; you need rest).
- Recovery score low → suggest postponing Q2 tasks that require high energy.
- Surface insight: "You've been averaging 5h sleep. Consider dropping low-priority tasks."

**What it doesn't do:**
- Override task quadrants based on health data. Reason: "I'm tired" doesn't make a legal deadline less urgent. Health data *suggests*, it doesn't decide.
- Create tasks from health metrics. Reason: "Drink more water" is a habit, not a task.

**MVP:** No health integration.

### 7.5 Fitness (Phase 5+)

**What it does:**
- Workout schedule as calendar blocks (affects available time for scheduling Q2 tasks).
- Recovery-aware: don't schedule high-energy tasks after intense workouts.

**What it doesn't do:**
- Treat every workout as an urgent task. "Go to gym" is a recurring habit, not a matrix item.
- Override real deadlines with fitness recovery suggestions.

**MVP:** No fitness integration.

---

## 8. Automations

### 8.1 Safe Automations (MVP or Near-MVP)

| Automation | Trigger | Action | Risk Level |
|---|---|---|---|
| Daily matrix summary | 7am cron (already exists as briefing) | Add quadrant counts and top Q1 tasks to Telegram briefing | Very low — read-only |
| Score recalculation | Task update, daily cron | Recompute urgency/importance when due_date changes or goal is linked | Low — only changes derived fields |
| Low-confidence review queue | Post-classification | Tasks with confidence <0.65 appear in review queue | Very low — existing pattern |
| Overdue urgency bump | Daily cron | Tasks past due_date get urgency_score recalculated (already high, but ensure it stays high) | Low |
| Stale task detection | Weekly cron | Flag tasks with no update in 14+ days as Chief of Staff insight | Very low — existing pattern |
| Quadrant notification | When a task crosses into Q1 (urgency climbs past threshold as deadline approaches) | Telegram message: "Task X is now in Do Now — due in 2 days" | Low — informational |

### 8.2 Risky Automations (Delay)

| Automation | Risk | Why Delay |
|---|---|---|
| Auto-delete Q4 tasks after 30 days | Data loss. "Someday" tasks may become relevant. | Wait until user has a proven habit of reviewing Q4 weekly. |
| Auto-delegate Q3 tasks | Side effects. Delegation requires human judgment about who, how, and context. | Wait until delegation workflow exists and user has explicitly opted in. |
| Auto-schedule Q2 tasks into calendar | Calendar pollution. Auto-created events without user review create mistrust. | Wait until calendar integration is proven and user trusts Alfred's scheduling. |
| Auto-create tasks from every email | Task explosion. Most emails are not tasks. | Wait until email classification accuracy is proven with a suggestion-only mode first. |
| Auto-classify every SMS | Noise. Most SMS is not actionable. | Wait until filter rules are tuned with user corrections over weeks. |
| Health-based quadrant adjustment | Overreach. "You're tired so I moved your deadline" is not acceptable. | Wait until user explicitly enables health-aware mode and understands the effects. |
| Auto-reclassify after user correction | Feedback loop risk. One correction shouldn't cascade to other tasks. | Wait until correction history has >50 data points and reclassification is explicitly opt-in. |

---

## 9. Edge Cases and Failure Modes

### 9.1 Everything Becomes Urgent

**Cause:** User adds due dates to everything, or uses "urgent" language habitually.
**Mitigation:** Dashboard warning when >50% of open tasks are in Q1 or Q3 (urgent row). Chief of Staff insight: "12 of 18 tasks are marked urgent. If everything is urgent, nothing is. Review your Do Now list." Don't auto-fix — this is a user behavior problem, not a system problem.

### 9.2 Everything Important Becomes Do Now

**Cause:** User links every task to a goal (good practice!) but the importance floor rises so high that combined with any urgency, everything is Q1.
**Mitigation:** Relative importance within goal-linked tasks. If 80% of tasks have importance ≥55, the effective threshold should surface a warning, not silently adjust. The user needs to decide which goal-linked tasks are *more* important than others.

### 9.3 AI Invents Deadlines

**Cause:** LLM infers "by Friday" from context like "the meeting is Friday."
**Mitigation:** Hard rule: `due_date` is ONLY set from explicit user input or a structured source (calendar event, email with parsed date). The AI classifier can suggest a date but it goes through the review queue, never directly to `due_date`. The `deadline_source` field (post-MVP) makes this auditable.

### 9.4 Task Is Actually a Project

**Cause:** "Renovate the kitchen" is not a task — it's dozens of tasks.
**Mitigation:** Heuristic: if the title contains words like "build", "launch", "redesign", "migrate", "implement" and has no specific deliverable in the title, Alfred suggests: "This looks like a project. Want to create it as a project and add tasks under it?" This is a suggestion, not auto-conversion.

### 9.5 Duplicate Tasks

**Cause:** User sends "call Sam" twice via Telegram, or captures the same item from email and Telegram.
**Mitigation:** Before inserting, check for existing open tasks with title similarity >80% (trigram similarity, `pg_trgm` extension already installed). If found, reply: "You already have 'Call Sam — re: contract'. Is this the same task?" with [Yes, skip] [No, create new].

### 9.6 Calendar Overpacking

**Cause:** Scheduling Q2 tasks fills every free slot, leaving no margin.
**Mitigation (post-MVP):** When suggesting schedule slots, enforce a configurable buffer (default: 25% of free time stays unscheduled). Surface: "You have 2 hours free tomorrow. Suggesting 1.5 hours of scheduled work, keeping 30 min buffer."

### 9.7 Email Task Explosion

**Cause:** Every email becomes a task suggestion.
**Mitigation (post-MVP):** Only surface emails that match task patterns (imperative language, deadline language, request patterns) from contacts with `relationship_strength ≥ 2`. All email-sourced tasks go to the review queue, never auto-created.

### 9.8 Delegation Fantasy

**Cause:** Q3 says "delegate" but the user has nobody to delegate to.
**Mitigation:** If the user is solo (no contacts with `category = 'team'`), relabel Q3 as "Batch/Minimize" instead of "Delegate." The point of Q3 is "don't spend deep focus on this" — batching and timboxing are solo-user equivalents of delegation.

### 9.9 Low-Value Task Hoarding

**Cause:** Q4 (Drop) accumulates hundreds of "someday" tasks that never get reviewed or dropped.
**Mitigation:** Weekly Chief of Staff insight: "You have {n} tasks in the Drop quadrant. Review and clear?" Monthly auto-suggestion: tasks in Q4 for >30 days with no update → "Still relevant? [Keep] [Drop]".

### 9.10 Contradictory User Corrections

**Cause:** User moves "Call Sam" to Do Now, then next day moves it to Schedule, then back to Do Now.
**Mitigation:** Store all corrections (that's what `quadrant_corrections` is for). If a task has ≥3 corrections, surface an insight: "You've reclassified 'Call Sam' 3 times. What's blocking you from completing or dropping it?"

### 9.11 Tasks with No Deadline but High Importance

**Cause:** "Write my will" is very important but has no urgency signal. It languishes in Q2 forever.
**Mitigation:** Q2 staleness detection. Tasks in Schedule for >21 days with no progress → Chief of Staff: "Important task stalling: 'Write my will' has been in Schedule for 3 weeks. Should Alfred suggest a deadline?" This is the entire point of Q2 — these tasks need *scheduling*, and the system should nudge the user to actually schedule them.

### 9.12 Tasks with Deadline but Low Consequence

**Cause:** "Return library book by June 30" has a deadline (urgent) but missing it costs $0.50 (not important). It shouldn't be Q1.
**Mitigation:** This is correct behavior — it's Q3 (urgent, not important). The system works as designed here. The user might feel weird seeing it in "delegate" but the label can be softened: "Quick tasks — batch these."

### 9.13 Recurring Tasks

**Cause:** "Take vitamins" or "Weekly team sync" — these repeat and don't fit the one-shot matrix model.
**Mitigation (post-MVP):** Recurring tasks are a habit or calendar concern, not an Eisenhower item. If a user captures a recurring task, suggest: "This seems recurring. Want to add it as a habit instead?" For MVP, recurring tasks are just tasks that the user re-creates manually.

### 9.14 Tasks Dependent on Another Person

**Cause:** "Wait for Sam's approval" — the user can't act on it regardless of quadrant.
**Mitigation:** Status `blocked` already exists. Blocked tasks should be excluded from the matrix view (or shown in a separate "Waiting" section). They don't have a meaningful quadrant until unblocked.

### 9.15 Tasks Requiring Location, Equipment, or Energy

**Cause:** "Fix the fence" requires being at home with tools. Putting it in Do Now while at the office is useless.
**Mitigation (post-MVP):** Context tags (location, tools, energy level) are a later feature. For MVP, the user handles this mentally. The matrix tells them *what* to do; *where/how* is their judgment.

---

## 10. MVP Scope

### 10.1 What's In

1. **Schema migration:** Add 6 columns to `tasks` + create `quadrant_corrections` table.
2. **Scoring functions:** `scoreUrgency()`, `scoreImportance()`, `assignQuadrant()` — pure TypeScript, fully testable, no LLM required.
3. **Scoring context builder:** Query active goals, projects, opportunities to feed into importance scoring.
4. **Pipeline integration:** After `routeRecord()` creates a task, run scoring and set quadrant fields.
5. **Telegram updates:**
   - Capture reply shows quadrant + confidence + reason.
   - Quadrant override buttons (Do Now / Schedule / Delegate / Drop).
   - `/matrix` command shows quadrant summary.
   - `/review` updated to include low-confidence quadrant assignments.
   - `/correct last` command.
6. **Dashboard page:** 2×2 grid, task cards, detail drawer with score breakdown, drag-and-drop between quadrants.
7. **Chief of Staff additions:** 2 new rules — "too many tasks in Q1" and "Q2 task stalling."
8. **Tests:** Unit tests for scoring functions, quadrant assignment, edge cases (overdue, no deadline, conflicting signals).
9. **Backfill script:** One-time script to score existing tasks and assign quadrants.

### 10.2 What's Out (explicitly)

- Calendar integration
- Email integration
- SMS/bank integration
- Health/fitness integration
- AI-enhanced scoring (regex rules only)
- Duplicate detection
- Recurring task handling
- Delegation workflow
- Auto-scheduling
- Auto-delete/auto-drop
- Snooze functionality
- Energy/location context
- Project-vs-task detection

### 10.3 MVP Checklist

```
[ ] Write migration SQL for 6 new task columns
[ ] Write migration SQL for quadrant_corrections table
[ ] Implement scoreUrgency() with deadline + language + postpone rules
[ ] Implement scoreImportance() with goal/project/opportunity links + language rules
[ ] Implement assignQuadrant() with confidence calculation
[ ] Implement buildScoringContext() to load active goals/projects/opportunities
[ ] Implement classifyQuadrant() orchestrator that chains the above
[ ] Integrate into capture pipeline (after task creation, score and update)
[ ] Update Telegram reply format with quadrant info + override buttons
[ ] Add quadrant override callback handler
[ ] Add /matrix command
[ ] Add /correct last command
[ ] Update /review to include low-confidence quadrants
[ ] Log corrections to quadrant_corrections table
[ ] Add Chief of Staff rule: too many Q1 tasks
[ ] Add Chief of Staff rule: Q2 stalling
[ ] Build dashboard page: 2×2 grid with task cards
[ ] Build detail drawer with score breakdown
[ ] Implement drag-and-drop between quadrants
[ ] Write backfill script for existing tasks
[ ] Unit tests: scoring functions (10+ cases)
[ ] Unit tests: quadrant assignment (threshold edges)
[ ] Unit tests: confidence calculation
[ ] Integration test: capture → score → quadrant
[ ] tsc + next build + vitest pass
```

---

## 11. Delayed Features

| Feature | Why Delay |
|---|---|
| Calendar sync | Requires OAuth for Google/Apple Calendar. Complex integration, irrelevant until the matrix itself is proven useful. |
| Email task extraction | Requires email integration (IMAP or API). High noise risk. Prove the matrix on manually captured tasks first. |
| SMS/bank parsing | Requires SMS access or forwarding setup. Privacy-sensitive. Not needed for core matrix value. |
| Health-aware scoring | Requires HealthKit/Fitbit integration. Marginal accuracy improvement vs. significant complexity. |
| AI-enhanced scoring | The regex classifier handles 70-80% of cases. AI improves the remaining 20%. That improvement isn't worth the dependency for MVP. |
| Duplicate detection | Useful but not blocking. Users naturally avoid exact duplicates. Fuzzy matching adds complexity and false positives. |
| Recurring tasks | A fundamentally different data model (habits vs. one-shot tasks). Shoehorning into the matrix creates confusion. Build the habit tracker separately. |
| Delegation workflow | Requires contacts with delegation capability, notification channels, and follow-up tracking. Only meaningful for users with teams. |
| Auto-scheduling | Requires calendar write access and trusted time estimates. Both prerequisites are absent in MVP. |
| Snooze | Nice-to-have but "set due date to next week" achieves the same effect manually. Add snooze when the matrix has enough daily use to justify the UI investment. |
| Project-vs-task detection | Useful insight but "that looks like a project" is a suggestion, not a feature. The Chief of Staff can surface it as an insight without any schema changes. |
| Energy/location tagging | Context-dependent scheduling is a Phase 5+ feature. The matrix answers "what matters" before "when/where to do it." |

---

## 12. Phased Build Plan

### Phase 1 — Schema and Scoring Engine (2–3 sessions)

1. Write and apply migration: 6 columns on `tasks`, `quadrant_corrections` table.
2. Implement scoring functions in `lib/eisenhower/score.ts`:
   - `scoreUrgency(task, now)`
   - `scoreImportance(task, context)`
   - `assignQuadrant(urgency, importance)`
   - `classifyQuadrant(task, context)` — orchestrator
3. Implement `buildScoringContext(supabase, userId)` — loads active goals, projects, high-value opportunities.
4. Unit tests: 15+ test cases covering deadline proximity, language detection, goal linkage, confidence edges, borderline scores.
5. Backfill script: score all existing tasks.

### Phase 2 — Pipeline Integration + Telegram (1–2 sessions)

1. Integrate scoring into `routeRecord()` → after task insert, call `classifyQuadrant()` and update the row.
2. Update Telegram capture reply: show quadrant, confidence, reason, override buttons.
3. Add callback handler for quadrant override buttons.
4. Add `/matrix` command.
5. Add `/correct last` command.
6. Update `/review` to include low-confidence quadrant assignments.
7. Log corrections to `quadrant_corrections`.
8. Update existing Telegram tests + add new ones.

### Phase 3 — Dashboard Matrix (2–3 sessions)

1. New page: `/dashboard/matrix` (or tab within existing dashboard).
2. 2×2 grid layout with task cards.
3. Detail drawer with score breakdown and explanation.
4. Drag-and-drop between quadrants (with correction logging).
5. "Needs Review" section below the grid.
6. Filters: status, source, confidence, goal.
7. Warning banners: too many Q1, stale tasks.

### Phase 4 — Chief of Staff Integration (1 session)

1. New rule: `tooManyQ1Tasks` — warns when >7 open tasks in Q1.
2. New rule: `q2Stalling` — flags Q2 tasks with no update in 21+ days.
3. New rule: `q4Hoarding` — flags when >10 tasks in Q4 for >30 days.
4. Include quadrant summary in the daily Telegram briefing.
5. Score recalculation cron: recompute urgency scores daily (deadline proximity changes).

### Phase 5 — Calendar Integration (future)

1. Calendar OAuth + event sync.
2. Due date import from calendar events.
3. "Schedule" action: suggest available time blocks for Q2 tasks.
4. Overpacking detection.

### Phase 6 — External Sources (future)

1. Email task suggestion pipeline (suggestion-only, review queue).
2. SMS/bank deadline detection.
3. VIP sender urgency boost.

### Phase 7 — Intelligence Layer (future)

1. AI-enhanced scoring for ambiguous tasks.
2. Learning from corrections (weighted adjustment to scoring rules).
3. Duplicate detection with `pg_trgm`.
4. Project-vs-task heuristic.

---

## 13. Open Questions Before Coding

1. **Q3 labeling for solo users.** Should Q3 be labeled "Delegate" (classic Eisenhower) or "Batch/Minimize" (more useful for a single user)? Recommendation: make it configurable, default to "Batch" for solo users.

2. **Score persistence vs. recomputation.** Should scores be stored and updated periodically, or computed on every read? Recommendation: store scores (current plan), recompute daily via cron + on task update. Computing on read is too slow for dashboard queries.

3. **Interaction between `priority` (existing) and `urgency_score` (new).** The existing `priority` field (low/medium/high/urgent) overlaps with urgency scoring. Should `priority` become a derived field from `urgency_score`? Recommendation: keep both for now. `priority` is the user-facing label; `urgency_score` is the internal numeric. Sync `priority` from `urgency_score` after classification: 0–30→low, 31–55→medium, 56–80→high, 81–100→urgent.

4. **Default quadrant for tasks without enough signal.** If a task has no deadline, no goal link, no urgency/importance language — what quadrant? Recommendation: `null` quadrant (unclassified), shown in the "Needs Review" section. Default scores of urgency=30, importance=40 would land in Q4 (Drop), which is too aggressive for a task Alfred knows nothing about.

5. **Backfill strategy.** Existing tasks have `priority` but no urgency/importance scores. Backfill based on current priority field? Recommendation: yes, as a rough starting point: urgent→urgency 85, high→70, medium→50, low→25. Importance defaults to 40 (unknown) unless goal-linked.

6. **Mobile dashboard.** The 2×2 grid works on desktop but may be cramped on mobile. Recommendation: on mobile, show quadrants as tabs or a vertical stack (Q1, Q2, Q3, Q4) rather than a grid.

---

## Appendix A: Classification Decision Tree

```
INPUT: task with title, description, due_date, priority, goal_id, project_id, opp_id, postpone_count

STEP 1: Score Urgency
  ├── Has due_date?
  │   ├── Overdue → urgency = 95
  │   ├── Due today → urgency = 90
  │   ├── Due in 1–3 days → urgency = 75
  │   ├── Due in 4–7 days → urgency = 60
  │   ├── Due in 8–30 days → urgency = 40
  │   └── Due in 30+ days → urgency = 25
  ├── No due_date
  │   ├── Text contains urgent/asap/now → urgency = 80
  │   ├── Text contains no rush/someday → urgency = 15
  │   └── No signal → urgency = 30
  ├── Postponed 3+ times? → urgency += 15
  └── Existing priority = "urgent"? → urgency = max(urgency, 70)

STEP 2: Score Importance
  ├── Linked to active goal? → importance += 30
  │   └── Goal deadline < 30 days? → importance += 10
  ├── Linked to active project? → importance += 15
  ├── Linked to high-value opportunity? → importance += 20
  ├── Text contains important/critical/essential → importance += 25
  ├── Text contains optional/nice-to-have → importance -= 20
  └── No signal → importance = 40 (below midpoint)

STEP 3: Assign Quadrant
  ├── urgency ≥ 55 AND importance ≥ 55 → DO NOW
  ├── urgency < 55 AND importance ≥ 55 → SCHEDULE
  ├── urgency ≥ 55 AND importance < 55 → DELEGATE/BATCH
  └── urgency < 55 AND importance < 55 → DROP

STEP 4: Compute Confidence
  └── Based on distance from thresholds (see §4.4)

STEP 5: Apply User Correction (if exists)
  └── Override quadrant, log to quadrant_corrections
```

---

## Appendix B: Build Order for Coding Agent

```
1.  supabase/migrations/0012_eisenhower.sql
2.  lib/eisenhower/types.ts          — Quadrant type, ScoringContext type
3.  lib/eisenhower/score.ts          — scoreUrgency, scoreImportance, assignQuadrant
4.  lib/eisenhower/context.ts        — buildScoringContext (loads goals/projects/opps)
5.  lib/eisenhower/classify.ts       — classifyQuadrant orchestrator
6.  lib/eisenhower/index.ts          — barrel export
7.  tests/unit/eisenhower-score.test.ts
8.  tests/unit/eisenhower-quadrant.test.ts
9.  lib/ingestion/route.ts           — integrate scoring after task insert
10. scripts/backfill-quadrants.ts    — score existing tasks
11. scripts/telegram-poll.ts         — update reply format, add /matrix, /correct, override buttons
12. tests/unit/telegram-matrix.test.ts
13. lib/chief/index.ts               — add 3 new rules
14. tests/unit/chief-eisenhower.test.ts
15. app/dashboard/matrix/page.tsx    — 2×2 grid page
16. components/matrix/              — MatrixGrid, TaskCard, DetailDrawer, QuadrantHeader
17. app/api/tasks/quadrant/route.ts  — API for drag-and-drop quadrant updates
18. tsc + next build + vitest
```
