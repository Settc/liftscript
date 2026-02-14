// ─── Keep Awake (prevent screen sleep during auto-mode) ───

export async function keepScreenAwake() {
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.keepAwake();
  } catch (e) {
    // Plugin not available (running in browser)
    console.log('KeepAwake not available:', e.message);
  }
}

export async function allowScreenSleep() {
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.allowSleep();
  } catch (e) {
    console.log('KeepAwake not available:', e.message);
  }
}

// ─── Local Notifications (rest timer alerts) ───

let notificationsPermitted = false;

export async function requestNotificationPermission() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const result = await LocalNotifications.requestPermissions();
    notificationsPermitted = result.display === 'granted';
    return notificationsPermitted;
  } catch {
    return false;
  }
}

export async function scheduleRestNotification(seconds) {
  if (!notificationsPermitted) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({
      notifications: [{
        title: 'Rest Over',
        body: 'Time for your next set',
        id: 1,
        schedule: { at: new Date(Date.now() + seconds * 1000) },
        sound: 'default',
      }],
    });
  } catch (e) {
    console.log('Notifications not available:', e.message);
  }
}

export async function cancelRestNotification() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
  } catch {}
}
