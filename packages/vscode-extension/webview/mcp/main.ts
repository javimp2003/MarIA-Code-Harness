import type { McpRequest, McpUpdate, McpServers, McpServer, ManageMcpServerParams } from "../../src/protocol";
import { h, button } from "../dom";
import { icon } from "../icons";
import { getVsCodeApi } from "../vscode-api";
import { mcpFormRequest } from "./form";

/** Optional key/value fields, with explicit labels and masked credentials. */
class PairEditor {
	readonly element: HTMLElement;
	readonly #rows = h("div", { className: "pair-rows" });
	constructor(
		label: string,
		addLabel: string,
		readonly keyLabel: string,
		readonly placeholder: string,
	) {
		this.element = h(
			"details",
			{ className: "pair-editor" },
			h("summary", {}, `${label} (opcional)`),
			this.#rows,
			button(addLabel, "secondary", () => this.#add()),
		);
	}
	#add(): void {
		const key = h("input", {
			type: "text",
			ariaLabel: this.keyLabel,
			placeholder: this.placeholder,
			spellcheck: false,
		});
		const value = h("input", {
			type: "password",
			ariaLabel: "Valor",
			placeholder: "Valor",
			autocomplete: "off",
			spellcheck: false,
		});
		const row = h(
			"div",
			{ className: "pair-row" },
			key,
			value,
			button("Quitar", "link", () => {
				row.remove();
				this.element.querySelector<HTMLButtonElement>("button.secondary")?.focus();
			}),
		);
		this.#rows.append(row);
		key.focus();
	}
	values(): [string, string][] {
		return Array.from(this.#rows.children, row => {
			const inputs = row.querySelectorAll("input");
			return [inputs[0]!.value, inputs[1]!.value];
		});
	}
	clear(): void {
		this.#rows.replaceChildren();
		(this.element as HTMLDetailsElement).open = false;
	}
}

const vscode = getVsCodeApi<McpRequest, undefined>();
let state: McpServers | undefined;
let pending: { id: number; op: ManageMcpServerParams["op"] } | undefined;
let nextId = 0;
let renderedServers = "";
let polling = true;

const folder = h("span", { className: "description context-folder" });
const notice = h("div", { className: "mcp-notice", role: "status", hidden: true });
const busyHint = h(
	"p",
	{ className: "hint", hidden: true },
	"MarIA Code está trabajando. Podrás cambiar los servidores cuando termine la tarea.",
);
const list = h(
	"div",
	{ className: "server-list", ariaLive: "polite" },
	h("p", { className: "empty" }, "Cargando servidores…"),
);
const add = button("Añadir servidor", "primary", () => openForm());
add.prepend(icon("plus"));
const refresh = button("Actualizar", "secondary", () => {
	polling = true;
	vscode.postMessage({ type: "refresh" });
});
const reload = button("Recargar conexiones", "secondary", () => manage({ op: "reload" }));
const count = h("span", { className: "server-count" });
const configProject = button("Configuración del proyecto", "link", () =>
	vscode.postMessage({ type: "openConfig", scope: "project" }),
);
const configUser = button("Configuración de usuario", "link", () =>
	vscode.postMessage({ type: "openConfig", scope: "user" }),
);

const form = h("form", { className: "server-form", hidden: true });
const fields = h("fieldset");
const name = h("input", {
	type: "text",
	required: true,
	maxLength: 100,
	placeholder: "p. ej., documentacion",
	autocomplete: "off",
});
const scope = h(
	"select",
	{},
	h("option", { value: "project" }, "Solo este proyecto"),
	h("option", { value: "user" }, "Todos mis proyectos"),
);
const scopeHint = h("span", { className: "hint scope-path" });
const transport = h(
	"select",
	{},
	h("option", { value: "http" }, "Remoto · HTTP (recomendado)"),
	h("option", { value: "stdio" }, "Local · Comando (stdio)"),
	h("option", { value: "sse" }, "Remoto · SSE (compatibilidad)"),
);
const url = h("input", { type: "url", placeholder: "https://servidor.example/mcp", spellcheck: false });
const token = h("input", { type: "password", placeholder: "Opcional", autocomplete: "off", spellcheck: false });
const command = h("input", {
	type: "text",
	placeholder: "p. ej., npx, uvx o la ruta del ejecutable",
	spellcheck: false,
});
const args = h("textarea", { rows: 4, placeholder: "-y\npaquete-del-servidor", spellcheck: false });
const cwd = h("input", { type: "text", placeholder: "Por defecto, la carpeta del chat", spellcheck: false });
const headers = new PairEditor("Cabeceras HTTP", "Añadir cabecera", "Nombre de cabecera", "p. ej., X-API-Key");
const env = new PairEditor("Variables de entorno", "Añadir variable", "Nombre de variable", "p. ej., API_KEY");
const remote = h(
	"fieldset",
	{ className: "form-group" },
	field("URL del servidor", url),
	field("Token Bearer", token, "Si el servidor lo requiere. Se envía como Authorization: Bearer …"),
	headers.element,
);
const local = h(
	"fieldset",
	{ className: "form-group", hidden: true },
	field("Comando", command, "El ejecutable, sin argumentos. Se inicia directamente, sin un intérprete de comandos."),
	field(
		"Argumentos",
		args,
		"Un argumento por línea, sin comillas adicionales. Las líneas vacías se omiten; las rutas con espacios van en una sola línea.",
	),
	env.element,
	field("Carpeta de trabajo", cwd),
);
const formError = h("div", { className: "error", role: "alert", hidden: true });
const save = h("button", { type: "submit", className: "primary" }, "Guardar y conectar");
const cancel = button("Cancelar", "secondary", () => closeForm());
const secretHint = h("p", { className: "hint" });
fields.append(
	h("legend", {}, "Añadir servidor MCP"),
	h(
		"p",
		{ className: "description" },
		"Conecta una herramienta o fuente de datos para que MarIA Code pueda utilizarla en tus tareas.",
	),
	field("Nombre", name),
	h(
		"div",
		{ className: "form-columns" },
		field("Disponible en", scope, scopeHint),
		field("Tipo de conexión", transport),
	),
	remote,
	local,
	secretHint,
	formError,
	h("div", { className: "actions form-actions" }, save, cancel),
);
form.append(fields);

document
	.getElementById("root")!
	.append(
		h(
			"div",
			{ className: "app mcp-app" },
			h(
				"header",
				{ className: "header" },
				h(
					"div",
					{ className: "mcp-heading" },
					h("span", { className: "mcp-mark" }, icon("mcp")),
					h(
						"div",
						{},
						h("h1", {}, "Servidores MCP"),
						h("p", { className: "description" }, "Conecta MarIA Code a tus herramientas y datos."),
					),
				),
				refresh,
			),
			h(
				"main",
				{ className: "mcp-content" },
				h("div", { className: "context" }, icon("folder"), folder),
				notice,
				busyHint,
				h("div", { className: "section-toolbar" }, h("h2", {}, "Tus servidores ", count), add),
				form,
				list,
				h(
					"footer",
					{ className: "mcp-footer" },
					h("div", { className: "actions" }, reload),
					h(
						"p",
						{ className: "hint" },
						"Los cambios se aplican a este chat y a los nuevos chats. Comparte la configuración con el motor del terminal.",
					),
					h("div", { className: "config-links" }, configProject, configUser),
				),
			),
		),
	);

function field(label: string, control: HTMLElement, hint?: string | HTMLElement): HTMLElement {
	const id = `mcp-${label.toLowerCase().replace(/\s+/g, "-")}`;
	control.id = id;
	const help = hint ? h("span", { className: "hint", id: `${id}-hint` }, hint) : undefined;
	if (help) control.setAttribute("aria-describedby", help.id);
	return h("div", { className: "field" }, h("label", { htmlFor: id }, label), control, help);
}

function scopeChanged(): void {
	const project = scope.value === "project";
	scopeHint.textContent = (project ? state?.projectConfigPath : state?.userConfigPath) ?? "";
	secretHint.textContent = project
		? "Las credenciales se guardan en el archivo de configuración del proyecto. Usa «Todos mis proyectos» si no quieres compartirlas con el repositorio."
		: "La configuración y las credenciales se guardan en tu archivo de usuario del perfil activo.";
}
scope.addEventListener("change", scopeChanged);
transport.addEventListener("change", () => {
	const isLocal = transport.value === "stdio";
	local.hidden = !isLocal;
	remote.hidden = isLocal;
	remote.disabled = isLocal;
	local.disabled = !isLocal;
	url.required = !isLocal;
	command.required = isLocal;
});
form.addEventListener("input", () => {
	formError.hidden = true;
});
form.addEventListener("keydown", event => {
	if (event.key === "Escape" && !pending) {
		event.preventDefault();
		closeForm();
	}
});
form.addEventListener("submit", event => {
	event.preventDefault();
	if (pending) return;
	try {
		const params = mcpFormRequest({
			name: name.value,
			scope: scope.value as "project" | "user",
			transport: transport.value as "http" | "stdio" | "sse",
			url: url.value,
			token: token.value,
			command: command.value,
			args: args.value,
			cwd: cwd.value,
			headers: headers.values(),
			env: env.values(),
		});
		if (state?.servers.some(server => server.name === params.name && server.scope === params.scope))
			throw new Error("Ya existe un servidor con este nombre en este ámbito. Elige otro nombre.");
		manage(params);
	} catch (error) {
		formError.textContent = error instanceof Error ? error.message : String(error);
		formError.hidden = false;
	}
});

function openForm(): void {
	notice.hidden = true;
	form.hidden = false;
	list.hidden = state?.servers.length === 0;
	scope.value = state?.projectEnabled ? "project" : "user";
	scopeChanged();
	transport.dispatchEvent(new Event("change"));
	add.hidden = true;
	name.focus();
}
function closeForm(): void {
	form.hidden = true;
	list.hidden = false;
	form.reset();
	headers.clear();
	env.clear();
	formError.hidden = true;
	add.hidden = false;
	add.focus();
}
function manage(params: ManageMcpServerParams): void {
	if (pending) return;
	pending = { id: ++nextId, op: params.op };
	notice.textContent =
		params.op === "test"
			? `Comprobando la conexión con «${params.name}»…`
			: params.op === "add"
				? "Guardando el servidor y conectando…"
				: "Actualizando servidores…";
	notice.className = "mcp-notice";
	notice.setAttribute("role", "status");
	notice.hidden = false;
	setDisabled();
	vscode.postMessage({ type: "manage", requestId: pending.id, params });
}
function setDisabled(): void {
	const disabled = !state || state.busy || !!pending;
	fields.disabled = disabled;
	add.disabled = disabled;
	reload.disabled = disabled;
	refresh.disabled = !!pending;
	for (const control of list.querySelectorAll<HTMLButtonElement>("button")) control.disabled = disabled;
	save.textContent = pending?.op === "add" ? "Guardando y conectando…" : "Guardar y conectar";
	reload.textContent = pending?.op === "reload" ? "Recargando…" : "Recargar conexiones";
	list.setAttribute("aria-busy", String(!!pending));
	busyHint.hidden = !state?.busy;
}

function renderServers(): void {
	if (!state) return;
	count.textContent = String(state.servers.length);
	configProject.title = state.projectConfigPath;
	configUser.title = state.userConfigPath;
	const rowsKey = JSON.stringify(state.servers);
	if (rowsKey === renderedServers) {
		setDisabled();
		return;
	}
	renderedServers = rowsKey;
	list.replaceChildren(
		...(state.servers.length
			? state.servers.map(serverCard)
			: [
					h(
						"div",
						{ className: "mcp-empty" },
						h("span", { className: "empty-mark" }, icon("mcp")),
						h("h3", {}, "Tu primera conexión"),
						h(
							"p",
							{ className: "description" },
							"Añade un servidor MCP para consultar documentación, trabajar con datos o conectar tus herramientas.",
						),
						button("Añadir mi primer servidor", "secondary", () => openForm()),
					),
				]),
	);
	setDisabled();
}
function serverCard(server: McpServer): HTMLElement {
	const labels: Record<McpServer["status"], string> = {
		connected: "Conectado",
		connecting: "Conectando…",
		disconnected: "Sin conexión",
		disabled: "Desactivado",
		inactive: "Sin aplicar",
	};
	const actions = h("div", { className: "server-actions" });
	if (server.scope !== "external") {
		const scope = server.scope;
		actions.append(
			button("Comprobar conexión", "secondary", () => manage({ op: "test", name: server.name, scope })),
			button(server.enabled ? "Desactivar" : "Activar", "secondary", () =>
				manage({ op: "set_enabled", name: server.name, scope, enabled: !server.enabled }),
			),
			button("Eliminar", "link danger", () => manage({ op: "remove", name: server.name, scope })),
		);
	}
	return h(
		"article",
		{ className: "server-card" },
		h(
			"div",
			{ className: "server-title" },
			icon("mcp"),
			h("strong", {}, server.name),
			h("span", { className: `connection-status ${server.status}` }, labels[server.status]),
		),
		h(
			"div",
			{ className: "server-meta" },
			h(
				"span",
				{},
				server.scope === "project"
					? "Este proyecto"
					: server.scope === "user"
						? "Todos mis proyectos"
						: "Otra configuración",
			),
			h("span", {}, server.type.toUpperCase()),
			server.status === "connected" ? h("span", {}, `${server.tools} herramientas`) : null,
		),
		h("code", { className: "server-location" }, server.location),
		server.reason ? h("p", { className: "hint" }, server.reason) : null,
		server.scope === "external" ? h("p", { className: "hint" }, "Configurado en ", server.configPath) : null,
		server.status === "disconnected"
			? h(
					"p",
					{ className: "hint" },
					"Comprueba la conexión para ver el problema. Si necesita OAuth, autorízalo desde el terminal con /mcp reauth y recarga las conexiones.",
				)
			: null,
		actions,
	);
}

window.addEventListener("message", (event: MessageEvent<McpUpdate>) => {
	const update = event.data;
	if (update.type === "mcpError") {
		polling = false;
		if (update.requestId === pending?.id) pending = undefined;
		notice.textContent = update.message;
		notice.className = "mcp-notice error";
		notice.setAttribute("role", "alert");
		notice.hidden = false;
		if (!state)
			list.replaceChildren(
				h(
					"p",
					{ className: "empty" },
					"No se han podido cargar los servidores. Pulsa Actualizar para reintentarlo.",
				),
			);
		setDisabled();
		return;
	}
	if (update.type !== "mcpState") return;
	state = update.state;
	folder.textContent = update.folder;
	if (update.requestId === pending?.id && pending) {
		const wasAdd = pending.op === "add";
		pending = undefined;
		if (wasAdd) closeForm();
		notice.hidden = true;
		if (state.message || state.warning) {
			notice.textContent = [state.message, state.warning].filter(Boolean).join(" ");
			notice.className = state.warning ? "mcp-notice warning" : "mcp-notice success";
			notice.setAttribute("role", "status");
			notice.hidden = false;
		}
	}
	polling = true;
	renderServers();
	scopeChanged();
});

setDisabled();
vscode.postMessage({ type: "ready" });
setInterval(() => {
	if (polling && !pending && !document.hidden) vscode.postMessage({ type: "refresh" });
}, 3000);
