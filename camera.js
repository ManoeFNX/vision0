(() => {
  const $=s=>document.querySelector(s);
  let localStream=null, recording=null, chunks=[], recTimer=null, recStarted=0, restarting=false;
  let cameraAudioEnabled=!!window.PCStore?.state?.settings?.cameraAudio;

  function activeVideo(){
    return document.querySelector('#camerasView.active') ? $('#remoteVideo') : $('#dashboardVideo');
  }
  function applyRemotePlayback(video, audible=false){
    if(!video)return;
    video.autoplay=true; video.playsInline=true; video.muted=!audible; video.volume=audible?1:0;
    const p=video.play?.();
    if(p?.catch && audible)p.catch(()=>window.PCApp?.showSoundHint?.());
  }
  function syncAudioTarget(){
    const cameraActive=!!document.querySelector('#camerasView.active');
    const r=$('#remoteVideo'),d=$('#dashboardVideo');
    const allow=cameraAudioEnabled;
    if(r){r.muted=!(allow&&cameraActive);r.volume=(allow&&cameraActive)?1:0; if(r.srcObject) r.play?.().catch(()=>{});}
    if(d){d.muted=!(allow&&!cameraActive);d.volume=(allow&&!cameraActive)?1:0; if(d.srcObject)d.play?.().catch(()=>{});}
  }
  function setStream(stream,id){
    $('#remoteVideo').srcObject=stream; $('#dashboardVideo').srcObject=stream;
    applyRemotePlayback($('#remoteVideo'),false);
    applyRemotePlayback($('#dashboardVideo'),false);
    $('#remoteEmpty').style.display='none'; $('#dashboardEmpty').style.display='none';
    $('#cameraLive').textContent='EN DIRECT'; $('#cameraLive').classList.add('live');
    $('#dashboardLive').textContent='EN DIRECT'; $('#dashboardLive').classList.add('live');
    const d=window.PCConnection.getDevices().get(id); window.PCConnection.setSelected(id);
    $('#cameraTitle').textContent=d?.name||'Téléphone'; $('#dashboardCameraName').textContent=d?.name||'Téléphone';
    $('#cameraStatus').textContent='Flux vidéo + audio reçu en direct.';
    syncAudioTarget(); window.PCRecognition?.start?.($('#remoteVideo')); window.PCApp?.render();
  }
  function clearStream(id){
    const selected=window.PCConnection?.getSelected?.();
    if(selected&&id&&selected!==id)return;
    ['remoteVideo','dashboardVideo'].forEach(videoId=>{const video=$('#'+videoId);if(video)video.srcObject=null});
    ['remoteEmpty','dashboardEmpty'].forEach(emptyId=>{const empty=$('#'+emptyId);if(empty)empty.style.display='flex'});
    $('#cameraTitle').textContent='Aucune caméra';$('#dashboardCameraName').textContent='Aucune caméra';
    $('#cameraStatus').textContent='En attente d’un téléphone.';
    $('#cameraLive').textContent='STANDBY';$('#cameraLive').classList.remove('live');
    $('#dashboardLive').textContent='STANDBY';$('#dashboardLive').classList.remove('live');
    $('#cameraMotionState').textContent='Analyse inactive';$('#motionOverlay').textContent='Analyse inactive';
    $('#cameraPersonOverlay').replaceChildren();$('#dashPersonOverlay').replaceChildren();
    window.PCDetection?.stop?.();
  }
  function videoConstraints(s){
    const width=s.quality==='1080'?1920:1280, height=s.quality==='1080'?1080:720;
    return {facingMode:{ideal:s.facing},width:{ideal:width},height:{ideal:height},frameRate:{ideal:Number(s.fps),max:Number(s.fps)}};
  }
  function audioConstraints(){return {echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:2,sampleRate:48000,sampleSize:16};}
  async function configureOutgoingCall(call){
    if(!call?.peerConnection)return;
    for(const sender of call.peerConnection.getSenders()){
      try{
        const p=sender.getParameters(); p.encodings=p.encodings?.length?p.encodings:[{}];
        if(sender.track?.kind==='audio'){p.encodings[0].maxBitrate=192000; p.encodings[0].dtx=false; await sender.setParameters(p);}
        if(sender.track?.kind==='video'){p.encodings[0].maxBitrate=Number(window.PCStore.state.settings.quality)>=1080?7000000:4000000; p.encodings[0].maxFramerate=Number(window.PCStore.state.settings.fps); await sender.setParameters(p); sender.track.contentHint='motion';}
      }catch(e){console.debug('sender parameters',e)}
    }
  }
  async function startLocal(){
    if(localStream)return;
    try{
      const s=window.PCStore.state.settings;
      const stream=await navigator.mediaDevices.getUserMedia({video:videoConstraints(s),audio:audioConstraints()});
      localStream=stream; $('#localVideo').srcObject=stream; $('#localEmpty').style.display='none'; $('#startPhoneBtn').textContent='■ Arrêter la caméra';
      window.PCDetection.startLocal(stream);
      const call=window.PCConnection.startPhoneCall(stream); setTimeout(()=>configureOutgoingCall(call),500);
    }catch(e){window.PCApp.toast('Caméra / micro inaccessible',e.name==='NotAllowedError'?'Autorise la caméra et le micro dans ton navigateur.':e.message||'Impossible de démarrer la caméra.');}
  }
  async function restartLocalStream(reason=''){
    if(restarting||!localStream)return; restarting=true;
    try{
      const old=localStream, oldVideo=old.getVideoTracks()[0], s=window.PCStore.state.settings;
      const next=await navigator.mediaDevices.getUserMedia({video:videoConstraints(s),audio:false});
      const newVideo=next.getVideoTracks()[0]; newVideo.contentHint='motion';
      const ok=await window.PCConnection.replaceOutgoingTrack(newVideo,'video');
      if(!ok)throw new Error('La piste vidéo ne peut pas être remplacée sur cette connexion.');
      oldVideo?.stop(); old.removeTrack(oldVideo); old.addTrack(newVideo); next.getTracks().forEach(t=>{if(t!==newVideo)t.stop()});
      $('#localVideo').srcObject=old; window.PCDetection.startLocal(old); await configureOutgoingCall(window.PCConnection.getActiveCall?.());
      window.PCApp.toast('📷 Caméra mise à jour',reason||'Le flux continue sans déconnexion.');
    }catch(e){window.PCApp.toast('Impossible de changer la caméra',e.message||'Le navigateur a refusé le changement.');}
    finally{restarting=false;}
  }
  async function updateAudio(){
    if(!localStream)return;
    try{const old=localStream.getAudioTracks()[0], temp=await navigator.mediaDevices.getUserMedia({video:false,audio:audioConstraints()}), fresh=temp.getAudioTracks()[0], ok=await window.PCConnection.replaceOutgoingTrack(fresh,'audio'); if(!ok)throw new Error('Piste audio non remplaçable'); old?.stop(); if(old)localStream.removeTrack(old); localStream.addTrack(fresh); await configureOutgoingCall(window.PCConnection.getActiveCall?.());}
    catch(e){window.PCApp.toast('Audio non mis à jour',e.message||'');}
  }
  async function applySettingsToCamera(changedKey){
    if(!localStream)return;
    if(['facing','quality','fps'].includes(changedKey))return restartLocalStream(changedKey==='facing'?(window.PCStore.state.settings.facing==='environment'?'Caméra arrière activée':'Caméra avant activée'):'Qualité vidéo mise à jour');
    if(changedKey==='audioQuality')return updateAudio();
  }
  function stopLocal(){try{window.PCConnection?.getActiveCall?.()?.close()}catch(e){console.debug('Fermeture du flux vidéo',e)}if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}$('#localVideo').srcObject=null;$('#localEmpty').style.display='flex';$('#startPhoneBtn').textContent='▶ Démarrer la caméra';window.PCDetection.stop();}
  function toggleLocal(){localStream?stopLocal():startLocal();}
  async function takeSnapshot(source='manual'){
    const v=activeVideo();
    if(!v?.srcObject || !v.videoWidth || !v.videoHeight){
      return window.PCApp.toast('Capture impossible','Aucun flux vidéo disponible.');
    }
    try{
      const c=document.createElement('canvas');
      c.width=v.videoWidth;
      c.height=v.videoHeight;
      const ctx=c.getContext('2d',{alpha:false});
      ctx.drawImage(v,0,0,c.width,c.height);
      const blob=await new Promise((resolve,reject)=>{
        c.toBlob(b=>b&&b.size?resolve(b):reject(new Error('Le navigateur n’a pas produit la photo.')),'image/jpeg',0.94);
      });
      await window.PCMedia.saveBlob(blob,'photo',source);
      window.PCApp.toast('📸 Photo enregistrée','Elle est maintenant dans la médiathèque.');
      return true;
    }catch(e){
      console.error('snapshot',e);
      window.PCApp.toast('❌ Photo non enregistrée',e.message||'Erreur de stockage local.');
      return false;
    }
  }
  function toggleRecord(){
    const v=activeVideo(); if(!v?.srcObject)return window.PCApp.toast('Enregistrement impossible','Aucun flux vidéo disponible.');
    if(recording){recording.stop();return;}
    const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']; const mime=types.find(t=>MediaRecorder.isTypeSupported(t));
    try{recording=new MediaRecorder(v.srcObject,mime?{mimeType:mime,audioBitsPerSecond:192000,videoBitsPerSecond:7000000}:undefined);}catch(e){return window.PCApp.toast('Enregistrement impossible','MediaRecorder ne peut pas enregistrer ce flux.');}
    chunks=[]; recording.ondataavailable=e=>e.data.size&&chunks.push(e.data); recording.onstop=async()=>{const blob=new Blob(chunks,{type:recording.mimeType||'video/webm'});try{await window.PCMedia.saveBlob(blob,'video','manual');}catch(e){window.PCApp.toast('Vidéo non enregistrée',e.message||'');}recording=null;$('#recordBar').classList.remove('show');$('#recordOverlay').style.display='none';$('#cameraRecOverlay').style.display='none';clearInterval(recTimer);$('#recordBtn').textContent='🔴 Enregistrer';$('#dashboardRecord').textContent='● Enregistrer';};
    recording.start(500); recStarted=Date.now(); $('#recordBar').classList.add('show');$('#recordOverlay').style.display='inline-block';$('#cameraRecOverlay').style.display='inline-block';$('#recordBtn').textContent='■ Stopper';$('#dashboardRecord').textContent='■ Stopper';recTimer=setInterval(()=>$('#recordTimer').textContent=new Date(Date.now()-recStarted).toISOString().substr(14,5),500); window.PCApp.notify('media','Enregistrement commencé','Le flux est en cours d’enregistrement.');
  }
  function fullscreen(){const frame=document.querySelector('#camerasView.active .video-frame.large')||document.querySelector('#dashboardFrame')||activeVideo();if(frame?.requestFullscreen)frame.requestFullscreen();else if(activeVideo()?.requestFullscreen)activeVideo().requestFullscreen();}
  async function enableSound(){
    cameraAudioEnabled=true;
    try{window.PCStore?.setSetting?.('cameraAudio',true)}catch{}
    syncAudioTarget();
    const v=activeVideo();
    if(v){v.muted=false;v.volume=1;try{await v.play()}catch(e){}}
    window.PCApp.toast('🔊 Son caméra activé','Le micro du téléphone est maintenant audible.');
  }
  function disableSound(){
    cameraAudioEnabled=false;
    try{window.PCStore?.setSetting?.('cameraAudio',false)}catch{}
    syncAudioTarget();
    window.PCApp.toast('🔇 Son caméra coupé','Audio coupé pour éviter la résonance.');
  }
  function toggleCameraAudio(){return cameraAudioEnabled?disableSound():enableSound();}
  window.PCCamera={setStream,clearStream,startLocal,stopLocal,toggleLocal,takeSnapshot,toggleRecord,fullscreen,getLocal:()=>localStream,applySettingsToCamera,enableSound,disableSound,toggleCameraAudio,syncAudioTarget};
})();
