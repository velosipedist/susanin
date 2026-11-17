import type { ImportReport } from './plan';

/** Human-readable review of what an import matched, dropped and appended. */
export function formatReport(report: ImportReport): string {
	const lines: string[] = [
		`Imported ${report.sectionCount} sections and ${report.briefTopicCount} Brief topics.`,
		`Syllabus items read: ${report.syllabusItemCount}; appended as not applicable: ${report.appended.length}.`,
		''
	];

	lines.push(`Matched (${report.matched.length})`);
	if (report.matched.length === 0) lines.push('  none');
	for (const entry of report.matched) {
		lines.push(
			`  Section ${entry.sectionNumber}: ${entry.briefName} — "${entry.syllabusName}" (${entry.side})`
		);
	}

	lines.push('', `Unmatched Brief topics, side unset (${report.unmatched.length})`);
	if (report.unmatched.length === 0) lines.push('  none');
	for (const entry of report.unmatched) {
		lines.push(`  Section ${entry.sectionNumber}: ${entry.briefName}`);
	}

	lines.push('', `Appended Syllabus-only topics (${report.appended.length})`);
	if (report.appended.length === 0) lines.push('  none');
	for (const entry of report.appended) {
		lines.push(`  Section ${entry.sectionNumber}: ${entry.syllabusName} (${entry.side})`);
	}

	lines.push('', `Ambiguous candidates, not applied (${report.ambiguous.length})`);
	if (report.ambiguous.length === 0) lines.push('  none');
	for (const entry of report.ambiguous) {
		lines.push(
			`  Section ${entry.sectionNumber}: ${entry.briefName} ~ "${entry.syllabusName}" (${entry.score.toFixed(2)})`
		);
	}

	return lines.join('\n');
}
