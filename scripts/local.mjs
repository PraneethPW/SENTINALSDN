import { spawnSync } from 'node:child_process';
import { randomBytes,createHash } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file=path.join(root,'.env.local-stack');
const context=process.env.SENTINEL_DOCKER_CONTEXT || (process.platform==='darwin'?'colima-sentinel-sdn':'default');
function run(command,args,options={}) {const p=spawnSync(command,args,{cwd:root,stdio:'inherit',...options});if(p.status!==0)process.exit(p.status||1);return p;}
const action=process.argv[2]||'up';
if(!['up','down','status','logs','credentials'].includes(action))throw new Error('Use up, down, status, logs, or credentials');
if(action==='up' && process.platform==='darwin') {
 const ready=spawnSync('docker',['--context',context,'info'],{stdio:'ignore'});
 if(ready.status!==0)run('colima',['start','sentinel-sdn','--vm-type','vz','--cpus','4','--memory','6','--disk','12','--activate=false','--ssh-config=false','--mount','none']);
}
if(!existsSync(file)) {
 if(action!=='up')throw new Error('Run npm run local:up first');
 const secret=()=>randomBytes(32).toString('hex');
 writeFileSync(file,`LOCAL_DB_PASSWORD=${secret()}\nLOCAL_COLLECTOR_TOKEN=${secret()}\nLOCAL_ADMIN_EMAIL=admin@sentinel.local\nLOCAL_ADMIN_PASSWORD=${secret()}\n`,{mode:0o600});
}
let text=readFileSync(file,'utf8').replace(/^LOCAL_MODEL_(SHA256|THRESHOLD)=.*\n?/gm,'');
text+=`LOCAL_MODEL_SHA256=${createHash('sha256').update(readFileSync(path.join(root,'backend/artifacts/model.joblib'))).digest('hex')}\nLOCAL_MODEL_THRESHOLD=${JSON.parse(readFileSync(path.join(root,'backend/artifacts/model.json'))).evaluation_threshold}\n`;
writeFileSync(file,text,{mode:0o600});
if(action==='credentials') {console.log(text.split('\n').filter(l=>l.startsWith('LOCAL_ADMIN_')).join('\n'));process.exit(0);}
const plugin=spawnSync('docker',['compose','version'],{stdio:'ignore'}).status===0;
const executable=plugin?'docker':'docker-compose';
const base=plugin?['--context',context,'compose','--env-file',file,'-f','compose.local.yml']:['--context',context,'--env-file',file,'-f','compose.local.yml'];
if(action==='up'){
 run(executable,[...base,'up','--build','--wait','--wait-timeout','240','-d']);
 console.log('\nSentinel local: http://localhost:5180\nAPI: http://localhost:8100\nCredentials: npm run local:credentials\nDatabase, inference, and real SDN packets run locally. No cloud credentials are used.\nAllow 60 seconds for discovery and the first valid ML window.');
}else run(executable,[...base,...({down:['down'],status:['ps'],logs:['logs','--tail','100','-f']}[action])]);
