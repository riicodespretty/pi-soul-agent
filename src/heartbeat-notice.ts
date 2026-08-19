export function renderHeartbeatNotice(content: string): string {
  const trimmed = content.trim();
  return `<system-notice>\nSoul heartbeat grounding — active soul's HEARTBEAT.md:\n\n${trimmed}\n</system-notice>`;
}
