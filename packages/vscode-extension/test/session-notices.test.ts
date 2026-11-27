import { describe, expect, it } from "bun:test";
import type { NoticeEvent } from "@oh-my-pi/pi-coding-agent/modes/rpc/wire/rpc-wire.generated";
import { handleSessionNotice } from "../src/chat/session-notices";

describe("session notices above the composer", () => {
	it("logs internal tool registration without showing banners, while preserving warnings, errors and user-facing information", () => {
		const banners: { level: NoticeEvent["level"]; message: string }[] = [];
		const log: string[] = [];
		const host = {
			notice: (level: NoticeEvent["level"], message: string) => banners.push({ level, message }),
			log: (line: string) => log.push(line),
		};
		handleSessionNotice(
			{ type: "notice", level: "info", source: "xdev", message: "Device registry refreshed" },
			host,
		);
		expect(banners).toEqual([]);
		expect(log).toHaveLength(1);
		expect(log[0]).toContain("Device registry refreshed");

		handleSessionNotice({ type: "notice", level: "warning", source: "xdev", message: "Tool unavailable" }, host);
		handleSessionNotice({ type: "notice", level: "error", source: "xdev", message: "Tool refresh failed" }, host);
		handleSessionNotice({ type: "notice", level: "info", source: "compaction", message: "Context compacted" }, host);
		handleSessionNotice({ type: "notice", level: "info", message: "Operation completed" }, host);
		expect(banners).toEqual([
			{ level: "warning", message: "Tool unavailable" },
			{ level: "error", message: "Tool refresh failed" },
			{ level: "info", message: "Context compacted" },
			{ level: "info", message: "Operation completed" },
		]);
	});
});
