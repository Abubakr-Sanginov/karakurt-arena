import * as THREE from 'three';
import { createSequelScene } from './sequelScene.js';
import { animateHuman, animateSpider, animateSpiderDeath, animateSpiderStrike } from './models.js';
import { animateHumanOutcome } from './campaignVisuals.js';
const ease=v=>{const t=THREE.MathUtils.clamp(v,0,1);return t*t*(3-2*t);};

/** Visual-only staging from the held chapter clock. Does not mutate simulation or saved cameras. */
export function createSequelView() {
  const scene=createSequelScene(), target=new THREE.Vector3(), centre=new THREE.Vector3(),bodyOffset=new THREE.Vector3();
  const fadeMaterial=new THREE.MeshBasicMaterial({color:0x010208,transparent:true,opacity:0,depthTest:false,depthWrite:false,toneMapped:false});
  const fadeGeometry=new THREE.PlaneGeometry(2,2),fade=new THREE.Mesh(fadeGeometry,fadeMaterial);
  fade.name='sequel-blackout';fade.position.z=-.3;fade.renderOrder=1100;fade.frustumCulled=false;
  let lastTime=-1,lastX=0,lastZ=0,walking=false,lastState=null,pursuerDeathAt=null;
  function relaxed(h,time,moving){
    animateHumanOutcome(h,{kind:'none'});animateHuman(h,time,moving,{relaxed:true});
  }
  function follow(camera,p,aspect){
    const portrait=Math.min(8,Math.max(0,1/aspect-1)*4);
    camera.position.set(p.x+2.3,13+portrait,p.z+10+portrait);camera.lookAt(p.x,.6,p.z-1.6);
  }
  return {root:scene.root,
    update(state,camera,actor,dt){
      const p=state.player,h=actor.getObjectByName('human-survivor'),gun=h.getObjectByName('visible-carbine');
      if(lastState!==state){lastX=p.x;lastZ=p.z;walking=false;lastTime=-1;lastState=state;pursuerDeathAt=null;}
      if(dt>0&&state.time!==lastTime)walking=Math.hypot(p.x-lastX,p.z-lastZ)>.00001;
      lastX=p.x;lastZ=p.z;lastTime=state.time;
      scene.root.visible=true;scene.animate(state.time,state);
      const hospital=state.chapter==='hospital',ending=state.stage==='ending',t=state.sceneTime;
      scene.hospital.visible=hospital;scene.home.visible=!hospital&&!ending;
      scene.clinic.visible=ending&&t<11;scene.bedroom.visible=ending&&t>=11;
      actor.position.set(p.x,0,p.z);actor.rotation.set(0,p.yaw,0);h.visible=true;h.scale.setScalar(1);h.position.set(0,0,0);
      animateHumanOutcome(h,{kind:'none'});animateHuman(h,state.time,walking&&!['nina','ending'].includes(state.stage),{viewmodel:!!h.userData.viewmodel});
      gun.visible=(hospital&&state.stage==='doctor')||(!hospital&&state.weapon&&!ending);
      if(!gun.visible)relaxed(h,state.time,walking);
      if(!h.userData.viewmodel){gun.position.set(.085,1.08,-.03);gun.rotation.set(0,0,0);}
      // The final horror lens is temporary and never changes the ordinary selected view mode.
      const fov=ending&&t>=11?68:58;
      if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
      follow(camera,p,camera.aspect);fadeMaterial.opacity=0;
      if(hospital){
        const d=scene.doctor;d.position.set(state.doctor.x,0,state.doctor.z);d.rotation.set(0,state.doctor.yaw,0);
        relaxed(d,state.time,state.doctor.hp>0);
        const arm=d.userData.modelRig.arms[1],slash=state.doctor.attack>0?1-state.doctor.attack:-1;
        if(slash>=0&&slash<.55){const k=ease(slash/.55);arm.root.rotation.x=-2.5+k*2.7;arm.elbow.rotation.x=-.5-k*.4;d.userData.modelRig.body.rotation.x=.12+Math.sin(k*Math.PI)*.35;}
        else{arm.root.rotation.x=-.65-Math.sin(state.time*9)*.3;arm.elbow.rotation.x=-1.5;}
        if(state.doctor.hp<=0)animateHumanOutcome(d,{kind:'death',time:state.stage==='nina'?Math.min(2.4,t):2.4,duration:2.4});
        const n=scene.nina,g=scene.giant;
        n.position.set(-3,0,5);n.rotation.set(0,0,0);n.scale.setScalar(1);n.visible=state.stage==='doctor'||state.stage==='nina';
        relaxed(n,state.time,false);
        g.visible=['nina','retreat','barricade'].includes(state.stage);g.scale.setScalar(6.2);
        if(state.stage==='nina'){
          const approach=ease((t-1)/1.4),swallow=ease((t-3)/1.7);
          g.position.set(-9+approach*3.2,0,5);g.rotation.y=Math.PI/2;
          animateSpider(g,t,t<2.4);animateSpiderStrike(g,t,ease((t-2.0)/0.5)*(1-ease((t-4.8)/0.6)),ease((t-3.9)/0.4)*(1-ease((t-5.8)/0.4)));animateHumanOutcome(n,{kind:'death',time:Math.max(0,t-2.3),duration:2});
          if(t<2.5){const fear=ease((t-.8)/.5);n.userData.modelRig.arms.forEach(({root,elbow})=>{root.rotation.x=-1.25*fear;elbow.rotation.x=-1.9*fear;});n.userData.modelRig.head.rotation.x=-.2*fear;}
          scene.root.updateMatrixWorld(true);n.getObjectByName('human-rig').localToWorld(centre.set(0,1,0));
          scene.maw.localToWorld(target.set(0,0,-.4));scene.hospital.worldToLocal(centre);scene.hospital.worldToLocal(target);
          const scale=1-swallow*.94;bodyOffset.copy(centre).sub(n.position);n.scale.setScalar(scale);
          n.position.addScaledVector(target.sub(centre),swallow).addScaledVector(bodyOffset,1-scale);n.position.y+=Math.sin(swallow*Math.PI)*.5;n.visible=swallow<1;
          camera.position.set(7,9,17);camera.lookAt(-2,1,4);
        } else if(state.stage==='retreat'||state.stage==='barricade'){
          n.visible=false;g.position.set(state.spider.x,0,state.spider.z);g.rotation.y=state.spider.yaw;animateSpider(g,state.time,state.stage==='retreat');animateSpiderStrike(g,state.time,0,0);
        }
        const shut=state.stage==='barricade';scene.door.rotation.y=shut?Math.sin(t*22)*.018*(1-state.door/100):-Math.PI*.52;
        scene.door.rotation.z=shut?(1-state.door/100)*.08:0;
        scene.cracks.forEach((crack,i)=>{crack.visible=shut&&state.door<90-i*10;});
        if(shut){camera.position.set(5,10,p.z+8);camera.lookAt(0,.6,p.z-3);}
      } else if(!ending){
        scene.notes.forEach((note,i)=>{note.visible=!state.notes.includes(i);note.rotation.y=state.time*.3;});
        const sp=scene.pursuer;sp.visible=true;sp.position.set(state.spider.x,0,state.spider.z);sp.rotation.set(0,state.spider.yaw,0);
        sp.scale.setScalar(4.2);
        if(state.spider.hp>0){animateSpider(sp,state.time,true);animateSpiderStrike(sp,state.time,0,0);}
        else{if(pursuerDeathAt===null)pursuerDeathAt=state.time;animateSpiderDeath(sp,state.time-pursuerDeathAt,false);}
      } else {
        if(t<11){
          const walk=ease((t-4)/4);actor.position.set(0,0,7-walk*16);actor.rotation.y=Math.PI;
          relaxed(h,t,t>4&&t<8);
          scene.queue.forEach((person,i)=>{person.position.x=(i%2?1:-1)*(1+ease((t-4)/1.4)*2.5);relaxed(person,t,false);});
          const door=scene.clinic.getObjectByName('final-doctor-door');door.rotation.y=-ease((t-7)/.7)*1.25;
          camera.position.set(3,3.4,actor.position.z+5);camera.lookAt(0,1.2,actor.position.z-2);
          fadeMaterial.opacity=ease((t-8.8)/.35);
        } else {
          h.visible=false;camera.position.set(0,1.45,3.3);camera.lookAt(0,1.3,-2);
          const sp=scene.nightmare,jump=ease((t-15)/.14);
          sp.visible=t>=15;sp.position.set(0,.35,-3+jump*3.6);sp.rotation.y=0;sp.scale.setScalar(3+jump*2.3);
          animateSpider(sp,t,t<15.2);fadeMaterial.opacity=ease((t-16.2)/.5);
        }
      }
      if(state.lost){
        const death=state.deathTime||0,progress=death/3.2;
        gun.visible=false;scene.nina.visible=false;
        animateHumanOutcome(h,{kind:'death',time:death,duration:3.2});
        if(state.deathCause==='doctor'){
          // The killer remains the knife-wielding doctor; never substitute the giant spider.
          scene.giant.visible=false;scene.pursuer.visible=false;
          const d=scene.doctor;d.visible=true;d.position.set(p.x+.65,0,p.z-.8);d.rotation.y=Math.PI*.8;
          relaxed(d,death,false);const arm=d.userData.modelRig.arms[1];
          arm.root.rotation.x=-1.2+Math.sin(Math.min(1,death)*Math.PI*4)*.35;arm.elbow.rotation.x=-.8;
          camera.position.set(p.x+4.2,3.7,p.z+4.7);camera.lookAt(p.x,1,p.z);
        }else{
          const sp=hospital?scene.giant:scene.pursuer,maw=hospital?scene.maw:scene.homeMaw;
          sp.visible=true;sp.scale.setScalar(6.2);sp.position.set(p.x,0,p.z-4.3);sp.rotation.y=0;animateSpider(sp,death,death<1);animateSpiderStrike(sp,death,ease((progress-.12)/.12)*(1-ease((progress-.8)/.12)),ease((progress-.72)/.1)*(1-ease((progress-.95)/.05)));
          const swallow=ease((progress-.4)/.45),scale=1-swallow*.94;
          actor.updateMatrixWorld(true);sp.updateMatrixWorld(true);h.getObjectByName('human-rig').localToWorld(centre.set(0,1,0));
          maw.localToWorld(target.set(0,0,-.4));actor.worldToLocal(centre);actor.worldToLocal(target);
          h.scale.setScalar(scale);h.position.copy(target).sub(centre).multiplyScalar(swallow).addScaledVector(centre,1-scale);h.visible=swallow<1;
          camera.position.set(p.x+6.5,5.5,p.z+7);camera.lookAt(p.x,1,p.z-1.7);
        }
        fadeMaterial.opacity=ease((progress-.85)/.15)*.85;
      }
      camera.add(fade);const half=Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*.31;fade.scale.set(half*camera.aspect,half,1);
      fade.visible=fadeMaterial.opacity>0;camera.updateMatrixWorld();
    },
    hide(){scene.root.visible=false;fade.visible=false;},
    dispose(){fade.removeFromParent();fadeGeometry.dispose();fadeMaterial.dispose();scene.dispose();},
  };
}
