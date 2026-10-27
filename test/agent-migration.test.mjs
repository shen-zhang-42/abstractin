import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

const prefix = 'extensions.abstractin.';
const custom = { id: 'custom-existing', name: 'Existing agent', command: 'existing-cli', protocol: 'acp', args: ['--stdio'] };
function fixture(values = {}, defaults = {}) {
 const prefs = Object.fromEntries(Object.entries({...defaults,...values}).map(([key,value])=>[prefix+key,value]));
 const env = loadPlugin({prefs});
 const userKeys = new Set(Object.keys(values).map(key=>prefix+key));
 const set = env.window.Zotero.Prefs.set;
 env.window.Zotero.Prefs.set = (key,value)=>{userKeys.add(key);set(key,value);};
 env.window.Services.prefs = {prefHasUserValue:key=>userKeys.has(key)};
 env.plugin.getDataDir=()=>'/existing/abstractin';
 return {...env,p:env.plugin};
}
function oldValidation(p,id,extra={}) {
 const key=JSON.parse(p.agentConfigKey(id));key[0]='0.2.80';
 return {configKey:JSON.stringify(key),discussion:true,source:true,agentVersion:'1.0',skillFingerprint:'unchanged',...extra};
}

test('a fresh profile keeps Codex as its default and still receives first-time setup',()=>{
 const {p,prefs}=fixture({}, {backend:'codex',useClaudeUserSettings:false});
 p.init({id:'test',version:'0.2.95',rootURI:'file:///plugin/'});
 assert.equal(p.readingAgent(),'codex');assert.equal(p.needsAgentSetup(),true);
 assert.equal(prefs[prefix+'readingAgent'],undefined);
 assert.equal(p.inheritedNativeAgent('claude'),false);
 assert.throws(()=>p.selectReadingAgent('claude'),/Test this agent/);
});

test('an existing Claude installation inherits its selected agent and all options without a wizard or connection test',async()=>{
 const {p,prefs,document}=fixture({backend:'claude',claudePath:'C:/Tools/claude.exe','claude.model':'sonnet','claude.effort':'high',useClaudeUserSettings:true});
 p.init({id:'test',version:'0.2.95',rootURI:'file:///plugin/'});
 assert.equal(p.readingAgent(),'claude');assert.equal(p.needsAgentSetup(),false);
 assert.equal(prefs[prefix+'claudePath'],'C:/Tools/claude.exe');
 assert.equal(p.getModel('claude'),'sonnet');assert.equal(p.getEffort('claude'),'high');assert.equal(p.getPref('useClaudeUserSettings'),true);
 assert.equal(p.agentCanReadSources(),true);assert.equal(p.getAgentValidation('claude'),null);
 p.queryAgentCapabilities=async()=>{assert.fail('inherited configuration must not require a new connection test');};
 await p.assertAgentReadingReady('claude','source');
 p.agentSkillSnapshot=async()=>({files:[{type:'book',name:'SKILL.md',content:'Original book instructions'}]});
 assert.match(await p.agentReadingContext('claude',{reading:{type:'book'}}),/Original book instructions/);
 p.checkInstalledBackends=async()=>{};
 const panel=document.createElement('div');panel.className='abstractin-reader-panel';document.body.append(panel);p.renderSkeleton(document,panel);
 assert.equal(panel.querySelector('.abstractin-wizard'),null);
});

test('old Claude options win over the new default branch when no backend user preference existed',()=>{
 const {p}=fixture({'claude.model':'opus'}, {backend:'codex'});p.migrateAgentSettings();
 assert.equal(p.readingAgent(),'claude');assert.equal(p.getBackend(),'claude');assert.equal(p.needsAgentSetup(),false);
});

test('an explicit reading-agent choice wins over the old general backend and migration is idempotent',()=>{
 const {p}=fixture({backend:'claude',readingAgent:'codex',onboarded:true,'claude.model':'opus'});p.migrateAgentSettings();
 assert.equal(p.readingAgent(),'codex');assert.equal(p.getBackend(),'claude');
 p.setPref('readingAgent','claude');p.setPref('claude.model','sonnet');p.migrateAgentSettings();
 assert.equal(p.readingAgent(),'claude');assert.equal(p.getModel('claude'),'sonnet');
});

test('legacy Antigravity selection continues through its native integration',async()=>{
 const {p}=fixture({backend:'agy',agyPath:'/local/agy','agy.model':'existing-model'});p.migrateAgentSettings();
 assert.equal(p.readingAgent(),'agy');assert.equal(p.agentCanReadSources(),true);await p.assertAgentReadingReady('agy','source');
 assert.equal(p.getModel('agy'),'existing-model');
});

test('custom-agent compatibility, model catalogs and image capability survive plugin upgrades',async()=>{
 const {p}=fixture({agents:JSON.stringify([custom]),backend:custom.id,[custom.id+'.model']:'existing-model',[custom.id+'.effort']:'high'});
 p.setPref('agentValidation',JSON.stringify({[custom.id]:oldValidation(p,custom.id,{images:true,models:[{id:'existing-model',label:'Existing model'}],efforts:['high']})}));
 p.init({id:'test',version:'0.2.95',rootURI:'file:///plugin/'});
 const key=p.agentConfigKey(custom.id);p.version='0.2.96';
 assert.equal(p.agentConfigKey(custom.id),key);assert.equal(p.readingAgent(),custom.id);assert.equal(p.needsAgentSetup(),false);
 assert.equal(p.getAgentValidation(custom.id).discussion,true);assert.equal(p.BACKENDS[custom.id].images,true);
 assert.equal(p.getModel(custom.id),'existing-model');assert.equal(p.getEffort(custom.id),'high');
 p.queryAgentCapabilities=async()=>({version:'1.0'});p.agentSkillSnapshot=async()=>({fingerprint:'unchanged'});
 await p.assertAgentReadingReady(custom.id,'source');
});

test('saved API validation survives plugin upgrades while credential and model changes still invalidate it',()=>{
 const {p}=fixture({backend:'deepseek','deepseek.credentialsRevision':'existing-login','deepseek.model':'existing-model'});
 p.setPref('agentValidation',JSON.stringify({deepseek:oldValidation(p,'deepseek',{source:false})}));p.migrateAgentSettings();
 const key=p.agentConfigKey('deepseek');p.version='0.2.99';
 assert.equal(p.agentConfigKey('deepseek'),key);assert.equal(p.readingAgent(),'deepseek');assert.equal(p.needsAgentSetup(),false);
 assert.equal(p.getAgentValidation('deepseek').discussion,true);
 p.setPref('deepseek.credentialsRevision','changed-login');assert.equal(p.getAgentValidation('deepseek'),null);
 p.setPref('deepseek.credentialsRevision','existing-login');p.setPref('deepseek.model','changed-model');assert.equal(p.getAgentValidation('deepseek'),null);
 assert.equal(p.readingAgent(),'deepseek');
});

test('changed CLI configuration cannot reuse an old validation or a legacy-native allowance',()=>{
 const {p}=fixture({backend:'claude',claudePath:'/old/claude'});p.migrateAgentSettings();
 p.setPref('claudePath','/new/claude');assert.equal(p.inheritedNativeAgent('claude'),false);assert.equal(p.agentReadyForDiscussion('claude'),false);
 assert.equal(p.readingAgent(),'claude');
 const customEnv=fixture({agents:JSON.stringify([custom]),readingAgent:custom.id,onboarded:true});
 customEnv.p.setPref('agentValidation',JSON.stringify({[custom.id]:oldValidation(customEnv.p,custom.id)}));
 customEnv.p.setPref('agent.'+custom.id+'.path','/changed/cli');assert.equal(customEnv.p.getAgentValidation(custom.id),null);
 customEnv.p.clearAgentValidation(custom.id);assert.equal(customEnv.p.readingAgent(),custom.id);
});

test('an obsolete validation is not promoted to a legacy native configuration',()=>{
 const {p}=fixture({backend:'claude'});p.setPref('agentValidation',JSON.stringify({claude:oldValidation(p,'claude')}));
 p.setPref('claudePath','/different/cli');p.migrateAgentSettings();
 assert.equal(p.getAgentValidation('claude'),null);assert.equal(p.inheritedNativeAgent('claude'),false);
 assert.equal(p.readingAgent(),'claude');assert.equal(p.needsAgentSetup(),false);
});

test('a later native compatibility result takes precedence over the inherited configuration',()=>{
 const {p}=fixture({backend:'claude'});p.migrateAgentSettings();
 assert.equal(p.inheritedNativeAgent('claude'),true);
 p.setPref('agentValidation',JSON.stringify({claude:{configKey:p.agentConfigKey('claude'),discussion:true,source:false}}));
 assert.equal(p.inheritedNativeAgent('claude'),false);assert.equal(p.agentCanReadSources('claude'),false);
});

test('completed onboarding is preserved even when older profiles had no explicit agent selection',()=>{
 const {p}=fixture({onboarded:true});p.migrateAgentSettings();
 assert.equal(p.readingAgent(),'codex');assert.equal(p.needsAgentSetup(),false);
 const codex=fixture({onboarded:true},{backend:'codex'});codex.p.migrateAgentSettings();
 assert.equal(codex.p.readingAgent(),'codex');assert.equal(codex.p.needsAgentSetup(),false);
});

test('a temporary agent failure preserves the chosen agent and its saved configuration',async()=>{
 const {p}=fixture({agents:JSON.stringify([custom]),readingAgent:custom.id,onboarded:true});
 const saved=JSON.stringify({[custom.id]:oldValidation(p,custom.id)});p.setPref('agentValidation',saved);p.migrateAgentSettings();
 p.queryAgentCapabilities=async()=>{throw new Error('Temporarily unavailable');};
 await assert.rejects(p.assertAgentReadingReady(custom.id,'knowledge'),/Temporarily unavailable/);
 assert.equal(p.readingAgent(),custom.id);assert.equal(p.getPref('agentValidation'),saved);assert.equal(p.needsAgentSetup(),false);
});
