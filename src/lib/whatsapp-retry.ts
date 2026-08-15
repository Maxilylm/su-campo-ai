export interface WhatsAppEventSnapshot {
  status?: string | null;
  response_text?: string | null;
}

export function isReplayableWhatsAppEvent(event: WhatsAppEventSnapshot | null | undefined): event is WhatsAppEventSnapshot & { response_text: string } {
  return event?.status === "side_effects_done"
    && typeof event.response_text === "string"
    && event.response_text.trim().length > 0;
}
