// Public orchestration only. The StackSnack Action and scan credential remain private.
const crypto = require('node:crypto');
const fs = require('node:fs');
const FIXTURE = 'The-Gift/stacksnack-ci-e2e-20261102';
const PRIVATE = 'The-Gift/stacksnack';
const SERVICE = 'srv-dbl5o65g1s2s73f2hhc0';
const ORIGIN = 'https://stacksnack-ci-e2e-green-20261103.onrender.com';
const BRANCH = 'codex/release/0.3.0';
const ENVIRONMENT = 'staging-ci-e2e-green';
const SHA = /^[a-f0-9]{40}$/;
const INTEGER = /^[1-9][0-9]*$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function requireContext(env) {
  if (env.GITHUB_REPOSITORY !== FIXTURE || env.GITHUB_REF !== 'refs/heads/preview' ||
      !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) || !SHA.test(env.GITHUB_SHA || '')) {
    throw new Error('Only the trusted staging preview branch can deploy.');
  }
}
function hookUrl(raw, sha) {
  const url = new URL(raw);
  if (url.origin !== 'https://api.render.com' || url.pathname !== '/deploy/' + SERVICE ||
      url.username || url.password || url.hash || !url.searchParams.get('key') ||
      [...url.searchParams.keys()].some(k => k !== 'key')) throw new Error('Expected the staging preview service deploy hook.');
  if (!SHA.test(sha || '')) throw new Error('Expected a full commit SHA.');
  url.searchParams.set('ref', sha);
  return url;
}
function validBuild(body, sha, startedAt) {
  return body?.ok === true && body.sha === sha && /^[a-f0-9-]{36}$/.test(body.buildId || '') &&
    Number.isFinite(Date.parse(body.builtAt)) && Date.parse(body.builtAt) >= startedAt;
}
async function main(env = process.env, {fetcher = fetch, pause = sleep} = {}) {
  requireContext(env);
  const sha = env.GITHUB_SHA, startedAt = Date.now();
  let appToken;
  const headers = token => ({authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'StackSnack staging preview'});
  async function api(repo, path, token, method = 'GET', body) {
    const r = await fetcher('https://api.github.com/repos/' + repo + path, {method, headers: headers(token),
      ...(body ? {body: JSON.stringify(body)} : {}), redirect: 'error', signal: AbortSignal.timeout(15000)});
    if (!r.ok) throw new Error('GitHub staging operation failed (' + r.status + ').');
    return r.status === 204 ? null : r.json();
  }
  const token = env.GITHUB_TOKEN;
  const pull = (await api(FIXTURE, '/pulls?state=open&head=The-Gift:preview&base=main', token)).find(p => p.head.sha === sha);
  if (!pull || pull.base.repo.full_name !== FIXTURE) throw new Error('This commit must be the current head of an open staging pull request.');
  const deploy = await api(FIXTURE, '/deployments', token, 'POST', {ref: sha, auto_merge: false, required_contexts: [],
    environment: ENVIRONMENT, production_environment: false, transient_environment: true,
    payload: {stagingOnly: true, workflowRunId: env.GITHUB_RUN_ID, renderServiceId: SERVICE}});
  const logUrl = 'https://github.com/' + FIXTURE + '/actions/runs/' + env.GITHUB_RUN_ID;
  async function status(state, description) {
    return api(FIXTURE, '/deployments/' + deploy.id + '/statuses', token, 'POST',
      {state, description, environment_url: ORIGIN, log_url: logUrl, auto_inactive: false});
  }
  let ready = false;
  try {
    await status('in_progress', 'Deploying the exact staging preview commit.');
    const r = await fetcher(hookUrl(env.RENDER_STAGING_DEPLOY_HOOK, sha), {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000)});
    if (r.status !== 200) throw new Error('The staging deploy was not started; inspect Render before retrying (' + r.status + ').');
    const result = await r.json();
    const renderDeployId = result.deploy?.id || result.deploy?.deploy?.id || result.deployId || result.id;
    if (!/^dep-[a-z0-9]+$/.test(renderDeployId || '')) throw new Error('Render did not confirm a deployment ID.');
    console.log('Render staging deployment: ' + renderDeployId);
    const deadline = Date.now() + 12 * 60000;
    while (Date.now() < deadline) {
      const currentPull = await api(FIXTURE, '/pulls/' + pull.number, token);
      if (currentPull.state !== 'open' || currentPull.head.sha !== sha) throw new Error('A newer staging commit replaced this rollout.');
      try {
        const health = await fetcher(ORIGIN + '/healthz', {redirect: 'error', signal: AbortSignal.timeout(15000)});
        if (health.ok && validBuild(await health.json(), sha, startedAt)) {ready = true; break;}
      } catch { /* A free staging service can be asleep while its build runs. */ }
      await pause(10000);
    }
    if (!ready) throw new Error('The new staging build did not become healthy before the timeout.');
    await status('success', 'The exact staging commit is healthy; starting the automatic release gate.');
    // The existing signed GitHub App webhook owns the blocking gate. Let it finish before the CLI creates a second scan.
    const gateDeadline = Date.now() + 12 * 60000;
    let gate;
    while (Date.now() < gateDeadline) {
      const checks = await api(FIXTURE, '/commits/' + sha + '/check-runs?per_page=100', token);
      gate = checks.check_runs.find(c => c.name === 'StackSnack Release Gate' && c.app?.id === 5535068 &&
        Date.parse(c.started_at || c.created_at) >= startedAt);
      if (gate?.status === 'completed') break;
      await pause(15000);
    }
    if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') throw new Error('The automatic staging release gate did not pass.');
    console.log('Automatic release gate passed: ' + gate.html_url);
    for (const key of ['STAGING_DISPATCH_APP_ID', 'STAGING_DISPATCH_INSTALLATION_ID']) {
      if (!INTEGER.test(env[key] || '')) throw new Error('The staging dispatcher App is not configured.');
    }
    const head = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const body = Buffer.from(JSON.stringify({iat:Math.floor(Date.now()/1000)-30,exp:Math.floor(Date.now()/1000)+540,iss:env.STAGING_DISPATCH_APP_ID})).toString('base64url');
    const unsigned = head + '.' + body;
    const jwt = unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), env.STAGING_DISPATCH_PRIVATE_KEY).toString('base64url');
    const auth = await fetcher('https://api.github.com/app/installations/' + env.STAGING_DISPATCH_INSTALLATION_ID + '/access_tokens',
      {method:'POST',headers:headers(jwt),body:JSON.stringify({repository_ids:[1422640642],permissions:{actions:'write'}}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!auth.ok) throw new Error('Could not obtain the repository-scoped workflow token.');
    const grant = await auth.json(); appToken = grant.token;
    if (typeof appToken !== 'string' || !grant.permissions?.actions) throw new Error('The dispatcher did not issue the expected token.');
    console.log('::add-mask::' + appToken);
    const title = 'Staging preview ' + renderDeployId;
    await api(PRIVATE, '/actions/workflows/security.yml/dispatches', appToken, 'POST', {ref:BRANCH,inputs:{
      staging_preview_check:'true',staging_pull_request:String(pull.number),staging_preview_sha:sha,staging_render_deploy_id:renderDeployId}});
    const ciDeadline = Date.now() + 20 * 60000;
    let run;
    while (Date.now() < ciDeadline) {
      const runs = await api(PRIVATE, '/actions/workflows/security.yml/runs?event=workflow_dispatch&branch=' + encodeURIComponent(BRANCH) + '&per_page=30', appToken);
      run = runs.workflow_runs.find(r => r.display_title === title && Date.parse(r.created_at) >= startedAt);
      if (run?.status === 'completed') break;
      await pause(15000);
    }
    if (!run || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('The private hosted workflow did not pass; inspect its run before retrying.');
    const receipt = {sha,renderDeployId,deploymentId:String(deploy.id),releaseGateId:String(gate.id),hostedRunId:String(run.id),state:'success'};
    fs.writeFileSync('staging-deployment-receipt.json', JSON.stringify(receipt,null,2) + '\n');
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, 'Staging preview, automatic release gate, and hosted Action all passed.\n\nCommit: `' + sha + '`\n');
    console.log('Staging deployment and hosted verification passed.');
  } catch (error) {
    // Never turn a healthy deploy into a failed deployment because a subsequent security check failed.
    if (!ready) await status('failure', 'Staging rollout did not become healthy.').catch(() => {});
    throw error;
  } finally {
    if (appToken) await fetcher('https://api.github.com/installation/token', {method:'DELETE',headers:headers(appToken),redirect:'error',signal:AbortSignal.timeout(10000)}).catch(() => {});
  }
}
module.exports = {requireContext, hookUrl, validBuild, main};
if (require.main === module) main().catch(() => {console.error('Staging verification failed. Inspect the deployment and private workflow; credentials and responses are deliberately omitted.');process.exitCode=1;});
