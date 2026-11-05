// Disposable public fixture. No account data, working secrets, or outbound requests.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
  res.setHeader('cache-control','no-store');
  res.setHeader('strict-transport-security','max-age=31536000; includeSubDomains');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('content-security-policy',"default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
  res.setHeader('x-frame-options','DENY');
  res.setHeader('referrer-policy','strict-origin-when-cross-origin');
  res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');
  if(!['GET','HEAD'].includes(req.method)){
    // No GraphQL or MCP server is installed: anonymous protocol probes get a real 404.
    res.writeHead(404,{'content-type':'application/json'});return res.end('{"error":"not_found"}');
  }
  let name;try{name=decodeURIComponent(new URL(req.url,'http://fixture.invalid').pathname);}catch{res.writeHead(400);return res.end();}
  if(name==='/healthz'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"ok":true}');}
  if(name==='/')name='/index.html';
  const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  fs.readFile(file,(error,body)=>{
    if(error){res.writeHead(404,{'content-type':'application/json'});return res.end('{"error":"not_found"}');}
    res.setHeader('content-type',name.startsWith('/api/')?'application/json':types[path.extname(file)]||'application/octet-stream');
    res.writeHead(200);res.end(req.method==='HEAD'?undefined:body);
  });
});
server.listen(Number(process.env.PORT||10000),'0.0.0.0');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
