<script lang="ts">
	import { onMount } from 'svelte';
	import {
		leaveAction,
		type FieldKey,
		type FieldStateValue,
		type SectionRun,
		type Verdicts
	} from '@susanin/shared';
	import {
		loadHomeForSession,
		loadLearnerHome,
		loadSectionRun,
		saveTopicProgress,
		type HomeResult
	} from '#lib/api';
	import { fieldLabel, sideLabel } from '#lib/card';
	import { overallStats, sectionStats } from '#lib/home';
	import { telegramWebApp } from '#lib/telegram';

	type LeaveAction = 'next' | 'back' | 'exit';

	let result = $state<HomeResult | null>(null);
	let note = $state('');
	let runError = $state('');
	let openingSection = $state<number | null>(null);

	let run = $state<SectionRun | null>(null);
	let cardIndex = $state(0);
	let verdicts = $state<Verdicts>({});
	let revealed = $state<FieldKey | null>(null);
	let saving = $state(false);
	let pendingAction = $state<LeaveAction | null>(null);

	onMount(async () => {
		const telegram = telegramWebApp();

		telegram?.ready();
		telegram?.expand();
		telegram?.setHeaderColor?.('#f1f4ee');
		telegram?.setBackgroundColor?.('#f1f4ee');

		result = await loadLearnerHome();
	});

	const home = $derived(result?.status === 'ready' ? result.home : null);
	const overall = $derived(home ? overallStats(home.sections) : null);
	const stops = $derived(home ? home.sections.map(sectionStats) : []);
	const firstName = $derived(home?.account.firstName ?? '');
	const group = $derived(home?.account.group ?? '');
	const longName = $derived(firstName.length > 15);

	const message = $derived(statusMessage(result));

	const card = $derived(run ? (run.cards[cardIndex] ?? null) : null);
	const cardFields = $derived(card?.fields ?? []);
	const cardCount = $derived(run?.cards.length ?? 0);
	const side = $derived(sideLabel(card?.side ?? null));
	const runPercent = $derived(
		cardCount === 0 ? 0 : Math.round(((cardIndex + 1) / cardCount) * 100)
	);
	const gradedCount = $derived(
		cardFields.filter((field) => isVerdict(verdicts[field.key])).length
	);

	function statusMessage(current: HomeResult | null): string {
		if (!current) return 'Loading your tour…';

		switch (current.status) {
			case 'onboarding-required':
				return 'Join the tour with the invite code in the bot, then choose your group.';
			case 'group-required':
				return 'Choose your group in the bot before opening Susanin.';
			case 'signed-out':
				return 'Open Susanin from the Telegram bot to sign in.';
			case 'ready':
			case 'unavailable':
				return 'Susanin is unavailable right now. Try again in a moment.';
		}
	}

	function isVerdict(value: FieldStateValue | undefined): boolean {
		return value === 'learned' || value === 'unlearned';
	}

	function preview(label: string) {
		note = `${label} is wired in the next build.`;
	}

	async function openSection(number: number) {
		if (openingSection !== null) return;

		openingSection = number;
		runError = '';
		note = '';

		const loaded = await loadSectionRun(number);
		openingSection = null;

		if (loaded.status === 'ready') {
			run = loaded.run;
			cardIndex = 0;
			resetCard();
			return;
		}

		runError =
			loaded.status === 'empty'
				? 'That section has no authored content to train yet.'
				: loaded.status === 'signed-out'
					? 'Your session has ended. Open Susanin from the bot again.'
					: 'That section could not be loaded. Try again in a moment.';
	}

	function resetCard() {
		verdicts = {};
		revealed = null;
		pendingAction = null;
		runError = '';
	}

	function grade(key: FieldKey, value: FieldStateValue) {
		verdicts = { ...verdicts, [key]: value };

		if (value === 'learned') {
			if (revealed === key) revealed = null;
		} else {
			revealed = key;
		}
	}

	function toggleReveal(key: FieldKey) {
		revealed = revealed === key ? null : key;
	}

	async function requestLeave(action: LeaveAction) {
		if (!card || saving) return;

		const rule = leaveAction(card.fields, verdicts);

		if (rule === 'confirm') {
			pendingAction = action;
			return;
		}

		if (rule === 'write') {
			const saved = await persist(card.id);
			if (!saved) return;
		}

		performLeave(action);
	}

	async function persist(topicId: number): Promise<boolean> {
		saving = true;
		runError = '';

		const outcome = await saveTopicProgress(topicId, verdicts);
		saving = false;

		if (outcome !== 'ok') {
			runError =
				outcome === 'rejected'
					? 'That card was not complete. Grade every fact and try again.'
					: 'Progress could not be saved. Try again in a moment.';
			return false;
		}

		await refreshHome();
		return true;
	}

	function performLeave(action: LeaveAction) {
		pendingAction = null;

		if (action === 'exit') {
			void closeRun();
			return;
		}

		if (action === 'back') {
			if (cardIndex > 0) {
				cardIndex -= 1;
				resetCard();
			}
			return;
		}

		if (cardIndex + 1 < cardCount) {
			cardIndex += 1;
			resetCard();
			return;
		}

		void closeRun();
	}

	async function closeRun() {
		run = null;
		cardIndex = 0;
		resetCard();
		await refreshHome();
	}

	async function refreshHome() {
		const refreshed = await loadHomeForSession();
		if (refreshed.status === 'ready') result = refreshed;
	}

	function confirmLeave() {
		const action = pendingAction;
		if (!action) return;
		performLeave(action);
	}
</script>

<svelte:head>
	<title>Susanin · Group {group}</title>
	<meta name="theme-color" content="#f1f4ee" />
</svelte:head>

{#if run && card}
<main class="run">
	<header class="run-header">
		<button
			class="chevron"
			type="button"
			aria-label="Back to home"
			onclick={() => requestLeave('exit')}
		>
			<span aria-hidden="true">‹</span>
		</button>
		<p class="run-count">Card {cardIndex + 1} of {cardCount}</p>
		<span class="run-spacer" aria-hidden="true"></span>
	</header>

	<div
		class="run-bar"
		role="progressbar"
		aria-label="Run progress"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={runPercent}
	>
		<span class="run-bar-fill" style:width={`${runPercent}%`}></span>
	</div>

	<article class="card" aria-labelledby="card-title">
		<p class="card-eyebrow">Section {run.section.number} · {run.section.name}</p>
		<h1 class="card-title" id="card-title">{card.name}</h1>
		<p class="card-meta">Topic {card.position} of {run.topicCount}</p>

		{#if side}
			<p class="side side-{side.align}">
				{#if side.arrow === '←'}←{/if}
				<span>{side.text}</span>
				{#if side.arrow === '→'}→{/if}
			</p>
		{/if}

		<ol class="facts">
			{#each card.fields as field (field.key)}
				<li
					class="fact"
					class:fact-learned={verdicts[field.key] === 'learned'}
					class:fact-unlearned={verdicts[field.key] === 'unlearned'}
				>
					<div class="fact-head">
						<span class="fact-label">{fieldLabel(field.key)}</span>
						<div class="fact-actions">
							<button
								class="verdict verdict-remember"
								class:chosen={verdicts[field.key] === 'learned'}
								type="button"
								aria-pressed={verdicts[field.key] === 'learned'}
								onclick={() => grade(field.key, 'learned')}
							>
								Remember
							</button>
							<button
								class="verdict verdict-forgot"
								class:chosen={verdicts[field.key] === 'unlearned'}
								type="button"
								aria-pressed={verdicts[field.key] === 'unlearned'}
								onclick={() => grade(field.key, 'unlearned')}
							>
								Forgot
							</button>
							<button
								class="reveal"
								type="button"
								aria-expanded={revealed === field.key}
								onclick={() => toggleReveal(field.key)}
							>
								{revealed === field.key ? 'Hide' : 'Show'}
								<span class="reveal-word"> answer</span>
							</button>
						</div>
					</div>
					{#if revealed === field.key}
						<p class="answer">{field.text}</p>
					{/if}
				</li>
			{/each}
		</ol>
	</article>

	{#if runError}
		<p class="run-error" role="alert">{runError}</p>
	{/if}

	<nav class="run-nav" aria-label="Card navigation">
		<button
			class="nav-back"
			type="button"
			disabled={cardIndex === 0 || saving}
			onclick={() => requestLeave('back')}
		>
			Back
		</button>
		<button class="nav-next" type="button" disabled={saving} onclick={() => requestLeave('next')}>
			{saving ? 'Saving…' : 'Next'}
		</button>
	</nav>
</main>
{:else if home && overall}
<main class="home">
	<header class="hero">
		<p class="eyebrow">Susanin · Group {group}</p>
		<h1 class="name" class:name-long={longName}>{firstName}</h1>
	</header>

	<section class="overall" aria-label="Overall progress">
		<p class="overall-value">
			{overall.percent}<span class="percent-sign">%</span>
		</p>
		<div class="overall-copy">
			<p class="overall-label">Overall</p>
			<p class="overall-detail">{overall.learned} of {overall.authored} facts learned</p>
			<div
				class="bar"
				role="progressbar"
				aria-label="Overall progress"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={overall.percent}
			>
				<span class="bar-fill" style:width={`${overall.percent}%`}></span>
			</div>
		</div>
	</section>

	<div class="entries">
		<button class="entry" type="button" onclick={() => preview('Learn new')}>
			<span class="entry-mark entry-mark-learn" aria-hidden="true">+</span>
			<span class="entry-text">
				<span class="entry-title">Learn new</span>
				<span class="entry-detail"
					>{overall.authored} {overall.authored === 1 ? 'fact' : 'facts'} across {home.sections.length}
					sections</span
				>
			</span>
			<span class="entry-chevron" aria-hidden="true">›</span>
		</button>

		<button class="entry" type="button" onclick={() => preview('Repeat gaps')}>
			<span class="entry-mark entry-mark-repeat" aria-hidden="true">↻</span>
			<span class="entry-text">
				<span class="entry-title">Repeat gaps</span>
				<span class="entry-detail">
					{#if overall.gapSections === 0}
						Nothing to repeat right now
					{:else}
						{overall.unlearned}
						{overall.unlearned === 1 ? 'fact' : 'facts'} left · {overall.gapSections}
						{overall.gapSections === 1 ? 'section' : 'sections'} with gaps
					{/if}
				</span>
			</span>
			<span class="entry-chevron" aria-hidden="true">›</span>
		</button>
	</div>

	<section class="stops" aria-labelledby="stops-heading">
		<h2 class="stops-heading" id="stops-heading">Your five stops</h2>
		<ol class="stop-list">
			{#each stops as stop (stop.number)}
				<li class="stop-item">
					<button
						class="stop"
						type="button"
						disabled={openingSection !== null}
						onclick={() => openSection(stop.number)}
					>
						<span class="stop-number">{stop.number}</span>
						<span class="stop-body">
							<span class="stop-line">
								<span class="stop-name">{stop.name}</span>
								<span class="stop-percent">{stop.percent}%</span>
							</span>
							<span
								class="bar bar-small"
								role="progressbar"
								aria-label="{stop.name} progress"
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={stop.percent}
							>
								<span class="bar-fill" style:width={`${stop.percent}%`}></span>
							</span>
							<span class="stop-counts">
								{stop.learned}/{stop.authored} learned{#if stop.unlearned > 0}
									· {stop.unlearned} to fix{/if}
							</span>
						</span>
						<span class="entry-chevron" aria-hidden="true">›</span>
					</button>
				</li>
			{/each}
		</ol>
		{#if openingSection !== null}
			<p class="home-note" aria-live="polite">Opening section {openingSection}…</p>
		{/if}
		{#if runError}
			<p class="home-error" role="alert">{runError}</p>
		{/if}
	</section>
</main>

<footer class="footer">
	{#if note}
		<p class="note" aria-live="polite">{note}</p>
	{/if}
	<button class="all-sections" type="button" onclick={() => preview('The full section list')}>
		<span>All 25 sections</span>
		<span class="entry-chevron" aria-hidden="true">›</span>
	</button>
</footer>
{:else}
<main class="status">
	<p>{message}</p>
</main>
{/if}

{#if pendingAction}
	<div class="dialog-backdrop">
		<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title">
			<h2 class="dialog-title" id="discard-title">Discard this partial card?</h2>
			<p class="dialog-copy">
				{gradedCount} of {cardFields.length} facts graded. Nothing on this card will be saved.
			</p>
			<div class="dialog-actions">
				<button class="dialog-cancel" type="button" onclick={() => (pendingAction = null)}>
					Keep editing
				</button>
				<button class="dialog-confirm" type="button" onclick={confirmLeave}>
					Discard and leave
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.status {
		max-width: 430px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
		text-align: center;
		color: #3c4a3f;
		line-height: 1.5;
	}

	.home {
		width: 100%;
		max-width: 430px;
		margin: 0 auto;
		padding: 2rem 1.15rem calc(9rem + env(safe-area-inset-bottom));
	}

	.hero {
		margin-bottom: 1.1rem;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #5f6f63;
	}

	.name {
		margin: 0;
		font-size: 2.5rem;
		line-height: 1.05;
		letter-spacing: -0.035em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.name-long {
		font-size: 1.25rem;
		letter-spacing: -0.01em;
	}

	.overall {
		display: flex;
		align-items: center;
		gap: 1.1rem;
		background: #fff;
		border: 1px solid #e1e7dc;
		border-radius: 22px;
		padding: 1.1rem 1.2rem;
		box-shadow: 0 8px 22px rgba(20, 34, 26, 0.05);
	}

	.overall-value {
		margin: 0;
		font-size: 2.4rem;
		line-height: 1;
		font-weight: 700;
		letter-spacing: -0.04em;
		color: #2f7d4f;
		font-variant-numeric: tabular-nums;
	}

	.percent-sign {
		margin-left: 0.05em;
		font-size: 1.2rem;
		font-weight: 600;
	}

	.overall-copy {
		flex: 1;
		min-width: 0;
	}

	.overall-label {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #5f6f63;
	}

	.overall-detail {
		margin: 0.15rem 0 0.55rem;
		font-size: 0.88rem;
		color: #3c4a3f;
	}

	.bar {
		display: block;
		height: 9px;
		border-radius: 999px;
		background: #e6ece2;
		overflow: hidden;
	}

	.bar-fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, #3f925f, #2f7d4f);
	}

	.bar-small {
		height: 7px;
	}

	.entries {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.9rem;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		width: 100%;
		background: #fff;
		border: 1px solid #e1e7dc;
		border-radius: 18px;
		padding: 0.9rem 1rem;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(20, 34, 26, 0.04);
	}

	.entry:active {
		transform: scale(0.995);
	}

	.entry-mark {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.35rem;
		height: 2.35rem;
		border-radius: 12px;
		font-size: 1.35rem;
		font-weight: 600;
	}

	.entry-mark-learn {
		background: #e3f1e6;
		color: #2f7d4f;
	}

	.entry-mark-repeat {
		background: #fdf1de;
		color: #a86a1f;
	}

	.entry-text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.1rem;
	}

	.entry-title {
		font-size: 1rem;
		font-weight: 650;
	}

	.entry-detail {
		font-size: 0.8rem;
		color: #5f6f63;
	}

	.entry-chevron {
		flex: none;
		font-size: 1.5rem;
		line-height: 1;
		color: #90a095;
	}

	.stops {
		margin-top: 1.6rem;
	}

	.stops-heading {
		margin: 0 0 0.55rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #5f6f63;
	}

	.stop-list {
		list-style: none;
		margin: 0;
		padding: 0;
		background: #fff;
		border: 1px solid #e1e7dc;
		border-radius: 22px;
		overflow: hidden;
		box-shadow: 0 8px 22px rgba(20, 34, 26, 0.05);
	}

	.stop-item + .stop-item {
		border-top: 1px solid #edf1e9;
	}

	.stop {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		width: 100%;
		padding: 0.85rem 1rem;
		border: 0;
		background: transparent;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.stop:disabled {
		cursor: progress;
		opacity: 0.7;
	}

	.stop-number {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.85rem;
		height: 1.85rem;
		border-radius: 50%;
		background: #f1f4ee;
		color: #4d5d52;
		font-size: 0.82rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.stop-body {
		flex: 1;
		min-width: 0;
	}

	.stop-line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.stop-name {
		font-size: 0.96rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stop-percent {
		flex: none;
		font-size: 0.82rem;
		font-weight: 700;
		color: #2f7d4f;
		font-variant-numeric: tabular-nums;
	}

	.stop .bar {
		margin-top: 0.4rem;
	}

	.stop-counts {
		display: block;
		margin: 0.35rem 0 0;
		font-size: 0.72rem;
		color: #6d7c71;
		font-variant-numeric: tabular-nums;
	}

	.home-note,
	.home-error {
		margin: 0.7rem 0 0;
		font-size: 0.8rem;
		text-align: center;
	}

	.home-note {
		color: #5f6f63;
	}

	.home-error {
		color: #a3342c;
	}

	.footer {
		position: fixed;
		inset: auto 0 0;
		z-index: 10;
		max-width: 430px;
		margin: 0 auto;
		padding-bottom: env(safe-area-inset-bottom);
		background: rgba(241, 244, 238, 0.94);
		border-top: 1px solid #e1e7dc;
		backdrop-filter: blur(10px);
	}

	.note {
		margin: 0;
		padding: 0.6rem 1.25rem 0;
		font-size: 0.78rem;
		color: #5f6f63;
		text-align: center;
	}

	.all-sections {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		padding: 1.5em 1.25em;
		border: 0;
		background: transparent;
		font: inherit;
		font-weight: 650;
		color: #14221a;
		cursor: pointer;
	}

	.all-sections .entry-chevron {
		font-size: 1.35rem;
	}

	.run {
		width: 100%;
		max-width: 430px;
		min-height: 100dvh;
		margin: 0 auto;
		padding: 0.9rem 1.15rem calc(6.5rem + env(safe-area-inset-bottom));
	}

	.run-header {
		display: grid;
		grid-template-columns: 2.5rem 1fr 2.5rem;
		align-items: center;
	}

	.chevron {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: 50%;
		background: transparent;
		font-size: 2rem;
		line-height: 1;
		color: #14221a;
		cursor: pointer;
	}

	.chevron:active {
		background: #e6ece2;
	}

	.run-count {
		margin: 0;
		text-align: center;
		font-size: 0.86rem;
		font-weight: 650;
		color: #4d5d52;
		font-variant-numeric: tabular-nums;
	}

	.run-spacer {
		width: 2.5rem;
	}

	.run-bar {
		display: block;
		height: 5px;
		margin: 0.35rem 0 1.1rem;
		border-radius: 999px;
		background: #e1e7dc;
		overflow: hidden;
	}

	.run-bar-fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: #2f7d4f;
		transition: width 180ms ease;
	}

	.card {
		background: #fff;
		border: 1px solid #e1e7dc;
		border-radius: 24px;
		padding: 1.2rem 1.1rem 0.5rem;
		box-shadow: 0 10px 26px rgba(20, 34, 26, 0.06);
	}

	.card-eyebrow {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #5f6f63;
	}

	.card-title {
		margin: 0.3rem 0 0;
		font-size: 1.55rem;
		line-height: 1.15;
		letter-spacing: -0.02em;
	}

	.card-meta {
		margin: 0.25rem 0 0;
		font-size: 0.78rem;
		color: #6d7c71;
	}

	.side {
		margin: 0.75rem 0 0;
		font-size: 0.82rem;
		font-weight: 650;
		color: #4d5d52;
	}

	.side-start {
		text-align: left;
	}

	.side-center {
		text-align: center;
	}

	.side-end {
		text-align: right;
	}

	.facts {
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
	}

	.fact {
		padding: 0.75rem 0;
		border-top: 1px solid #edf1e9;
	}

	.fact-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.fact-label {
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #5f6f63;
	}

	.fact-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.verdict {
		border: 1px solid #d9e1d4;
		border-radius: 999px;
		padding: 0.32rem 0.6rem;
		font-size: 0.72rem;
		font-weight: 650;
		background: #fff;
		color: #4d5d52;
		cursor: pointer;
	}

	.verdict-remember.chosen {
		border-color: #2f7d4f;
		background: #e3f1e6;
		color: #246640;
	}

	.verdict-forgot.chosen {
		border-color: #b4453b;
		background: #fbe8e6;
		color: #9c352d;
	}

	.fact-learned {
		background: linear-gradient(90deg, rgba(227, 241, 230, 0.65), transparent 70%);
	}

	.fact-unlearned {
		background: linear-gradient(90deg, rgba(251, 232, 230, 0.75), transparent 70%);
	}

	.reveal {
		border: 0;
		background: transparent;
		padding: 0.32rem 0.15rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: #5f6f63;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
		white-space: nowrap;
	}

	.answer {
		margin: 0.55rem 0 0;
		padding: 0.6rem 0.7rem;
		border-radius: 12px;
		background: #f6f8f3;
		font-size: 0.88rem;
		line-height: 1.45;
		color: #2c3a30;
	}

	.run-error {
		margin: 0.9rem 0 0;
		padding: 0.65rem 0.8rem;
		border-radius: 12px;
		background: #fbe8e6;
		font-size: 0.82rem;
		color: #9c352d;
	}

	.run-nav {
		position: fixed;
		inset: auto 0 0;
		z-index: 10;
		display: flex;
		gap: 0.7rem;
		width: 100%;
		max-width: 430px;
		margin: 0 auto;
		padding: 0.8rem 1.15rem calc(0.8rem + env(safe-area-inset-bottom));
		background: rgba(241, 244, 238, 0.96);
		border-top: 1px solid #e1e7dc;
		backdrop-filter: blur(10px);
	}

	.nav-back,
	.nav-next {
		border-radius: 14px;
		padding: 0.8rem 1rem;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	.nav-back {
		flex: 0 0 30%;
		border: 1px solid #d9e1d4;
		background: #fff;
		color: #3c4a3f;
	}

	.nav-back:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.nav-next {
		flex: 1;
		border: 1px solid #2f7d4f;
		background: #2f7d4f;
		color: #fff;
	}

	.nav-next:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.dialog-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 1.25rem;
		background: rgba(20, 34, 26, 0.42);
	}

	.dialog {
		width: 100%;
		max-width: 360px;
		background: #fff;
		border-radius: 20px;
		padding: 1.3rem 1.2rem 1.1rem;
		box-shadow: 0 18px 40px rgba(20, 34, 26, 0.24);
	}

	.dialog-title {
		margin: 0;
		font-size: 1.15rem;
	}

	.dialog-copy {
		margin: 0.5rem 0 0;
		font-size: 0.88rem;
		line-height: 1.45;
		color: #4d5d52;
	}

	.dialog-actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.1rem;
	}

	.dialog-actions button {
		flex: 1;
		border-radius: 12px;
		padding: 0.7rem 0.6rem;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 650;
		cursor: pointer;
	}

	.dialog-cancel {
		border: 1px solid #d9e1d4;
		background: #fff;
		color: #3c4a3f;
	}

	.dialog-confirm {
		border: 1px solid #b4453b;
		background: #fbe8e6;
		color: #9c352d;
	}
</style>
