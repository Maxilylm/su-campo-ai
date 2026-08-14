import { whatsappConfig } from "./env";
import { fetchWithTimeout } from "./fetch";

const GRAPH_API = "https://graph.facebook.com/v21.0";

export async function sendWhatsAppMessage(to: string, text: string) {
  const wa = whatsappConfig();
  if (!wa.configured) {
    console.error("WhatsApp credentials not configured");
    return;
  }

  // Split long messages (WhatsApp limit ~4096 chars)
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    const response = await fetchWithTimeout(`${GRAPH_API}/${wa.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wa.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
    }, 15000);
    if (!response.ok) {
      console.error("WhatsApp send failed:", response.status, await response.text());
      throw new Error("WhatsApp message failed");
    }
  }
}

export async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
  const wa = whatsappConfig();
  if (!wa.configured) throw new Error("WhatsApp not configured");
  const token = wa.accessToken;

  // Step 1: Get media URL
  const metaRes = await fetchWithTimeout(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, 15000);
  if (!metaRes.ok) throw new Error("WhatsApp media metadata failed");
  const meta = await metaRes.json();
  if (typeof meta.url !== "string") throw new Error("WhatsApp media URL missing");

  // Step 2: Download the file
  const fileRes = await fetchWithTimeout(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  }, 30000);
  if (!fileRes.ok) throw new Error("WhatsApp media download failed");
  const contentLength = Number(fileRes.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024) {
    throw new Error("WhatsApp media too large");
  }
  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.5) {
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx === -1) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}
