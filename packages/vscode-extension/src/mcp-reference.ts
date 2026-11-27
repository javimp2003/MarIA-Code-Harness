import { compile } from "@oh-my-pi/pi-utils/prompt";
import template from "./mcp-reference.md" with { type: "text" };

const render = compile(template.trimEnd());

/** Self-contained guidance works with existing engines; the selected name remains quoted user data. */
export function mcpReference(name: string): string {
	return render({
		name: JSON.stringify(name)
			.replaceAll("<", "\\u003c")
			.replaceAll(">", "\\u003e")
			.replaceAll("&", "\\u0026")
			.replaceAll("@", "\\u0040"),
	});
}

/** Recognize current and legacy persisted references; their guidance stays out of the visible prompt. */
export function splitMcpReferences(text: string): Array<string | { server: string; label: string }> {
	const parts: Array<string | { server: string; label: string }> = [];
	let offset = 0;
	// This is the extension's narrow reference format, not a general XML parser.
	const references =
		/<mcp-reference>\nUser-selected MCP server: ("(?:\\.|[^"\\])*")\n[^<]*<\/mcp-reference>|\bMCP\(("(?:\\.|[^"\\])*")\)/g;
	for (const match of text.matchAll(references)) {
		if (match.index > 0 && !/[\s([{<"'`]/.test(text[match.index - 1]!)) continue;
		let name: unknown;
		try {
			name = JSON.parse(match[1] ?? match[2]!);
		} catch {
			continue;
		}
		if (typeof name !== "string" || !name) continue;
		if (match.index > offset) parts.push(text.slice(offset, match.index));
		parts.push({ server: name, label: `#${name}` });
		offset = match.index + match[0].length;
	}
	if (offset < text.length) parts.push(text.slice(offset));
	return parts;
}

/** Human-readable text for History previews and text-length limits, without the model-facing guidance. */
export function displayMcpReferences(text: string): string {
	return splitMcpReferences(text)
		.map(part => (typeof part === "string" ? part : part.label))
		.join("");
}
