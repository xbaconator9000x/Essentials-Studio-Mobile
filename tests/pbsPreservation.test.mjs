import test from "node:test";
import assert from "node:assert/strict";
import { preserveOpaquePbsFields } from "../src/services/pbsPreservation.ts";

const managed = new Set(["Name", "Types", "Power", "Pokemon", "Moves"]);
const sec = (header, fields) => ({
  header,
  fields: fields.map(([key, value]) => ({ key, value })),
});

test("custom fields survive targeted edits in original order", () => {
  const before = [sec("VULPIX", [
    ["Name", "Vulpix"], ["ShatteredAbility", "DARKFIRE"],
    ["Types", "FIRE"], ["Custom", "A=B"],
  ])];
  const after = [sec("VULPIX", [["Name", "Noctales"], ["Types", "GHOST,FIRE"]])];
  assert.deepEqual(preserveOpaquePbsFields(before, after, managed), [
    sec("VULPIX", [
      ["Name", "Noctales"], ["ShatteredAbility", "DARKFIRE"],
      ["Types", "GHOST,FIRE"], ["Custom", "A=B"],
    ]),
  ]);
  assert.equal(before[0].fields[0].value, "Vulpix");
});

test("new fields append without reordering existing opaque fields", () => {
  const before = [sec("ONE", [["Name", "Old"], ["Unknown", "yes"]])];
  const after = [sec("ONE", [["Name", "New"], ["Types", "FIRE"]])];
  assert.deepEqual(preserveOpaquePbsFields(before, after, managed), [
    sec("ONE", [["Name", "New"], ["Unknown", "yes"], ["Types", "FIRE"]]),
  ]);
});

test("repeated trainer keys match by occurrence, not by collapsed map", () => {
  const before = [sec("TRAINER", [
    ["Pokemon", "A,1"], ["Custom", "keep"], ["Moves", "TACKLE"],
    ["Pokemon", "B,2"], ["Moves", "GROWL"],
  ])];
  const after = [sec("TRAINER", [
    ["Pokemon", "C,1"], ["Moves", "EMBER"],
    ["Pokemon", "D,2"], ["Moves", "SCRATCH"],
  ])];
  assert.deepEqual(preserveOpaquePbsFields(before, after, managed), [
    sec("TRAINER", [
      ["Pokemon", "C,1"], ["Custom", "keep"], ["Moves", "EMBER"],
      ["Pokemon", "D,2"], ["Moves", "SCRATCH"],
    ]),
  ]);
});

test("section deletion and reordering fail closed", () => {
  const before = [sec("ONE", [["Name", "a"]]), sec("TWO", [["Name", "b"]])];
  assert.throws(() => preserveOpaquePbsFields(before, before.slice(0, 1), managed), /section deletion/);
  assert.throws(() => preserveOpaquePbsFields(before, before.toReversed(), managed), /order\/identity/);
});

test("missing modeled fields reject rather than silently retaining stale values", () => {
  const before = [sec("ONE", [
    ["Name", "a"], ["Power", "30"], ["Custom", "keep"],
  ])];
  assert.throws(() => preserveOpaquePbsFields(before, [
    sec("ONE", [["Name", "b"]]),
  ], managed), /Power.*removed/);
});

test("new section appends without changing existing opaque fields", () => {
  const before = [sec("ONE", [["Name", "a"], ["Opaque", "keep"]])];
  const after = [
    sec("ONE", [["Name", "b"]]),
    sec("TWO", [["Name", "new"]]),
  ];
  assert.deepEqual(preserveOpaquePbsFields(before, after, managed), [
    sec("ONE", [["Name", "b"], ["Opaque", "keep"]]),
    sec("TWO", [["Name", "new"]]),
  ]);
});

test("omitted numeric-zero move fields retain explicit defaults and clear old values", () => {
  const defaults = new Map([["Power", "0"], ["Priority", "0"], ["EffectChance", "0"]]);
  const before = [sec("STATUSMOVE", [
    ["Name", "Status"], ["Power", "30"], ["Priority", "0"], ["Custom", "preserve"],
  ])];
  const after = [sec("STATUSMOVE", [["Name", "Status"]])];
  assert.deepEqual(
    preserveOpaquePbsFields(before, after, new Set([...managed, "Priority", "EffectChance"]), defaults),
    [sec("STATUSMOVE", [
      ["Name", "Status"], ["Power", "0"], ["Priority", "0"], ["Custom", "preserve"],
    ])],
  );
});
