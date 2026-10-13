(() => {
  const DB='PhoneCamPeopleV1',STORE='people';
  const $=s=>document.querySelector(s);
  let db=null,cache=[],search='';

  const uid=()=>crypto.randomUUID?.()||'person-'+Date.now()+'-'+Math.random().toString(36).slice(2);

  async function open(){
    if(db)return db;
    db=await new Promise((res,rej)=>{
      const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>r.result.objectStoreNames.contains(STORE)||r.result.createObjectStore(STORE,{keyPath:'id'});
      r.onsuccess=()=>res(r.result);
      r.onerror=()=>rej(r.error);
    });
    return db;
  }

  async function all(){
    const d=await open();
    return new Promise((res,rej)=>{
      const r=d.transaction(STORE,'readonly').objectStore(STORE).getAll();
      r.onsuccess=()=>res(r.result||[]);
      r.onerror=()=>rej(r.error);
    });
  }

  async function put(v){
    const d=await open();
    return new Promise((res,rej)=>{
      const t=d.transaction(STORE,'readwrite');
      t.objectStore(STORE).put(v);
      t.oncomplete=res;
      t.onerror=()=>rej(t.error);
    });
  }

  async function del(id){
    const d=await open();
    return new Promise((res,rej)=>{
      const t=d.transaction(STORE,'readwrite');
      t.objectStore(STORE).delete(id);
      t.oncomplete=res;
      t.onerror=()=>rej(t.error);
    });
  }

  function esc(s){
    return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  async function load(){
    cache=await all();
    const c=$('#peopleCount');
    if(c)c.textContent=cache.length;
    return cache;
  }

  async function render(){
    if(!$('#peopleGrid'))return;
    await load();
    const q=search.toLowerCase();
    const items=cache.filter(p=>`${p.first} ${p.last}`.toLowerCase().includes(q));
    const g=$('#peopleGrid');
    g.innerHTML='';
    $('#peopleEmpty').classList.toggle('show',!items.length);

    items.sort((a,b)=>`${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`,'fr')).forEach(p=>{
      const card=document.createElement('article');
      card.className='person-card-rich';

      let u=null;
      if(p.photo instanceof Blob) u=URL.createObjectURL(p.photo);

      const refCount=Array.isArray(p.descriptors)
        ? p.descriptors.length
        : (p.descriptor ? 1 : 0);

      card.innerHTML=`
        <div class="person-photo">
          ${u?`<img src="${u}" alt="">`:'<div class="person-photo-fallback">👤</div>'}
        </div>
        <div class="person-card-body">
          <span class="person-label">PERSONNE ENREGISTRÉE</span>
          <h3>${esc(p.first)} ${esc(p.last)}</h3>
          <p>${esc(p.notes||'Aucune note')}</p>
          <small>${refCount} photo${refCount>1?'s':''} de référence • identification locale</small>
          <div class="person-actions">
            <button class="outline-btn" data-del>Supprimer</button>
          </div>
        </div>
      `;

      card.querySelector('[data-del]').onclick=async()=>{
        if(confirm(`Supprimer ${p.first} ${p.last} ?`)){
          await del(p.id);
          if(u)URL.revokeObjectURL(u);
          await render();
          window.PCApp?.toast('Personne supprimée',`${p.first} ${p.last}`);
        }
      };

      g.appendChild(card);
    });
  }

  async function fileImg(file){
    return new Promise((res,rej)=>{
      const i=new Image(),u=URL.createObjectURL(file);
      i.onload=()=>{URL.revokeObjectURL(u);res(i)};
      i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('Image impossible à lire.'))};
      i.src=u;
    });
  }

  function makeEnhancedCanvas(img){
    const maxW=900;
    const ratio=Math.min(1,maxW/img.naturalWidth);
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(img.naturalWidth*ratio));
    c.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.filter='brightness(1.5) contrast(1.2) saturate(.95)';
    ctx.drawImage(img,0,0,c.width,c.height);
    return c;
  }

  function closeModal(){
    $('#personModal')?.classList.add('hidden');
  }

  function openModal(){
    $('#personModal').classList.remove('hidden');
    $('#personModelStatus').textContent='Modèle de reconnaissance : préparation…';
    $('#personPhoto').value='';
  }

  async function buildDescriptors(files){
    const descriptors=[];

    for(const file of files.slice(0,5)){
      try{
        const img=await fileImg(file);

        const original = await faceapi
          .detectSingleFace(img,new faceapi.TinyFaceDetectorOptions({inputSize:512,scoreThreshold:.28}))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if(original?.descriptor){
          descriptors.push(Array.from(original.descriptor));
        }

        // Deuxième passe sur la même photo améliorée pour les conditions sombres.
        const enhancedCanvas=makeEnhancedCanvas(img);
        const enhanced = await faceapi
          .detectSingleFace(enhancedCanvas,new faceapi.TinyFaceDetectorOptions({inputSize:512,scoreThreshold:.22}))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if(enhanced?.descriptor){
          descriptors.push(Array.from(enhanced.descriptor));
        }
      }catch(e){
        console.debug('Référence ignorée',e);
      }
    }

    return descriptors;
  }

  async function save(){
    const f=$('#personFirst').value.trim();
    const l=$('#personLast').value.trim();
    const files=[...($('#personPhoto').files||[])];
    const notes=$('#personNotes').value.trim();

    if(!f||!l||!files.length){
      return window.PCApp?.toast('Informations manquantes','Prénom, nom et au moins une photo sont nécessaires.');
    }

    try{
      $('#personModelStatus').textContent='Analyse des photos…';
      await window.PCRecognition.loadModels();

      const descriptors=await buildDescriptors(files);
      if(!descriptors.length){
        return window.PCApp?.toast(
          'Visage introuvable',
          'Ajoute une ou plusieurs photos où le visage est suffisamment visible.'
        );
      }

      const primaryFile=files[0];
      const blob=new Blob(
        [await primaryFile.arrayBuffer()],
        {type:primaryFile.type||'image/jpeg'}
      );

      await put({
        id:uid(),
        first:f,
        last:l,
        notes,
        photo:blob,
        descriptors,
        // Compatibilité avec les anciennes versions.
        descriptor:descriptors[0],
        referenceCount:files.length,
        created:Date.now()
      });

      closeModal();
      ['personFirst','personLast','personNotes'].forEach(id=>$('#'+id).value='');
      $('#personPhoto').value='';
      await render();
      window.PCApp?.toast(
        'Personne ajoutée',
        `${f} ${l} • ${files.length} photo${files.length>1?'s':''} de référence`
      );
    }catch(e){
      console.error(e);
      window.PCApp?.toast('Ajout impossible',e.message||'Le modèle n’a pas pu traiter les photos.');
    }
  }

  document.addEventListener('click',e=>{
    if(e.target.closest('#addPersonBtn'))openModal();
    if(e.target.matches('[data-close]'))closeModal();
    if(e.target.closest('#savePerson'))save();
  });

  $('#peopleSearch')?.addEventListener('input',e=>{
    search=e.target.value;
    render();
  });

  window.PCPeople={load,all,render,openModal};
  window.addEventListener('load',render);
})();