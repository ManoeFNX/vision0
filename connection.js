(() => {
  let peer=null; let pcCode=''; const devices=new Map(); let selectedId=null; let role='pc'; let activeCall=null;
  const $=s=>document.querySelector(s);
  const code=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let x='';for(let i=0;i<8;i++)x+=a[Math.floor(Math.random()*a.length)];return 'CAM-'+x.slice(0,4)+'-'+x.slice(4)};
  function setStatus(text,on=false){$('#globalStatus').textContent=text;document.querySelector('.top-status .status-dot').classList.toggle('connected',on)}
  function updateCodes(){['pairCode','dashboardPairCode','largePairCode'].forEach(id=>{const el=$('#'+id);if(el)el.textContent=pcCode})}
  function initPC(){role='pc';pcCode=code();updateCodes();setStatus('Initialisation...',false);peer=new Peer(pcCode);peer.on('open',()=>{setStatus('PC prêt',false);window.PCStore.addEvent('connection','PC prêt','Code de liaison généré',false);window.PCApp?.render()});peer.on('error',e=>{setStatus('Erreur connexion',false);window.PCApp?.toast('Connexion PeerJS','Impossible d’initialiser la liaison.');console.error(e)});peer.on('connection',conn=>acceptData(conn));peer.on('call',call=>acceptCall(call));}
  function acceptData(conn){const id=conn.peer;devices.set(id,{id,conn,stream:null,name:'Téléphone '+(devices.size+1),battery:null,connected:true});conn.on('open',()=>{window.PCStore.updateDevice(id,{id,name:devices.get(id).name,connected:true,battery:null});conn.send({type:'hello',settings:window.PCStore.state.settings});window.PCStore.addEvent('connection','Téléphone connecté',devices.get(id).name);window.PCApp?.render();window.PCApp?.toast('Appareil connecté',devices.get(id).name)});conn.on('data',data=>handleData(id,data));conn.on('close',()=>{const d=devices.get(id);if(d){d.connected=false;d.stream=null}window.PCCamera?.clearStream?.(id);window.PCStore.updateDevice(id,{connected:false});window.PCStore.addEvent('connection','Téléphone déconnecté',d?.name||id);window.PCApp?.render()});}
  function acceptCall(call){const id=call.peer;const d=devices.get(id)||{id,conn:null,stream:null,name:'Téléphone '+(devices.size+1),battery:null,connected:true};devices.set(id,d);call.answer();call.on('stream',stream=>{d.stream=stream;window.PCCamera.setStream(stream,id);window.PCStore.updateDevice(id,{connected:true});window.PCApp?.render();});call.on('close',()=>{d.stream=null;window.PCCamera?.clearStream?.(id);window.PCApp?.render()});}
  function handleData(id,data){const d=devices.get(id);if(!d)return;if(data.type==='battery'){d.battery=data.level;window.PCStore.updateDevice(id,{battery:data.level,name:d.name});window.PCApp?.render();if(data.level<=window.PCStore.state.settings.batteryThreshold&&window.PCStore.state.settings.notifyBattery){window.PCApp.notify('battery','Batterie faible',`${d.name} : ${data.level}%`)}}if(data.type==='motion'){window.PCApp.motionAlert(id,data); }if(data.type==='photo'){window.PCMedia.receivePhoto(data,id,d.name)}if(data.type==='deviceInfo'){Object.assign(d,data);window.PCStore.updateDevice(id,data);window.PCApp?.render()} if(data.type==='settingsAck'){window.PCApp?.toast('Réglages appliqués',d.name)}}
  function connectPhone(){
    const c=$('#pcCodeInput').value.trim().replace(/\s+/g,'').toUpperCase();
    if(!c)return window.PCApp.toast('Code manquant','Entre le code affiché sur le PC.');
    role='phone';
    try{if(peer)peer.destroy()}catch{}
    peer=new Peer();
    $('#phoneStatusText').textContent='Connexion…';
    const tryConnect=(attempt=1)=>{
      peer.once('open',()=>{
        // Binary serialization is required because automatic captures include an ArrayBuffer.
        const conn=peer.connect(c,{reliable:true,serialization:'binary'});dataConn=conn;
        let done=false;
        const fail=()=>{if(done)return;done=true;try{conn.close()}catch{};if(attempt<4){$('#phoneStatusText').textContent=`Nouvelle tentative ${attempt+1}/4…`;setTimeout(()=>{try{peer.destroy()}catch{};peer=new Peer();tryConnect(attempt+1)},220)}else{$('#phoneStatusText').textContent='Échec de liaison : vérifie le code du PC.';window.PCApp.toast('Échec de liaison','Garde la page PC ouverte et vérifie le code.')}};
        const timeout=setTimeout(()=>{if(!conn.open)fail()},1800);
        conn.on('open',()=>{clearTimeout(timeout);done=true;window.PCPhone.connection=conn;$('#phoneConnectionText').textContent='Connecté au PC';$('#phoneConnectionDot').classList.add('connected');$('#phoneStatusText').textContent='Liaison établie ✔';conn.send({type:'deviceInfo',name:'Téléphone mobile',userAgent:navigator.userAgent});window.PCApp.toast('Connexion réussie','Le téléphone est lié au PC.');window.PCPhone.startBattery()});
        conn.on('data',data=>{if(data.type==='hello')window.PCPhone.applySettings(data.settings);if(data.type==='settings')window.PCPhone.applySettings(data.settings)});
        conn.on('close',()=>{if(done){window.PCPhone.connection=null;$('#phoneConnectionText').textContent='Déconnecté';$('#phoneConnectionDot').classList.remove('connected')}});
        conn.on('error',fail);
      });
      peer.on('error',e=>{console.error(e);if(attempt<4){setTimeout(()=>{try{peer.destroy()}catch{};peer=new Peer();tryConnect(attempt+1)},220)}else{$('#phoneStatusText').textContent='Échec de liaison : '+(e.type||'réseau');window.PCApp.toast('Connexion impossible','Vérifie le code du PC.')}});
    };
    tryConnect();
  }
  function startPhoneCall(stream){const c=window.PCPhone.connection;if(!c)return window.PCApp.toast('Pas de liaison','Connecte le téléphone au PC avant de démarrer.'); if(activeCall){try{activeCall.close()}catch(e){}} const call=peer.call(c.peer,stream,{metadata:{quality:window.PCStore.state.settings.quality,fps:window.PCStore.state.settings.fps}});activeCall=call;call.on('close',()=>{if(activeCall===call)activeCall=null});return call;}
  async function replaceOutgoingTrack(track,kind='video'){if(!activeCall?.peerConnection||!track)return false;const sender=activeCall.peerConnection.getSenders().find(s=>s.track?.kind===kind||(!s.track&&kind==='video'));if(!sender)return false;try{await sender.replaceTrack(track);return true}catch(e){console.error('replaceTrack',e);return false}}
  function sendSettings(settings){devices.forEach(d=>{if(d.connected&&d.conn?.open){try{d.conn.send({type:'settings',settings})}catch(e){}}})}
  function regenerate(){if(peer)peer.destroy();devices.clear();pcCode=code();updateCodes();initPC();window.PCApp.toast('Nouveau code',pcCode)}
  window.PCConnection={initPC,connectPhone,startPhoneCall,replaceOutgoingTrack,sendSettings,regenerate,getDevices:()=>devices,getSelected:()=>selectedId,setSelected:id=>{selectedId=id},getCode:()=>pcCode,getActiveCall:()=>activeCall};
  window.addEventListener('load',initPC);
})();
