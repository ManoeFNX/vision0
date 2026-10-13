(() => {
  let ready=false;
  let loading=null;
  let timer=null;
  let busy=false;
  let scanCount=0;
  let lastKnown=0;
  let lastUnknown=0;
  let recentMatches=[];
  let lastVisiblePerson=null;
  let enhancedCanvas=null;
  let enhancedCtx=null;
  let lightCanvas=null;
  let lightCtx=null;

  const $=s=>document.querySelector(s);
  const URLMODEL='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';

  const defaults={
    matchThreshold:.60,
    difficultThreshold:.66,
    strongDistance:.48,
    intervalBalanced:420,
    intervalHigh:280,
    intervalMax:210
  };

  function settings(){
    return window.PCStore?.state?.settings||{};
  }

  async function loadModels(){
    if(ready)return true;
    if(loading)return loading;

    loading=Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(URLMODEL),
      faceapi.nets.ssdMobilenetv1.loadFromUri(URLMODEL),
      faceapi.nets.faceLandmark68Net.loadFromUri(URLMODEL),
      faceapi.nets.faceRecognitionNet.loadFromUri(URLMODEL)
    ]).then(()=>{
      ready=true;
      $('#peopleModelStatus')?.replaceChildren(
        document.createTextNode('Haute précision : détecteurs + lumière adaptative ✔')
      );
      return true;
    }).catch(e=>{
      loading=null;
      console.error('Chargement reconnaissance',e);
      throw e;
    });

    return loading;
  }

  function distance(a,b){
    if(!a||!b||a.length!==b.length)return Infinity;
    let s=0;
    for(let i=0;i<a.length;i++){
      const d=a[i]-b[i];
      s+=d*d;
    }
    return Math.sqrt(s);
  }

  function normalizePersonDescriptors(person){
    const out=[];
    if(Array.isArray(person.descriptors)){
      for(const d of person.descriptors){
        if(Array.isArray(d)&&d.length===128)out.push(d);
      }
    }
    if(Array.isArray(person.descriptor)&&person.descriptor.length===128){
      out.push(person.descriptor);
    }
    return out;
  }

  function isDark(video){
    if(!video?.videoWidth)return false;

    if(!lightCanvas){
      lightCanvas=document.createElement('canvas');
      lightCanvas.width=64;
      lightCanvas.height=36;
      lightCtx=lightCanvas.getContext('2d',{willReadFrequently:true});
    }

    lightCtx.drawImage(video,0,0,64,36);
    const d=lightCtx.getImageData(0,0,64,36).data;
    let total=0;

    for(let i=0;i<d.length;i+=4){
      total += d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;
    }

    return total/(64*36)<78;
  }

  function enhance(video){
    if(!enhancedCanvas){
      enhancedCanvas=document.createElement('canvas');
      enhancedCtx=enhancedCanvas.getContext('2d');
    }

    const maxW=960;
    const ratio=Math.min(1,maxW/video.videoWidth);
    enhancedCanvas.width=Math.max(320,Math.round(video.videoWidth*ratio));
    enhancedCanvas.height=Math.max(180,Math.round(video.videoHeight*ratio));

    enhancedCtx.filter='brightness(1.65) contrast(1.28) saturate(.92)';
    enhancedCtx.drawImage(video,0,0,enhancedCanvas.width,enhancedCanvas.height);
    enhancedCtx.filter='none';

    return enhancedCanvas;
  }

  async function detect(input, detector){
    if(detector==='ssd'){
      return faceapi
        .detectAllFaces(
          input,
          new faceapi.SsdMobilenetv1Options({
            minConfidence:.28,
            maxResults:20
          })
        )
        .withFaceLandmarks()
        .withFaceDescriptors();
    }

    return faceapi
      .detectAllFaces(
        input,
        new faceapi.TinyFaceDetectorOptions({
          inputSize:detector==='tinyMax'?512:320,
          scoreThreshold:detector==='tinyMax'?.20:.25
        })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();
  }

  function boxCenter(d){
    const b=d?.detection?.box;
    if(!b)return {x:0,y:0,w:0,h:0};
    return {
      x:b.x+b.width/2,
      y:b.y+b.height/2,
      w:b.width,
      h:b.height
    };
  }

  function iou(a,b){
    const A=a?.detection?.box, B=b?.detection?.box;
    if(!A||!B)return 0;

    const x1=Math.max(A.x,B.x);
    const y1=Math.max(A.y,B.y);
    const x2=Math.min(A.x+A.width,B.x+B.width);
    const y2=Math.min(A.y+A.height,B.y+B.height);

    const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
    const areaA=A.width*A.height;
    const areaB=B.width*B.height;

    return inter/Math.max(1,areaA+areaB-inter);
  }

  function mergeFaces(list){
    const sorted=[...list].sort((a,b)=>(b.detection?.score||0)-(a.detection?.score||0));
    const out=[];

    for(const f of sorted){
      if(out.some(x=>iou(x,f)>.55))continue;
      out.push(f);
    }

    return out;
  }

  function bestMatch(desc,people,threshold){
    let best=null;

    for(const p of people){
      const refs=normalizePersonDescriptors(p);
      for(const ref of refs){
        const d=distance(desc,ref);
        if(!best||d<best.distance){
          best={person:p,distance:d};
        }
      }
    }

    return best && best.distance<=threshold ? best : null;
  }

  function temporalConfirm(personId){
    const recent=recentMatches.slice(-4);
    return recent.filter(x=>x===personId).length>=2;
  }

  function rememberMatch(personId){
    recentMatches.push(personId);
    if(recentMatches.length>6)recentMatches.shift();
  }

  function clearMatchHistory(){
    recentMatches=[];
  }

  function confidenceFromDistance(distanceValue){
    return Math.max(0,Math.min(99,Math.round((1-distanceValue)*100)));
  }

  function showMatch(match,mode,meta={}){
    const overlay=$('#personMatchOverlay');
    if(!overlay||!match?.person)return;

    const u=match.person.photo instanceof Blob
      ? URL.createObjectURL(match.person.photo)
      : null;

    if(u){
      $('#personMatchPhoto').src=u;
    }

    const pct=confidenceFromDistance(match.distance);
    $('#personMatchName').textContent=`${match.person.first} ${match.person.last}`;
    $('#personMatchInfo').textContent=
      `${pct}% • ${mode==='dark'?'mode nuit':'haute précision'}${meta.multi?' • multi-référence':''}`;
    $('#personMatchNote').textContent=match.person.notes||'';
    overlay.classList.remove('hidden');

    clearTimeout(overlay._hide);
    overlay._hide=setTimeout(()=>{
      overlay.classList.add('hidden');
      if(u)URL.revokeObjectURL(u);
    },6500);
  }

  function showUnknown(){
    const ids=['#cameraPersonOverlay','#dashPersonOverlay'];
    ids.forEach(id=>{
      const e=$(id);
      if(e){
        e.innerHTML='<div class="person-chip unknown"><strong>⚠️ Visage non identifié</strong><small>Détection active</small></div>';
      }
    });
  }

  function updateOverlay(match){
    const ids=['#cameraPersonOverlay','#dashPersonOverlay'];

    ids.forEach(id=>{
      const e=$(id);
      if(!e)return;

      if(!match){
        e.innerHTML='';
        return;
      }

      const pct=confidenceFromDistance(match.distance);
      e.innerHTML=`<div class="person-chip"><strong>👤 ${match.person.first} ${match.person.last}</strong><small>${pct}% • identifié</small></div>`;
    });
  }

  async function scan(video){
    if(!ready||busy||!video||video.readyState<2||!video.videoWidth)return;

    busy=true;
    scanCount++;

    try{
      const s=settings();
      const mode=s.recognitionMode||'high';
      const nightEnabled=s.recognitionNight!==false;
      const dark=nightEnabled && isDark(video);

      let faces=[];
      const original=await detect(video,'tiny');

      faces.push(...original);

      // En faible lumière, deuxième passe sur image éclaircie.
      // Même en lumière normale, la passe renforcée tourne périodiquement
      // pour récupérer les visages difficiles.
      const shouldEnhance=dark || scanCount%3===0;

      if(shouldEnhance){
        const enhanced=enhance(video);
        const enhancedFaces=await detect(enhanced,'tinyMax');
        faces.push(...enhancedFaces);
      }

      // Fallback SSD plus robuste quand le visage est petit/partiellement visible.
      if(!faces.length || scanCount%6===0){
        const source=dark?enhance(video):video;
        const ssd=await detect(source,'ssd');
        faces.push(...ssd);
      }

      faces=mergeFaces(faces);

      if($('#peopleModelStatus')){
        $('#peopleModelStatus').textContent=
          dark
            ? 'Mode nuit actif • analyse renforcée'
            : 'Haute précision • analyse multi-passe';
      }

      if(!faces.length){
        clearMatchHistory();
        updateOverlay(null);
        return;
      }

      const people=await window.PCPeople.all();
      if(!people.length)return;

      // Les visages les plus fiables d'abord.
      faces.sort((a,b)=>(b.detection?.score||0)-(a.detection?.score||0));

      const thresholdBase=(Number(s.recognitionThreshold)||60)/100;
      const threshold=Math.max(
        defaults.matchThreshold,
        Math.min(.72,thresholdBase + (dark ? .025 : 0))
      );

      let recognized=null;

      for(const face of faces){
        const candidate=bestMatch(face.descriptor,people,threshold);

        if(!candidate)continue;

        const area=face.detection.box.width*face.detection.box.height;
        const frameArea=Math.max(1,video.videoWidth*video.videoHeight);
        const faceRatio=area/frameArea;

        // Un visage très petit ou partiel est accepté avec confirmation temporelle,
        // pas sur une seule image isolée.
        const difficult=dark || faceRatio<.045 || (face.detection.score||0)<.55;

        if(candidate.distance<=defaults.strongDistance || !difficult || temporalConfirm(candidate.person.id)){
          recognized=candidate;
          break;
        }

        rememberMatch(candidate.person.id);
      }

      if(recognized){
        rememberMatch(recognized.person.id);
        if(lastVisiblePerson!==recognized.person.id){
          clearMatchHistory();
          rememberMatch(recognized.person.id);
          lastVisiblePerson=recognized.person.id;
        }

        updateOverlay(recognized);
        showMatch(
          recognized,
          dark?'dark':'normal',
          {
            multi:normalizePersonDescriptors(recognized.person).length>1
          }
        );

        const pct=confidenceFromDistance(recognized.distance);
        const now=Date.now();
        const cool=(Number(s.cooldown)||5)*1000;

        if(now-lastKnown>cool){
          lastKnown=now;
          window.PCApp?.notify(
            'person',
            `👤 ${recognized.person.first} ${recognized.person.last}`,
            `${pct}% de correspondance${dark?' • mode nuit':''}`
          );
          window.PCApp?.playAlertTone?.();
        }
      }else{
        lastVisiblePerson=null;
        showUnknown();

        const now=Date.now();
        const cool=(Number(s.cooldown)||5)*1000;

        if(now-lastUnknown>cool){
          lastUnknown=now;
          window.PCApp?.notify(
            'person',
            '⚠️ Visage non identifié',
            'Un visage a été détecté mais aucune correspondance suffisamment fiable.'
          );
          window.PCApp?.playAlertTone?.();
        }
      }
    }catch(e){
      console.debug('recognition',e);
    }finally{
      busy=false;
    }
  }

  async function start(video){
    stop();

    try{
      await loadModels();
    }catch(e){
      window.PCApp?.toast(
        'Reconnaissance indisponible',
        'Les modèles n’ont pas pu être chargés. La détection de mouvement reste disponible.'
      );
      return;
    }

    const mode=settings().recognitionMode||'high';
    const interval=
      mode==='max'
        ? defaults.intervalMax
        : mode==='balanced'
          ? defaults.intervalBalanced
          : defaults.intervalHigh;

    timer=setInterval(()=>scan(video),interval);
  }

  function stop(){
    if(timer)clearInterval(timer);
    timer=null;
    busy=false;
    lastVisiblePerson=null;
    clearMatchHistory();
    $('#cameraPersonOverlay')?.replaceChildren();
    $('#dashPersonOverlay')?.replaceChildren();
    hideMatch();
  }

  function hideMatch(){
    const o=$('#personMatchOverlay');
    if(!o)return;
    o.classList.add('hidden');
    clearTimeout(o._hide);
  }

  window.PCRecognition={loadModels,start,stop,hideMatch};
})();