# V1 trains facts only: no retell mode, no written test, no spaced repetition

V1 drills the six fields of every topic and reports per-section recall. It deliberately excludes three things that a study tool would normally grow: section-level retell practice, the 100-question written test, and Leitner/SM-2 scheduling. The owner's reason, in their words, is that "the main point is to memorize the facts that could not be improvized or varied" — narrative rehearsal is not the skill being examined here.

The written test covers general Hong Kong history far beyond the 25 route sections and needs its own dataset and question model; it is tracked as a later, separate feature. Field states already carry `last_graded_at`, so adding review scheduling later needs no migration, and a future retell feature would add a section-attempt log rather than change any field state.
