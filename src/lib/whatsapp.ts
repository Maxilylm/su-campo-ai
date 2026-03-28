const GRAPH_API = "https://graph.facebook.com/v21.0";

export async function sendWhatsAppMessage(to: string, text: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !token) {
    console.error("WhatsApp credentials not configured");
    return;
  }

  // Split long messages (WhatsApp limit ~4096 chars)
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
    });
  }
}

export async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN!;

  // Step 1: Get media URL
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json();

  // Step 2: Download the file
  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
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
