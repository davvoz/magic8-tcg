import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_TRADE_CARDS, parseTradeRecord, tradeRecord } from "../src/index.js";

const card = (n, finish = "standard") => ({ id: `0000000${n}-0000-4000-8000-000000000000`, definitionId: "ember_imp", serial: n, finish });

describe("trade records", () => {
  it("records both sides canonically, and reads back only well-formed records", () => {
    const json = tradeRecord({ tradeId: "0000000a-0000-4000-8000-000000000001", proposer: { account: "alice", cards: [card(1), card(2, "foil")] }, counterparty: { account: "bob", cards: [card(3)] } });
    assert.equal(json, '{"a":{"cards":[["00000001-0000-4000-8000-000000000000","ember_imp",1,"s"],["00000002-0000-4000-8000-000000000000","ember_imp",2,"f"]],"u":"alice"},"b":{"cards":[["00000003-0000-4000-8000-000000000000","ember_imp",3,"s"]],"u":"bob"},"t":"0000000a-0000-4000-8000-000000000001","v":1}');
    assert.equal(parseTradeRecord(json).b.u, "bob");
    for (const broken of [json.replace('"v":1', '"v":2'), json.replace('"u":"bob"', '"u":"alice"'), json.replace(',"s"]', ',"x"]'), `${json} `, "{}"]) {
      assert.equal(parseTradeRecord(broken), null, broken.slice(-40));
    }
    assert.throws(() => tradeRecord({ tradeId: "x", proposer: { account: "alice", cards: [] }, counterparty: { account: "bob", cards: [] } }), /trade id/);
    assert.throws(() => tradeRecord({ tradeId: "0000000a-0000-4000-8000-000000000001", proposer: { account: "alice", cards: Array.from({ length: MAX_TRADE_CARDS + 1 }, (_, i) => card(i + 1)) }, counterparty: { account: "bob", cards: [] } }), /0\.\.10 copies/);
  });
});
