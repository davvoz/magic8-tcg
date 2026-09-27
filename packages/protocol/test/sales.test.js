import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OperationId, parseSaleRecord, saleRecord } from "../src/index.js";

const SALE = Object.freeze({
  listingId: "0000000a-0000-4000-8000-000000000001",
  seller: "alice",
  buyer: "bob",
  card: { id: "00000001-0000-4000-8000-000000000000", definitionId: "ember_imp", serial: 4 },
  price: "1.500 STEEM",
  txId: "ab".repeat(20),
});

describe("sale records", () => {
  it("records the copy, both accounts, the price and the payment canonically, and reads back only well-formed records", () => {
    assert.equal(OperationId.SALE, "m8tcg_sale");
    const json = saleRecord(SALE);
    assert.equal(json, `{"b":"bob","c":["00000001-0000-4000-8000-000000000000","ember_imp",4],"p":"1.500 STEEM","s":"alice","t":"0000000a-0000-4000-8000-000000000001","v":1,"x":"${"ab".repeat(20)}"}`);
    assert.deepEqual([parseSaleRecord(json).s, parseSaleRecord(json).p], ["alice", "1.500 STEEM"]);
    for (const broken of [json.replace('"v":1', '"v":2'), json.replace('"b":"bob"', '"b":"alice"'), json.replace(',4]', ',4,"s"]'), json.replace('"1.500 STEEM"', '"1,5 STEEM"'), json.replace(`"${"ab".repeat(20)}"`, '"abc"'), `${json} `, "{}"]) {
      assert.equal(parseSaleRecord(broken), null, broken.slice(0, 60));
    }
    assert.throws(() => saleRecord({ ...SALE, buyer: "alice" }), /two different accounts/);
  });
});
