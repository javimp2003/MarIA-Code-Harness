import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { OmpProcess } from "../src/rpc/omp-process";
import { mcpFormRequest } from "../webview/mcp/form";

const fixture = path.resolve(import.meta.dir, "../../coding-agent/test/fixtures/mcp-ui-rpc-agent.ts");
const serverFixture = path.resolve(import.meta.dir, "../../coding-agent/test/fixtures/readiness-mcp.ts");

describe("visual MCP management over the extension's real RPC client", () => {
	let root: string;
	let rpc: OmpProcess;
	let http: Bun.Server<undefined> | undefined;
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "maria-mcp-ui-"));
		rpc = new OmpProcess({
			executable: process.execPath,
			args: [fixture],
			cwd: root,
			env: {
				HOME: root,
				PI_CONFIG_DIR: path.join(root, "config"),
				PI_CODING_AGENT_DIR: path.join(root, "agent"),
				OMP_PROFILE: "",
				PI_PROFILE: "",
				CI: "true",
			},
		});
		await rpc.start([]);
	}, 20_000);
	afterEach(async () => {
		await rpc?.stop();
		http?.stop(true);
		http = undefined;
		await fs.rm(root, { recursive: true, force: true });
	});

	it("adds a local server, exposes its tools, disables and re-enables it, then removes it", async () => {
		const params = mcpFormRequest({
			name: "local",
			scope: "project",
			transport: "stdio",
			url: "",
			token: "",
			command: process.execPath,
			args: serverFixture,
			cwd: root,
			headers: [],
			env: [["SRV_NAME", "local"]],
		});
		await rpc.request("manage_mcp_server", params, 10_000);
		let snapshot = await rpc.request("get_mcp_servers");
		for (let i = 0; i < 30 && snapshot.servers[0]?.status === "connecting"; i++) {
			await Bun.sleep(20);
			snapshot = await rpc.request("get_mcp_servers");
		}
		expect(snapshot.servers).toEqual([
			expect.objectContaining({ name: "local", scope: "project", status: "connected", tools: 1 }),
		]);
		const test = await rpc.request("manage_mcp_server", { op: "test", name: "local", scope: "project" });
		expect(test.message).toContain("1 herramientas");
		const disabled = await rpc.request("manage_mcp_server", {
			op: "set_enabled",
			name: "local",
			scope: "project",
			enabled: false,
		});
		expect(disabled.servers[0]).toMatchObject({ status: "disabled", tools: 0, enabled: false });
		const persisted = await Bun.file(snapshot.projectConfigPath).json();
		expect(persisted.mcpServers.local.enabled).toBe(false);
		await rpc.request("manage_mcp_server", { op: "set_enabled", name: "local", scope: "project", enabled: true });
		const removed = await rpc.request("manage_mcp_server", { op: "remove", name: "local", scope: "project" });
		expect(removed.servers).toEqual([]);
		expect((await Bun.file(snapshot.projectConfigPath).json()).mcpServers).toEqual({});
	}, 20_000);

	it("connects an HTTP server using literal credentials, keeps them out of the list and preserves existing user configuration", async () => {
		const credentials: (string | null)[] = [];
		http = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			async fetch(req) {
				if (req.method === "GET") return new Response(null, { status: 405 });
				if (req.method === "DELETE") return new Response(null, { status: 204 });
				credentials.push(req.headers.get("X-Test-Key"));
				const body = (await req.json()) as { id?: number; method: string };
				if (body.id === undefined) return new Response(null, { status: 202 });
				const result =
					body.method === "initialize"
						? {
								protocolVersion: "2025-11-25",
								capabilities: { tools: {} },
								serverInfo: { name: "remote", version: "1" },
							}
						: { tools: [{ name: "lookup", inputSchema: { type: "object", properties: {} } }] };
				return Response.json({ jsonrpc: "2.0", id: body.id, result });
			},
		});
		const before = await rpc.request("get_mcp_servers");
		await Bun.write(
			before.userConfigPath,
			JSON.stringify({
				disabledServers: ["other"],
				mcpServers: { existing: { command: "unused", enabled: false } },
			}),
		);
		await rpc.request("manage_mcp_server", {
			op: "add",
			name: "remote",
			scope: "user",
			transport: "http",
			url: `http://127.0.0.1:${http.port}/mcp?session=hidden-query`,
			headers: { "X-Test-Key": `!literal-\${HOME}` },
		});
		const result = await rpc.request("manage_mcp_server", { op: "test", name: "remote", scope: "user" });
		expect(result.message).toContain("1 herramientas");
		expect(credentials.length).toBeGreaterThan(0);
		expect(credentials.every(value => value === `!literal-\${HOME}`)).toBe(true);
		expect(JSON.stringify(result)).not.toContain("!literal-");
		expect(JSON.stringify(result)).not.toContain("hidden-query");
		const persisted = await Bun.file(before.userConfigPath).json();
		expect(persisted.disabledServers).toEqual(["other"]);
		expect(persisted.mcpServers.existing.enabled).toBe(false);
		expect(persisted.mcpServers.remote.headers["X-Test-Key"]).toBe(`!literal-\${HOME}`);
	}, 20_000);

	it("rejects duplicates and invalid remote configuration without overwriting the saved server", async () => {
		await rpc.request("manage_mcp_server", {
			op: "add",
			name: "saved",
			scope: "project",
			transport: "stdio",
			command: process.execPath,
			args: [serverFixture],
			cwd: root,
		});
		await expect(
			rpc.request("manage_mcp_server", {
				op: "add",
				name: "saved",
				scope: "project",
				transport: "http",
				url: "https://example.com/mcp",
			}),
		).rejects.toThrow(/already exists/);
		await expect(
			rpc.request("manage_mcp_server", {
				op: "add",
				name: "bad",
				scope: "project",
				transport: "http",
				url: "file:///tmp/mcp",
			}),
		).rejects.toThrow(/HTTP/);
		const snapshot = await rpc.request("get_mcp_servers");
		expect(snapshot.servers.map(server => server.name)).toEqual(["saved"]);
		expect((await Bun.file(snapshot.projectConfigPath).json()).mcpServers.saved.command).toBe(process.execPath);
	}, 20_000);
});
