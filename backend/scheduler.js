const cron = require('node-cron');
const db = require('./db');
const { fetchSubscription } = require('./fetcher');
const testBundle = require('./testBundle');

class Scheduler {
  constructor() {
    this.cronTask = null;
    this.testTask = null;
  }

  init() {
    this.restart();
    this.restartScheduledTest();
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
   * 定时测速（延迟 + 网速 捆绑）
   * 支持：模式（两者/仅延迟/仅网速）、范围（整合订阅/仅可用/全部/自定义节点集合）
   */
  restartScheduledTest() {
    if (this.testTask) {
      this.testTask.stop();
      this.testTask = null;
    }

    const settings = db.getSettings();
    const enabled = settings.schedTestEnabled !== undefined
      ? settings.schedTestEnabled
      : settings.speedTestEnabled;

    if (!enabled) {
      console.log('[Scheduler] 定时测速未开启（系统配置 → 定时测速）');
      return;
    }

    const cronExpr = settings.schedTestCron || settings.speedTestCron || '0 4 * * *';
    const mode = settings.schedTestMode || 'both';
    const scope = settings.schedTestScope || 'combined';
    console.log(`[Scheduler] Starting scheduled test cron (${cronExpr}) mode=${mode} scope=${scope}`);

    try {
      this.testTask = cron.schedule(cronExpr, async () => {
        try {
          const targets = testBundle.pickNodes({ scope });
          console.log(`[Scheduler] Triggering scheduled ${mode} test on ${targets.length} node(s)...`);
          testBundle.runBundle({ mode, scope, trigger: 'cron' });
        } catch (e) {
          console.error('[Scheduler] Scheduled test failed:', e.message);
          db.addLog('error', `定时测速启动失败: ${e.message}`);
        }
      });
    } catch (e) {
      console.error('[Scheduler] Invalid scheduled test cron expression:', cronExpr, e.message);
    }
  }

  // 兼容旧调用名
  restartSpeedTest() {
    this.restartScheduledTest();
  }
}

module.exports = new Scheduler();
