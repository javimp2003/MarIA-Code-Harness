import type { NoticeEvent } from "@oh-my-pi/pi-coding-agent/modes/rpc/wire/rpc-wire.generated";

interface SessionNoticeHost {
	notice(level: NoticeEvent["level"], message: string): void;
	log(line: string): void;
}

/** Tool registration runs when a chat's MCP connections start or reload; it is diagnostic output. */
export function handleSessionNotice(event: NoticeEvent, host: SessionNoticeHost): void {
	if (event.level === "info" && event.source === "xdev") {
		host.log(`[info] [xdev] ${event.message}`);
		return;
	}
	host.notice(event.level, event.message);
}
