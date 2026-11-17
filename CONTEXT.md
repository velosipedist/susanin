# Susanin

A study tool for a small group of candidate Hong Kong tour guides: each learner drills the facts of one fixed coach tour until they can recall them, while the tour's content itself is shared and corrected by admins.

## Language

**Tour**:
The single fixed itinerary under study, made of 25 sections. There are no tour variants.
_Avoid_: route, program, course, curriculum

**Syllabus**:
The table document that assigns each section's required items to the passengers' left, the supplementary column, or the passengers' right. It is the only source of a topic's side.
_Avoid_: table, plan, outline

**Brief**:
The detailed commentary document: prose entries, one per heading, carrying the facts and figures a guide says at that point.
_Avoid_: script, description, notes

**Section**:
A numbered block of the tour (1–25) with a name and an ordered list of topics. It is the unit a learner selects, trains, and sees progress for.
_Avoid_: chapter, lesson, group, deck

**Topic**:
One item of a section's commentary, at a fixed position in the route's order — a place, building, monument, event, or person. It is the unit a learner sees as one card.
_Avoid_: object, item, card, POI, entry, heading

**Side**:
Which column of the syllabus a topic belongs to — passengers' left, supplementary, or passengers' right. It tells the guide where to look or when to speak; it is displayed, never graded, and is unset when the syllabus does not name the topic.
_Avoid_: direction, position, column

**Field**:
One of the six prompts a topic is answered by: What, When, Where, Why, Who, How. When a topic is a person, Who describes the person, not the author, builder, or owner of a place.
_Avoid_: sub-card, point, sub-item, question, detail

**Marked not applicable**:
A field an admin has declared permanently unaskable for its topic, as opposed to one still waiting to be written. It is hidden from learners and excluded from progress and stats.
_Avoid_: empty, missing, N/A (as a value), placeholder

**Field State**:
A learner's most recent graded verdict on one field — Untouched, Learned ("I Remember"), or Unlearned ("I Forgot"). Revealing a field never changes its state; a whole topic's verdicts are written together or not at all.
_Avoid_: mastery, score, confidence, progress status

**Run**:
One pass through a set of sections, section by section in number order, showing every topic's card until the set is exhausted or the learner leaves. Entered from Learn New, Repeat Unlearned, or a single section.
_Avoid_: session, drill, lesson

**Group**:
A named cohort (A–E) whose learners study the same sections. Every account belongs to exactly one group, chosen once at onboarding; a section belongs to at most one group; only an admin moves a learner between groups, and moving touches no progress.
_Avoid_: cohort, team, class, batch, track

**Scope**:
The sections a learner studies: their group's sections.
_Avoid_: selection, plan, syllabus (for a task list), deck

**Fact check**:
The one-time admin job of verifying every imported topic's facts against current sources, tracked per topic in an admin-only worklist that learners never see.
_Avoid_: review, moderation, verification badge

**Account**:
A Telegram identity known to the system. One account may be a learner, an admin, or both; the roles are independent.
_Avoid_: user, member, person

**Learner**:
An account that has redeemed the invite code and owns its own scope, field states, and stats.
_Avoid_: student, trainee

**Admin**:
An account on the allowlist that may correct the tour's content. An admin's edit changes what every learner is studying.
_Avoid_: editor, owner, superuser

**Invite Code**:
A shared secret that admits a Telegram account into the tour, once, on first use. Membership persists afterwards.
_Avoid_: promo, promo code, password, passcode, token
