const {test} = require('node:test');
const assert = require('node:assert/strict');
const {requireContext,hookUrl,validBuild} = require('./staging-preview.cjs');
const sha = 'a'.repeat(40);
const context = {GITHUB_REPOSITORY:'The-Gift/stacksnack-ci-e2e-20261102',GITHUB_REF:'refs/heads/preview',GITHUB_EVENT_NAME:'push',GITHUB_SHA:sha};
test('rejects production, forks, PR execution, and partial commits', () => {
  requireContext(context);
  for (const change of [{GITHUB_REF:'refs/heads/main'},{GITHUB_REPOSITORY:'someone/fork'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_SHA:'abc123'}]) assert.throws(() => requireContext({...context,...change}));
});
test('only the exact staging deploy hook can be used', () => {
  const hook = 'https://api.render.com/deploy/srv-dbl5o65g1s2s73f2hhc0?key=synthetic';
  assert.equal(hookUrl(hook,sha).searchParams.get('ref'),sha);
  for (const raw of [hook.replace('srv-dbl5o65g1s2s73f2hhc0','srv-production'),hook.replace('api.render.com','attacker.invalid'),hook+'&ref=main',hook.replace('https:','http:')]) assert.throws(() => hookUrl(raw,sha));
});
test('a prior deployment or a different commit cannot satisfy readiness', () => {
  const now = Date.now(), build = {ok:true,sha,buildId:'12345678-1234-1234-1234-123456789abc',builtAt:new Date(now).toISOString()};
  assert.equal(validBuild(build,sha,now-1000),true);
  assert.equal(validBuild(build,sha,now+1000),false);
  assert.equal(validBuild({...build,sha:'b'.repeat(40)},sha,now-1000),false);
});

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const {main} = require('./staging-preview.cjs');
test('rollout, signed App gate, and private workflow complete in order; token is revoked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'staging-preview-test-'));
  const old = process.cwd(); process.chdir(dir);
  const calls = [];
  const key = crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
  const env = {...context,GITHUB_TOKEN:'synthetic',GITHUB_RUN_ID:'42',GITHUB_STEP_SUMMARY:path.join(dir,'summary'),
    RENDER_STAGING_DEPLOY_HOOK:'https://api.render.com/deploy/srv-dbl5o65g1s2s73f2hhc0?key=synthetic',
    STAGING_DISPATCH_APP_ID:'123',STAGING_DISPATCH_INSTALLATION_ID:'456',STAGING_DISPATCH_PRIVATE_KEY:key};
  const response = (data,status=200) => new Response(status===204?null:JSON.stringify(data),{status});
  async function fetcher(raw, options = {}) {
    const url = String(raw); calls.push({url,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
    if (url.includes('/pulls')) {const pull={number:1,state:'open',head:{sha},base:{repo:{full_name:context.GITHUB_REPOSITORY}}};return response(url.includes('/pulls?')?[pull]:pull);}
    if (url.endsWith('/deployments')) return response({id:1234},201);
    if (url.endsWith('/statuses')) return response({id:5678},201);
    if (url.startsWith('https://api.render.com/')) return response({deploy:{id:'dep-synthetic'}});
    if (url.endsWith('/healthz')) return response({ok:true,sha,buildId:crypto.randomUUID(),builtAt:new Date(Date.now()+1000).toISOString()});
    if (url.includes('/check-runs')) return response({check_runs:[{id:999,name:'StackSnack Release Gate',app:{id:5535068},external_id:crypto.createHash('sha256').update(['9a3d5ef5-84d1-4228-a275-3267581d4c28','1443487174','1234',sha].join(':')).digest('hex'),started_at:new Date(Date.now()+1000).toISOString(),status:'completed',conclusion:'success',html_url:'https://github.com/synthetic'}]});
    if (url.endsWith('/access_tokens')) return response({token:'synthetic-short-lived',permissions:{actions:'write'}});
    if (url.endsWith('/dispatches')) return response(null,204);
    if (url.includes('/actions/workflows/security.yml/runs?')) return response({workflow_runs:[{id:777,display_title:'Staging preview dep-synthetic',created_at:new Date(Date.now()+1000).toISOString(),status:'completed',conclusion:'success'}]});
    if (url.endsWith('/installation/token')) return response(null,204);
    throw new Error('Unexpected request: '+url);
  }
  try {
    await main(env,{fetcher,pause:async()=>{throw new Error('Unexpected wait');}});
    const names = calls.map(c=>c.url);
    assert.ok(names.findIndex(u=>u.endsWith('/healthz')) < names.findIndex(u=>u.includes('/check-runs')));
    assert.ok(names.findIndex(u=>u.includes('/check-runs')) < names.findIndex(u=>u.endsWith('/dispatches')));
    const grant = calls.find(c=>c.url.endsWith('/access_tokens'));
    assert.deepEqual(grant.body,{repository_ids:[1422640642],permissions:{actions:'write'}});
    const dispatch = calls.find(c=>c.url.endsWith('/dispatches'));
    assert.equal(dispatch.body.ref,'codex/release/0.3.0');
    assert.equal(dispatch.body.inputs.staging_render_deploy_id,'dep-synthetic');
    assert.equal(calls.at(-1).method,'DELETE');
    const receipt = JSON.parse(fs.readFileSync('staging-deployment-receipt.json'));
    assert.equal(receipt.hostedRunId,'777');assert.equal(receipt.sha,sha);
  } finally {process.chdir(old);fs.rmSync(dir,{recursive:true,force:true});}
});
