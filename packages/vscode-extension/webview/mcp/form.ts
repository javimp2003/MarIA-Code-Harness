import type { ManageMcpServerParams } from "../../src/protocol";

export interface McpFormDraft {
	name: string;
	scope: "project" | "user";
	transport: "http" | "stdio" | "sse";
	url: string;
	token: string;
	command: string;
	args: string;
	cwd: string;
	headers: [string, string][];
	env: [string, string][];
}

/** Keep arguments and secrets literal; the form never parses shell quoting or splits on spaces. */
export function mcpFormRequest(draft: McpFormDraft): ManageMcpServerParams {
	const name = draft.name.trim();
	if (!name || name.length > 100 || !/^[a-zA-Z0-9_.:-]+(?: [a-zA-Z0-9_.:-]+)*$/.test(name)) {
		throw new Error(
			"Usa un nombre de hasta 100 caracteres: letras, números, espacios simples, guiones, puntos o dos puntos.",
		);
	}
	const params: ManageMcpServerParams = { op: "add", name, scope: draft.scope, transport: draft.transport };
	if (draft.transport === "stdio") {
		if (!draft.command.trim()) throw new Error("Indica el comando que inicia el servidor.");
		params.command = draft.command.trim();
		params.args = draft.args
			? draft.args
					.replace(/\r\n/g, "\n")
					.split("\n")
					.filter(arg => arg !== "")
			: [];
		params.cwd = draft.cwd.trim() || undefined;
		params.env = pairsToRecord(draft.env, "variable de entorno");
	} else {
		let url: URL;
		try {
			url = new URL(draft.url.trim());
		} catch {
			throw new Error("Introduce una URL completa, por ejemplo https://servidor.example/mcp.");
		}
		if (!/^https?:$/.test(url.protocol)) throw new Error("La URL debe empezar por https:// o http://.");
		if (url.username || url.password) throw new Error("Usa el campo de token o las cabeceras para las credenciales.");
		params.url = url.toString();
		params.headers = pairsToRecord(draft.headers, "cabecera", true);
		if (draft.token.trim()) {
			if (Object.keys(params.headers).some(key => key.toLowerCase() === "authorization"))
				throw new Error("Usa el token Bearer o la cabecera Authorization; elige solo uno.");
			params.headers.Authorization = `Bearer ${draft.token.trim()}`;
		}
	}
	return params;
}

function pairsToRecord(pairs: [string, string][], label: string, caseInsensitive = false): Record<string, string> {
	const result: Record<string, string> = Object.create(null);
	const seen = new Set<string>();
	for (const [rawKey, value] of pairs) {
		const key = rawKey.trim();
		if (!key && !value) continue;
		if (!key) throw new Error(`Falta el nombre de una ${label}.`);
		const identity = caseInsensitive ? key.toLowerCase() : key;
		if (seen.has(identity)) throw new Error(`La ${label} «${key}» aparece más de una vez.`);
		seen.add(identity);
		result[key] = value;
	}
	return result;
}
