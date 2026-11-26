import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as utils from "@oh-my-pi/pi-utils";
import { mcpCapability } from "@oh-my-pi/pi-coding-agent/capability/mcp";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp/manager";
import { RpcMcpController, rpcMcpServerConfig } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mcp";
import "@oh-my-pi/pi-coding-agent/discovery";

describe("MCP management boundaries", () => {
	let root: string;
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-rpc-mcp-"));
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(root, { recursive: true, force: true });
	});

	function fixture(projectEnabled = true) {
		const session = {
			settings: Settings.isolated({ "mcp.enableProjectConfig": projectEnabled }),
			isStreaming: false,
			isCompacting: false,
			setMCPPromptCommands() {},
			getEvalPreludes: () => [],
			effectiveExtensionRoots: {
				explicit: [],
				configured: [],
				mode: "merge" as const,
				configuredLevel: "user" as const,
			},
			async refreshMCPTools() {},
		};
		const paths = { project: path.join(root, ".omp", "mcp.json"), user: path.join(root, "agent", "mcp.json") };
		return { session, paths, controller: new RpcMcpController(session, undefined, root, paths) };
	}

	it("marks a shadowed user server inactive and respects the user denylist and project opt-out", async () => {
		const { paths, controller } = fixture();
		await Bun.write(
			paths.project,
			JSON.stringify({ mcpServers: { shared: { command: "project" }, denied: { command: "blocked" } } }),
		);
		await Bun.write(
			paths.user,
			JSON.stringify({ disabledServers: ["denied"], mcpServers: { shared: { command: "user" } } }),
		);
		const snapshot = await controller.list();
		expect(snapshot.servers.find(server => server.name === "shared" && server.scope === "user")?.status).toBe(
			"inactive",
		);
		expect(snapshot.servers.find(server => server.name === "denied")?.status).toBe("disabled");
		const optedOut = await fixture(false).controller.list();
		expect(optedOut.servers.find(server => server.name === "shared" && server.scope === "project")?.status).toBe(
			"inactive",
		);
		expect(optedOut.servers.find(server => server.name === "shared" && server.scope === "user")?.status).toBe(
			"disconnected",
		);
	});

	it("rejects writes while the session works or has no MCP manager", async () => {
		const { session, controller, paths } = fixture();
		session.isStreaming = true;
		await expect(
			controller.manage({ op: "add", name: "server", scope: "project", transport: "stdio", command: "server" }),
		).rejects.toThrow(/termine la tarea/);
		session.isStreaming = false;
		await expect(controller.manage({ op: "reload" })).rejects.toThrow(/no está disponible/);
		expect(await Bun.file(paths.project).exists()).toBe(false);
	});

	it("rejects header injection and invalid local settings before any process is launched", () => {
		expect(() =>
			rpcMcpServerConfig({ type: "http", url: "https://example.com", headers: { Key: "value\r\nInjected: yes" } }),
		).toThrow(/cabecera/);
		expect(() => rpcMcpServerConfig({ type: "stdio", command: " " })).toThrow(/comando/);
		expect(() => rpcMcpServerConfig({ type: "stdio", command: "server", env: { "INVALID=KEY": "value" } })).toThrow(
			/variable/,
		);
	});

	it("preserves local form environment values through discovery and auth preparation, while existing configs still expand variables", async () => {
		vi.spyOn(utils, "getAgentDir").mockReturnValue(path.join(root, "agent"));
		const literal = `!literal-\${HOME}`;
		await Bun.write(
			path.join(root, ".omp", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					local: rpcMcpServerConfig({ type: "stdio", command: "server", env: { KEY: literal, EMPTY: "" } }),
					remote: rpcMcpServerConfig({
						type: "http",
						url: "https://example.com/mcp",
						headers: { "X-Key": literal },
					}),
					existing: { command: "server", env: { HOME_VALUE: `\${HOME}` } },
				},
			}),
		);
		const provider = mcpCapability.providers.find(candidate => candidate.id === "native")!;
		const loaded = await provider.load({ cwd: root, home: root, repoRoot: null });
		const local = loaded.items.find(server => server.name === "local")!;
		const manager = new MCPManager(root);
		const localConfig = await manager.prepareConfig({
			type: "stdio",
			command: local.command!,
			env: local.env,
			envPolicy: local.envPolicy,
		});

		expect("env" in localConfig && localConfig.env).toEqual({ KEY: literal, EMPTY: "" });
		expect(loaded.items.find(server => server.name === "existing")?.env?.HOME_VALUE).toBe(process.env.HOME!);
	});
});
