// Synthetic pages only; no application data or working credentials.
const fs=require('node:fs');
const fixture=JSON.parse(fs.readFileSync('fixture.json','utf8'));
fs.rmSync('public',{recursive:true,force:true});
fs.mkdirSync('public/.well-known',{recursive:true});fs.mkdirSync('public/api',{recursive:true});
fs.writeFileSync('public/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="stacksnack-verify" content="${fixture.proof}"><title>Synthetic integration fixture</title></head><body><h1>Synthetic integration fixture</h1><p>Mode: ${fixture.mode}</p><script src="/app.js"></script></body></html>`);
fs.writeFileSync('public/.well-known/stacksnack-verify.txt',fixture.proof+'\n');
fs.writeFileSync('public/.well-known/security.txt','Contact: https://github.com/The-Gift/stacksnack-ci-e2e-20261102\nExpires: 2027-01-01T00:00:00Z\n');
fs.writeFileSync('public/package.json',JSON.stringify({name:'synthetic-ci-fixture',dependencies:{'is-number':'7.0.0'}}));
fs.writeFileSync('public/api/catalog','[]');
fs.writeFileSync('public/app.js',`fetch('/api/catalog');${fixture.mode==='leak'?"fetch('/api/sessionTokens');":''}`);
if(fixture.mode==='leak')fs.writeFileSync('public/api/sessionTokens',JSON.stringify({fixtureOnly:true,key:['sk','live','SYNTHETICNOTVALID1234567890'].join('_')}));
