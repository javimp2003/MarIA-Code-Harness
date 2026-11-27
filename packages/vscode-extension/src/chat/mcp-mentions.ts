import type { McpMention, McpServers } from "../protocol";

/** The current chat's connected servers; no config paths, URLs or credentials enter completion results. */
export function searchMcpMentions(snapshot: McpServers, query: string): { entries: McpMention[]; connecting: boolean } {
	const needle = query.toLocaleLowerCase();
	const matches = (name: string) => name.toLocaleLowerCase().includes(needle);
	const entries = new Map<string, McpMention>();
	for (const server of snapshot.servers) {
		if (!server.enabled || server.status !== "connected" || !matches(server.name)) continue;
		entries.set(server.name, { kind: "mcp", name: server.name, tools: server.tools });
	}
	return {
		entries: [...entries.values()].sort(
			(a, b) =>
				Number(b.name.toLocaleLowerCase().startsWith(needle)) -
					Number(a.name.toLocaleLowerCase().startsWith(needle)) || a.name.localeCompare(b.name),
		),
		connecting: snapshot.servers.some(
			server => server.enabled && server.status === "connecting" && matches(server.name),
		),
	};
}
