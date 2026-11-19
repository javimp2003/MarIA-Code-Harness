import type { ChatRequest } from "../../src/protocol";

/** A slash command the webview handles when omp does not advertise the action in its RPC command list. */
export interface LocalCommand {
	name: string;
	description: string;
	/** `args` is the text after the command name, trimmed. */
	run(args: string): void;
}

export function chatLocalCommands(post: (request: ChatRequest) => void, openHistory: () => void): LocalCommand[] {
	return [
		{ name: "new", description: "Start a new session", run: () => post({ type: "newSession" }) },
		{ name: "resume", description: "Resume a different session", run: openHistory },
		{
			name: "fork",
			description: "Fork this conversation into a new session",
			run: () => post({ type: "forkSession" }),
		},
		{ name: "settings", description: "Open settings", run: () => post({ type: "openSettings" }) },
	];
}
