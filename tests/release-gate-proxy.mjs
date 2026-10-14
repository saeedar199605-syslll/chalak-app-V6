// Local release gate instrumentation. No production endpoint, credential logging or injected HTTP success.
import http from 'node:http';import fs from 'node:fs';import zlib from 'node:zlib';
const targetPort=8811;let mode=null,sequence=0;const records=[];const sessions=JSON.parse(fs.readFileSync('.qa62-sessions-private.json','utf8'));
const cookie=i=>'chalak_session='+sessions[i].token;
function write(){fs.writeFileSync('.gate-network-private.json',JSON.stringify(records,null,2));}
function json(res,value){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
http.createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),path=req.url||'/';
 if(path==='/__gate/control'){const c=JSON.parse(body.toString()||'{}');if(c.action==='delay-next')mode='delay';if(c.action==='race-next')mode='race';return json(res,{mode,records});}
 const payload=path.startsWith('/api/state')&&req.method==='POST'?JSON.parse(body.toString()):null;
 const record=path.startsWith('/api/state')?{sequence:++sequence,method:req.method,path,startedAt:new Date().toISOString(),operationId:payload?.operationId,baseRevision:payload?.baseRevision,requestBody:payload}:null;if(record)records.push(record);
 const forward=()=>{
  if(record)record.forwardedAt=new Date().toISOString();const headers={...req.headers,host:'127.0.0.1:'+targetPort};delete headers['transfer-encoding'];delete headers['connection'];headers['content-length']=String(body.length);
  const upstream=http.request({host:'127.0.0.1',port:targetPort,path,method:req.method,headers},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{const bytes=Buffer.concat(chunks);if(record){record.status=response.statusCode;record.serverResponseAt=new Date().toISOString();try{const encoding=response.headers['content-encoding'];const decoded=encoding==='gzip'?zlib.gunzipSync(bytes):encoding==='br'?zlib.brotliDecompressSync(bytes):encoding==='deflate'?zlib.inflateSync(bytes):bytes;record.responseBody=JSON.parse(decoded.toString());}catch{record.responseBody={invalidJson:true};}write();}if(!res.destroyed){res.writeHead(response.statusCode,response.headers);res.end(bytes);if(record){record.deliveredAt=new Date().toISOString();write();}}});});upstream.on('error',()=>{res.writeHead(502);res.end('Isolated upstream unavailable');});upstream.end(body);
 };
 if(mode&&payload?.employeePatch===true&&payload.state?.pe_employees?.some(row=>row.id==='qa-person')){
  const selected=mode;mode=null;record.testMode=selected;
  const beforeResponse=await fetch('http://127.0.0.1:8812/api/state',{headers:{Cookie:cookie(0)}});const before=await beforeResponse.json();record.serverRevisionWhileHeld=before.revision;record.serverValueWhileHeld=before.state.pe_employees.find(e=>e.id==='qa-person').name;write();
  if(selected==='delay'){setTimeout(forward,4500);}
  else{const e=before.state.pe_employees.find(e=>e.id==='qa-person');const operationId=crypto.randomUUID();const competing=await fetch('http://127.0.0.1:8812/api/state',{method:'POST',headers:{Cookie:cookie(1),'Content-Type':'application/json'},body:JSON.stringify({state:{pe_employees:[{...e,shift:'QA62-COMPETING-WRITER'}]},employeePatch:true,baseRevision:before.revision,operationId})});const competingBody=await competing.json();record.competing={operationId,http:competing.status,revision:competingBody.revision};write();forward();}
 }else forward();
}).listen(8813,'127.0.0.1',()=>console.log('Local browser gate proxy ready; bounded ACK delay and real competing writer.'));
