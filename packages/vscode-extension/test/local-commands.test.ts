import { describe, expect, it } from "bun:test";
import type { ChatRequest } from "../src/protocol";
import { chatLocalCommands } from "../webview/chat/local-commands";

describe("chat local commands", () => {
	it("offers /fork and routes it to a session fork instead of an agent prompt", () => {
		const requests: ChatRequest[] = [];
		const fork = chatLocalCommands(request => requests.push(request), () => {}).find(command => command.name === "fork");

		expect(fork).toBeDefined();
		fork!.run("");
		expect(requests).toEqual([{ type: "forkSession" }]);
	});
});
