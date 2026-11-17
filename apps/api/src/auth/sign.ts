import { createHmac } from 'node:crypto';

/** Base64url HMAC-SHA256 over a payload, shared by every signed cookie. */
export function signPayload(secret: string, payload: string): string {
	return createHmac('sha256', secret).update(payload).digest('base64url');
}
