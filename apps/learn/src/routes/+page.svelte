<script lang="ts">
	import { onMount } from 'svelte';
	import { loadLearnerHome, type HomeResult } from '#lib/api';
	import { overallStats, sectionStats } from '#lib/home';
	import { telegramWebApp } from '#lib/telegram';

	let result = $state<HomeResult | null>(null);
	let note = $state('');

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

	const message = $derived(
		result === null
			? 'Loading your tour…'
			: result.status === 'onboarding-required'
				? 'Join the tour with the invite code in the bot, then choose your group.'
				: result.status === 'group-required'
					? 'Choose your group in the bot before opening Susanin.'
					: result.status === 'signed-out'
						? 'Open Susanin from the Telegram bot to sign in.'
						: 'Susanin is unavailable right now. Try again in a moment.'
	);

	function preview(label: string) {
		note = `${label} is wired in the next build.`;
	}
</script>

<svelte:head>
	<title>Susanin · Group {group}</title>
	<meta name="theme-color" content="#f1f4ee" />
</svelte:head>

{#if home && overall}
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
				<li class="stop">
					<span class="stop-number">{stop.number}</span>
					<div class="stop-body">
						<div class="stop-line">
							<span class="stop-name">{stop.name}</span>
							<span class="stop-percent">{stop.percent}%</span>
						</div>
						<div
							class="bar bar-small"
							role="progressbar"
							aria-label="{stop.name} progress"
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={stop.percent}
						>
							<span class="bar-fill" style:width={`${stop.percent}%`}></span>
						</div>
						<p class="stop-counts">
							{stop.learned}/{stop.authored} learned{#if stop.unlearned > 0}
								· {stop.unlearned} to fix{/if}
						</p>
					</div>
				</li>
			{/each}
		</ol>
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

	.stop {
		display: flex;
		gap: 0.8rem;
		padding: 0.85rem 1rem;
	}

	.stop + .stop {
		border-top: 1px solid #edf1e9;
	}

	.stop-number {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.85rem;
		height: 1.85rem;
		margin-top: 0.05rem;
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
		margin: 0.35rem 0 0;
		font-size: 0.72rem;
		color: #6d7c71;
		font-variant-numeric: tabular-nums;
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
</style>
