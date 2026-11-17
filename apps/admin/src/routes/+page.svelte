<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		AdminAccount,
		AdminDashboardResponse,
		AdminSectionStatus,
		AdminSessionResponse
	} from '@susanin/shared';

	type View =
		| { status: 'loading' }
		| { status: 'signed-out' }
		| { status: 'forbidden'; account: AdminAccount }
		| { status: 'unavailable' }
		| {
				status: 'ready';
				account: AdminAccount;
				dashboard: AdminDashboardResponse;
		  };

	let view = $state<View>({ status: 'loading' });
	let loginMessage = $state('');

	onMount(() => {
		loginMessage = loginErrorMessage(new URLSearchParams(window.location.search).get('error'));
		void load();
	});

	async function load(): Promise<void> {
		const session = await fetchApi('/api/admin/session');
		if (!session) {
			view = { status: 'unavailable' };
			return;
		}

		if (session.status === 401) {
			view = { status: 'signed-out' };
			return;
		}

		if (!session.ok) {
			view = { status: 'unavailable' };
			return;
		}

		const body = (await session.json()) as AdminSessionResponse;
		if (!body.account.isAdmin) {
			view = { status: 'forbidden', account: body.account };
			return;
		}

		const dashboard = await fetchApi('/api/admin/dashboard');
		if (!dashboard) {
			view = { status: 'unavailable' };
			return;
		}

		if (dashboard.status === 403) {
			view = { status: 'forbidden', account: body.account };
			return;
		}

		if (!dashboard.ok) {
			view = { status: 'unavailable' };
			return;
		}

		view = {
			status: 'ready',
			account: body.account,
			dashboard: (await dashboard.json()) as AdminDashboardResponse
		};
	}

	/** GETs an API path; null means the request could not be made at all. */
	async function fetchApi(path: string): Promise<Response | null> {
		try {
			return await fetch(path, { credentials: 'same-origin' });
		} catch {
			return null;
		}
	}

	function loginErrorMessage(code: string | null): string {
		switch (code) {
			case 'not-invited':
				return 'This Telegram account has not joined the tour yet. Use the invite code in the bot first.';
			case 'login-failed':
				return 'Telegram sign-in did not complete. Try again.';
			case 'login-unavailable':
				return 'Admin sign-in is not configured on this server.';
			default:
				return '';
		}
	}

	function statusLabel(status: AdminSectionStatus): string {
		switch (status) {
			case 'empty':
				return 'No content';
			case 'partial':
				return 'In progress';
			case 'complete':
				return 'Complete';
		}
	}
</script>

<svelte:head>
	<title>Susanin · Admin</title>
	<meta name="theme-color" content="#f4f6f2" />
</svelte:head>

<main class="shell">
	<header class="masthead">
		<p class="eyebrow">Susanin</p>
		<h1>Tour content admin</h1>
	</header>

	{#if loginMessage}
		<p class="notice" role="alert">{loginMessage}</p>
	{/if}

	{#if view.status === 'loading'}
		<p class="muted">Checking your session…</p>
	{:else if view.status === 'signed-out'}
		<section class="panel sign-in">
			<h2>Sign in to correct the tour</h2>
			<p>
				Admins sign in with their Telegram account. Editing happens here on a desktop browser;
				learning stays in the Mini App.
			</p>
			<a class="button" href="/api/admin/auth/login">Sign in with Telegram</a>
		</section>
	{:else if view.status === 'forbidden'}
		<section class="panel sign-in">
			<h2>Not an admin</h2>
			<p>
				Signed in as {view.account.displayName}, but this account does not have admin rights.
				Ask an existing admin or the owner to grant them.
			</p>
			<a class="button button-quiet" href="/learn/">Open the learner app</a>
		</section>
	{:else if view.status === 'unavailable'}
		<section class="panel sign-in">
			<h2>Admin unavailable</h2>
			<p>The admin API could not be reached. Try again in a moment.</p>
			<button class="button button-quiet" type="button" onclick={() => void load()}>Retry</button>
		</section>
	{:else}
		<section class="summary" aria-label="Dataset summary">
			<div class="summary-item">
				<p class="summary-value">{view.dashboard.totalSections}</p>
				<p class="summary-label">sections</p>
			</div>
			<div class="summary-item">
				<p class="summary-value">{view.dashboard.sections.length}</p>
				<p class="summary-label">listed, no pagination</p>
			</div>
			<p class="summary-account">
				Signed in as <strong>{view.account.displayName}</strong>
				{#if view.account.group}
					· Group {view.account.group}
				{/if}
			</p>
		</section>

		<section class="table-panel" aria-labelledby="sections-heading">
			<div class="table-heading">
				<h2 id="sections-heading">All sections</h2>
				<p>Authored, not-applicable and empty fields are counted across every topic.</p>
			</div>

			<table>
				<thead>
					<tr>
						<th class="number" scope="col">#</th>
						<th scope="col">Section</th>
						<th class="count" scope="col">Topics</th>
						<th class="count" scope="col">Authored</th>
						<th class="count" scope="col">Not applicable</th>
						<th class="count" scope="col">Empty</th>
						<th scope="col">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each view.dashboard.sections as section (section.number)}
						<tr class:no-content={section.status === 'empty'}>
							<td class="number">{section.number}</td>
							<td class="name">{section.name}</td>
							<td class="count">{section.topicCount}</td>
							<td class="count">{section.authoredFields}</td>
							<td class="count">{section.notApplicableFields}</td>
							<td class="count">{section.emptyFields}</td>
							<td>
								<span class="badge badge-{section.status}">{statusLabel(section.status)}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</main>

<style>
	.shell {
		width: 100%;
		max-width: 1080px;
		margin: 0 auto;
		padding: 3rem 2rem 4rem;
	}

	.masthead {
		margin-bottom: 1.75rem;
	}

	.eyebrow {
		margin: 0 0 0.4rem;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #5c6b60;
	}

	h1 {
		margin: 0;
		font-size: 2.15rem;
		letter-spacing: -0.03em;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.15rem;
	}

	p {
		margin: 0;
		line-height: 1.55;
	}

	.muted {
		color: #5c6b60;
	}

	.notice {
		margin-bottom: 1.25rem;
		padding: 0.85rem 1rem;
		border: 1px solid #e6d2a8;
		border-radius: 12px;
		background: #fdf6e7;
		color: #6b4e14;
	}

	.panel {
		max-width: 520px;
		padding: 1.6rem;
		border: 1px solid #dfe6da;
		border-radius: 18px;
		background: #fff;
		box-shadow: 0 10px 26px rgba(20, 34, 26, 0.05);
	}

	.panel p {
		margin-bottom: 1.2rem;
		color: #47564c;
	}

	.button {
		display: inline-block;
		padding: 0.7rem 1.1rem;
		border: 1px solid #2f7d4f;
		border-radius: 10px;
		background: #2f7d4f;
		color: #fff;
		font: inherit;
		font-weight: 650;
		text-decoration: none;
		cursor: pointer;
	}

	.button-quiet {
		border-color: #cfd9ca;
		background: #fff;
		color: #17211a;
	}

	.summary {
		display: flex;
		align-items: baseline;
		gap: 2rem;
		margin-bottom: 1.25rem;
	}

	.summary-item {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
	}

	.summary-value {
		font-size: 1.6rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.summary-label {
		font-size: 0.8rem;
		color: #5c6b60;
	}

	.summary-account {
		margin-left: auto;
		font-size: 0.85rem;
		color: #5c6b60;
	}

	.table-panel {
		overflow: hidden;
		border: 1px solid #dfe6da;
		border-radius: 18px;
		background: #fff;
		box-shadow: 0 10px 26px rgba(20, 34, 26, 0.05);
	}

	.table-heading {
		padding: 1.2rem 1.4rem;
		border-bottom: 1px solid #e8eee4;
	}

	.table-heading p {
		color: #5c6b60;
		font-size: 0.85rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 0.7rem 1rem;
		text-align: left;
	}

	th {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5c6b60;
		background: #f7f9f5;
		border-bottom: 1px solid #e8eee4;
	}

	tbody tr + tr td {
		border-top: 1px solid #eef2eb;
	}

	tr.no-content td {
		background: #fff8f6;
	}

	.number {
		width: 3.5rem;
		color: #5c6b60;
	}

	.name {
		font-weight: 600;
	}

	.count {
		width: 7rem;
		text-align: right;
	}

	th.count {
		text-align: right;
	}

	.badge {
		display: inline-block;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 650;
		white-space: nowrap;
	}

	.badge-empty {
		background: #fbe3de;
		color: #9b2c1c;
	}

	.badge-partial {
		background: #fdf1de;
		color: #8a5a13;
	}

	.badge-complete {
		background: #e3f1e6;
		color: #256a43;
	}
</style>
