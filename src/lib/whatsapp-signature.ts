import { createHmac, timingSafeEqual } from "crypto";

export function verifyWhatsAppSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}
