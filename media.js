(() => {
  'use strict';

  const DB_NAMES = ['PhoneCamMediaV5', 'PhoneCamMediaV4', 'PhoneCamMediaV3', 'PhoneCamMediaV2'];
  const DB_NAME = DB_NAMES[0];
  const STORE = 'media';
  const FALLBACK_KEY = 'phonecam_media_fallback_v2';
  const $ = s => document.querySelector(s);

  let dbPromise = null;
  let filter = 'all';
  let migrationDone = false;

  function uid(){
    try { return crypto.randomUUID(); } catch {}
    return `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function isBlob(value){
    return value instanceof Blob;
  }

  async function dataURLToBlob(dataURL){
    if(typeof dataURL !== 'string' || !dataURL) throw new Error('Data URL invalide.');
    const res = await fetch(dataURL);
    const blob = await res.blob();
    if(!isBlob(blob) || !blob.size) throw new Error('Data URL vide.');
    return blob;
  }

  function blobToDataURL(blob){
    return new Promise((resolve,reject)=>{
      if(!isBlob(blob)) return reject(new Error('Objet non convertible en image.'));
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  // Normalise les anciennes structures afin que la médiathèque ne casse jamais
  // si un ancien enregistrement contenait dataUrl, ArrayBuffer, Uint8Array, etc.
  async function normalizeBlob(value, mime='application/octet-stream'){
    if(isBlob(value)) return value;

    if(value instanceof ArrayBuffer){
      const blob = new Blob([value], {type:mime});
      if(blob.size) return blob;
    }

    if(ArrayBuffer.isView(value)){
      const blob = new Blob([value.buffer], {type:mime});
      if(blob.size) return blob;
    }

    if(value && typeof value === 'object'){
      if(value.dataUrl) return normalizeBlob(value.dataUrl, value.mime || mime);
      if(value.buffer) return normalizeBlob(value.buffer, value.mime || mime);
      if(value.bytes) return normalizeBlob(value.bytes, value.mime || mime);
    }

    if(typeof value === 'string' && value.startsWith('data:')){
      return dataURLToBlob(value);
    }

    throw new Error('Ce média ne contient pas de fichier exploitable.');
  }

  function safeFallbackRead(){
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function safeFallbackWrite(items){
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(items));
      return true;
    } catch { return false; }
  }

  function openDB(){
    if(dbPromise) return dbPromise;

    dbPromise = new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){
        reject(new Error('IndexedDB n’est pas disponible dans ce navigateur.'));
        return;
      }

      let settled = false;
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath:'id'});
      };
      req.onsuccess = () => { settled = true; resolve(req.result); };
      req.onerror = () => { settled = true; reject(req.error || new Error('Ouverture du stockage impossible.')); };
      req.onblocked = () => {
        if(!settled) reject(new Error('Le stockage est bloqué par un autre onglet PhoneCam. Ferme les anciens onglets du site.'));
      };
    });

    return dbPromise;
  }

  async function put(item){
    const db = await openDB();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Écriture impossible dans la médiathèque.'));
      tx.onabort = () => reject(tx.error || new Error('Écriture annulée.'));
    });
  }

  async function get(id){
    const db = await openDB();
    return new Promise((resolve,reject)=>{
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Lecture impossible.'));
    });
  }

  async function allDB(){
    const db = await openDB();
    return new Promise((resolve,reject)=>{
      const req = db.transaction(STORE,'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a,b)=>(b.created||0)-(a.created||0)));
      req.onerror = () => reject(req.error || new Error('Lecture impossible.'));
    });
  }

  async function deleteItem(id){
    try {
      const db = await openDB();
      await new Promise((resolve,reject)=>{
        const tx = db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Suppression impossible.'));
      });
    } catch(e) { console.debug('delete indexedDB',e); }

    safeFallbackWrite(safeFallbackRead().filter(x => x.id !== id));
  }

  async function clearStore(){
    try {
      const db = await openDB();
      await new Promise((resolve,reject)=>{
        const tx = db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Nettoyage impossible.'));
      });
    } catch(e){ console.debug('clear indexedDB',e); }
    try { localStorage.removeItem(FALLBACK_KEY); } catch {}
  }

  async function saveFallbackPhoto(item){
    if(item.type !== 'photo') return false;
    try{
      const dataUrl = await blobToDataURL(item.blob);
      if(dataUrl.length > 4_500_000) return false;
      const list = safeFallbackRead().filter(x => x.id !== item.id);
      list.unshift({
        id:item.id,type:item.type,source:item.source,created:item.created,
        name:item.name,mime:item.mime,size:item.size,dataUrl
      });
      return safeFallbackWrite(list.slice(0,80));
    }catch{return false;}
  }

  async function all(){
    const merged = [];
    const seen = new Set();

    let indexed = [];
    try { indexed = await allDB(); } catch(e){ console.debug('IndexedDB read',e); }

    for(const item of indexed){
      try{
        const blob = await normalizeBlob(item.blob ?? item.data ?? item.dataUrl, item.mime || (item.type === 'photo' ? 'image/jpeg' : 'video/webm'));
        const normalized = {...item, blob, size:blob.size, mime:blob.type || item.mime};
        if(!seen.has(normalized.id)){
          merged.push(normalized);
          seen.add(normalized.id);
        }
      }catch(e){
        console.warn('Média ignoré car invalide:', item?.id, e.message);
      }
    }

    for(const item of safeFallbackRead()){
      if(seen.has(item.id)) continue;
      try{
        const blob = await normalizeBlob(item.blob ?? item.data ?? item.dataUrl, item.mime || 'image/jpeg');
        merged.push({...item, blob, size:blob.size, mime:blob.type || item.mime});
        seen.add(item.id);
      }catch(e){
        console.warn('Fallback média ignoré:', item?.id, e.message);
      }
    }

    return merged.sort((a,b)=>(b.created||0)-(a.created||0));
  }

  async function saveBlob(input,type='photo',source='manual',extra={}){
    const blob = await normalizeBlob(input, type === 'photo' ? 'image/jpeg' : 'video/webm');
    if(!blob.size) throw new Error('Le fichier capturé est vide.');

    const ext = type === 'photo' ? 'jpg' : 'webm';
    const item = {
      id:uid(), blob, type, source, created:Date.now(),
      name:extra.name || `PhoneCam_${type}_${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,
      mime:blob.type || (type === 'photo' ? 'image/jpeg' : 'video/webm'),
      size:blob.size
    };

    let indexedOk = false;
    try{
      await put(item);
      const verified = await get(item.id);
      const verifiedBlob = await normalizeBlob(verified?.blob ?? verified?.data ?? verified?.dataUrl, item.mime);
      indexedOk = !!verifiedBlob?.size;
    }catch(e){
      console.error('Médiathèque IndexedDB:', e);
    }

    const fallbackOk = indexedOk ? true : await saveFallbackPhoto(item);
    if(!indexedOk && !fallbackOk){
      throw new Error('Le navigateur a refusé l’enregistrement local. Vérifie l’espace de stockage et ferme les anciens onglets PhoneCam.');
    }

    try{
      window.PCStore.state.stats.media = (window.PCStore.state.stats.media || 0) + 1;
      window.PCStore.save();
    }catch{}

    window.PCApp?.notify('media', type === 'photo' ? 'Photo capturée' : 'Vidéo enregistrée', item.name);
    await render();
    return item;
  }

  async function receivePhoto(data,id,name){
    try{
      const blob = await normalizeBlob(data?.blob ?? data?.buffer ?? data?.dataUrl, data?.mime || 'image/jpeg');
      const item = await saveBlob(blob,'photo','motion',{
        name:`PhoneCam_Mouvement_${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`
      });
      window.PCApp?.toast('📸 Capture enregistrée',`${name || 'Téléphone'} • ${item.name}`);
    }catch(e){
      console.error('receivePhoto',e);
      window.PCApp?.toast('❌ Capture non enregistrée',e.message || 'Erreur inconnue.');
    }
  }

  async function migrateFromDb(name){
    return new Promise(resolve=>{
      let finished=false, created=false;
      let req;
      try { req = indexedDB.open(name); } catch { return resolve([]); }

      req.onupgradeneeded=e=>{
        created=true;
        try { e.target.transaction.abort(); } catch {}
      };
      req.onsuccess=()=>{
        if(finished)return;
        const db=req.result;
        if(created || !db.objectStoreNames.contains(STORE)){
          db.close(); finished=true; return resolve([]);
        }
        try{
          const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
          r.onsuccess=()=>{const out=r.result||[];db.close();finished=true;resolve(out)};
          r.onerror=()=>{db.close();finished=true;resolve([])};
        }catch{
          db.close(); finished=true; resolve([]);
        }
      };
      req.onerror=()=>{if(!finished){finished=true;resolve([])}};
    });
  }

  async function migrateLegacy(){
    if(migrationDone) return;
    migrationDone=true;
    try{
      const current=await all();
      const ids=new Set(current.map(x=>x.id));
      let count=0;

      for(const name of DB_NAMES.slice(1)){
        const legacy=await migrateFromDb(name);
        for(const item of legacy){
          if(!item?.id || ids.has(item.id)) continue;
          try{
            const blob = await normalizeBlob(item.blob ?? item.data ?? item.dataUrl, item.mime || (item.type === 'photo' ? 'image/jpeg' : 'video/webm'));
            await put({...item,blob,size:blob.size,mime:blob.type || item.mime,id:item.id || uid()});
            ids.add(item.id); count++;
          }catch(e){ console.debug('migration item ignoré',e); }
        }
      }

      if(count){
        const now=await all();
        window.PCStore.state.stats.media=now.length;
        window.PCStore.save();
        window.PCApp?.toast('📁 Anciennes captures récupérées',`${count} média(s) retrouvé(s).`);
      }
    }catch(e){ console.debug('migration media',e); }
  }

  function formatSize(n=0){
    if(n<1024)return `${n} o`;
    if(n<1024*1024)return `${(n/1024).toFixed(0)} Ko`;
    return `${(n/1024/1024).toFixed(1)} Mo`;
  }

  function safeObjectURL(blob){
    if(!isBlob(blob) || !blob.size) return null;
    try { return URL.createObjectURL(blob); } catch(e){ console.warn('createObjectURL refusé',e); return null; }
  }

  async function render(){
    const grid=$('#mediaGrid'), empty=$('#mediaEmpty');
    if(!grid || !empty) return;

    try{
      await migrateLegacy();
      const items=await all();
      const shown=items.filter(x=>filter==='all'||x.type===filter||(filter==='motion'&&x.source==='motion'));
      grid.innerHTML='';

      for(const x of shown){
        const url=safeObjectURL(x.blob);
        if(!url){
          console.warn('Entrée média invalide ignorée:',x.id);
          continue;
        }

        const card=document.createElement('article');
        card.className='media-card';
        const thumb=x.type==='photo'
          ? `<img src="${url}" alt="Capture PhoneCam" loading="lazy">`
          : `<video src="${url}" muted preload="metadata"></video>`;

        card.innerHTML=`<div class="media-thumb">${thumb}<span class="media-type">${x.type==='photo'?'📸':'🎥'}</span></div><div class="media-info"><strong>${x.type==='photo'?'Photo':'Vidéo'}</strong><small>${new Date(x.created).toLocaleString('fr-FR')} • ${x.source==='motion'?'Mouvement':'Manuel'} • ${formatSize(x.size)}</small><div class="media-actions"><button data-action="view">Voir</button><button data-action="download">Télécharger</button><button data-action="delete">Supprimer</button></div></div>`;

        card.querySelector('[data-action=view]').onclick=()=>{
          const m=$('#modalContent');
          m.innerHTML=x.type==='photo' ? `<img src="${url}" alt="Capture PhoneCam">` : `<video src="${url}" controls autoplay></video>`;
          $('#mediaModal').classList.remove('hidden');
        };

        card.querySelector('[data-action=download]').onclick=()=>{
          const a=document.createElement('a');
          a.href=url;
          a.download=x.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        };

        card.querySelector('[data-action=delete]').onclick=async()=>{
          try{
            await deleteItem(x.id);
            window.PCStore.state.stats.media=Math.max(0,(window.PCStore.state.stats.media||0)-1);
            window.PCStore.save();
            URL.revokeObjectURL(url);
            await render();
          }catch(e){window.PCApp?.toast('Suppression impossible',e.message)}
        };

        grid.appendChild(card);
      }

      const visibleCount=grid.children.length;
      empty.classList.toggle('show',visibleCount===0);
      window.PCStore.state.stats.media=items.length;
      window.PCStore.save();
      window.PCApp?.renderStats();
    }catch(e){
      console.error('Médiathèque',e);
      grid.innerHTML='';
      empty.classList.add('show');
      empty.innerHTML='⚠️<strong>Impossible de lire la médiathèque</strong><small>'+String(e.message||'Erreur de stockage local.')+'</small>';
    }
  }

  async function clear(){
    await clearStore();
    window.PCStore.state.stats.media=0;
    window.PCStore.save();
    await render();
  }

  window.PCMedia={saveBlob,receivePhoto,render,setFilter(v){filter=v;render()},clear,all,migrateLegacy};
  window.addEventListener('load',()=>setTimeout(render,150));
})();
