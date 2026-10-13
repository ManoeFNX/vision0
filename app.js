(() => {
  const $=s=>document.querySelector(s);
  let alertFilter='all',start=Date.now();
  let notificationRequested=false;
  const channel='BroadcastChannel' in window?new BroadcastChannel('phonecam-alert-v2'):null;

  function toast(title,detail=''){
    const stack=$('#toastStack'); if(!stack)return;
    const d=document.createElement('div');d.className='toast';
    const heading=document.createElement('strong');heading.textContent=String(title??'');d.appendChild(heading);
    if(detail!==''&&detail!==null&&detail!==undefined){const body=document.createElement('small');body.textContent=String(detail);d.appendChild(body)}
    stack.appendChild(d);setTimeout(()=>d.remove(),4500);
  }

  async function requestNotifications(){
    if(!('Notification' in window))return false;
    if(Notification.permission==='granted')return true;
    if(Notification.permission==='denied')return false;
    try{const p=await Notification.requestPermission();notificationRequested=true;updateNotificationButton();return p==='granted'}catch(e){return false}
  }
  function updateNotificationButton(){
    const b=$('#notificationBtn');if(!b)return;
    if(!('Notification' in window)){b.textContent='🔕 Notifications indisponibles';return}
    b.textContent=Notification.permission==='granted'?'🔔 Notifications actives':'🔔 Activer les notifications';
  }
  function systemNotification(title,detail,type='motion'){
    if(type==='motion'&&!window.PCStore.state.settings.notifyMotion)return;
    if(type==='person'&&!window.PCStore.state.settings.notifyPerson)return;
    if(type==='battery'&&!window.PCStore.state.settings.notifyBattery)return;
    if(type==='connection'&&!window.PCStore.state.settings.notifyConnection)return;
    if('Notification' in window&&Notification.permission==='granted'){
      try{const n=new Notification(title,{body:detail,tag:`phonecam-${type}`,renotify:true});n.onclick=()=>{window.focus();n.close()}}catch(e){console.debug('Notification',e)}
    }
    if(channel)channel.postMessage({title,detail,type,time:Date.now()});
  }
  function notify(type,title,detail){
    const s=window.PCStore.state.settings;
    if(type==='motion'&&!s.notifyMotion)return;if(type==='person'&&!s.notifyPerson)return;if(type==='battery'&&!s.notifyBattery)return;if(type==='connection'&&!s.notifyConnection)return;
    window.PCStore.addEvent(type,title,detail);toast(title,detail);systemNotification(title,detail,type);render();
  }
  function showSoundHint(){toast('🔊 Son du flux bloqué','Clique sur « Activer le son » pour autoriser la lecture audio du téléphone.')}

  function render(){
    renderStats();renderEvents();renderDevices();renderAlerts();renderSettings();window.PCPeople?.render?.();
    const devices=window.PCConnection.getDevices();
    const count=[...devices.values()].filter(d=>d.connected&&d.stream).length;
    $('#deviceCount').textContent=devices.size;$('#statCameras').textContent=count;
    $('#dashConnection').textContent=count?`${count} active${count>1?'s':''}`:'Hors ligne';
    $('#dashConnectionDetail').textContent=count?'Flux vidéo disponible':'Aucun appareil';
    const selected=window.PCConnection.getSelected();
    const selectedDevice=selected?devices.get(selected):null;
    const d=(selectedDevice?.connected?selectedDevice:null)||[...devices.values()].find(x=>x.connected&&x.stream)||[...devices.values()].find(x=>x.connected);
    if(d&&d.connected){
      $('#cameraBattery').textContent=`🔋 ${d.battery??'--'}%`;
      $('#dashBattery').textContent=d.battery==null?'--%':`${d.battery}%`;
      $('#dashBatteryBar').style.width=(d.battery||0)+'%';
      $('#dashCameraState').textContent=d.stream?'Active':'Connectée';
      $('#dashCameraQuality').textContent=`${window.PCStore.state.settings.quality}p • ${window.PCStore.state.settings.fps} FPS • Audio HD`;
    }else{
      $('#cameraBattery').textContent='🔋 --%';$('#dashBattery').textContent='--%';$('#dashBatteryBar').style.width='0%';$('#dashCameraState').textContent='Inactive';$('#dashCameraQuality').textContent='--';
    }
  }
  function renderStats(){const unread=window.PCStore.state.events.filter(e=>e.unread).length;$('#statAlerts').textContent=unread;$('#alertCount').textContent=unread;$('#statMedia').textContent=window.PCStore.state.stats.media||0;const sec=Math.floor((Date.now()-start)/1000);$('#statUptime').textContent=new Date(sec*1000).toISOString().substr(14,5)}
  function icon(t){return({motion:'🔴',person:'👤',battery:'🔋',connection:'📡',media:'📸'})[t]||'•'}
  function makeEventRow(e,full=false){
    const row=document.createElement('div');row.className='event-item '+(e.unread?'unread':'');
    const glyph=document.createElement('span');glyph.className='event-icon';glyph.textContent=icon(e.type);row.appendChild(glyph);
    const body=document.createElement('div');body.className='event-copy';
    const heading=document.createElement('strong');heading.textContent=String(e.title??'');body.appendChild(heading);
    const detail=document.createElement('small');
    detail.textContent=`${String(e.detail??'')} • ${full?new Date(e.time).toLocaleString('fr-FR'):new Date(e.time).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
    body.appendChild(detail);row.appendChild(body);
    if(full){
      row.tabIndex=0;row.setAttribute('role','button');row.style.cursor='pointer';
      const markRead=()=>{e.unread=false;window.PCStore.save();render()};
      row.addEventListener('click',markRead);row.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();markRead()}});
    }
    return row;
  }
  function renderEvents(){const list=$('#dashboardEvents');list.replaceChildren();window.PCStore.state.events.slice(0,7).forEach(e=>list.appendChild(makeEventRow(e,false)))}
  function renderAlerts(){const list=$('#alertList');if(!list)return;list.replaceChildren();window.PCStore.state.events.filter(e=>alertFilter==='all'||e.type===alertFilter).forEach(e=>list.appendChild(makeEventRow(e,true)))}
  function renderDevices(){
    const grid=$('#deviceGrid'),list=$('#cameraDeviceList');grid.replaceChildren();list.replaceChildren();
    const ds=[...window.PCConnection.getDevices().values()];
    ds.forEach(d=>{
      const online=!!d.connected;
      const name=String(d.name||'Téléphone');
      const battery=Number.isFinite(Number(d.battery))&&d.battery!==null?`${Math.max(0,Math.min(100,Number(d.battery)))}%`:'--';
      const card=document.createElement('article');card.className='panel device-card';
      card.innerHTML='<div class="device-top"><div class="device-icon">📱</div><div><strong></strong><small></small></div></div><div class="device-detail"><div class="detail-box"><span>Batterie</span><b class="device-battery"></b></div><div class="detail-box"><span>Flux</span><b class="device-stream"></b></div></div><button class="outline-btn" data-select type="button">Afficher</button>';
      card.querySelector('.device-top strong').textContent=name;
      card.querySelector('.device-top small').textContent=online?'🟢 Connecté':'⚪ Déconnecté';
      card.querySelector('.device-battery').textContent=battery;
      card.querySelector('.device-stream').textContent=d.stream?'Actif':'Aucun';
      card.querySelector('[data-select]').onclick=()=>{window.PCConnection.setSelected(d.id);showView('camerasView');render()};grid.appendChild(card);
      const row=document.createElement('div');row.className='device-row';
      row.innerHTML='<span>📱</span><div class="device-main"><strong></strong><small></small></div><div class="device-actions"><button data-select type="button">Voir</button></div>';
      row.querySelector('.device-main strong').textContent=name;
      row.querySelector('.device-main small').textContent=`${online?'Connecté':'Déconnecté'} • ${battery}`;
      row.querySelector('[data-select]').onclick=()=>{window.PCConnection.setSelected(d.id);showView('camerasView');render()};list.appendChild(row);
    });
    $('#deviceEmpty').classList.toggle('show',ds.length===0);
  }
  function renderSettings(){
    const s=window.PCStore.state.settings;
    $('#qualitySetting').value=s.quality;$('#fpsSetting').value=s.fps;$('#facingSetting').value=s.facing;$('#motionSetting').checked=!!s.motion;$('#sensitivitySetting').value=s.sensitivity;$('#sensitivityValue').textContent=`Seuil de sensibilité : ${s.sensitivity}`;$('#cooldownSetting').value=s.cooldown;$('#autoCaptureSetting').checked=!!s.autoCapture;$('#notifyMotion').checked=!!s.notifyMotion;$('#notifyPerson').checked=!!s.notifyPerson;$('#notifyBattery').checked=!!s.notifyBattery;$('#notifyConnection').checked=!!s.notifyConnection;$('#batteryThreshold').value=s.batteryThreshold;
    if($('#recognitionModeSetting'))$('#recognitionModeSetting').value=s.recognitionMode||'high';
    if($('#recognitionThresholdSetting'))$('#recognitionThresholdSetting').value=s.recognitionThreshold||60;
    if($('#recognitionNightSetting'))$('#recognitionNightSetting').checked=s.recognitionNight!==false;
    $('#animationsSetting').checked=s.animations!==false;$('#glowSetting').checked=s.glow!==false;$('#compactSetting').checked=!!s.compact;
    document.body.classList.toggle('compact-mode',!!s.compact);document.body.classList.toggle('no-glow',!s.glow);document.body.classList.toggle('no-animations',!s.animations);document.body.classList.toggle('light-theme',!!s.lightTheme);
    const themeButton=$('#themeBtn');if(themeButton){themeButton.textContent=s.lightTheme?'☾ Mode sombre':'☼ Apparence claire';themeButton.setAttribute('aria-pressed',String(!!s.lightTheme));themeButton.title=s.lightTheme?'Revenir à l’apparence sombre':'Activer l’apparence claire'}
    if($('#cameraAudioBtn'))$('#cameraAudioBtn').textContent=s.cameraAudio?'🔊 Son caméra actif':'🔇 Son caméra coupé';updateNotificationButton();
  }

  function motionAlert(id,data){
    const d=window.PCConnection.getDevices().get(id),name=d?.name||'Téléphone';
    window.PCStore.addEvent('motion','Mouvement détecté',`${name} • score ${data.score}`);
    $('#dashLastMotion').textContent=name;$('#dashLastMotionTime').textContent=new Date().toLocaleTimeString('fr-FR');
    toast('🔴 Mouvement détecté',name);systemNotification('🔴 Mouvement détecté',`${name} • ${new Date().toLocaleTimeString('fr-FR')}`,'motion');
    render();
  }
  async function phoneAutoCapture(source='passage'){
    const v=$('#localVideo');
    if(!v.videoWidth||!window.PCPhone.connection?.open)return false;
    try{
      const maxW=1280;
      const ratio=Math.min(1,maxW/v.videoWidth);
      const c=document.createElement('canvas');
      c.width=Math.max(1,Math.round(v.videoWidth*ratio));
      c.height=Math.max(1,Math.round(v.videoHeight*ratio));
      c.getContext('2d',{alpha:false}).drawImage(v,0,0,c.width,c.height);
      const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b&&b.size?resolve(b):reject(new Error('Capture vide.')),'image/jpeg',.82));
      const buffer=await blob.arrayBuffer();
      window.PCPhone.connection.send({type:'photo',buffer,mime:'image/jpeg',source,time:Date.now()});
      return true;
    }catch(e){
      console.debug('auto capture send',e);
      toast('📸 Capture automatique échouée','La photo n’a pas pu être envoyée au PC.');
      return false;
    }
  }
  function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='phoneView')document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));$('#sidebar').classList.remove('open');if(id==='camerasView')window.PCDetection.startPC($('#remoteVideo').srcObject); if(id==='peopleView')window.PCPeople?.render?.(); window.PCCamera?.syncAudioTarget?.(); if(id==='mediaView')window.PCMedia?.render?.()}
  function bind(){
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
    $('#openNav').onclick=()=>$('#sidebar').classList.add('open');$('#closeNav').onclick=()=>$('#sidebar').classList.remove('open');$('#quickPhoneMode').onclick=()=>showView('phoneView');$('#phoneBack').onclick=()=>showView('dashboardView');
    $('#notificationBtn').onclick=requestNotifications;$('#soundBtn').onclick=()=>window.PCApp.enableAlertSound();$('#themeBtn').onclick=()=>{const lightTheme=!window.PCStore.state.settings.lightTheme;window.PCStore.setSetting('lightTheme',lightTheme);renderSettings();toast(lightTheme?'Apparence claire activée':'Apparence sombre activée','Ton choix est conservé sur cet appareil.');};$('#cameraAudioBtn').onclick=()=>window.PCCamera.toggleCameraAudio();$('#addPersonBtn').onclick=()=>window.PCPeople?.openModal?.();$('#closePersonMatch').onclick=()=>window.PCRecognition?.hideMatch?.();$('#peopleSearch').oninput=()=>window.PCPeople?.render?.();
    document.addEventListener('click',()=>{if(!notificationRequested&&'Notification' in window&&Notification.permission==='default'&&window.PCConnection.getDevices().size)requestNotifications()},{once:true});
    $('#copyPairCode').onclick=copy;$('#cameraCopyCode').onclick=copy;$('#copyCode').onclick=copy;$('#newPairCode').onclick=window.PCConnection.regenerate;$('#cameraNewCode').onclick=window.PCConnection.regenerate;$('#regenerateCode').onclick=window.PCConnection.regenerate;
    $('#dashboardRecord').onclick=window.PCCamera.toggleRecord;$('#recordBtn').onclick=window.PCCamera.toggleRecord;$('#dashboardSnapshot').onclick=window.PCCamera.takeSnapshot;$('#snapshotBtn').onclick=window.PCCamera.takeSnapshot;$('#dashboardFullscreen').onclick=window.PCCamera.fullscreen;$('#fullscreenBtn').onclick=window.PCCamera.fullscreen;
    $('#clearAlerts').onclick=()=>{window.PCStore.clearEvents();render()};$('#clearMedia').onclick=()=>{if(confirm('Vider la médiathèque ?'))window.PCMedia.clear()};$('#refreshMedia')?.addEventListener('click',()=>window.PCMedia.render());$('#closeMediaModal').onclick=()=>$('#mediaModal').classList.add('hidden');
    document.querySelectorAll('[data-alert-filter]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-alert-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');alertFilter=b.dataset.alertFilter;renderAlerts()});
    document.querySelectorAll('[data-media-filter]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-media-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');window.PCMedia.setFilter(b.dataset.mediaFilter)});
    $('#connectPhoneBtn').onclick=window.PCConnection.connectPhone;$('#startPhoneBtn').onclick=window.PCCamera.toggleLocal;$('#phoneMotionBtn').onclick=()=>{const s=window.PCStore.state.settings;s.motion=!s.motion;window.PCStore.save();$('#phoneMotionBtn').textContent=s.motion?'🧠 Détection ON':'🧠 Détection OFF'};bindSettings();
  }
  function syncRemoteSettings(){
    const all=window.PCStore.state.settings;
    const keys=['quality','fps','facing','motion','sensitivity','cooldown','autoCapture','notifyMotion','notifyPerson','notifyBattery','notifyConnection','batteryThreshold','recognitionMode','recognitionThreshold','recognitionNight'];
    const settings=Object.fromEntries(keys.map(key=>[key,all[key]]));
    window.PCConnection.sendSettings(settings);
  }
  function bindSettings(){
    const map={qualitySetting:'quality',fpsSetting:'fps',facingSetting:'facing',motionSetting:'motion',sensitivitySetting:'sensitivity',cooldownSetting:'cooldown',autoCaptureSetting:'autoCapture',notifyMotion:'notifyMotion',notifyPerson:'notifyPerson',notifyBattery:'notifyBattery',notifyConnection:'notifyConnection',batteryThreshold:'batteryThreshold',recognitionModeSetting:'recognitionMode',recognitionThresholdSetting:'recognitionThreshold',recognitionNightSetting:'recognitionNight',animationsSetting:'animations',glowSetting:'glow',compactSetting:'compact'};
    Object.entries(map).forEach(([id,key])=>$('#'+id).addEventListener('change',async e=>{
      const value=e.target.type==='checkbox'?e.target.checked:e.target.value;window.PCStore.setSetting(key,value);
      syncRemoteSettings();
      if(['quality','fps','facing'].includes(key))window.PCCamera?.applySettingsToCamera?.(key);
      renderSettings();
    }));
    $('#sensitivitySetting').addEventListener('input',e=>{$('#sensitivityValue').textContent=`Seuil de sensibilité : ${e.target.value}`});
    $('#resetSettings').onclick=()=>{if(confirm('Réinitialiser tous les paramètres ?')){const previous={...window.PCStore.state.settings};window.PCStore.clearSettings();syncRemoteSettings();for(const key of ['quality','fps','facing'])if(previous[key]!==window.PCStore.defaults[key])window.PCCamera?.applySettingsToCamera?.(key);renderSettings();toast('Paramètres réinitialisés','Les valeurs par défaut sont restaurées.')}}
  }
  async function copy(){
    const value=window.PCConnection.getCode();
    try{
      if(navigator.clipboard?.writeText&&window.isSecureContext){await navigator.clipboard.writeText(value);toast('Code copié',value);return}
    }catch(error){console.debug('Clipboard API indisponible, essai du mode de copie classique.',error)}
    const field=document.createElement('textarea');field.value=value;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';field.style.pointerEvents='none';document.body.appendChild(field);field.select();
    let copied=false;try{copied=document.execCommand('copy')}catch{}
    field.remove();
    toast(copied?'Code copié':'Copie impossible',copied?value:'Autorise le presse-papiers ou copie le code affiché à l’écran.');
  }

  let alertAudioCtx=null;
  async function enableAlertSound(){try{alertAudioCtx ??= new (window.AudioContext||window.webkitAudioContext)();await alertAudioCtx.resume();playAlertTone();$('#soundBtn').textContent='🔊 Son alerte actif ✔';$('#soundBtn').classList.add('sound-active')}catch(e){toast('Son indisponible','Clique à nouveau sur le bouton pour autoriser le son.')}}
  function playAlertTone(){
    try{
      alertAudioCtx ??= new (window.AudioContext||window.webkitAudioContext)();
      const t=alertAudioCtx.currentTime;
      [0,.24,.48].forEach((d,i)=>{
        const o=alertAudioCtx.createOscillator(),g=alertAudioCtx.createGain(),f=alertAudioCtx.createBiquadFilter();
        o.type='sine'; o.frequency.value=i%2?740:560;
        f.type='lowpass'; f.frequency.value=1800;
        g.gain.setValueAtTime(.0001,t+d);
        g.gain.exponentialRampToValueAtTime(.08,t+d+.03);
        g.gain.exponentialRampToValueAtTime(.0001,t+d+.14);
        o.connect(f).connect(g).connect(alertAudioCtx.destination);
        o.start(t+d); o.stop(t+d+.16);
      });
    }catch{}
  }
  window.PCApp={render,renderStats,toast,notify,motionAlert,phoneAutoCapture,showSoundHint,requestNotifications,enableAlertSound,playAlertTone};
  window.addEventListener('load',()=>{bind();render();setInterval(renderStats,1000);setTimeout(()=>window.PCRecognition?.loadModels?.().catch(()=>{}),300);});
  window.PCPhone={
    connection:null,
    startBattery(){if(!navigator.getBattery)return;navigator.getBattery().then(b=>{const send=()=>{if(this.connection)this.connection.send({type:'battery',level:Math.round(b.level*100)});$('#phoneBattery').textContent=`🔋 ${Math.round(b.level*100)}%`;$('#topBattery').textContent=`🔋 ${Math.round(b.level*100)}%`};send();b.addEventListener('levelchange',send);setInterval(send,30000)})},
    applySettings(s){if(!s)return;const prev=window.PCStore.state.settings;window.PCStore.state.settings={...prev,...s};window.PCStore.save();renderSettings();const changed=prev.facing!==s.facing?'facing':prev.quality!==s.quality?'quality':prev.fps!==s.fps?'fps':null;if(changed&&window.PCCamera?.applySettingsToCamera)window.PCCamera.applySettingsToCamera(changed);}
  };
  if(channel)channel.onmessage=e=>{if(document.visibilityState==='visible'&&e.data?.type==='motion')toast(e.data.title,e.data.detail)};
})();
