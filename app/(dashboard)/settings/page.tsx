import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui/Panel";
import { DemoControls } from "@/components/settings/DemoControls";
import { MfaControls } from "@/components/settings/MfaControls";
import { DEMO_TAG } from "@/lib/demo/fixtures";

export default async function SettingsPage() {
  const supabase = await createClient();

  // Demo mode is "active" if any tagged row exists.
  let demoActive = false;
  try {
    const { count } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .like("title", `${DEMO_TAG} %`);
    demoActive = (count ?? 0) > 0;
  } catch {
    // non-fatal; page still renders
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-ink-4">Settings</h1>

      <Panel title="Two-factor authentication">
        <MfaControls />
      </Panel>

      <Panel title="Demo mode">
        <DemoControls active={demoActive} />
      </Panel>

      <Panel title="AI provider">
        <p className="text-sm text-ink-3">
          Set <code>AI_PROVIDER</code> in <code>.env.local</code>:{" "}
          <code>local</code> (Ollama, default — free), <code>openai</code>,{" "}
          <code>anthropic</code>, or <code>hybrid</code>. With no model running,
          capture falls back to the deterministic regex classifier — nothing is
          lost, low-confidence items go to the review queue.
        </p>
      </Panel>

      <Panel title="Health targets">
        <p className="text-sm text-ink-3">
          Step, sleep, and protein targets that drive recovery/activity/nutrition
          scores are edited on the <a href="/health" className="text-accent underline">Health page</a>{" "}
          (stored in <code>profiles.targets</code> via{" "}
          <code>/api/settings/targets</code>).
        </p>
      </Panel>
    </div>
  );
}
