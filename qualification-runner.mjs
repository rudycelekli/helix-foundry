import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,cpSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve('candidate'),proof=resolve('proof');mkdirSync(proof,{recursive:true});
const guard=()=>{const r=spawnSync(process.execPath,[resolve('harness/source-guard.mjs'),'verify'],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);};
guard();const temp=resolve(proof,'owned-temp');mkdirSync(temp,{recursive:true});
const r=spawnSync('pnpm',['exec','playwright','test','tests/browser/analyst-precision.spec.ts','-g','Analyst sorts large integers exactly and leaves nulls last','--reporter=json'],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:20000000,env:{...process.env,TMPDIR:temp,TMP:temp,TEMP:temp,NODE_OPTIONS:'--import '+resolve('harness/network-guard.mjs'),HELIX_QUALIFICATION_UNIX_ROOTS:JSON.stringify([root,proof,temp]),PLAYWRIGHT_JSON_OUTPUT_NAME:resolve(proof,'baseline-result.json')}});
writeFileSync(resolve(proof,'baseline.log'),(r.stdout||'')+'\n'+(r.stderr||''));guard();
if(existsSync(resolve(root,'test-results')))cpSync(resolve(root,'test-results'),resolve(proof,'test-results'),{recursive:true});
writeFileSync(resolve(proof,'receipt.json'),JSON.stringify({status:'BASELINE_CLASSIFIER',head:'00d7927d7c08e16c58316e006959f052427e7fa1',tree:'625c3b7e73e87c7379d63a603839c79d0db213ce',command_status:r.status,error:r.error?.code||null,unchanged_sources:true},null,2));
// This classifier records its test failure; it does not claim the required gate passed.
