<script lang="ts">
	import { onMount } from 'svelte';
	import {
		GROUPS,
		isGroup,
		isSide,
		type AdminAccount,
		type AdminCohortResponse,
		type AdminDashboardResponse,
		type AdminPeopleResponse,
		type AdminPerson,
		type AdminProgressConflict,
		type AdminSectionDraft,
		type AdminSectionDraftBody,
		type AdminSectionReview,
		type AdminSectionSaveBody,
		type AdminSectionSaveResponse,
		type AdminSectionStatus,
		type AdminSessionResponse,
		type AdminTopicCreateResponse,
		type AdminTopicDeleteConflict
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
				cohort: AdminCohortResponse;
				people: AdminPeopleResponse;
		  };

	type DeleteConflict = {
		topicId: number;
		topicName: string;
		affectedLearners: number;
	};

	type EditorState = {
		draft: AdminSectionDraft;
		review: AdminSectionReview | null;
		conflict: AdminProgressConflict | null;
		deleteConflict: DeleteConflict | null;
		error: string;
		busy: boolean;
	};

	let view = $state<View>({ status: 'loading' });
	let loginMessage = $state('');
	let actionMessage = $state('');
	let editor = $state<EditorState | null>(null);
	let draggedTopicId = $state<number | null>(null);

	onMount(() => {
		loginMessage = loginErrorMessage(new URLSearchParams(window.location.search).get('error'));
		void load();
	});

	async function load(): Promise<void> {
		const session = await request('/api/admin/session');
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

		const dashboard = await request('/api/admin/dashboard');
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

		const cohort = await request('/api/admin/cohort');
		const people = await request('/api/admin/people');
		if (!cohort || !people || !cohort.ok || !people.ok) {
			view = { status: 'unavailable' };
			return;
		}

		view = {
			status: 'ready',
			account: body.account,
			dashboard: (await dashboard.json()) as AdminDashboardResponse,
			cohort: (await cohort.json()) as AdminCohortResponse,
			people: (await people.json()) as AdminPeopleResponse
		};
	}

	/** GETs an API path; null means the request could not be made at all. */
	async function request(path: string, init: RequestInit = {}): Promise<Response | null> {
		try {
			return await fetch(path, { credentials: 'same-origin', ...init });
		} catch {
			return null;
		}
	}

	/** PUTs JSON to an API path; null means the request could not be made at all. */
	async function putApi(path: string, body: unknown): Promise<Response | null> {
		return request(path, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	/** POSTs JSON to an API path; null means the request could not be made at all. */
	async function postApi(path: string, body: unknown): Promise<Response | null> {
		return request(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	function draftBody(draft: AdminSectionDraft): AdminSectionDraftBody {
		return { name: draft.section.name, topics: draft.topics };
	}

	async function openEditor(sectionNumber: number): Promise<void> {
		actionMessage = '';

		const response = await request(`/api/admin/sections/${sectionNumber}`);
		if (!response || !response.ok) {
			actionMessage = `Could not open section ${sectionNumber}. Try again.`;
			return;
		}

		editor = {
			draft: (await response.json()) as AdminSectionDraft,
			review: null,
			conflict: null,
			deleteConflict: null,
			error: '',
			busy: false
		};
	}

	function closeEditor(): void {
		editor = null;
		draggedTopicId = null;
	}

	/** Drops the review panel and any pending Keep/Reset choice. */
	function dismissReview(): void {
		if (!editor) return;
		editor.review = null;
		editor.conflict = null;
	}

	/** Any edit after a review makes that review stale, so it is dropped. */
	function invalidateReview(): void {
		if (!editor || (!editor.review && !editor.conflict && !editor.deleteConflict)) return;
		dismissReview();
		editor.deleteConflict = null;
		editor.error = '';
	}

	function setSide(topic: AdminSectionDraft['topics'][number], value: string): void {
		topic.side = isSide(value) ? value : null;
	}

	/** Appends a persisted empty topic without disturbing unsaved edits. */
	async function addTopic(): Promise<void> {
		const state = editor;
		if (!state || state.busy) return;

		state.busy = true;
		state.error = '';

		const response = await postApi(
			`/api/admin/sections/${state.draft.section.number}/topics`,
			{}
		);
		state.busy = false;
		if (editor !== state) return;

		if (!response || !response.ok) {
			state.error =
				response?.status === 404
					? 'This section no longer exists.'
					: 'The topic could not be added. Try again.';
			return;
		}

		const body = (await response.json()) as AdminTopicCreateResponse;
		state.draft.topics = [...state.draft.topics, body.topic];
		state.review = null;
		state.conflict = null;
		state.deleteConflict = null;
		state.error = '';
		actionMessage = 'Topic added at the end.';
		await refreshDashboard();
	}

	function startTopicDrag(event: DragEvent, topicId: number): void {
		draggedTopicId = topicId;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(topicId));
		}
	}

	function allowTopicDrop(event: DragEvent): void {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
	}

	/** Saves a dragged order immediately; only positions change on the server. */
	async function dropOnTopic(event: DragEvent, targetId: number): Promise<void> {
		event.preventDefault();
		const draggedId = draggedTopicId;
		draggedTopicId = null;

		const state = editor;
		if (draggedId === null || draggedId === targetId || !state || state.busy) return;

		const from = state.draft.topics.findIndex((topic) => topic.id === draggedId);
		const to = state.draft.topics.findIndex((topic) => topic.id === targetId);
		if (from < 0 || to < 0) return;

		const previous = state.draft.topics;
		const next = [...previous];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);

		state.draft.topics = next;
		state.review = null;
		state.conflict = null;
		state.deleteConflict = null;
		state.error = '';
		state.busy = true;

		const response = await putApi(
			`/api/admin/sections/${state.draft.section.number}/order`,
			{ topicIds: next.map((topic) => topic.id) }
		);
		state.busy = false;
		if (editor !== state) return;

		if (!response || !response.ok) {
			state.draft.topics = previous;
			state.error = 'The new order could not be saved. Try again.';
			return;
		}

		actionMessage = 'Topic order saved.';
	}

	function requestDelete(topic: AdminSectionDraft['topics'][number]): void {
		const state = editor;
		if (!state || state.busy) return;

		const message =
			`Delete "${topic.name}"? Its six fields and every learner's progress on it ` +
			'will be removed.';
		if (!window.confirm(message)) return;

		void sendDelete(topic.id);
	}

	/**
	 * Deletes one topic. Without a choice the API refuses when the topic carries
	 * verdicts; the returned conflict asks the editor for Keep or Reset.
	 */
	async function sendDelete(topicId: number, resetProgress?: boolean): Promise<void> {
		const state = editor;
		if (!state || state.busy) return;

		state.busy = true;
		state.error = '';

		const response = await request(`/api/admin/topics/${topicId}`, {
			method: 'DELETE',
			...(resetProgress === undefined
				? {}
				: {
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ resetProgress })
					})
		});
		state.busy = false;
		if (editor !== state) return;

		if (!response) {
			state.error = 'The delete request could not be made. Try again.';
			return;
		}

		if (response.status === 409) {
			const conflict = (await response.json()) as AdminTopicDeleteConflict;
			state.deleteConflict = {
				topicId,
				topicName: conflict.topicName,
				affectedLearners: conflict.affectedLearners
			};
			state.review = null;
			state.conflict = null;
			state.error = '';
			return;
		}

		if (!response.ok) {
			state.error =
				response.status === 404
					? 'This topic no longer exists.'
					: 'The topic could not be deleted. Try again.';
			return;
		}

		state.draft.topics = state.draft.topics.filter((topic) => topic.id !== topicId);
		state.deleteConflict = null;
		state.review = null;
		state.conflict = null;
		actionMessage = 'Topic deleted.';
		await refreshDashboard();
	}

	function deleteWithChoice(choice: boolean): void {
		if (!editor?.deleteConflict) return;
		void sendDelete(editor.deleteConflict.topicId, choice);
	}

	function dismissDeleteConflict(): void {
		if (editor) editor.deleteConflict = null;
	}

	async function reviewDraft(): Promise<void> {
		// Hold the editor this request belongs to: closing or replacing it while
		// the request is in flight must not write into a different editor.
		const state = editor;
		if (!state || state.busy) return;

		state.busy = true;
		state.error = '';

		const response = await postApi(
			`/api/admin/sections/${state.draft.section.number}/review`,
			draftBody(state.draft)
		);
		state.busy = false;
		if (editor !== state) return;

		if (!response) {
			state.error = 'The review could not be prepared. Try again.';
			return;
		}

		if (!response.ok) {
			state.error =
				response.status === 400
					? 'This draft is invalid. Every topic needs a name, a valid side and exactly six distinct fields.'
					: 'The review could not be prepared. Try again.';
			return;
		}

		state.review = (await response.json()) as AdminSectionReview;
		state.conflict = null;
	}

	/**
	 * Saves the reviewed draft. The optional choice answers the 409's question:
	 * false keeps progress, true resets it. Without a choice the API refuses to
	 * write while any changed topic carries a verdict.
	 */
	async function saveDraft(resetProgress?: boolean): Promise<void> {
		const state = editor;
		if (!state || state.busy) return;

		const sectionNumber = state.draft.section.number;
		const body: AdminSectionSaveBody = draftBody(state.draft);
		if (resetProgress !== undefined) body.resetProgress = resetProgress;

		state.busy = true;
		state.error = '';

		const response = await putApi(`/api/admin/sections/${sectionNumber}`, body);
		state.busy = false;
		if (editor !== state) return;

		if (!response) {
			state.error = 'The save request could not be made. Try again.';
			return;
		}

		if (response.status === 409) {
			const conflict = (await response.json()) as AdminProgressConflict;
			state.conflict = conflict;
			state.review = conflict.review;
			state.error = '';
			return;
		}

		if (!response.ok) {
			state.error =
				response.status === 400
					? 'This draft is invalid. Nothing has been written.'
					: 'The section could not be saved. Try again.';
			return;
		}

		const saved = (await response.json()) as AdminSectionSaveResponse;
		state.draft = saved.draft;
		state.review = null;
		state.conflict = null;
		actionMessage = `Section ${sectionNumber} saved.`;
		await refreshDashboard();
	}

	/** The changed topic names whose verdicts a Reset would clear. */
	function affectedTopicNames(review: AdminSectionReview): string[] {
		const ids = new Set(review.affectedTopicIds);
		return review.topics
			.filter((topic) => ids.has(topic.id))
			.map((topic) => topic.previousName);
	}

	async function refreshDashboard(): Promise<void> {
		if (view.status !== 'ready') return;

		const response = await request('/api/admin/dashboard');
		if (response?.ok) {
			view.dashboard = (await response.json()) as AdminDashboardResponse;
		}
	}

	async function assignSectionGroup(sectionNumber: number, value: string): Promise<void> {
		if (view.status !== 'ready') return;

		const group = isGroup(value) ? value : null;
		const response = await putApi(`/api/admin/sections/${sectionNumber}/group`, { group });
		if (!response || !response.ok) {
			actionMessage = `Could not assign section ${sectionNumber}. Try again.`;
			return;
		}

		actionMessage = '';
		view.cohort = (await response.json()) as AdminCohortResponse;
	}

	async function movePerson(person: AdminPerson, value: string): Promise<void> {
		if (view.status !== 'ready' || !isGroup(value)) return;

		const response = await putApi(`/api/admin/accounts/${person.telegramId}/group`, {
			group: value
		});
		if (!response || !response.ok) {
			actionMessage = `Could not move ${person.displayName}. Try again.`;
			return;
		}

		actionMessage = '';
		view.people = (await response.json()) as AdminPeopleResponse;
	}

	async function toggleAdmin(person: AdminPerson): Promise<void> {
		if (view.status !== 'ready') return;

		const response = await putApi(`/api/admin/accounts/${person.telegramId}/admin`, {
			isAdmin: !person.isAdmin
		});
		if (!response || !response.ok) {
			actionMessage = `Could not change admin rights for ${person.displayName}. Try again.`;
			return;
		}

		actionMessage = '';
		view.people = (await response.json()) as AdminPeopleResponse;
	}

	function sectionGroup(sectionNumber: number): string {
		if (view.status !== 'ready') return '';
		return view.cohort.sections.find((section) => section.number === sectionNumber)?.group ?? '';
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

	{#if actionMessage}
		<p class="notice notice-error" role="alert">{actionMessage}</p>
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

		{#if editor}
			<section class="editor-panel" aria-labelledby="editor-heading">
				<div class="editor-heading">
					<div>
						<p class="eyebrow">Section editor</p>
						<h2 id="editor-heading">Section {editor.draft.section.number}</h2>
					</div>
					<button class="button button-quiet button-small" type="button" onclick={closeEditor}>
						Close
					</button>
				</div>

				{#if editor.error}
					<p class="notice notice-error" role="alert">{editor.error}</p>
				{/if}

				<label class="section-name">
					<span>Section name</span>
					<input
						type="text"
						bind:value={editor.draft.section.name}
						maxlength="200"
						oninput={invalidateReview}
					/>
				</label>

				<p class="muted editor-hint">
					Drag a topic's handle to reorder it; the new order saves immediately. A new topic
					starts with six empty fields and no side, so it produces no card until a field is
					authored.
				</p>

				{#each editor.draft.topics as topic, topicIndex (topic.id)}
					<article
						class="topic-editor"
						class:dragging={draggedTopicId === topic.id}
						ondragover={allowTopicDrop}
						ondrop={(event) => void dropOnTopic(event, topic.id)}
					>
						<div class="topic-heading">
							<button
								class="drag-handle"
								type="button"
								draggable="true"
								title="Drag to reorder"
								aria-label={`Drag topic ${topicIndex + 1} to reorder`}
								ondragstart={(event) => startTopicDrag(event, topic.id)}
								ondragend={() => (draggedTopicId = null)}
							>
								⠿
							</button>
							<h3>Topic {topicIndex + 1}</h3>
							<label>
								<span>Name</span>
								<input
									type="text"
									bind:value={topic.name}
									maxlength="200"
									oninput={invalidateReview}
								/>
							</label>
							<label>
								<span>Side</span>
								<select
									value={topic.side ?? ''}
									onchange={(event) => {
										setSide(topic, event.currentTarget.value);
										invalidateReview();
									}}
								>
									<option value="">Not set</option>
									<option value="left">Passengers' left</option>
									<option value="supplementary">Supplementary</option>
									<option value="right">Passengers' right</option>
								</select>
							</label>
							<button
								class="button button-danger button-small topic-delete"
								type="button"
								onclick={() => requestDelete(topic)}
								disabled={editor.busy}
							>
								Delete
							</button>
						</div>

						<div class="field-editors">
							{#each topic.fields as field (field.key)}
								<label class="field-editor" class:not-applicable={field.notApplicable}>
									<span class="field-key">{field.key}</span>
									<span class="na-toggle">
										<input
											type="checkbox"
											bind:checked={field.notApplicable}
											onchange={invalidateReview}
										/>
										Not applicable
									</span>
									<textarea
										bind:value={field.text}
										rows="2"
										placeholder={`Write the ${field.key} fact…`}
										oninput={invalidateReview}
									></textarea>
								</label>
							{/each}
						</div>
					</article>
				{/each}

				<div class="editor-add">
					<button
						class="button button-quiet"
						type="button"
						onclick={() => void addTopic()}
						disabled={editor.busy}
					>
						+ Add topic at the end
					</button>
				</div>

				{#if editor.deleteConflict}
					{@const pending = editor.deleteConflict}
					{@const learnersHave =
						pending.affectedLearners === 1 ? 'learner has' : 'learners have'}
					<section class="choice-panel" aria-labelledby="delete-choice-heading">
						<h4 id="delete-choice-heading">Keep or reset progress before deleting?</h4>
						<p>
							{pending.affectedLearners}
							{learnersHave}
							graded <strong>{pending.topicName}</strong>.
						</p>
						<p class="muted">
							The topic and its field states are removed either way. <strong>Keep</strong> leaves
							every other topic's progress untouched; <strong>Reset</strong> clears this topic's
							verdicts first.
						</p>
						<div class="editor-actions">
							<button
								class="button"
								type="button"
								onclick={() => deleteWithChoice(false)}
								disabled={editor.busy}
							>
								{editor.busy ? 'Working…' : 'Keep progress and delete'}
							</button>
							<button
								class="button button-danger"
								type="button"
								onclick={() => deleteWithChoice(true)}
								disabled={editor.busy}
							>
								Reset progress and delete
							</button>
							<button
								class="button button-quiet"
								type="button"
								onclick={dismissDeleteConflict}
							>
								Cancel
							</button>
						</div>
					</section>
				{/if}

				<div class="editor-actions">
					<button
						class="button"
						type="button"
						onclick={() => void reviewDraft()}
						disabled={editor.busy}
					>
						{editor.busy ? 'Working…' : 'Review save…'}
					</button>
					<button class="button button-quiet" type="button" onclick={closeEditor}>
						Cancel
					</button>
				</div>

				{#if editor.review}
					{@const affectedLearners = editor.review.affectedLearners}
					{@const learnersHave = affectedLearners === 1 ? 'learner has' : 'learners have'}
					<section class="review-panel" aria-labelledby="review-heading">
						<h3 id="review-heading">Review before saving</h3>

						{#if editor.review.section.previousName !== editor.review.section.name}
							<p>
								Section name: <span class="old">{editor.review.section.previousName}</span> →
								<strong>{editor.review.section.name}</strong>
							</p>
						{:else}
							<p class="muted">Section name unchanged.</p>
						{/if}

						{#if editor.review.topics.length === 0}
							<p class="muted">
								No content changes. Reordering, side changes and a section rename are saved
								without prompting.
							</p>
						{:else}
							<p>
								{editor.review.topics.length} changed
								{editor.review.topics.length === 1 ? 'topic' : 'topics'}:
							</p>
							<ul class="review-topics">
								{#each editor.review.topics as topic (topic.id)}
									<li>
										<h4>
											{topic.previousName}
											{#if topic.previousName !== topic.name}
												→ <strong>{topic.name}</strong>
											{/if}
										</h4>
										{#if topic.fields.length === 0}
											<p class="muted">Name changed only.</p>
										{:else}
											<ul class="review-fields">
												{#each topic.fields as field (field.key)}
													<li>
														<span class="field-key">{field.key}</span>
														{#if field.previousNotApplicable !== field.notApplicable}
															<span>
																{field.previousNotApplicable ? 'Not applicable' : 'Applicable'}
																→ {field.notApplicable ? 'not applicable' : 'applicable'}
															</span>
														{/if}
														{#if field.previousText !== field.text}
															<span class="old">{field.previousText || 'empty'}</span> →
															<span>{field.text || 'empty'}</span>
														{/if}
													</li>
												{/each}
											</ul>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if editor.conflict}
							{@const affected = affectedTopicNames(editor.conflict.review)}
							{@const gradedTopics = affected.length === 1 ? 'this topic' : 'these topics'}
							<section class="choice-panel" aria-labelledby="choice-heading">
								<h4 id="choice-heading">Keep or reset progress?</h4>
								<p>
									{affectedLearners}
									{learnersHave}
									graded {gradedTopics}:
									<strong>{affected.join(', ')}</strong>.
								</p>
								<p class="muted">
									Nothing has been written yet. <strong>Keep</strong> preserves every verdict,
									which will then certify the corrected text. <strong>Reset</strong> returns
									every field of {gradedTopics} to Untouched for every learner, so they must be
									learned again.
								</p>
								<div class="editor-actions">
									<button
										class="button"
										type="button"
										onclick={() => void saveDraft(false)}
										disabled={editor.busy}
									>
										{editor.busy ? 'Working…' : 'Keep progress'}
									</button>
									<button
										class="button button-danger"
										type="button"
										onclick={() => void saveDraft(true)}
										disabled={editor.busy}
									>
										Reset progress
									</button>
									<button class="button button-quiet" type="button" onclick={dismissReview}>
										Back to editing
									</button>
								</div>
							</section>
						{:else}
							{#if editor.review.affectedTopicIds.length > 0}
								<p class="notice">
									{affectedLearners}
									{learnersHave}
									graded the affected topics. Saving will ask whether to keep or reset their
									progress before anything is written.
								</p>
							{/if}

							<div class="editor-actions">
								<button
									class="button"
									type="button"
									onclick={() => void saveDraft()}
									disabled={editor.busy}
								>
									Confirm save
								</button>
								<button class="button button-quiet" type="button" onclick={dismissReview}>
									Back to editing
								</button>
							</div>
						{/if}
					</section>
				{/if}
			</section>
		{/if}

		<section class="group-panel" aria-labelledby="groups-heading">
			<div class="table-heading">
				<h2 id="groups-heading">Cohort map</h2>
				<p>
					Assign each section to one group below. A group with other than five sections is a
					mistake to fix, but it never blocks a save.
				</p>
			</div>
			<ul class="group-counts">
				{#each view.cohort.groups as count (count.group)}
					<li class:off={count.sectionCount !== 5}>
						<span class="group-letter">{count.group}</span>
						<span class="group-count">{count.sectionCount} sections</span>
						{#if count.sectionCount !== 5}
							<span class="group-warning">check this</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>

		<section class="table-panel" aria-labelledby="sections-heading">
			<div class="table-heading">
				<h2 id="sections-heading">All sections</h2>
				<p>Authored, not-applicable and empty fields are counted across every topic. Select a section name to edit its topics and fields.</p>
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
						<th scope="col">Group</th>
					</tr>
				</thead>
				<tbody>
					{#each view.dashboard.sections as section (section.number)}
						<tr class:no-content={section.status === 'empty'}>
							<td class="number">{section.number}</td>
							<td class="name">
								<button
									class="name-button"
									type="button"
									aria-label={`Edit section ${section.number}, ${section.name}`}
									onclick={() => void openEditor(section.number)}
								>
									{section.name}
								</button>
							</td>
							<td class="count">{section.topicCount}</td>
							<td class="count">{section.authoredFields}</td>
							<td class="count">{section.notApplicableFields}</td>
							<td class="count">{section.emptyFields}</td>
							<td>
								<span class="badge badge-{section.status}">{statusLabel(section.status)}</span>
							</td>
							<td>
								<select
									class="group-select"
									aria-label={`Group for section ${section.number}`}
									value={sectionGroup(section.number)}
									onchange={(event) =>
										void assignSectionGroup(section.number, event.currentTarget.value)}
								>
									<option value="">Unassigned</option>
									{#each GROUPS as group (group)}
										<option value={group}>{group}</option>
									{/each}
								</select>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="table-panel people-panel" aria-labelledby="people-heading">
			<div class="table-heading">
				<h2 id="people-heading">People</h2>
				<p>
					Every account with its Telegram id, group and the number of sections it has touched.
					Moving a learner changes their scope immediately and leaves progress untouched.
					<code>ADMIN_IDS</code> remains an admin grant.
				</p>
			</div>

			<table>
				<thead>
					<tr>
						<th class="number" scope="col">Telegram id</th>
						<th scope="col">Name</th>
						<th scope="col">Group</th>
						<th class="count" scope="col">Sections touched</th>
						<th scope="col">Admin</th>
					</tr>
				</thead>
				<tbody>
					{#each view.people.people as person (person.telegramId)}
						<tr>
							<td class="number telegram-id">{person.telegramId}</td>
							<td class="name">{person.displayName}</td>
							<td>
								<select
									class="group-select"
									aria-label={`Group for ${person.displayName}`}
									value={person.group ?? ''}
									onchange={(event) => void movePerson(person, event.currentTarget.value)}
								>
									<option value="" disabled>No group</option>
									{#each GROUPS as group (group)}
										<option value={group}>{group}</option>
									{/each}
								</select>
							</td>
							<td class="count">{person.touchedSections}</td>
							<td>
								<button
									class="button button-small"
									class:button-quiet={person.isAdmin}
									type="button"
									onclick={() => void toggleAdmin(person)}
								>
									{person.isAdmin ? 'Revoke admin' : 'Grant admin'}
								</button>
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

	.button-danger {
		border-color: #a33a23;
		background: #a33a23;
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

	.notice-error {
		border-color: #efc9c1;
		background: #fdf0ed;
		color: #8f2f1e;
	}

	.group-panel {
		overflow: hidden;
		margin-bottom: 1.25rem;
		border: 1px solid #dfe6da;
		border-radius: 18px;
		background: #fff;
		box-shadow: 0 10px 26px rgba(20, 34, 26, 0.05);
	}

	.group-counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0;
		padding: 0 1.4rem 1.2rem;
		list-style: none;
	}

	.group-counts li {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		background: #f2f6ef;
		color: #2b3a30;
		font-size: 0.85rem;
	}

	.group-counts li.off {
		background: #fdf0de;
		color: #8a5a13;
	}

	.group-letter {
		font-weight: 750;
	}

	.group-count {
		font-variant-numeric: tabular-nums;
	}

	.group-warning {
		font-size: 0.68rem;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.group-select {
		padding: 0.35rem 0.5rem;
		border: 1px solid #cfd9ca;
		border-radius: 8px;
		background: #fff;
		color: #17211a;
		font: inherit;
	}

	.people-panel {
		margin-top: 1.25rem;
	}

	.button-small {
		padding: 0.35rem 0.6rem;
		font-size: 0.78rem;
	}

	.telegram-id {
		width: 9rem;
	}

	.name-button {
		padding: 0;
		border: 0;
		background: none;
		color: #1f5f3c;
		font: inherit;
		font-weight: 600;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: #b9cdbc;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.name-button:hover {
		text-decoration-color: #2f7d4f;
	}

	.editor-panel {
		margin-bottom: 1.25rem;
		padding: 1.4rem;
		border: 1px solid #cfdccc;
		border-radius: 18px;
		background: #fff;
		box-shadow: 0 10px 26px rgba(20, 34, 26, 0.06);
	}

	.editor-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.2rem;
	}

	.editor-heading h2 {
		margin: 0;
	}

	.section-name {
		display: grid;
		gap: 0.35rem;
		max-width: 34rem;
		margin-bottom: 1.4rem;
		font-size: 0.8rem;
		font-weight: 650;
	}

	.editor-hint {
		margin: -0.7rem 0 1.2rem;
		font-size: 0.85rem;
	}

	.section-name input,
	.topic-heading input,
	.topic-heading select,
	.field-editor textarea {
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1px solid #cfd9ca;
		border-radius: 9px;
		background: #fff;
		color: #17211a;
		font: inherit;
	}

	.section-name input:focus,
	.topic-heading input:focus,
	.topic-heading select:focus,
	.field-editor textarea:focus {
		outline: 2px solid #8fb99b;
		outline-offset: 1px;
	}

	.topic-editor {
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid #e2e9de;
		border-radius: 13px;
		background: #fbfcfa;
	}

	.topic-editor.dragging {
		border-style: dashed;
		opacity: 0.55;
	}

	.topic-heading {
		display: grid;
		grid-template-columns: 2.4rem 4.7rem minmax(11rem, 1fr) minmax(10rem, 0.7fr) auto;
		gap: 0.8rem;
		align-items: end;
		margin-bottom: 0.9rem;
	}

	.topic-heading h3 {
		margin: 0 0 0.35rem;
		font-size: 0.95rem;
	}

	.drag-handle {
		align-self: end;
		padding: 0.5rem 0.35rem;
		border: 1px solid #cfd9ca;
		border-radius: 9px;
		background: #fff;
		color: #5c6b60;
		font: inherit;
		cursor: grab;
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.topic-delete {
		align-self: end;
		white-space: nowrap;
	}

	.editor-add {
		margin: 0.2rem 0 0.6rem;
	}

	.topic-heading label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.75rem;
		font-weight: 650;
		color: #5c6b60;
	}

	.field-editors {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.65rem;
	}

	.field-editor {
		display: grid;
		gap: 0.3rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid #e8eee4;
		border-radius: 10px;
		background: #fff;
	}

	.field-editor.not-applicable {
		background: #f6f6f2;
	}

	.field-key {
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5c6b60;
	}

	.na-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: #5c6b60;
	}

	.field-editor textarea {
		resize: vertical;
		font-size: 0.88rem;
		line-height: 1.45;
	}

	.field-editor.not-applicable textarea {
		color: #8a948d;
	}

	.editor-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 1rem;
	}

	.review-panel {
		margin-top: 1.4rem;
		padding: 1.1rem 1.2rem;
		border: 1px solid #e6d2a8;
		border-radius: 13px;
		background: #fdfaf1;
	}

	.review-panel h3 {
		margin: 0 0 0.6rem;
	}

	.choice-panel {
		margin-top: 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid #e3bdb3;
		border-radius: 11px;
		background: #fff6f3;
	}

	.choice-panel h4 {
		margin: 0 0 0.45rem;
		font-size: 0.95rem;
	}

	.review-panel p {
		margin: 0.35rem 0;
		font-size: 0.9rem;
	}

	.review-topics,
	.review-fields {
		margin: 0.4rem 0 0.8rem;
		padding-left: 1.1rem;
	}

	.review-topics > li {
		margin-bottom: 0.7rem;
	}

	.review-topics h4 {
		margin: 0 0 0.35rem;
		font-size: 0.9rem;
	}

	.review-fields li {
		margin-bottom: 0.2rem;
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.old {
		color: #8a5a13;
		text-decoration: line-through;
	}
</style>
