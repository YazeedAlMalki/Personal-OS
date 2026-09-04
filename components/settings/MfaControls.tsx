"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { ShieldCheck, ShieldOff } from "lucide-react";

type Factor = { id: string; friendly_name?: string | null; status: string };

// §13 optional TOTP MFA — enroll/verify/unenroll, all client-side against
// Supabase Auth. Once a factor is verified, login demands the 6-digit code.
export function MfaControls() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function enroll() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    // Clear any abandoned unverified factor first (Supabase keeps them around;
    // note listFactors().totp holds only VERIFIED factors — use .all here).
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Personal OS",
    });
    setBusy(false);
    if (error || !data) {
      setMsg(error?.message ?? "Enroll failed");
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code); // SVG data URI
    setSecret(data.totp.secret);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !challenge) {
      setBusy(false);
      setMsg(chErr?.message ?? "Challenge failed");
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setQr(null);
    setSecret(null);
    setFactorId(null);
    setCode("");
    setMsg("Two-factor enabled. You'll be asked for a code at every sign-in.");
    void refresh();
  }

  async function unenroll(id: string) {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setBusy(false);
    setMsg(error ? error.message : "Two-factor disabled.");
    void refresh();
  }

  const verified = factors.filter((f) => f.status === "verified");

  return (
    <div className="space-y-3">
      {verified.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm text-ink-4">
            <ShieldCheck size={16} className="text-success" />
            TOTP enabled ({verified.length} factor{verified.length === 1 ? "" : "s"})
          </p>
          <button
            onClick={() => void unenroll(verified[0]!.id)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-3 hover:text-danger disabled:opacity-50"
          >
            <ShieldOff size={13} /> Disable
          </button>
        </div>
      ) : qr ? (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-ink-3">
            Scan with your authenticator app, then enter the 6-digit code to confirm.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="TOTP QR code" className="h-40 w-40 rounded-lg bg-white p-2" />
          {secret && (
            <p className="break-all text-xs text-ink-3">
              Manual key: <code className="text-ink-4">{secret}</code>
            </p>
          )}
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-32 rounded-lg border border-line bg-ink-0 px-3 py-2 text-center text-sm tracking-widest outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-3">
            Add a second factor (authenticator app). Recommended — this workspace holds your
            journal, health and finance data.
          </p>
          <button
            onClick={() => void enroll()}
            disabled={busy}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
          >
            Enable 2FA
          </button>
        </div>
      )}
      {msg && <p className="text-sm text-ink-3">{msg}</p>}
    </div>
  );
}
