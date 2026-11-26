import { getMCPConfigPath, isRecord } from "@oh-my-pi/pi-utils";
import { connectToServer, disconnectServer, listTools } from "../../mcp/client";
import { addMCPServer, readMCPConfigFile, removeMCPServer, setMcpServerEnabled } from "../../mcp/config-writer";
import { redactUrlForLog } from "../../mcp/json-rpc";
import type { MCPManager } from "../../mcp/manager";
import { reloadMCPServers } from "../../mcp/reload";
import { cfgMcpEnableProjectConfig } from "../../mcp/settings";
import type { MCPServerConfig } from "../../mcp/types";
import type { AgentSession } from "../../session/agent-session";

export type RpcMcpScope = "project" | "user";
export interface RpcMcpServerInput {
	type: "http" | "stdio" | "sse";
	url?: string;
	headers?: Record<string, string>;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}
export interface RpcMcpServer {
	name: string;
	scope: RpcMcpScope | "external";
	configPath: string;
	type: string;
	/** Credentials, arguments and environment values never enter the list response. */
	location: string;
	enabled: boolean;
	status: "connected" | "connecting" | "disconnected" | "disabled" | "inactive";
	tools: number;
	reason?: string;
}
export interface RpcMcpServers {
	servers: RpcMcpServer[];
	projectConfigPath: string;
	userConfigPath: string;
	projectEnabled: boolean;
	busy: boolean;
	message?: string;
	warning?: string;
}
export interface RpcManageMcpServer extends Omit<RpcMcpServerInput, "type"> {
	op: "add" | "remove" | "set_enabled" | "test" | "reload";
	name?: string;
	scope?: RpcMcpScope;
	transport?: RpcMcpServerInput["type"];
	enabled?: boolean;
}

/** Validate the host boundary before a config can be persisted or a process launched. */
export function rpcMcpServerConfig(input: RpcMcpServerInput): MCPServerConfig {
	if (!isRecord(input)) throw new Error("Falta la configuración del servidor.");
	const stringMap = (value: unknown): value is Record<string, string> =>
		isRecord(value) && Object.values(value).every(item => typeof item === "string");
	if (input.type === "http" || input.type === "sse") {
		if (typeof input.url !== "string") throw new Error("Indica la URL del servidor.");
		let url: URL;
		try {
			url = new URL(input.url);
		} catch {
			throw new Error("Introduce una URL HTTP o HTTPS válida.");
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("La URL debe usar HTTP o HTTPS.");
		if (url.username || url.password)
			throw new Error("Usa las cabeceras para las credenciales, en lugar de incluirlas en la URL.");
		if (input.headers !== undefined && !stringMap(input.headers))
			throw new Error("Las cabeceras deben contener nombres y valores de texto.");
		if (
			input.headers &&
			Object.entries(input.headers).some(
				([key, value]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n]/.test(value),
			)
		) {
			throw new Error("Hay una cabecera HTTP con un nombre o valor no válido.");
		}
		return { type: input.type, url: url.toString(), headers: input.headers, headerPolicy: "origin-locked" };
	}
	if (input.type !== "stdio") throw new Error("Elige HTTP, stdio o SSE como transporte.");
	if (typeof input.command !== "string" || !input.command.trim())
		throw new Error("Indica el comando que inicia el servidor.");
	if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some(arg => typeof arg !== "string")))
		throw new Error("Los argumentos deben ser una lista de textos.");
	if (
		input.env !== undefined &&
		(!stringMap(input.env) || Object.keys(input.env).some(key => !key || /[=\0]/.test(key)))
	)
		throw new Error("Hay una variable de entorno no válida.");
	if (input.cwd !== undefined && typeof input.cwd !== "string")
		throw new Error("La carpeta de trabajo debe ser una ruta.");
	return {
		type: "stdio",
		command: input.command.trim(),
		args: input.args,
		env: input.env,
		envPolicy: "literal",
		cwd: input.cwd || undefined,
	};
}

type McpSession = Pick<
	AgentSession,
	| "isStreaming"
	| "isCompacting"
	| "settings"
	| "setMCPPromptCommands"
	| "getEvalPreludes"
	| "effectiveExtensionRoots"
	| "refreshMCPTools"
>;

/** Structured MCP management for hosts. Uses the same writer and lifecycle as the TUI. */
export class RpcMcpController {
	#mutating = false;
	readonly #paths: Record<RpcMcpScope, string>;
	constructor(
		readonly session: McpSession,
		readonly manager: MCPManager | undefined,
		cwd: string,
		paths?: Record<RpcMcpScope, string>,
	) {
		this.#paths = paths ?? { project: getMCPConfigPath("project", cwd), user: getMCPConfigPath("user", cwd) };
	}

	async list(): Promise<RpcMcpServers> {
		const [project, user] = await Promise.all([
			readMCPConfigFile(this.#paths.project),
			readMCPConfigFile(this.#paths.user),
		]);
		const projectEnabled = cfgMcpEnableProjectConfig.get(this.session.settings);
		const disabled = new Set(user.disabledServers ?? []);
		const forced = new Set(user.enabledServers ?? []);
		const servers: RpcMcpServer[] = [];
		for (const scope of ["project", "user"] as const) {
			for (const [name, config] of Object.entries((scope === "project" ? project : user).mcpServers ?? {})) {
				const enabled = !disabled.has(name) && (config.enabled !== false || forced.has(name));
				let reason: string | undefined;
				if (scope === "project" && !projectEnabled)
					reason = "La configuración MCP del proyecto está desactivada en Ajustes.";
				else if (scope === "user" && projectEnabled && project.mcpServers?.[name])
					reason = "El servidor del proyecto con este nombre tiene prioridad.";
				const source = this.manager?.getSource(name);
				if (!reason && source && source.path !== this.#paths[scope])
					reason = "Otra configuración con este nombre tiene prioridad.";
				const status = !enabled
					? "disabled"
					: reason
						? "inactive"
						: (this.manager?.getConnectionStatus(name) ?? "disconnected");
				servers.push({
					name,
					scope,
					configPath: this.#paths[scope],
					type: config.type ?? "stdio",
					location: "url" in config ? redactUrlForLog(config.url, { omitQuery: true }) : config.command,
					enabled,
					status,
					tools: status === "connected" ? (this.manager?.getConnection(name)?.tools?.length ?? 0) : 0,
					reason,
				});
			}
		}
		for (const name of this.manager?.getAllServerNames() ?? []) {
			if (servers.some(server => server.name === name && server.status !== "inactive")) continue;
			const config = this.manager?.getServerConfig(name);
			if (!config) continue;
			servers.push({
				name,
				scope: "external",
				configPath: this.manager?.getSource(name)?.path ?? "",
				type: config.type ?? "stdio",
				location: "url" in config ? redactUrlForLog(config.url, { omitQuery: true }) : config.command,
				enabled: true,
				status: this.manager?.getConnectionStatus(name) ?? "disconnected",
				tools: this.manager?.getConnection(name)?.tools?.length ?? 0,
			});
		}
		return {
			servers,
			projectConfigPath: this.#paths.project,
			userConfigPath: this.#paths.user,
			projectEnabled,
			busy: this.session.isStreaming || this.session.isCompacting,
		};
	}

	async manage(request: RpcManageMcpServer): Promise<RpcMcpServers> {
		if (this.#mutating) throw new Error("Espera a que termine la operación MCP en curso.");
		if (this.session.isStreaming || this.session.isCompacting)
			throw new Error("Espera a que MarIA Code termine la tarea para cambiar los servidores MCP.");
		if (!this.manager) throw new Error("MCP no está disponible en esta sesión.");
		this.#mutating = true;
		try {
			if (request.op === "reload") {
				await reloadMCPServers(this.manager, this.session);
				return { ...(await this.list()), message: "Servidores MCP recargados." };
			}
			if (request.scope !== "project" && request.scope !== "user")
				throw new Error("Elige el ámbito del servidor: proyecto o usuario.");
			if (typeof request.name !== "string" || !request.name.trim())
				throw new Error("Indica el nombre del servidor.");
			const { name, scope } = request;
			const file = this.#paths[scope];
			if (request.op === "add") {
				if (!request.transport) throw new Error("Falta el transporte del servidor.");
				await addMCPServer(file, name, rpcMcpServerConfig({ ...request, type: request.transport }));
			} else {
				const config = (await readMCPConfigFile(file)).mcpServers?.[name];
				if (!config) throw new Error("Este servidor ya no está en la configuración. Actualiza la lista.");
				switch (request.op) {
					case "remove":
						await removeMCPServer(file, name);
						break;
					case "set_enabled":
						if (typeof request.enabled !== "boolean")
							throw new Error("Indica si el servidor debe estar activado.");
						await setMcpServerEnabled({
							userPath: this.#paths.user,
							projectPath: this.#paths.project,
							sourcePath: file,
							name,
							enabled: request.enabled,
						});
						break;
					case "test": {
						const prepared = await this.manager.prepareConfig(config);
						const connection = await connectToServer(name, prepared);
						try {
							const tools = await listTools(connection);
							return {
								...(await this.list()),
								message: `Conexión correcta con «${name}»: ${tools.length} herramientas disponibles.`,
							};
						} finally {
							await disconnectServer(connection);
						}
					}
					default:
						throw new Error("Operación MCP no válida.");
				}
			}
			// Saving and connecting are different outcomes: do not invite a duplicate add when only reload failed.
			let warning: string | undefined;
			try {
				await reloadMCPServers(this.manager, this.session);
			} catch {
				warning =
					"La configuración se ha guardado, pero no se ha podido recargar. Pulsa Recargar para reintentarlo.";
			}
			return {
				...(await this.list()),
				message: request.op === "add" ? `Servidor «${name}» guardado.` : "Configuración MCP actualizada.",
				warning,
			};
		} finally {
			this.#mutating = false;
		}
	}
}
