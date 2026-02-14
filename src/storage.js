import { Preferences } from '@capacitor/preferences';

// ─── Local Storage (saved workouts, last session, settings) ───

export async function loadSavedWorkouts() {
  try {
    const { value } = await Preferences.get({ key: 'saved-workouts' });
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

export async function persistWorkouts(workouts) {
  try {
    await Preferences.set({ key: 'saved-workouts', value: JSON.stringify(workouts) });
  } catch (e) {
    console.error('Storage error:', e);
  }
}

export async function loadLastSession() {
  try {
    const { value } = await Preferences.get({ key: 'last-session' });
    return value || '';
  } catch {
    return '';
  }
}

export async function persistLastSession(text) {
  try {
    await Preferences.set({ key: 'last-session', value: text });
  } catch (e) {
    console.error('Storage error:', e);
  }
}

export async function loadDarkMode() {
  try {
    const { value } = await Preferences.get({ key: 'dark-mode' });
    return value === 'true';
  } catch {
    return false;
  }
}

export async function persistDarkMode(dark) {
  try {
    await Preferences.set({ key: 'dark-mode', value: String(dark) });
  } catch (e) {
    console.error('Storage error:', e);
  }
}

export async function hasSeenOnboarding() {
  try {
    const { value } = await Preferences.get({ key: 'seen-onboarding' });
    return value === 'true';
  } catch {
    return false;
  }
}

export async function markOnboardingSeen() {
  try {
    await Preferences.set({ key: 'seen-onboarding', value: 'true' });
  } catch (e) {
    console.error('Storage error:', e);
  }
}
