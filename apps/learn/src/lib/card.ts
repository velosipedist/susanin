import type { FieldKey, Side } from '@susanin/shared';

export type SideLabel = {
	text: string;
	arrow: '←' | '→' | null;
	align: 'start' | 'center' | 'end';
};

/** The side of the coach, with the arrow on the outside edge of the card. */
export function sideLabel(side: Side | null): SideLabel | null {
	switch (side) {
		case 'left':
			return { text: "Passengers' left", arrow: '←', align: 'start' };
		case 'right':
			return { text: "Passengers' right", arrow: '→', align: 'end' };
		case 'supplementary':
			return { text: 'Supplementary', arrow: null, align: 'center' };
		default:
			return null;
	}
}

/** What, When, Where, Why, Who, How. */
export function fieldLabel(key: FieldKey): string {
	return key.charAt(0).toUpperCase() + key.slice(1);
}
