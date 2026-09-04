"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";

// Email+password, then a TOTP challenge when the account has MFA enrolled
// (§13: optional TOTP, no magic-link). Enrollment lives in /settings.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function finishLogin() {
    const supabase = createClient();
    // Best-effort login audit (§13 auditability) — never blocks sign-in.
    await supabase
      .from("audit_log")
      .insert({ action: "login", table_name: "auth", source: "web" })
      .then(() => {});
    router.push("/");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    // MFA gate: password gets you to aal1; a verified TOTP factor demands aal2.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (totp) {
        setMfaFactorId(totp.id);
        setLoading(false);
        return; // show the code form
      }
    }
    setLoading(false);
    await finishLogin();
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: mfaFactorId,
    });
    if (chErr || !challenge) {
      setLoading(false);
      setError(chErr?.message ?? "MFA challenge failed");
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setLoading(false);
    if (vErr) {
      setError(vErr.message);
      return;
    }
    await finishLogin();
  }

  const inputCls =
    "w-full rounded-lg border border-line bg-ink-0 px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {mfaFactorId ? (
        <form
          onSubmit={onVerify}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-ink-1 p-8"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-ink-4">Two-factor code</h1>
            <p className="text-sm text-ink-3">Enter the 6-digit code from your authenticator app.</p>
          </div>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputCls + " text-center tracking-[0.5em]"}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.trim().length < 6}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={onSubmit}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-ink-1 p-8"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-ink-4">Personal OS</h1>
            <p className="text-sm text-ink-3">Sign in to your private workspace.</p>
          </div>
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <input
            type="password"
            required
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center text-xs text-ink-3">
            No account?{" "}
            <Link href="/signup" className="text-accent hover:underline">
              Create one
            </Link>
          </p>
        </form>
      )}
    </main>
  );
}
