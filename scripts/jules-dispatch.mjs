// Free-tier Google Jules cloud coding sessions for the persistent development queue.
// Jules clones the project in its own cloud VM and can open a PR. No paid Copilot token.
// Jules REST API: https://jules.google/docs/api/reference/sessions
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repo = "xbaconator9000x/Essentials-Studio-Mobile";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = "development/jules-dispatch-state.json";
const inFlight = new Set(["QUEUED","PLANNING","AWAITING_PLAN_APPROVAL","AWAITING_USER_FEEDBACK","IN_PROGRESS","PAUSED","reserved"]);
const nativeAreas = new Set(["build","native","storage","editor","runtime"]);
const maxActive = 2; // below Jules free 3-concurrent-session limit; cross-project usage may differ
const maxDailyStarts = 3; // a conservative allocation within Jules free 15 tasks / rolling day

export function choose(queue, receipts, prs, now = Date.now()) {
  const byId = new Map(queue.tasks.map(t => [t.id, t]));
  const active = receipts.filter(r => inFlight.has(r.session_state || r.state));
  const startedToday = receipts.filter(r => r.launched_at && now - Date.parse(r.launched_at) < 86_400_000).length;
  const dailySlots = Math.max(0, maxDailyStarts - startedToday);
  const openSlots = Math.max(0, maxActive - active.length);
  const nativeLimit = queue.policy?.max_parallel_native_workstreams ?? 1;
  let nativeUsed = active.filter(r => nativeAreas.has(byId.get(r.task_id)?.area)).length;
  const choices = [];
  for (const task of [...queue.tasks].sort((a,b) => a.priority-b.priority || a.id.localeCompare(b.id))) {
    if (choices.length >= Math.min(dailySlots, openSlots)) break;
    if (!["todo","in_progress"].includes(task.status)) continue;
    if (task.depends_on.some(id => byId.get(id)?.status !== "done")) continue;
    // A persisted receipt isn't consumed by "success": acceptance requires a real PR review.
    if (receipts.some(r => r.task_id === task.id)) continue;
    const token = new RegExp("(^|[^A-Z0-9])" + task.id + "([^0-9]|$)", "i");
    if (prs.some(pr => token.test((pr.title || "") + "\n" + (pr.body || "")))) continue;
    if (nativeAreas.has(task.area)) {
      if (nativeUsed >= nativeLimit) continue;
      nativeUsed++;
    }
    choices.push(task);
  }
  return choices;
}

export function promptFor(task) {
  return [
    "Essentials Studio Mobile autonomous implementation task " + task.id + ": " + task.title,
    "Read development/queue.json and current main before modifying any code. Check existing PRs to avoid duplication.",
    "Use existing upstream implementation; write real code, not a stub or a status-only PR. Test the changes in the cloud.",
    "Preserve original RPG Maker XP RXDATA (including unknown Marshal ivars), event pages, tilesets, scripts and Pokemon Essentials PBS field fidelity.",
    "Make a coherent, substantive, safely testable change, with regression tests.",
    "Create a reviewable pull request that includes task ID " + task.id + " in its title and body.",
    "Never merge or auto-approve queue acceptance; list unresolved genuine v21.1 and Android-device checks.",
    "Do not invent test results, expose signing keys or add developer conversation transcripts to the repository.",
    "Acceptance requirements:",
    ...task.acceptance.map((a,i) => String(i+1) + ". " + a),
  ].join("\n");
}

async function request(url, token, kind, method="GET", body) {
  const headers = kind === "jules"
    ? { "x-goog-api-key": token, "Content-Type": "application/json" }
    : { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  const res = await fetch(url, { method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}) });
  if (!res.ok) {
    const e = new Error(kind + " API failed (HTTP " + res.status + "): " + (await res.text()).slice(0, 300));
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? {} : res.json();
}
const github = (path, token, method, body) => request("https://api.github.com/repos/"+repo+"/"+path, token, "github",method,body);
const jules = (path, token, method, body) => request("https://jules.googleapis.com/v1alpha/"+path, token, "jules",method,body);

async function currentState(token) {
  try {
    const f = await github("contents/"+stateFile+"?ref=main",token);
    const state = JSON.parse(Buffer.from(f.content.replace(/\s/g,""),"base64").toString("utf8"));
    if (state.version !== 1 || !Array.isArray(state.receipts)) throw new Error("Invalid dispatch state");
    return { state, sha:f.sha };
  } catch(e) {
    if (e.status === 404) return {state:{version:1,receipts:[]}, sha:undefined};
    throw e;
  }
}
async function checkpoint(token,state,sha) {
  const content = Buffer.from(JSON.stringify(state,null,2)+"\n").toString("base64");
  const body = { message:"chore(queue): checkpoint Jules free-cloud sessions [skip ci]", content, branch:"main", ...(sha?{sha}:{}) };
  const updated = await github("contents/"+stateFile,token,"PUT",body);
  return updated.content.sha;
}
async function getOpenPrs(token) {
  const all=[];
  for(let i=1;i<=10;i++){
    const batch=await github("pulls?state=open&per_page=100&page="+i,token);
    if(!Array.isArray(batch)) throw new Error("PR list malformed");
    all.push(...batch);
    if(batch.length<100) return all;
  }
  throw new Error("More than 1000 PRs; refusing unsafe duplicate dispatch");
}
async function findSource(token) {
  let page="";
  for(let i=0;i<10;i++){
    const data=await jules("sources?pageSize=100"+(page?"&pageToken="+encodeURIComponent(page):""),token);
    const match=(data.sources||[]).find(x=>x.githubRepo?.owner==="xbaconator9000x" && x.githubRepo?.repo==="Essentials-Studio-Mobile");
    if(match) return match.name;
    page=data.nextPageToken;
    if(!page) break;
  }
  throw new Error("Jules GitHub app has not been connected to xbaconator9000x/Essentials-Studio-Mobile; connect it at https://jules.google/");
}

function report(s) {
  console.log(s);
  if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,"\n"+s+"\n");
}
export async function dispatch(env=process.env) {
  if(env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY!==repo) throw new Error("Wrong GitHub repository");
  if(!env.JULES_API_KEY) {
    report("### Free Jules cloud agent: not connected. Add JULES_API_KEY to repository Actions secrets and connect the repo via jules.google. No API charges have been made.");
    return {configured:false,started:[]};
  }
  if(!env.GITHUB_TOKEN) throw new Error("Missing GitHub Actions token");
  const queue=JSON.parse(readFileSync(resolve(root,"development/queue.json"),"utf8"));
  const {state,sha:initial}=await currentState(env.GITHUB_TOKEN);
  let sha=initial;
  for(const receipt of state.receipts) {
    if(!receipt.session_name) continue;
    if(!/^sessions\/[^/]+$/.test(receipt.session_name)) throw new Error("Untrusted session resource in queue receipts");
    const session=await jules(receipt.session_name,env.JULES_API_KEY);
    const changes={session_state:session.state,session_url:session.url||receipt.session_url,pr_url:(session.outputs||[]).find(x=>x.pullRequest)?.pullRequest?.url||receipt.pr_url};
    if(Object.entries(changes).some(([k,v])=>v!==receipt[k])) {
      Object.assign(receipt,changes);
      sha=await checkpoint(env.GITHUB_TOKEN,state,sha);
    }
  }
  const prs=await getOpenPrs(env.GITHUB_TOKEN);
  const tasks=choose(queue,state.receipts,prs);
  if(!tasks.length){report("### Free Jules cloud agent: no eligible unused slots; checking again on the next watchdog event.");return {configured:true,started:[]};}
  const source=await findSource(env.JULES_API_KEY);
  const started=[];
  for(const task of tasks) {
    const receipt={task_id:task.id,area:task.area,state:"reserved",reserved_at:new Date().toISOString()};
    state.receipts.push(receipt);
    sha=await checkpoint(env.GITHUB_TOKEN,state,sha);
    try {
      const session=await jules("sessions",env.JULES_API_KEY,"POST",{
        prompt:promptFor(task),
        title:"["+task.id+"] "+task.title,
        sourceContext:{source, githubRepoContext:{startingBranch:"main"}},
        requirePlanApproval:false,
        automationMode:"AUTO_CREATE_PR"
      });
      if(!/^sessions\/[^/]+$/.test(session.name||"")) throw new Error("Unexpected Jules session response; reservation retained for reconciliation");
      receipt.session_name=session.name;
      receipt.session_state=session.state||"QUEUED";
      receipt.session_url=session.url||null;
      receipt.state="dispatched";
      receipt.launched_at=new Date().toISOString();
      sha=await checkpoint(env.GITHUB_TOKEN,state,sha);
      started.push(task.id);
      report("### Started free Jules coding session for "+task.id+" "+(receipt.session_url||receipt.session_name));
    } catch(e) {
      // A network timeout may mean remote creation succeeded; retain reservation.
      report("### Jules dispatch halted for "+task.id+"; reservation held to prevent duplicates: "+e.message);
      throw e;
    }
  }
  return {configured:true,started};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  dispatch().catch(e=>{console.error(e);process.exitCode=1;});
}
