// Isolated acceptance only: inject exactly one failure BEFORE forwarding/commit. Never ship in production ZIP.
import http from 'node:http';
let failNext=false,failed=0,posts=0;const requests=[],receiptLookups=[];
http.createServer(async(req,res)=>{
  if(req.url==='/__test/fail-once'&&req.method==='POST'){failNext=true;res.end('armed');return;}
  if(req.url==='/__test/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({failed,posts,requests,receiptLookups}));return;}
  if(req.url.startsWith('/api/state?operationId=')) receiptLookups.push(new URL(req.url,'http://localhost').searchParams.get('operationId'));
  let body;
  if(req.url==='/api/state'&&req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);body=Buffer.concat(chunks);try{const p=JSON.parse(body);requests.push({operationId:p.operationId,keys:Object.keys(p.state||{}),employeeIds:(p.state?.pe_employees||[]).map(e=>e.id),injected:failNext});}catch{requests.push({invalid:true});}}
  if(req.url==='/api/state'&&req.method==='POST'){posts++;if(failNext){failNext=false;failed++;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'خطای کنترل‌شده قبل از ثبت؛ داده‌ای نوشته نشد.',code:'local_precommit_failure',retryable:false}));return;}}
  const upstream=http.request({hostname:'127.0.0.1',port:8796,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:8796'}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});upstream.on('error',()=>{res.writeHead(503);res.end('Local backend unavailable');});if(body)upstream.end(body);else req.pipe(upstream);
}).listen(8797,'127.0.0.1',()=>console.log('Isolated acceptance proxy ready: http://127.0.0.1:8797'));
