# A learner studies a group's five sections, not an arbitrary selection

Every account belongs to one of five groups (A–E), chosen once in the bot after the invite code. Each group holds a set of sections assigned in the admin app, and a section belongs to at most one group. Scope is derived from the group rather than typed in by the learner, the two study buttons draw only from the group's sections, and the Sections list can be widened to all 25 for targeted work.

Why: the exam draws five of the twenty-five sections per cohort, so the cohort — not the individual — decides what is in scope. The original design let each learner pick any sections, which produced progress that could not be compared across learners and queues that mixed exam material with sightseeing.

Consequences: onboarding must ask for a group; the admin app owns group→section assignment and can move a learner between groups; moving never touches progress, because field states are stored per field and account, not per scope.
