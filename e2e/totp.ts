import { createHmac } from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so the login setup can pass the 2FA step
// when the test account has an authenticator enrolled.
export function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/[\s=]/g, "").toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("E2E_TOTP_SECRET is not valid base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const off = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
