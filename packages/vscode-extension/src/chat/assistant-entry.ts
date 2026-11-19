/** The session entry behind a completed assistant message in the transcript. */
export function assistantEntryIdAt(entries: readonly Record<string, unknown>[], timestamp: number): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry || entry.type !== "message" || typeof entry.id !== "string") continue;
		const message = entry.message;
		if (
			message &&
			typeof message === "object" &&
			"role" in message &&
			message.role === "assistant" &&
			"timestamp" in message &&
			message.timestamp === timestamp
		) {
			return entry.id;
		}
	}
	return undefined;
}
