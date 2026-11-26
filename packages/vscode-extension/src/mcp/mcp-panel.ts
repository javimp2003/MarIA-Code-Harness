import * as vscode from "vscode";
import { errorMessage, type AgentHost } from "../chat/agent-host";
import { displayPath } from "../config";
import type { McpRequest, McpUpdate } from "../protocol";
import { webviewHtml } from "../webview-html";

/** A panel stays bound to the chat that opened it, including its profile and working directory. */
export class McpPanel implements vscode.Disposable {
	static #current: McpPanel | undefined;
	static show(extensionUri: vscode.Uri, host: AgentHost): void {
		if (McpPanel.#current?.host === host) {
			McpPanel.#current.#panel.reveal();
			return;
		}
		McpPanel.close();
		McpPanel.#current = new McpPanel(extensionUri, host);
	}
	static close(): void {
		McpPanel.#current?.dispose();
	}
	readonly #panel: vscode.WebviewPanel;
	readonly #disposables: vscode.Disposable[] = [];
	#disposed = false;
	#pending = false;

	constructor(
		extensionUri: vscode.Uri,
		readonly host: AgentHost,
	) {
		this.#panel = vscode.window.createWebviewPanel(
			"ompCustom.mcp",
			"Servidores MCP · MarIA Code",
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview")],
			},
		);
		this.#panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "maria-mark.png");
		this.#panel.webview.html = webviewHtml(this.#panel.webview, extensionUri, "mcp");
		this.#disposables.push(
			this.#panel.onDidDispose(() => this.dispose()),
			this.#panel.webview.onDidReceiveMessage((request: McpRequest) => void this.#handle(request)),
		);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (McpPanel.#current === this) McpPanel.#current = undefined;
		for (const disposable of this.#disposables) disposable.dispose();
		this.#panel.dispose();
	}
	#post(update: McpUpdate): void {
		if (this.#disposed) return;
		if (update.type === "mcpState") {
			update = {
				...update,
				state: {
					...update.state,
					projectConfigPath: displayPath(update.state.projectConfigPath),
					userConfigPath: displayPath(update.state.userConfigPath),
					servers: update.state.servers.map(server => ({
						...server,
						configPath: displayPath(server.configPath),
						location: server.type === "stdio" ? displayPath(server.location) : server.location,
					})),
				},
			};
		}
		void this.#panel.webview.postMessage(update);
	}

	async #handle(request: McpRequest): Promise<void> {
		if (!request || this.#disposed) return;
		if (this.#pending && (request.type === "ready" || request.type === "refresh")) return;
		const requestId = request.type === "manage" ? request.requestId : undefined;
		if (this.#pending) {
			this.#post({ type: "mcpError", requestId, message: "Espera a que termine la operación en curso." });
			return;
		}
		try {
			this.#pending = true;
			const process = this.host.process;
			if (!process) throw new Error("El chat se ha cerrado. Abre Servidores MCP desde un chat activo.");
			if (request.type === "openConfig") {
				const state = await process.request("get_mcp_servers");
				const file = request.scope === "project" ? state.projectConfigPath : state.userConfigPath;
				// An untitled document does not create or overwrite a config until the user saves it.
				const uri = vscode.Uri.file(file);
				try {
					await vscode.workspace.fs.stat(uri);
				} catch (error) {
					if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
					await vscode.window.showTextDocument(
						await vscode.workspace.openTextDocument(uri.with({ scheme: "untitled" })),
					);
					return;
				}
				await vscode.window.showTextDocument(uri);
				return;
			}
			if (request.type === "manage" && request.params.op === "remove") {
				const choice = await vscode.window.showWarningMessage(
					`¿Eliminar el servidor MCP «${request.params.name}»?`,
					{
						modal: true,
						detail: "Se eliminará su configuración de MarIA Code. El servidor no se desinstala.",
					},
					"Eliminar",
				);
				if (choice !== "Eliminar") {
					this.#post({
						type: "mcpState",
						state: await process.request("get_mcp_servers"),
						folder: displayPath(process.command.cwd),
						requestId,
					});
					return;
				}
			}
			const state =
				request.type === "manage"
					? await process.request("manage_mcp_server", request.params, 60_000)
					: await process.request("get_mcp_servers");
			this.#post({ type: "mcpState", state, folder: displayPath(process.command.cwd), requestId });
		} catch (error) {
			const message = errorMessage(error);
			this.#post({
				type: "mcpError",
				requestId,
				message: /Unknown command/.test(message)
					? "Esta versión del motor omp todavía no admite la gestión visual de MCP. Actualiza el motor y reinicia el agente desde la paleta de comandos."
					: message,
			});
		} finally {
			this.#pending = false;
		}
	}
}
