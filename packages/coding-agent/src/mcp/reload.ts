import { clearCache } from "../capability/fs";
import type { AgentSession } from "../session/agent-session";
import type { MCPManager, MCPLoadResult } from "./manager";
import { cfgMcpEnableProjectConfig } from "./settings";

/** Reload with the session's startup filters and remove stale prompt commands. */
export async function reloadMCPServers(
	manager: MCPManager,
	session: Pick<
		AgentSession,
		"settings" | "setMCPPromptCommands" | "getEvalPreludes" | "effectiveExtensionRoots" | "refreshMCPTools"
	>,
	settings: AgentSession["settings"] = session.settings,
): Promise<MCPLoadResult> {
	await manager.disconnectAll();
	session.setMCPPromptCommands([]);
	clearCache();
	const result = await manager.discoverAndConnect({
		enableProjectConfig: cfgMcpEnableProjectConfig.get(settings),
		filterExa: true,
		filterBrowser: session.getEvalPreludes().some(definition => definition.name === "browser"),
		extensionRoots: session.effectiveExtensionRoots,
	});
	await session.refreshMCPTools(manager.getTools());
	return result;
}
