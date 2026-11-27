/** Compare mention formats through the production model/auth client. Tools use synthetic fixtures; none execute. */
import * as path from "node:path";
import { parseArgs } from "node:util";
import { completeSimple, type Message, type Tool, type ToolCall } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "../../src/config/model-registry";
import { AuthStorage } from "../../src/session/auth-storage";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { compile } from "@oh-my-pi/pi-utils/prompt";
import system from "./system.md" with { type: "text" };
import legacy from "./legacy.md" with { type: "text" };
import xml from "./xml.md" with { type: "text" };
import explicit from "../../../vscode-extension/src/mcp-reference.md" with { type: "text" };
import plain from "./plain.md" with { type: "text" };
import user from "./user.md" with { type: "text" };
import cases from "./cases.json";
import toolFixtures from "./tools.json";

interface Observation {
	variant: string;
	case: string;
	sample: number;
	pass: boolean;
	calls: Array<{ name: string; path: string }>;
	text: string;
	inputTokens: number;
	outputTokens: number;
	milliseconds: number;
	error?: string;
}

const { values } = parseArgs({
	options: {
		model: { type: "string" },
		"agent-dir": { type: "string" },
		samples: { type: "string", default: "3" },
		out: { type: "string" },
	},
});
if (!values.model || !values.out)
	throw new Error("Required: --model provider/id --out report.json [--agent-dir path] [--samples 3]");
const separator = values.model.indexOf("/");
if (separator < 1) throw new Error("Model must be provider/id");
const samples = Number(values.samples);
if (!Number.isInteger(samples) || samples < 1 || samples > 10)
	throw new Error("Samples must be an integer from 1 to 10");
const agentDir = values["agent-dir"] ?? getAgentDir();
const auth = await AuthStorage.create(path.join(agentDir, "agent.db"));
const registry = new ModelRegistry(auth, path.join(agentDir, "models.yml"));
const model = registry.find(values.model.slice(0, separator), values.model.slice(separator + 1));
if (
	!model ||
	!registry.getAvailable().some(candidate => candidate.provider === model.provider && candidate.id === model.id)
) {
	auth.close();
	throw new Error("Requested model is not configured/authenticated in this profile");
}
const tools: Tool[] = toolFixtures;
const toolPaths = [
	"xd://mcp__docs_search",
	"xd://mcp__docs_archive_search",
	"xd://mcp__tickets_search",
	"xd://mcp__tickets_create",
];
const variants = Object.entries({ legacy, xml, explicit, plain });
const renderUser = compile(user);
const jobs = variants.flatMap(([variant, template]) =>
	cases.flatMap(testCase =>
		Array.from({ length: samples }, (_, sample) => ({ variant, template, testCase, sample: sample + 1 })),
	),
);
const rows: Observation[] = [];

/** Only synthetic tool results: model output never becomes local file I/O or a real MCP request. */
function toolResult(call: ToolCall): string {
	const route = String(call.arguments.path ?? "");
	if (call.name === "read") {
		if (route === "xd://" || route === "xd:///") return JSON.stringify({ tools: toolPaths });
		if (toolPaths.includes(route))
			return JSON.stringify({
				path: route,
				inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
				execute: { tool: "write", path: route, content: "JSON arguments" },
			});
	}
	if (call.name === "write" && toolPaths.includes(route)) {
		try {
			const args: unknown = JSON.parse(String(call.arguments.content));
			if (typeof args === "object" && args !== null && "query" in args && typeof args.query === "string")
				return JSON.stringify({
					results: [{ id: "fixture-123", text: "Synthetic result for routing evaluation" }],
				});
		} catch {
			/* Invalid tool arguments are reported to the model. */
		}
		return JSON.stringify({ error: "Expected JSON object with a string query" });
	}
	return JSON.stringify({ error: "Path or tool unavailable" });
}

async function run(job: (typeof jobs)[number]): Promise<Observation> {
	const { variant, template, testCase, sample } = job;
	const renderReference = compile(template.trimEnd());
	const messages: Message[] = [
		{
			role: "user",
			content: renderUser({
				references: testCase.servers.map(name => renderReference({ name: JSON.stringify(name) })),
				message: testCase.message,
			}),
			timestamp: Date.now(),
		},
	];
	const result: Observation = {
		variant,
		case: testCase.id,
		sample,
		pass: false,
		calls: [],
		text: "",
		inputTokens: 0,
		outputTokens: 0,
		milliseconds: 0,
	};
	const start = performance.now();
	const executed = new Set<string>();
	try {
		for (let turn = 0; turn < 4; turn++) {
			const response = await completeSimple(
				model!,
				{ systemPrompt: [system], messages, tools },
				{ apiKey: registry.resolver(model!), maxTokens: 2048, signal: AbortSignal.timeout(45_000) },
			);
			result.inputTokens += response.usage.input;
			result.outputTokens += response.usage.output;
			if (response.stopReason === "error" || response.stopReason === "length") {
				result.error = response.stopReason;
				break;
			}
			messages.push(response);
			const calls = response.content.filter(block => block.type === "toolCall");
			result.text = response.content
				.filter(block => block.type === "text")
				.map(block => block.text)
				.join("");
			for (const call of calls) {
				const route = String(call.arguments.path ?? "");
				result.calls.push({ name: call.name, path: route });
				const output = toolResult(call);
				if (call.name === "write" && !output.includes('"error"')) executed.add(route);
				messages.push({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [{ type: "text", text: output }],
					isError: output.includes('"error"'),
					timestamp: Date.now(),
				});
			}
			if (!calls.length || (testCase.mustCall && testCase.allowed.every(route => executed.has(route)))) break;
		}
		const allowed = new Set(testCase.allowed);
		const unexpected = result.calls.some(
			call =>
				!allowed.has(call.path) &&
				!(
					testCase.id === "unavailable" &&
					call.name === "read" &&
					(call.path === "xd://" || call.path === "xd:///")
				),
		);
		result.pass =
			!result.error &&
			!unexpected &&
			(testCase.mustCall
				? testCase.allowed.every(route => executed.has(route))
				: executed.size === 0 &&
					(!testCase.text || result.text.toLowerCase().includes(testCase.text.toLowerCase())));
	} catch (error) {
		// Never copy arbitrary gateway error bodies or credentials into the report.
		result.error = error instanceof Error ? error.name : "InferenceError";
	}
	result.milliseconds = Math.round(performance.now() - start);
	return result;
}

try {
	// Bounded inference concurrency, independent cases; results are saved after each sample.
	await Promise.all(
		Array.from({ length: 3 }, async () => {
			while (jobs.length) {
				const job = jobs.shift();
				if (!job) break;
				const row = await run(job);
				rows.push(row);
				console.log(`${row.variant} / ${row.case} / ${row.sample}: ${row.error ?? (row.pass ? "PASS" : "FAIL")}`);
			}
		}),
	);
	const summary = variants.map(([variant]) => {
		const matches = rows.filter(row => row.variant === variant);
		return {
			variant,
			passed: matches.filter(row => row.pass).length,
			total: matches.length,
			errors: matches.filter(row => row.error).length,
			inputTokens: matches.reduce((total, row) => total + row.inputTokens, 0),
			outputTokens: matches.reduce((total, row) => total + row.outputTokens, 0),
		};
	});
	await Bun.write(
		values.out,
		JSON.stringify({ model: values.model, date: new Date().toISOString(), samples, summary, rows }, null, 2),
	);
	console.log(JSON.stringify(summary, null, 2));
} finally {
	auth.close();
}
