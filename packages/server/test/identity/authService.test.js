import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../../src/kernel/AppError.js";
import { hashToken } from "../../src/modules/identity/index.js";
import { ORIGIN, buildTestApp, deterministicRandom, keyPair, keychainSign } from "../helpers.js";

const alice = keyPair(1);
const mallory = keyPair(2);

/**
 * @param {Awaited<ReturnType<typeof buildTestApp>>} setup
 * @param {{ account?: string, key?: Uint8Array, origin?: string }} [options]
 */
async function signIn(setup, { account = "alice", key = alice.privateKey, origin = ORIGIN } = {}) {
  const challenge = await setup.app.auth.issueChallenge({ account, origin });
  return setup.app.auth.login({ challengeId: challenge.challengeId, signature: keychainSign(challenge.message, key), origin, ip: "10.0.0.1" });
}

/**
 * @param {Promise<unknown>} promise
 * @param {string} code
 */
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => error instanceof AppError && error.code === code, `expected ${code}`);
}

describe("AuthService: challenges", () => {
  it("issues a message binding account, origin, nonce and expiry, for the posting key", async () => {
    const setup = await buildTestApp();
    const challenge = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    assert.equal(challenge.network, "steem");
    assert.equal(challenge.keyRole, "Posting");
    assert.equal(challenge.expiresAt, setup.clock.now() + 120_000);
    assert.match(challenge.message, /^magic8-tcg login\naccount: alice\norigin: http:\/\/127\.0\.0\.1:8080\nnonce: [A-Za-z0-9_-]{43}\n/);
    const second = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    assert.notEqual(second.message, challenge.message, "every challenge has its own nonce");
  });

  it("refuses invalid account names and unknown networks", async () => {
    const { app } = await buildTestApp();
    await rejectsWith(app.auth.issueChallenge({ account: "Not Valid", origin: ORIGIN }), "INVALID_ACCOUNT");
    await rejectsWith(app.auth.issueChallenge({ account: 42, origin: ORIGIN }), "INVALID_ACCOUNT");
    await rejectsWith(app.auth.issueChallenge({ account: "alice", network: "ethereum", origin: ORIGIN }), "UNSUPPORTED_NETWORK");
  });
});

describe("AuthService: login", () => {
  it("signs in with a signature by the account's posting key and stores only a token hash", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    const result = await signIn(setup);
    assert.equal(result.user.account, "alice");
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
    const stored = await setup.sessions.findByTokenHash(hashToken(result.token));
    assert.equal(stored?.userId, result.user.id);
    assert.equal(stored?.loginPublicKey, alice.publicKey);
    assert.equal(JSON.stringify(stored).includes(result.token), false);
  });

  it("returns the same user on every login", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    const first = await signIn(setup);
    const second = await signIn(setup);
    assert.equal(first.user.id, second.user.id);
    assert.notEqual(first.token, second.token);
  });

  it("rejects a key that is not a posting key of the account", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    await rejectsWith(signIn(setup, { key: mallory.privateKey }), "LOGIN_FAILED");
  });

  it("rejects accounts that do not exist on chain", async () => {
    const setup = await buildTestApp();
    await rejectsWith(signIn(setup, { account: "nobody" }), "LOGIN_FAILED");
  });

  it("uses each challenge once: a replayed signature is refused, even after a failed attempt", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    const challenge = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    const signature = keychainSign(challenge.message, alice.privateKey);
    await setup.app.auth.login({ challengeId: challenge.challengeId, signature, origin: ORIGIN, ip: "x" });
    await rejectsWith(setup.app.auth.login({ challengeId: challenge.challengeId, signature, origin: ORIGIN, ip: "x" }), "CHALLENGE_INVALID");

    const other = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    await rejectsWith(setup.app.auth.login({ challengeId: other.challengeId, signature: "00".repeat(65), origin: ORIGIN, ip: "x" }), "LOGIN_FAILED");
    await rejectsWith(setup.app.auth.login({ challengeId: other.challengeId, signature: keychainSign(other.message, alice.privateKey), origin: ORIGIN, ip: "x" }), "CHALLENGE_INVALID");
  });

  it("refuses expired challenges and challenges issued for another origin", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    const challenge = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    setup.clock.advance(120_000);
    await rejectsWith(setup.app.auth.login({ challengeId: challenge.challengeId, signature: keychainSign(challenge.message, alice.privateKey), origin: ORIGIN, ip: "x" }), "CHALLENGE_INVALID");

    const phished = await setup.app.auth.issueChallenge({ account: "alice", origin: "https://evil.example" });
    await rejectsWith(setup.app.auth.login({ challengeId: phished.challengeId, signature: keychainSign(phished.message, alice.privateKey), origin: ORIGIN, ip: "x" }), "CHALLENGE_INVALID");
  });

  it("refuses a signature made for another challenge", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    const first = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    const second = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    await rejectsWith(setup.app.auth.login({ challengeId: second.challengeId, signature: keychainSign(first.message, alice.privateKey), origin: ORIGIN, ip: "x" }), "LOGIN_FAILED");
  });

  it("reports an unreachable chain as a temporary failure, not as a wrong signature", async () => {
    const setup = await buildTestApp();
    setup.chain.unavailable = true;
    await rejectsWith(signIn(setup), "CHAIN_UNAVAILABLE");
  });

  it("validates input types", async () => {
    const { app } = await buildTestApp();
    await rejectsWith(app.auth.login({ challengeId: 1, signature: "x", origin: ORIGIN, ip: "x" }), "VALIDATION");
    await rejectsWith(app.auth.login({ challengeId: "x", signature: "a".repeat(300), origin: ORIGIN, ip: "x" }), "VALIDATION");
  });

  it("records logins and failures in a verifiable audit trail", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    await signIn(setup);
    await assert.rejects(signIn(setup, { key: mallory.privateKey }));
    const rows = await setup.database.rows("SELECT action FROM audit_logs ORDER BY seq");
    assert.deepEqual(rows.map((row) => row.action), ["auth.login", "auth.login_failed"]);
    assert.equal(await setup.app.audit.verify(), null);
  });

  it("lets only one of several concurrent logins consume a challenge", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    const challenge = await setup.app.auth.issueChallenge({ account: "alice", origin: ORIGIN });
    const signature = keychainSign(challenge.message, alice.privateKey);
    const attempts = await Promise.allSettled([1, 2, 3].map(() => setup.app.auth.login({ challengeId: challenge.challengeId, signature, origin: ORIGIN, ip: "x" })));
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal((await setup.database.rows("SELECT id FROM sessions")).length, 1);
  });
});

describe("AuthService: persistence", () => {
  it("keeps users and sessions across a server restart", async () => {
    const first = await buildTestApp();
    first.chain.setAccount("alice", [alice.publicKey]);
    const login = await signIn(first);
    const restarted = await buildTestApp({ database: first.database, clock: first.clock, chain: first.chain, random: deterministicRandom("restart") });
    const principal = await restarted.app.auth.authenticate(login.token);
    assert.equal(principal?.user.id, login.user.id);
    assert.equal((await signIn(restarted)).user.id, login.user.id, "the account maps to the same user");
    assert.equal(await restarted.app.audit.verify(), null, "the audit chain continues across restarts");
  });

  it("pages through active login keys without skipping or repeating", async () => {
    const setup = await buildTestApp();
    const keys = [4, 5, 6, 7].map((seed) => keyPair(seed));
    setup.chain.setAccount("alice", keys.map((key) => key.publicKey));
    for (const key of keys) {
      await signIn(setup, { key: key.privateKey });
    }
    const seen = [];
    let after = null;
    for (;;) {
      const page = await setup.sessions.listActiveLoginKeys(setup.clock.now(), 3, after);
      seen.push(...page.map((pair) => pair.loginPublicKey));
      if (page.length < 3) {
        break;
      }
      after = page.at(-1);
    }
    assert.deepEqual([...seen].sort(), keys.map((key) => key.publicKey).sort());
  });
});

describe("AuthService: sessions", () => {
  async function signedIn(policy = {}) {
    const setup = await buildTestApp({ policy });
    setup.chain.setAccount("alice", [alice.publicKey]);
    const login = await signIn(setup);
    return { ...setup, login };
  }

  it("authenticates a valid token and ignores malformed or unknown ones", async () => {
    const { app, login } = await signedIn();
    assert.equal((await app.auth.authenticate(login.token))?.user.account, "alice");
    for (const token of [null, "", "x", `${login.token}x`, login.token.replace(/.$/, (character) => (character === "A" ? "B" : "A"))]) {
      assert.equal(await app.auth.authenticate(token), null, String(token));
    }
  });

  it("ends a session on logout", async () => {
    const { app, login } = await signedIn();
    const principal = await app.auth.authenticate(login.token);
    await app.auth.logout(principal, "x");
    assert.equal(await app.auth.authenticate(login.token), null);
  });

  it("expires sessions when idle and at their absolute lifetime", async () => {
    const idle = await signedIn({ sessionIdleTtlMs: 60_000, sessionAbsoluteTtlMs: 600_000, sessionTouchIntervalMs: 1000 });
    idle.clock.advance(59_000);
    assert.notEqual(await idle.app.auth.authenticate(idle.login.token), null, "use keeps it alive");
    idle.clock.advance(59_000);
    assert.notEqual(await idle.app.auth.authenticate(idle.login.token), null);
    idle.clock.advance(60_000);
    assert.equal(await idle.app.auth.authenticate(idle.login.token), null, "idle for a full minute");

    const absolute = await signedIn({ sessionIdleTtlMs: 60_000, sessionAbsoluteTtlMs: 120_000, sessionTouchIntervalMs: 1000 });
    for (let minute = 0; minute < 2; minute += 1) {
      absolute.clock.advance(59_000);
      await absolute.app.auth.authenticate(absolute.login.token);
    }
    absolute.clock.advance(2_000);
    assert.equal(await absolute.app.auth.authenticate(absolute.login.token), null, "past the absolute lifetime");
  });

  it("stops authenticating suspended users", async () => {
    const { app, users, login } = await signedIn();
    await users.setStatus(login.user.id, "suspended");
    assert.equal(await app.auth.authenticate(login.token), null);
  });
});

describe("SessionKeyAuditor", () => {
  it("revokes sessions whose login key left the posting authority, and only those", async () => {
    const setup = await buildTestApp();
    const aliceNew = keyPair(3);
    setup.chain.setAccount("alice", [alice.publicKey, aliceNew.publicKey]);
    const oldKeySession = await signIn(setup);
    const newKeySession = await signIn(setup, { key: aliceNew.privateKey });
    setup.chain.setAccount("alice", [aliceNew.publicKey]);
    const report = await setup.app.keyAuditor.run();
    assert.deepEqual(report, { checked: 2, revoked: 1, skipped: 0 });
    assert.equal(await setup.app.auth.authenticate(oldKeySession.token), null);
    assert.notEqual(await setup.app.auth.authenticate(newKeySession.token), null);
  });

  it("revokes nothing while the chain is unreachable", async () => {
    const setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    const login = await signIn(setup);
    setup.chain.unavailable = true;
    assert.deepEqual(await setup.app.keyAuditor.run(), { checked: 1, revoked: 0, skipped: 1 });
    assert.notEqual(await setup.app.auth.authenticate(login.token), null);
  });
});
