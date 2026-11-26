import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { runRpcMode } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mode";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

// Real RPC, discovery, writer and session tool registry; tests never submit an LLM prompt.
const cwd = process.cwd();
const authStorage = await AuthStorage.create(path.join(cwd, "auth.db"));
authStorage.keys.setRuntime("anthropic", "test-key");
const settings = Settings.isolated({ "async.enabled": false });
const { session, mcpManager } = await createAgentSession({
	cwd,
	agentDir: process.env.PI_CODING_AGENT_DIR,
	authStorage,
	settings,
	modelRegistry: new ModelRegistry(authStorage, path.join(cwd, "models.yml")),
	model: getBundledModel("anthropic", "claude-sonnet-4-5"),
	sessionManager: SessionManager.inMemory(cwd),
	disableExtensionDiscovery: true,
	skills: [],
	contextFiles: [],
	promptTemplates: [],
	slashCommands: [],
	workspaceTree: { rootPath: cwd, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
	enableMCP: true,
	enableLsp: false,
	hasUI: true,
});
await runRpcMode(session, { mcpManager });
