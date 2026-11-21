import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,chmodSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'backend/work/lab-host');
export const configPath=path.join(directory,'config.json');
export function configureLocal(token,context,apiPort=8100) {
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const config=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{capacity:2,sources:[]};
 config.docker_context=context;
 config.sources=config.sources.filter(s=>!s.local&&s.url!=='http://127.0.0.1:8100'&&s.url!==`http://127.0.0.1:${apiPort}`);
 config.sources.push({local:true,url:`http://127.0.0.1:${apiPort}`,collector_url:`http://host.docker.internal:${apiPort}`,token});
 writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});chmodSync(configPath,0o600);
}
const pidPath=path.join(directory,'host.pid');
function ownedHost() {
 if(!existsSync(pidPath))return null;
 const pid=Number(readFileSync(pidPath,'utf8'));
 if(!Number.isInteger(pid)||pid<1)return null;
 const args=spawnSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'}).stdout||'';
 return args.includes(path.join(root,'backend/lab/host.py'))&&args.includes(configPath)?pid:null;
}
export function startHost() {
 if(!existsSync(configPath))throw new Error('Configure the private lab host first with npm run local:up');
 if(ownedHost()){console.log('This checkout’s managed lab host is already running.');return;}
 const python=process.env.SENTINEL_PYTHON||(process.platform==='darwin'?'/usr/bin/python3':'python3');
 const check=spawnSync(python,['--version'],{stdio:'ignore'});
 if(check.error||check.status!==0)throw new Error('Python 3.9+ is required for the managed lab host. Set SENTINEL_PYTHON to its executable.');
 const log=openSync(path.join(directory,'host.log'),'a',0o600);
 const child=spawn(python,[path.join(root,'backend/lab/host.py'),'--config',configPath],{cwd:root,detached:true,stdio:['ignore',log,log]});
 closeSync(log);
 child.on('error',error=>console.error('Lab host could not start:',error.message));
 if(!child.pid)throw new Error('Lab host could not start; see backend/work/lab-host/host.log');
 writeFileSync(pidPath,String(child.pid),{mode:0o600});
 child.unref();
 console.log('Managed lab host started for this checkout. No login service was installed.');
}
export function stopHost() {
 const pid=ownedHost();
 if(pid){try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
 if(existsSync(pidPath))unlinkSync(pidPath);
}
export async function drainLocal() {
 if(!existsSync(configPath))return;
 const source=JSON.parse(readFileSync(configPath,'utf8')).sources.find(s=>s.local||s.url==='http://127.0.0.1:8100');
 if(!source)return;
 const response=await fetch(source.url+'/api/lab-host/drain',{method:'POST',headers:{Authorization:'Bearer '+source.token},signal:AbortSignal.timeout(10000)}).catch(()=>null);
 if(response?.ok) {
  for(let i=0;i<15;i++) {
   const poll=await fetch(source.url+'/api/lab-host/poll',{method:'POST',headers:{Authorization:'Bearer '+source.token,'Content-Type':'application/json'},body:JSON.stringify({ready:false,capacity:2,version:'1.4.0',reason:'preparing'}),signal:AbortSignal.timeout(5000)}).catch(()=>null);
   if(poll?.ok&&!(await poll.json()).jobs.length)return;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Lab cleanup is still pending. Keep the local API running and retry local:down.');
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))startHost();
