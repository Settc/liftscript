import { createClient } from '@supabase/supabase-js';

// TODO: Replace with your actual Supabase credentials
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function generateShareCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function shareWorkout(text, name) {
  const code = generateShareCode();
  try {
    const { error } = await supabase
      .from('shared_workouts')
      .insert({ code, name: name || 'Shared Workout', workout_text: text });

    if (error) {
      // If code collision, try once more
      if (error.code === '23505') {
        const retry = generateShareCode();
        const { error: retryError } = await supabase
          .from('shared_workouts')
          .insert({ code: retry, name: name || 'Shared Workout', workout_text: text });
        if (retryError) return null;
        return retry;
      }
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export async function importWorkout(code) {
  try {
    const { data, error } = await supabase
      .from('shared_workouts')
      .select('name, workout_text')
      .eq('code', code.toUpperCase().trim())
      .single();

    if (error || !data) return null;
    return { name: data.name, text: data.workout_text };
  } catch {
    return null;
  }
}

export async function nativeShare(code, name) {
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({
      title: name || 'Lift Workout',
      text: `Try my workout on LiftScript! Code: ${code}`,
      // TODO: Replace with your actual domain when you have one
      // url: `https://yourdomain.com/s/${code}`,
    });
  } catch {
    // Fallback: just copy to clipboard
    try {
      await navigator.clipboard.writeText(code);
    } catch {}
  }
}
