/**
 * Monitor: the numbers an external monitoring system scrapes, and the
 * alarms the server raises itself (docs/tcg/07-runbook.md §Allarmi).
 *
 * Alarms are conditions checked every minute; each one is logged at error
 * level when it starts and at info level when it clears, so any log-based
 * alerting (or a human reading the logs) sees one line per incident, not
 * one per minute. The same state is exposed as a metric.
 */

export const DEFAULT_ALARM_POLICY = Object.freeze({
  /** A record waiting this long to be published means broadcasting is stuck. */
  outboxBacklogMs: 10 * 60 * 1000,
  /** A payment detected but not confirmed for this long: nodes disagree or are down. */
  paymentConfirmationMs: 30 * 60 * 1000,
  /** A refund an operator has not sent for this long. */
  refundWaitingMs: 24 * 60 * 60 * 1000,
});

/**
 * @typedef {Readonly<{ name: string, active: boolean, detail: string }>} Alarm
 */

/** @param {string} value */
const label = (value) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");

export class Monitor {
  #readModel;
  #runtime;
  #clock;
  #logger;
  #policy;
  /** @type {Map<string, Alarm>} */
  #alarms = new Map();

  /**
   * @param {{
   *   readModel: import("../infrastructure/PgOperationsReadModel.js").PgOperationsReadModel,
   *   runtime: () => Readonly<Record<string, any>>,
   *   clock: import("../../../kernel/time.js").Clock,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   policy?: Partial<typeof DEFAULT_ALARM_POLICY>,
   * }} deps
   */
  constructor({ readModel, runtime, clock, logger, policy = {} }) {
    this.#readModel = readModel;
    this.#runtime = runtime;
    this.#clock = clock;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_ALARM_POLICY, ...policy });
  }

  /** Liveness and readiness: the database answers. */
  async ready() {
    try {
      return await this.#readModel.ping();
    } catch {
      return false;
    }
  }

  /** @returns {readonly Alarm[]} */
  alarms() {
    return Object.freeze([...this.#alarms.values()]);
  }

  /** Re-evaluates every alarm; logs the ones that started or cleared. */
  async evaluate() {
    const now = this.#clock.now();
    const overview = await this.#readModel.overview();
    const runtime = this.#runtime();
    const oldestBuilt = Math.min(...overview.outbox.filter((entry) => entry.status === "BUILT").map((entry) => entry.oldest), now);
    const oldestRefund = (await this.#readModel.oldestPendingRefund()) ?? now;
    const oldestPayment = overview.paymentsAwaitingConfirmation.oldest ?? now;
    const paused = Object.entries(runtime.broadcasters?.resourceCredits ?? {}).filter(([, level]) => level.mode === "PAUSED").map(([account]) => account);
    this.#set("outbox_backlog", now - oldestBuilt > this.#policy.outboxBacklogMs, `oldest unpublished record waits ${Math.round((now - oldestBuilt) / 60000)} min`);
    this.#set("chain_alerts_open", overview.openAlerts > 0, `${overview.openAlerts} open chain alert(s)`);
    this.#set("payment_confirmation_slow", now - oldestPayment > this.#policy.paymentConfirmationMs, `oldest unconfirmed payment seen ${Math.round((now - oldestPayment) / 60000)} min ago`);
    this.#set("refund_waiting", now - oldestRefund > this.#policy.refundWaitingMs, `oldest refund to send queued ${Math.round((now - oldestRefund) / 3600000)} h ago`);
    this.#set("broadcaster_paused", paused.length > 0, `paused for lack of resource credits: ${paused.join(", ")}`);
    return this.alarms();
  }

  /**
   * @param {string} name
   * @param {boolean} active
   * @param {string} detail
   */
  #set(name, active, detail) {
    const before = this.#alarms.get(name)?.active ?? false;
    this.#alarms.set(name, Object.freeze({ name, active, detail }));
    if (active && !before) {
      this.#logger.error(`alarm raised: ${name}`, { alarm: name, detail });
    } else if (!active && before) {
      this.#logger.info(`alarm cleared: ${name}`, { alarm: name });
    }
  }

  /** Prometheus text exposition (version 0.0.4). */
  async metrics() {
    const now = this.#clock.now();
    const overview = await this.#readModel.overview();
    const runtime = this.#runtime();
    const lines = [];
    const metric = (name, help, samples) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
      for (const [labels, value] of samples) {
        const text = Object.entries(labels).map(([key, item]) => `${key}="${label(item)}"`).join(",");
        const braces = text === "" ? "" : `{${text}}`;
        lines.push(`${name}${braces} ${value}`);
      }
    };
    metric("m8_outbox_records", "Protocol records not yet irreversible on chain.", overview.outbox.map((entry) => [{ kind: entry.kind, status: entry.status }, entry.count]));
    const built = overview.outbox.filter((entry) => entry.status === "BUILT");
    metric("m8_outbox_oldest_built_seconds", "Age of the oldest record waiting to be published.", [[{}, built.length === 0 ? 0 : Math.round((now - Math.min(...built.map((entry) => entry.oldest))) / 1000)]]);
    metric("m8_chain_alerts_open", "Chain anomalies waiting for an operator.", [[{}, overview.openAlerts]]);
    metric("m8_games", "Games not finished.", Object.entries(overview.games).map(([status, count]) => [{ status }, count]));
    metric("m8_orders_open", "Orders not settled.", Object.entries(overview.orders).map(([status, count]) => [{ status }, count]));
    metric("m8_refunds_open", "Refunds to send or to confirm.", Object.entries(overview.refunds).map(([status, count]) => [{ status }, count]));
    metric("m8_payments_unconfirmed", "Transfers seen but not yet irreversible.", [[{}, overview.paymentsAwaitingConfirmation.count]]);
    metric("m8_ws_connections", "Players connected.", [[{}, runtime.connections]]);
    metric("m8_broadcaster_resource_credits_ratio", "Resource credits of each broadcaster (0..1).", Object.entries(runtime.broadcasters?.resourceCredits ?? {}).map(([account, level]) => [{ account }, level.basisPoints / 10_000]));
    metric("m8_alarm", "1 while an alarm is raised.", this.alarms().map((alarm) => [{ alarm: alarm.name }, alarm.active ? 1 : 0]));
    return `${lines.join("\n")}\n`;
  }
}
