import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'peeper-card-rollout-'));
process.env.PEEPER_DB_PATH=path.join(directory,'rollout.db');
process.env.NODE_ENV='development';process.env.BOT_TOKEN='dev';
const db=require('../database');
const {ROLLOUT_KEY,finishLegacyExpeditionsForCardRollout:rollout}=require('./cardRollout');
const {createPendingRewards}=require('./rewards');
const NOW=Math.floor(Date.now()/1000);
let serial=0;
test.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});

function fixture({mode='dice',status='active',contributions=[3,0,1]}={}) {
  const users=contributions.map((_,i)=>Number(db.prepare('INSERT INTO users(telegram_id,first_name)VALUES(?,?)').run(`rollout-${++serial}`,`Rollout ${i}`).lastInsertRowid));
  const familyId=Number(db.prepare('INSERT INTO families(name,founder_id,invite_code)VALUES(?,?,?)').run('Rollout family',users[0],`ROL${serial}`).lastInsertRowid);
  users.slice(0,2).forEach(id=>db.prepare('INSERT INTO family_members(family_id,user_id)VALUES(?,?)').run(familyId,id));
  const expeditionId=Number(db.prepare(`INSERT INTO family_expeditions(family_id,theme_id,seed,status,map_json,started_by,started_at,boss_defeated_at,finished_at)
    VALUES (?,'root_king','rollout',?,?,?,?,?,?)`).run(familyId,status,JSON.stringify({title:'Legacy crypt',...(mode==='dice'?{}:{combatMode:mode})}),users[0],NOW-500,status==='boss_defeated'?NOW-100:null,status==='finished'?NOW-50:null).lastInsertRowid);
  const definitions=[['camp','camp','cleared',1,1,0],['vault','treasure','cleared',4,4,10],['unfinished','combat','unlocked',2,8,500],['boss','boss','hidden',0,50,1000]];
  for(const [key,type,state,progress,target,coins] of definitions)db.prepare(`INSERT INTO family_expedition_rooms(expedition_id,room_key,room_type,state,progress,progress_target,payload_json)
    VALUES(?,?,?,?,?,?,?)`).run(expeditionId,key,type,state,progress,target,JSON.stringify({name:key,phase:1,loot:{coins:{min:coins,max:coins},artifactRolls:1}}));
  for(let i=0;i<users.length;i++)db.prepare(`INSERT INTO family_expedition_members(expedition_id,user_id,role,ap_regen_day,role_ability_day,contribution_ap,contribution_progress,prepared_at,loadout_json,provision_id,provision_state_json)
    VALUES (?,?,'scout',0,0,?,?,?, ?,?,?)`).run(expeditionId,users[i],contributions[i],contributions[i]*2,NOW-400,
      JSON.stringify({slots:i===0?[{artifactId:'mimic_tooth'},{artifactId:'wooden_shield'},null]:i===1?[{artifactId:'rabbit_foot'},null,null]:[],triggerHistory:[]}),
      i===1?'warm_milk':i===2?'tomato_soup':null,JSON.stringify(i===1?{available:true,used:false}:i===2?{available:false,used:true}:{}));
  const roomId=db.prepare("SELECT id FROM family_expedition_rooms WHERE expedition_id=? AND room_key='unfinished'").get(expeditionId).id;
  const attemptToken=`rollout-attempt-${serial}`;
  db.prepare(`INSERT INTO family_expedition_minigame_attempts(attempt_token,expedition_id,room_id,user_id,game_type,seed,status,ap_spent,started_at,expires_at,result_json)
    VALUES(?,?,?,?,'timing_window','seed','active',1,?,?,'{}')`).run(attemptToken,expeditionId,roomId,users[0],NOW-5,NOW+30);
  return {users,familyId,expeditionId,attemptToken};
}
const clearMarker=()=>db.prepare('DELETE FROM app_settings WHERE key=?').run(ROLLOUT_KEY);
const expedition=id=>db.prepare('SELECT * FROM family_expeditions WHERE id=?').get(id);
const rewards=id=>db.prepare('SELECT * FROM family_expedition_pending_rewards WHERE expedition_id=? ORDER BY user_id').all(id);
const stock=(user,id)=>db.prepare('SELECT quantity FROM expedition_artifact_inventory WHERE user_id=? AND artifact_id=?').get(user,id)?.quantity||0;

test('rollout closes all unfinished legacy runs, rewards actual contribution including former members and frees families',()=>{
  const c=fixture(),boss=fixture({status:'boss_defeated'}),card=fixture({mode:'cards_v1'}),past=fixture({status:'finished'});
  const cardBefore=expedition(card.expeditionId),pastBefore=expedition(past.expeditionId);
  clearMarker();const result=rollout(db,{now:NOW,rng:()=>0.99});assert.equal(result.closed,2);
  assert.equal(expedition(c.expeditionId).status,'finished');assert.equal(expedition(c.expeditionId).finished_at,NOW);
  assert.equal(expedition(c.expeditionId).boss_defeated_at,null);
  assert.equal(rewards(c.expeditionId).length,2);assert.ok(rewards(c.expeditionId).some(row=>row.user_id===c.users[2]));
  assert.ok(!rewards(c.expeditionId).some(row=>row.user_id===c.users[1]));
  const leader=JSON.parse(rewards(c.expeditionId).find(row=>row.user_id===c.users[0]).payload_json);
  assert.equal(leader.contributionAp,3);assert.equal(leader.roomCoins,22);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM family_expeditions WHERE family_id=? AND status!='finished'").get(c.familyId).n,0);
  assert.deepEqual(expedition(card.expeditionId),cardBefore);assert.deepEqual(expedition(past.expeditionId),pastBefore);
  const history=JSON.parse(db.prepare('SELECT summary_json FROM family_expedition_history WHERE expedition_id=?').get(c.expeditionId).summary_json);
  assert.equal(history.finishReason,'expupdate_rollout');assert.equal(history.bossDefeated,false);assert.equal(history.roomsCleared,2);
  assert.equal(JSON.parse(db.prepare('SELECT summary_json FROM family_expedition_history WHERE expedition_id=?').get(boss.expeditionId).summary_json).bossDefeated,true);
});

test('rollout returns still-equipped active and passive relics and only unused food, without inventing consumed copies',()=>{
  const c=fixture();clearMarker();rollout(db,{now:NOW,rng:()=>0.99});
  assert.equal(stock(c.users[0],'mimic_tooth'),1);assert.equal(stock(c.users[0],'wooden_shield'),1);assert.equal(stock(c.users[1],'rabbit_foot'),1);
  assert.equal(stock(c.users[0],'bone_die'),0);
  assert.equal(db.prepare("SELECT quantity FROM farm_inventory WHERE user_id=? AND product_id='milk'").get(c.users[1]).quantity,8);
  assert.equal(db.prepare("SELECT quantity FROM farm_inventory WHERE user_id=? AND product_id='tomato'").get(c.users[2]),undefined);
  assert.equal(db.prepare('SELECT status FROM family_expedition_minigame_attempts WHERE attempt_token=?').get(c.attemptToken).status,'superseded');
  const row=db.prepare('SELECT loadout_json,provision_state_json FROM family_expedition_members WHERE expedition_id=? AND user_id=?').get(c.expeditionId,c.users[1]);
  assert.deepEqual(JSON.parse(row.loadout_json).slots,[null,null,null]);assert.equal(JSON.parse(row.provision_state_json).returnedAt,NOW);
  const again=rollout(db,{now:NOW+1,rng:()=>0});assert.equal(again.alreadyApplied,true);assert.equal(stock(c.users[0],'mimic_tooth'),1);
  assert.equal(db.prepare("SELECT quantity FROM farm_inventory WHERE user_id=? AND product_id='milk'").get(c.users[1]).quantity,8);
});

test('already-created and claimed reward payloads remain byte-identical across rollout and restarts',()=>{
  const c=fixture();db.transaction(()=>createPendingRewards(db,{expeditionId:c.expeditionId,now:NOW-20,completedAt:NOW-20,rng:()=>0.99}))();
  db.prepare('UPDATE family_expedition_pending_rewards SET claimed_at=? WHERE expedition_id=? AND user_id=?').run(NOW-10,c.expeditionId,c.users[0]);
  const before=rewards(c.expeditionId);clearMarker();rollout(db,{now:NOW,rng:()=>0});assert.deepEqual(rewards(c.expeditionId),before);
  const card=fixture({mode:'cards_v1'});rollout(db,{now:NOW+1,rng:()=>0});assert.equal(expedition(card.expeditionId).status,'active');
  assert.deepEqual(rewards(c.expeditionId),before);
});

test('a failure rolls back rewards, refunds, history, statuses and the completion marker together',()=>{
  const c=fixture();clearMarker();
  db.exec(`CREATE TRIGGER reject_rollout_history BEFORE INSERT ON family_expedition_history
    WHEN NEW.expedition_id=${c.expeditionId} BEGIN SELECT RAISE(ABORT,'rollout test failure'); END;`);
  try {assert.throws(()=>rollout(db,{now:NOW,rng:()=>0.99}),/rollout test failure/);} finally {db.exec('DROP TRIGGER reject_rollout_history');}
  assert.equal(expedition(c.expeditionId).status,'active');assert.deepEqual(rewards(c.expeditionId),[]);
  assert.equal(stock(c.users[0],'mimic_tooth'),0);assert.equal(db.prepare('SELECT 1 FROM app_settings WHERE key=?').get(ROLLOUT_KEY),undefined);
  assert.equal(db.prepare('SELECT status FROM family_expedition_minigame_attempts WHERE attempt_token=?').get(c.attemptToken).status,'active');
  assert.equal(rollout(db,{now:NOW,rng:()=>0.99}).closed,1);
});

test('zero-contribution runs close without a reward and card runs remain active',()=>{
  const c=fixture({contributions:[0,0]}),card=fixture({mode:'cards_v1'});clearMarker();rollout(db,{now:NOW,rng:()=>0.99});
  assert.equal(expedition(c.expeditionId).status,'finished');assert.deepEqual(rewards(c.expeditionId),[]);assert.equal(expedition(card.expeditionId).status,'active');
});

test('malformed historical loadout shapes do not prevent the rollout or create phantom refunds',()=>{
  const c=fixture();
  db.prepare('UPDATE family_expedition_members SET loadout_json=? WHERE expedition_id=?')
    .run(JSON.stringify({slots:{invalid:true},triggerHistory:'invalid'}),c.expeditionId);
  clearMarker();assert.equal(rollout(db,{now:NOW,rng:()=>0.99}).closed,1);
  assert.equal(stock(c.users[0],'mimic_tooth'),0);assert.equal(expedition(c.expeditionId).status,'finished');
});

test('normal database startup applies rollout once before serving requests',()=>{
  const c=fixture();clearMarker();
  const boot=()=>execFileSync(process.execPath,['-e',"require('./backend/database').close()"],{cwd:path.resolve(import.meta.dirname,'../..'),env:{...process.env},encoding:'utf8'});
  boot();assert.equal(expedition(c.expeditionId).status,'finished');const before=rewards(c.expeditionId);assert.equal(before.length,2);
  const card=fixture({mode:'cards_v1'});boot();assert.equal(expedition(card.expeditionId).status,'active');assert.deepEqual(rewards(c.expeditionId),before);
});

test('after rollout API allows a new card expedition and rejects stale room actions from the closed run',async()=>{
  const c=fixture();clearMarker();rollout(db,{now:NOW,rng:()=>0.99});
  const express=require('express'),http=require('node:http');const app=express();app.use(express.json());app.use('/api/expeditions',require('../routes/expeditions'));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}/api/expeditions`;
    const headers={'Content-Type':'application/json','X-Telegram-Init-Data':new URLSearchParams({user:JSON.stringify({id:db.prepare('SELECT telegram_id FROM users WHERE id=?').get(c.users[0]).telegram_id})}).toString()};
    const current=await (await fetch(`${base}/current`,{headers})).json();assert.equal(current.expedition,null);assert.equal(current.permissions.canStart,true);assert.equal(current.pendingRewardCount,1);
    for(const action of ['attempt','role-ability','minigame/start','provision/use']) {
      const response=await fetch(`${base}/${c.expeditionId}/rooms/unfinished/${action}`,{method:'POST',headers,body:JSON.stringify({idempotencyKey:`rollout-stale-${serial}-${action}`})});
      assert.equal(response.status,409);
    }
    const start=await fetch(`${base}/start`,{method:'POST',headers,body:JSON.stringify({idempotencyKey:`rollout-new-${serial}`})});
    assert.equal(start.status,200);const next=await start.json();assert.equal(next.expedition.combatMode,'cards_v1');assert.equal(next.member,null);
    assert.equal(next.pendingRewardCount,1);assert.equal(rollout(db,{now:NOW+1}).alreadyApplied,true);assert.equal(expedition(next.expedition.id).status,'active');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
