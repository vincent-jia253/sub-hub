const cron = require('node-cron');
const db = require('./db');
const { fetchSubscription } = require('./fetcher');
const speedRunner = require('./speedRunner');

class Scheduler {
  constructor() {
    this.cronTask = null;
    this.speedTask = null;
  }

  init() {
    this.restart();
    this.restartSpeedTest();
  }

  restart() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    const settings = db.getSettings();
    if (!settings.autoRefreshEnabled) {
      console.log('[Scheduler] Auto-refresh is disabled in settings.');
      return;
    }

    const cronExpr = settings.autoRefreshInterval || '0 */6 * * *';
    console.log(`[Scheduler] Starting cron job with schedule: ${cronExpr}`);

    try {
      this.cronTask = cron.schedule(cronExpr, async () => {
        console.log('[Scheduler] Triggering scheduled subscription update...');
        const subs = db.getSubscriptions().filter(s => s.enabled && s.autoRefresh);
        for (const sub of subs) {
          try {
            console.log(`[Scheduler] Auto-refreshing subscription: ${sub.name}`);
            await fetchSubscription(sub.id);
          } catch (e) {
            console.error(`[Scheduler] Failed to auto-refresh ${sub.name}:`, e.message);
          }
        }
      });
    } catch (e) {
      console.error('[Scheduler] Invalid cron expression:', cronExpr, e.message);
    }
  }

  /**
   * 定时网速测速：独立 cron，可在系统配置里开关与调整频率
   */
  restartSpeedTest() {
    if (this.speedTask) {
      this.speedTask.stop();
      this.speedTask = null;
    }

    const settings = db.getSettings();
    if (!settings.speedTestEnabled) {
      console.log('[Scheduler] 定时网速测速未开启（系统配置 → 网速测速）');
      return;
    }

    const cronExpr = settings.speedTestCron || '0 */6 * * *';
    console.log(`[Scheduler] Starting bandwidth test cron job with schedule: ${cronExpr}`);

    try {
      this.speedTask = cron.schedule(cronExpr, async () => {
        try {
          console.log('[Scheduler] Triggering scheduled bandwidth test...');
          speedRunner.startSpeedTest({ trigger: 'cron', scope: settings.speedTestScope });
        } catch (e) {
          console.error('[Scheduler] Bandwidth test failed:', e.message);
        }
      });
    } catch (e) {
      console.error('[Scheduler] Invalid speed test cron expression:', cronExpr, e.message);
    }
  }
}

module.exports = new Scheduler();
