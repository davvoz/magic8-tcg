/**
 * How amounts of money read: exact ones without the zeros they do not need, figures at a glance rounded down.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { amountText, moneyText, roundAmountText, roundMoneyText } from "../../src/application/money/moneyText.js";

describe("moneyText", () => {
  it("writes an exact amount without the zeros it does not need, grouped by thousands", () => {
    assert.deepEqual(["1.000", "0.500", "12.500", "0.125", "49", "1250.000", "1234567.890", "0.000"].map(amountText), ["1", "0.5", "12.5", "0.125", "49", "1,250", "1,234,567.89", "0"]);
    assert.equal(moneyText("5.000", "STEEM"), "5 STEEM");
    assert.equal(amountText("not a number"), "not a number", "left as it came");
  });

  it("rounds a figure down: whole units from 10 up, at most two decimals below", () => {
    assert.deepEqual(["866.666", "86.668", "10.999", "9.999", "0.500", "2.250", "1500.000"].map(roundAmountText), ["866", "86", "10", "9.99", "0.5", "2.25", "1,500"]);
    assert.equal(roundMoneyText("563.332", "STEEM"), "563 STEEM");
  });
});
