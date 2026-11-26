import { describe, expect, it } from "bun:test";
import { mcpFormRequest, type McpFormDraft } from "../webview/mcp/form";

const draft: McpFormDraft = {
	name: "docs",
	scope: "project",
	transport: "http",
	url: "https://example.com/mcp",
	token: "",
	command: "",
	args: "",
	cwd: "",
	headers: [],
	env: [],
};

describe("MCP form submission", () => {
	it("sends remote credentials as headers and omits hidden local fields", () => {
		expect(
			mcpFormRequest({
				...draft,
				token: " secret ",
				headers: [[" X-Tenant ", "team"]],
				command: "stale",
				env: [["KEY", "stale"]],
			}),
		).toEqual({
			op: "add",
			name: "docs",
			scope: "project",
			transport: "http",
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer secret", "X-Tenant": "team" },
		});
	});
	it("keeps spaces, quotes and environment values literal and skips blank argument lines for a local command", () => {
		const request = mcpFormRequest({
			...draft,
			transport: "stdio",
			command: " /path with spaces/server ",
			args: '--dir\r\n/path with spaces\r\n"quoted"\r\n',
			env: [
				["TOKEN", `!literal \${HOME}`],
				["EMPTY", ""],
			],
			token: "stale",
		});
		expect(request.args).toEqual(["--dir", "/path with spaces", '"quoted"']);
		expect(request.command).toBe("/path with spaces/server");
		expect(request.env).toEqual({ TOKEN: `!literal \${HOME}`, EMPTY: "" });
		expect(request.headers).toBeUndefined();
		expect(request.url).toBeUndefined();
	});
	it("rejects duplicate HTTP headers case-insensitively and conflicting authorization", () => {
		expect(() =>
			mcpFormRequest({
				...draft,
				headers: [
					["X-Key", "a"],
					["x-key", "b"],
				],
			}),
		).toThrow(/más de una vez/);
		expect(() => mcpFormRequest({ ...draft, token: "a", headers: [["authorization", "b"]] })).toThrow(
			/elige solo uno/,
		);
	});
	it("rejects unsafe URLs, missing names and incomplete environment rows before sending", () => {
		expect(() => mcpFormRequest({ ...draft, url: "file:///tmp/server" })).toThrow(/https/);
		expect(() => mcpFormRequest({ ...draft, url: "https://user:pass@example.com/mcp" })).toThrow(/credenciales/);
		expect(() => mcpFormRequest({ ...draft, name: "  " })).toThrow(/nombre/);
		expect(() => mcpFormRequest({ ...draft, transport: "stdio", command: "server", env: [["", "secret"]] })).toThrow(
			/nombre/,
		);
	});
});
