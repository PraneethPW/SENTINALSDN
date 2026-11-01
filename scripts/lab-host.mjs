import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,chmodSync,openSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'backend/work/lab-host');
export const configPath=path.join(directory,'config.json');
export function configureLocal(token,context) {
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const config=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{capacity:2,sources:[]};
 config.docker_context=context;
 config.sources=config.sources.filter(s=>s.url!=='http://127.0.0.1:8100');
 config.sources.push({url:'http://127.0.0.1:8100',collector_url:'http://host.docker.internal:8100',token});
 writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});chmodSync(configPath,0o600);
}
export function startHost() {
 if(!existsSync(configPath))throw new Error('Configure the private lab host first with npm run local:up');
 const python=process.platform==='darwin'?'/usr/bin/python3':'python3';
 const script=path.join(root,'backend/lab/host.py');
 if(process.platform==='darwin') {
  const service='com.sentinel-sdn.lab-host';const plist=path.join(process.env.HOME,'Library/LaunchAgents',service+'.plist');
  mkdirSync(path.dirname(plist),{recursive:true});
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const contents=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${service}</string><key>ProgramArguments</key><array>${[python,script,'--config',configPath].map(x=>'<string>'+escape(x)+'</string>').join('')}</array><key>WorkingDirectory</key><string>${escape(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${escape(directory)}/host.log</string><key>StandardErrorPath</key><string>${escape(directory)}/host.log</string></dict></plist>`;
  spawnSync('launchctl',['bootout',`gui/${process.getuid()}/${service}`],{stdio:'ignore'});
  writeFileSync(plist,contents,{mode:0o600});
  const result=spawnSync('launchctl',['bootstrap',`gui/${process.getuid()}`,plist],{stdio:'inherit'});
  if(result.status!==0)throw new Error('Could not start the lab host service');
 } else {
  const log=openSync(path.join(directory,'host.log'),'a',0o600);
  spawn(python,[script,'--config',configPath],{cwd:root,detached:true,stdio:['ignore',log,log]}).unref();
 }
 console.log('Managed lab host started. Start a private live lab from Network setup.');
}
export async function drainLocal() {
 if(!existsSync(configPath))return;
 const source=JSON.parse(readFileSync(configPath,'utf8')).sources.find(s=>s.url==='http://127.0.0.1:8100');
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
