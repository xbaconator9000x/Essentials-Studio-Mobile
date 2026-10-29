import test from "node:test";
import assert from "node:assert/strict";
import { choose,promptFor,dispatch } from "./jules-dispatch.mjs";
const t=(id,area="native",status="todo",priority=0,depends_on=[])=>({id,area,status,priority,depends_on,title:id,acceptance:["Roundtrip succeeds","Actual code and tests"]});
const q=tasks=>({tasks,policy:{max_parallel_native_workstreams:1}});
const day=Date.now();
test("free cloud lane admits independent work but not concurrent native changes",()=>{
  assert.deepEqual(choose(q([t("ASM-003"),t("ASM-004","storage"),t("ASM-014","quality", "in_progress",1)]),[],[]).map(x=>x.id),["ASM-003","ASM-014"]);
});
test("blocked and incomplete dependencies do not dispatch",()=>{
  assert.deepEqual(choose(q([t("ASM-001","build","done"),t("ASM-002","build","blocked"),t("ASM-003"),t("ASM-004","storage","todo",0,["ASM-003"])]),[],[]).map(x=>x.id),["ASM-003"]);
});
test("existing PR or durable task receipt prevents duplicate sessions",()=>{
  const queue=q([t("ASM-003"),t("ASM-004","storage","in_progress",1),t("ASM-014","quality","in_progress",2)]);
  assert.deepEqual(choose(queue,[{task_id:"ASM-003",state:"dispatched",session_state:"COMPLETED"}],[{title:"ASM-004: test",body:""}]).map(x=>x.id),["ASM-014"]);
});
test("active native session reserves native lane while quality lane stays available",()=>{
  const receipts=[{task_id:"ASM-003",area:"native",state:"dispatched",session_state:"IN_PROGRESS",launched_at:new Date(day).toISOString()}];
  assert.deepEqual(choose(q([t("ASM-003"),t("ASM-004","storage","in_progress",1),t("ASM-014","quality","in_progress",2)]),receipts,[],day).map(x=>x.id),["ASM-014"]);
});
test("three dispatches in rolling 24h block additional per-repo free tier use",()=>{
  const receipts=["ASM-099","ASM-098","ASM-097"].map(id=>({task_id:id,state:"dispatched",session_state:"COMPLETED",launched_at:new Date(day-1000).toISOString()}));
  assert.deepEqual(choose(q([t("ASM-003")]),receipts,[],day),[]);
  assert.deepEqual(choose(q([t("ASM-003")]),receipts,[],day+86_401_000).map(x=>x.id),["ASM-003"]);
});
test("reserved slot blocks duplicate dispatch even after runner interruption",()=>{
  assert.deepEqual(choose(q([t("ASM-003"),t("ASM-004","storage","todo",1),t("ASM-014","quality","todo",2)]),[{task_id:"ASM-003",area:"native",state:"reserved"}],[]).map(x=>x.id),["ASM-014"]);
});
test("agent prompt requires actual code, regression tests, PR and preserves source",()=>{
  const prompt=promptFor(t("ASM-003"));
  assert.match(prompt,/ASM-003/);
  assert.match(prompt,/not a stub/);
  assert.match(prompt,/regression tests/);
  assert.match(prompt,/pull request/);
  assert.match(prompt,/RXDATA/);
});
test("without Jules secret, agent dispatch fails closed",async()=>{
  assert.deepEqual(await dispatch({GITHUB_REPOSITORY:"xbaconator9000x/Essentials-Studio-Mobile"}),{configured:false,started:[]});
});
test("refuse unexpected repository before checking credentials",async()=>{
  await assert.rejects(dispatch({GITHUB_REPOSITORY:"someone/else"}),/Wrong GitHub repository/);
});
