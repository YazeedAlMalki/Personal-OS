import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    
    // Test DB connection
    const { error: dbError } = await supabase
      .from('calendar_events_cache')
      .select('count(*)', { count: 'exact' })
      .limit(1);
    
    const dbStatus = dbError ? 'unhealthy' : 'healthy';
    
    return NextResponse.json({
      ok: dbStatus === 'healthy',
      db: dbStatus,
      ai: 'healthy',
      ai_model: process.env.CLAUDE_MODEL || 'claude-opus-4-1',
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: 'error', ai: 'error', ai_model: 'unknown' },
      { status: 500 }
    );
  }
}
