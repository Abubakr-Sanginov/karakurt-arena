import { CODE_NOTES, HOME_ROOMS, SAFE_POS, HOME_EXIT, roomIndex } from './sequelData.js';
const byId = id => document.getElementById(id);
const near = (p,x,z) => Math.hypot(p.x-x,p.z-z)<1.9;
export function sequelAction(state) {
  if(state.chapter==='hospital')return {ready:state.stage==='retreat'&&state.player.z< -6.5&&near(state.player,0,-8),text:'Закрыть дверь · E'};
  const note=CODE_NOTES.find(n=>!state.notes.includes(n.id)&&near(state.player,n.x,n.z));
  if(note)return {ready:true,text:`Подобрать записку · ${note.room} · E`};
  if(!state.weapon&&near(state.player,SAFE_POS.x,SAFE_POS.z))return {ready:true,text:'Открыть панель сейфа · E'};
  if(state.spider.hp<=0&&near(state.player,HOME_EXIT.x,HOME_EXIT.z))return {ready:true,text:'Срочно в больницу · E'};
  return {ready:false,text:state.weapon?'Остановите паука':'Найдите записки и сейф'};
}
export function updateSequelHud(state) {
  const hospital=state.chapter==='hospital',p=state.player,action=sequelAction(state);
  byId('map-label').textContent=hospital?'ЭТАП III · БОЛЬНИЦА':state.stage==='ending'?'ФИНАЛ · НОЧЬ НЕ ЗАКОНЧИЛАСЬ':'ЭТАП IV · ДОМ';
  byId('hud').classList.toggle('hud--critical',p.hp<=30);
  byId('health-value').textContent=Math.ceil(p.hp);byId('health-meter').setAttribute('aria-valuenow',String(Math.ceil(p.hp)));
  byId('health-meter').setAttribute('aria-valuemax','100');
  byId('health-fill').style.transform=`scaleX(${p.hp/100})`;
  byId('wave-value').textContent=hospital?state.stage==='doctor'?`Врач: ${state.doctor.hp}`:state.stage==='barricade'?`Дверь: ${Math.ceil(state.door)}%`:'Нина…':`${state.notes.length} / 5 записок`;
  byId('wave-status').textContent=hospital?'Ранение · найдите помощь':`${HOME_ROOMS[roomIndex(p.x,p.z)]} · Паук: ${state.spider.hp}`;
  const mode=hospital?document.body.dataset.viewMode:'third',first=mode==='first',flat=mode==='top2d';
  byId('view-hud-label').textContent=`${first?'От первого лица':flat?'2D — вид сверху':'От третьего лица'} · WASD — идти · ${first?'Клик — захват мыши · Мышь или стрелки — обзор':'Мышь — прицел'} · ЛКМ / пробел — огонь · E — действие`;
  byId('view-control-hint').textContent=state.message;
  byId('dawn-interact').textContent=action.text;byId('dawn-interact').disabled=!action.ready;
  byId('dodge-label').textContent=hospital?'Рана требует помощи':`Спринт: ${Math.ceil(state.stamina*100)}%`;
  byId('dodge-fill').style.transform=`scaleX(${state.stamina})`;
  const journal=CODE_NOTES.map(note=>state.notes.includes(note.id)?`${note.position}: ${note.digits}`:`${note.position}: ??`).join(' · ');
  byId('safe-notes').textContent=journal;byId('code-journal').textContent=hospital?'':journal;
}
