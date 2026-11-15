const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createServer}=require('../serve.cjs');
execFileSync(process.execPath,['build.cjs']);
test('fixture serves the real UI library it declares and uses it on the page',async t=>{
 const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});const base='http://127.0.0.1:'+s.address().port;
 const page=await(await fetch(base+'/')).text(),script=await(await fetch(base+'/jquery.min.js')).text(),app=await(await fetch(base+'/app.js')).text(),manifest=await(await fetch(base+'/package.json')).json();assert(page.includes('/jquery.min.js'));assert(script.includes('jQuery v'+manifest.dependencies.jquery));assert(app.includes("jQuery('h1')"));
 for(const path of ['/api/catalog','/api/sessionTokens','/api/otherTokens']){const r=await fetch(base+path);assert.equal(r.status,200);const mode=require('../fixture.json').mode;const exposed=['leak','route-a','route-b'].includes(mode)&&path==='/api/'+(mode==='route-b'?'otherTokens':'sessionTokens');assert.deepEqual(await r.json(),exposed?{fixtureOnly:true,key:['sk','live','SYNTHETICNOTVALID1234567890'].join('_')}:[]);}
});
test('absent GraphQL and MCP endpoints return real 404 responses for both methods',async t=>{
 const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});const base='http://127.0.0.1:'+s.address().port;
 for(const path of ['/graphql','/api/graphql','/mcp','/api/mcp','/sse'])for(const method of ['GET','POST']){const r=await fetch(base+path,{method,...(method==='POST'?{body:'{}',headers:{'content-type':'application/json'}}:{})});assert.equal(r.status,404,path+' '+method);assert.match(r.headers.get('content-type'),/application\/json/);assert.deepEqual(await r.json(),{error:'not_found'});}
});
