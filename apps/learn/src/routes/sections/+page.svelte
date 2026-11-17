<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { loadSectionList, type SectionListResult } from '#lib/api';
	import { sectionStats } from '#lib/home';
	import { telegramWebApp } from '#lib/telegram';

	let result = $state<SectionListResult | null>(null);

	onMount(async () => {
		const telegram = telegramWebApp();

		telegram?.ready();
		telegram?.expand();
		telegram?.setHeaderColor?.('#f1f4ee');
		telegram?.setBackgroundColor?.('#f1f4ee');

		result = await loadSectionList();
	});

	const list = $derived(result?.status === 'ready' ? result.list : null);
	const rows = $derived(list ? list.sections.map(sectionStats) : []);
	const group = $derived(list?.account.group ?? '');
	const inScopeCount = $derived(rows.filter((row) => row.inScope).length);

	const message = $derived(statusMessage(result));

	function statusMessage(current: SectionListResult | null): string {
		if (!current) return 'Loading all sections…';

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
</script>

<svelte:head>
	<title>Susanin · All sections</title>
	<meta name="theme-color" content="#f1f4ee" />
</svelte:head>

{#if list}
<main class="sections">
	<header class="sections-header">
		<a class="back" href={resolve('/')} aria-label="Back to home">
			<span aria-hidden="true">‹</span>
		</a>
		<div class="sections-title">
			<p class="eyebrow">Susanin · Group {group}</p>
			<h1>All 25 sections</h1>
		</div>
	</header>

	<p class="intro">
		{inScopeCount} of 25 are in your group. Any section with authored facts can be trained, inside
		your group or outside it.
	</p>

	<ol class="section-list">
		{#each rows as row (row.number)}
			<li class="section-item">
				{#if row.authored > 0}
					<a
						class="section-row"
						href={resolve(`/?section=${row.number}`)}
						aria-label="Train section {row.number}, {row.name}"
					>
						<span class="section-number" class:section-number-in={row.inScope}>
							{row.number}
						</span>
						<span class="section-body">
							<span class="section-line">
								<span class="section-name">{row.name}</span>
								<span class="section-percent">{row.percent}%</span>
							</span>
							<span class="scope" class:scope-in={row.inScope} class:scope-out={!row.inScope}>
								{row.inScope ? 'In your group' : 'Outside your group'}
							</span>
							<span
								class="bar"
								role="progressbar"
								aria-label="{row.name} progress"
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={row.percent}
							>
								<span class="bar-fill" style:width={`${row.percent}%`}></span>
							</span>
							<span class="counts">
								{row.learned}/{row.authored} learned{#if row.unlearned > 0}
									· {row.unlearned} to fix{/if}
							</span>
						</span>
						<span class="chevron" aria-hidden="true">›</span>
					</a>
				{:else}
					<div class="section-row section-row-empty">
						<span class="section-number" class:section-number-in={row.inScope}>
							{row.number}
						</span>
						<span class="section-body">
							<span class="section-line">
								<span class="section-name">{row.name}</span>
							</span>
							<span class="scope" class:scope-in={row.inScope} class:scope-out={!row.inScope}>
								{row.inScope ? 'In your group' : 'Outside your group'}
							</span>
							<span class="no-content">No authored content yet</span>
						</span>
					</div>
				{/if}
			</li>
		{/each}
	</ol>
</main>
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

	.sections {
		width: 100%;
		max-width: 430px;
		margin: 0 auto;
		padding: 1.5rem 1.15rem calc(2rem + env(safe-area-inset-bottom));
	}

	.sections-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.9rem;
	}

	.back {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		background: #fff;
		border: 1px solid #e1e7dc;
		color: #14221a;
		font-size: 1.7rem;
		line-height: 1;
		text-decoration: none;
	}

	.back span {
		margin-top: -0.15rem;
	}

	.sections-title {
		min-width: 0;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #5f6f63;
	}

	.sections-title h1 {
		margin: 0;
		font-size: 1.65rem;
		line-height: 1.1;
		letter-spacing: -0.025em;
	}

	.intro {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		line-height: 1.45;
		color: #5f6f63;
	}

	.section-list {
		list-style: none;
		margin: 0;
		padding: 0;
		background: #fff;
		border: 1px solid #e1e7dc;
		border-radius: 22px;
		overflow: hidden;
		box-shadow: 0 8px 22px rgba(20, 34, 26, 0.05);
	}

	.section-item + .section-item {
		border-top: 1px solid #edf1e9;
	}

	.section-row {
		display: flex;
		align-items: flex-start;
		gap: 0.8rem;
		padding: 0.95rem 1rem;
		color: inherit;
		text-decoration: none;
	}

	.section-row:active {
		background: #f7faf5;
	}

	.section-row-empty {
		color: #6d7c71;
	}

	.section-number {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.85rem;
		height: 1.85rem;
		margin-top: 0.05rem;
		border-radius: 50%;
		background: #f1f4ee;
		color: #6d7c71;
		font-size: 0.82rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.section-number-in {
		background: #e3f1e6;
		color: #2f7d4f;
	}

	.section-body {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.35rem;
	}

	.section-line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.section-name {
		font-size: 0.96rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.section-percent {
		flex: none;
		font-size: 0.82rem;
		font-weight: 700;
		color: #2f7d4f;
		font-variant-numeric: tabular-nums;
	}

	.scope {
		width: fit-content;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.scope-in {
		background: #e3f1e6;
		color: #2f7d4f;
	}

	.scope-out {
		background: #f1f4ee;
		color: #6d7c71;
	}

	.bar {
		display: block;
		height: 7px;
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

	.counts {
		font-size: 0.72rem;
		color: #6d7c71;
		font-variant-numeric: tabular-nums;
	}

	.no-content {
		font-size: 0.78rem;
		font-weight: 600;
		color: #8a6d3b;
	}

	.chevron {
		flex: none;
		align-self: center;
		font-size: 1.5rem;
		line-height: 1;
		color: #90a095;
	}
</style>
