# Susanin — MVP plan

Status: planning closed. Implementation starts with prototype P1 (§9); P2 and P3 are planned later as tracer bullets.

## 1. Goal

A handful of candidate Hong Kong tour guides (5–20 accounts, including the owner) drill the facts of one fixed 25-section Hong Kong Island coach tour. The exam is retelling 5 of the 25 sections plus a 100-question written test. V1 trains fact recall only; retell practice, the written test, spaced repetition and the one-time fact-checking worklist are out of scope ([ADR 0005](adr/0005-v1-scope-facts-only.md)).

## 2. Surfaces

| Surface | Where | Who |
|---|---|---|
| Bot | Telegram | invite gate, group choice, launcher |
| Learner app | `susanin.konev.hk/learn` (Mini App) | learners and admins |
| Admin app | `susanin.konev.hk/admin` (desktop web, Telegram OIDC) | allowlisted accounts |
| API | `susanin.konev.hk/api` | both apps, plus the bot webhook |
| Importer | one-off CLI on the VPS | owner |

Deployment, stack and offline-build decisions: [ADR 0001](adr/0001-two-clients-one-api.md), [ADR 0002](adr/0002-sqlite-single-process.md), [ADR 0004](adr/0004-caddy-systemd-single-origin.md).

## 3. Roles and onboarding

1. `/start` in the bot → invite code (from env; 20 failed attempts/hour per account) → group A–E (inline buttons) → "Open Susanin" button.
2. The invite code is entered in chat, once; membership is permanent. Group choice is required before access is granted.
3. Admins come from `ADMIN_IDS` (a whitelist row can also be added in-app). An admin is also a learner and picks a group like anyone.
4. Only an admin moves an account between groups.

## 4. Content model

```
Tour → Section (1–25, ordered by number) → Topic (ordered) → Field ×6
Group (A–E) ──< group_section >── Section        # a section belongs to at most one group
Account (telegram id) → Group
Field State: (account, field) → Learned | Unlearned        # absence = Untouched
```

- **Section**: number, name (seeded from the briefs heading, editable).
- **Topic**: name, position in the section, side (`left` · `supplementary` · `right` · unset).
- **Field**: `what` · `when` · `where` · `why` · `who` · `how`; each is authored text, *marked not applicable*, or still empty.
- **Field State** is per field and per account, carrying `graded_at`; there is no per-topic state.
- **Group**: exactly a set of sections; today each section belongs to at most one group. Scope is derived from the group ([ADR 0006](adr/0006-group-scoped-study-set.md)).

## 5. Import (once, at setup)

- **Briefs** are the topic source: only headings under a `Section NN` heading are imported; `Introduction`, `Background information` and the `USEFUL TOPICS` appendix are ignored. The section name comes from the section heading.
- **Syllabus** supplies a topic's **side** by fuzzy name match; its numbered items that no brief covers (e.g. *The Noonday Gun*) are imported as topics with all six fields **marked not applicable**, appended to that section.
- The importer refuses to run once any field state exists anywhere; `--reset` wipes content and progress and re-imports.
- Expected volume: 25 sections, 137 brief topics, ~820 fields.

## 6. Learner flow

Home shows the group label and three entries: **Learn New**, **Repeat Unlearned**, **Sections**.

A **run** walks whole sections in number order and shows one card per topic.

**Card**
- Header: `Section 7 · Topic 3 of 8`, topic name, side tag (`L` / `R` / `Supp`).
- One row per **gradeable** field (authored and not marked not applicable), in What → When → Where → Why → Who → How order. Rows start with no verdict — verdicts stored from earlier visits are not shown.
- Each row carries three controls: **Remember**, **Forgot**, and a separate **reveal** control.
  - Remember → green; the answer stays hidden.
  - Forgot → red **and** the answer expands; the reveal control collapses it again, keeping the verdict.
  - Reveal → shows or hides the answer without setting a verdict.
- **Next is always enabled.**
  - Every row has a verdict → the topic's verdicts are written, then advance.
  - Some rows have verdicts → confirm ("2 fields ungraded — leave and discard these marks?"), then advance without writing.
  - No rows have verdicts → advance immediately, nothing written.
- **Back** is always enabled and follows the same write rule and the same confirmation; Back on the first card leaves the run.
- **Exit** (X) always confirms, then returns Home.
- No drafts and no local persistence: a partial card's marks live only on screen, and returning to that card later starts it clean.
- Next on the last topic of a section continues into the next section's first topic; after the last card of the run, Home.
- A topic with no gradeable fields is skipped by the walk.

**Modes**
- *Learn New* walks every section of the group, every topic, every gradeable field.
- *Repeat Unlearned* uses exactly the same flow, over only those sections that hold at least one unlearned field; the walk is still in section-number order.
- *Sections* lists the group's sections (toggle **Show all 25**), each with a stacked bar and counts; tapping a row starts a run over that one section only. Sections outside the group are marked as such but can be trained.

## 7. Progress

- A section's bar covers its gradeable fields: learned / unlearned / untouched; empty and not-applicable fields never enter a denominator.
- Writes are atomic per topic, so a section's bar moves in topic-sized steps — there is no half-graded topic.
- `graded_at` is set on every write, so it means "last confirmed", not "first learned".
- Counts are shown numerically beside the bar; the bar is reference, not the goal.
- No leaderboards and no cross-learner visibility anywhere.

## 8. Admin app

- **Dashboard** — 25 rows, no pagination: number, name, topic count, authored / not-applicable / empty counts, status (`no topics` · `has empty topics` · `ready`).
- **Section edit** — rename section; per topic: rename, side, six field texts with an **N/A** chip per field, delete behind a confirm, add; drag to reorder; explicit **Save**.
- **Save with progress** — if changed topics carry graded fields, one dialog: *Keep progress* / *Reset progress*; dismissing cancels the save ([ADR 0003](adr/0003-save-time-reset-choice.md)).
- **Groups** — A–E, each with its section set; the count is shown for reference, with no validation.
- **People** — Telegram id, name, group (editable), and the number of sections the learner has touched.

## 9. Prototype P1 (separate track)

SvelteKit learner app, fake in-memory data (three sections, real Section 1 content), no backend, no bot, no Telegram — built and tested on a real phone through a browser. Purpose: whether the card is usable one-handed, whether Remember/Forgot placement and the reveal control work, and whether an always-on Next with the discard prompt feels like freedom or like a way to lose work. P2 (admin + SQLite) and P3 (importer) follow as tracer bullets.

Explicitly cut from P1: swipe gestures, read-only browse mode, drafts and local persistence.
