import { mcpReference, splitMcpReferences } from "../../src/mcp-reference";

/** A compact mention in the draft and the full reference it sends. */
interface DraftMentionRange {
	start: number;
	end: number;
	/** The text shown in the draft, `@file` or `#server`. */
	label: string;
	/** The file path or explicit MCP identity sent in its place. */
	mention: string;
}

export type DraftMention = DraftMentionRange & ({ kind?: "file"; path: string } | { kind: "mcp"; server: string });

/** Restore saved references as editable labels; sending an intact label retains its server identity. */
export function compactMcpDraft(prompt: string): { text: string; mentions: DraftMention[] } {
	let text = "";
	const mentions: DraftMention[] = [];
	for (const part of splitMcpReferences(prompt)) {
		if (typeof part === "string") text += part;
		else {
			mentions.push({
				kind: "mcp",
				start: text.length,
				end: text.length + part.label.length,
				label: part.label,
				server: part.server,
				mention: mcpReference(part.server),
			});
			text += part.label;
		}
	}
	return { text, mentions };
}

/** Mentions after an edit from `previous` to `next`: those before it stay, those after it move, those it touched are dropped. */
export function updateDraftMentions(previous: string, next: string, mentions: readonly DraftMention[]): DraftMention[] {
	let start = 0;
	while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
	let oldEnd = previous.length;
	let newEnd = next.length;
	while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
		oldEnd--;
		newEnd--;
	}
	const delta = newEnd - oldEnd;
	return mentions.flatMap(mention => {
		if (mention.end <= start) return [mention];
		if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
		return [];
	});
}

/** `draft` with every intact compact mention replaced by its full mention; text typed by hand is left as is. */
export function expandDraftMentions(draft: string, mentions: readonly DraftMention[]): string {
	let result = draft;
	for (const entry of [...mentions].sort((a, b) => b.start - a.start)) {
		if (draft.slice(entry.start, entry.end) === entry.label) {
			// Draft state can survive an extension update; refresh the MCP hint from its saved identity.
			const reference = entry.kind === "mcp" ? mcpReference(entry.server) : entry.mention;
			result = result.slice(0, entry.start) + reference + result.slice(entry.end);
		}
	}
	return result;
}
