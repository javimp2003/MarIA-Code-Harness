import { describe, expect, it } from "bun:test";
import { assistantEntryIdAt } from "../src/chat/assistant-entry";

describe("assistant transcript entry lookup", () => {
	it("matches an assistant message by timestamp and ignores other entry roles", () => {
		const entries = [
			{ type: "message", id: "user", message: { role: "user", timestamp: 42 } },
			{ type: "message", id: "assistant", message: { role: "assistant", timestamp: 42 } },
			{ type: "message", id: "later", message: { role: "assistant", timestamp: 43 } },
		];

		expect(assistantEntryIdAt(entries, 42)).toBe("assistant");
		expect(assistantEntryIdAt(entries, 44)).toBeUndefined();
	});
});
