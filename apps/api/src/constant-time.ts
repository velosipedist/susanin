import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two strings without leaking their contents through timing.
 * A length difference is not secret.
 */
export function constantTimeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	if (leftBuffer.length !== rightBuffer.length) return false;
	return timingSafeEqual(leftBuffer, rightBuffer);
}
