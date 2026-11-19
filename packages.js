/* Portable v1 activity and amendment ZIP files. Import produces an isolated candidate. */
(() => {
  'use strict';
  const MB = 1024 * 1024, maxArchive = 8 * MB, maxImage = 2 * MB, maxJson = 256 * 1024;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
  const fail = message => { throw new Error(message); };
  const requireValue = (condition, message) => { if (!condition) fail(message); };
  const crcTable = Uint32Array.from({length:256}, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value;
  });
  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ -1) >>> 0;
  }
  function putEntry(name, bytes, offset) {
    const filename = encoder.encode(name);
    const local = new ArrayBuffer(30), central = new ArrayBuffer(46);
    const l = new DataView(local), c = new DataView(central);
    l.setUint32(0, 0x04034b50, true); c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); c.setUint32(42, offset, true);
    const crc = crc32(bytes);
    for (const [view, start] of [[l,4],[c,6]]) {
      view.setUint16(start,20,true);
      view.setUint16(start+2,0x800,true);
      view.setUint16(start+8,33,true); // DOS date, 1980-01-01.
      view.setUint32(start+10,crc,true);
      view.setUint32(start+14,bytes.length,true);
      view.setUint32(start+18,bytes.length,true);
      view.setUint16(start+22,filename.length,true);
    }
    return {local:[local,filename,bytes],central:[central,filename]};
  }
  function archive(files) {
    const local = [], central = [];
    let offset = 0, directorySize = 0;
    for (const [name, bytes] of files) {
      const entry = putEntry(name, bytes, offset);
      local.push(...entry.local); central.push(...entry.central);
      offset += entry.local.reduce((n,b)=>n+b.byteLength,0);
      directorySize += entry.central.reduce((n,b)=>n+b.byteLength,0);
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
    end.setUint32(12,directorySize,true); end.setUint32(16,offset,true);
    return new Blob([...local,...central,end.buffer], {type:'application/zip'});
  }
  const imagePath = /^assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,71}\.(?:png|jpe?g|webp)$/i;
  function utf8(bytes) {
    try {return decoder.decode(bytes);} catch {fail('文件名称和 JSON 必须使用 UTF-8 编码。');}
  }
  async function inflate(compressed, expected) {
    if (typeof DecompressionStream === 'undefined') fail('当前浏览器不支持此 ZIP 压缩方式，请使用新版 Chrome 或 Edge。');
    const bytes = new Uint8Array(expected);
    let length = 0;
    try {
      const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (length + result.value.length > expected) { await reader.cancel(); fail('大小不符'); }
        bytes.set(result.value,length); length += result.value.length;
      }
    } catch {fail('ZIP 解压失败，数据损坏或解压后大小不符。');}
    requireValue(length===expected,'ZIP 解压后大小不符。');
    return bytes;
  }
  async function readArchive(file) {
    requireValue(file?.size >= 22 && file.size <= maxArchive,'请选择 8 MiB 以内的修改稿 ZIP。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer), u16 = p=>view.getUint16(p,true), u32 = p=>view.getUint32(p,true);
    let end = bytes.length - 22;
    const earliest = Math.max(0,end-65535);
    while (end>=earliest && !(u32(end)===0x06054b50 && end+22+u16(end+20)===bytes.length)) end--;
    requireValue(end>=earliest,'无法识别 ZIP 目录，请选择修改稿.zip。');
    const count = u16(end+10), offset = u32(end+16);
    requireValue(!u16(end+4) && !u16(end+6) && u16(end+8)===count,'不支持分卷 ZIP。');
    requireValue(count>0 && count<=24 && offset+u32(end+12)===end,'ZIP 目录无效或文件数量超限。');
    const entries = new Map(), ranges = [];
    let cur=offset, expanded=0;
    for (let i=0; i<count; i++) {
      requireValue(cur+46<=end && u32(cur)===0x02014b50,'ZIP 目录记录无效。');
      const flags=u16(cur+8), method=u16(cur+10), crc=u32(cur+16), size=u32(cur+20), raw=u32(cur+24);
      const nameLength=u16(cur+28), pos=u32(cur+42);
      const next=cur+46+nameLength+u16(cur+30)+u16(cur+32);
      requireValue(next<=end && nameLength<=128 && !u16(cur+34),'ZIP 文件头无效。');
      const name=utf8(bytes.subarray(cur+46,cur+46+nameLength));
      requireValue(name!=='manifest.json','你选择了系统导出的活动包，请选择包含 changes.json 的修改稿 ZIP。');
      requireValue(name==='changes.json' || name==='assets/' || imagePath.test(name),'修改包里含有不支持的文件或路径。');
      requireValue(!entries.has(name),'修改包包含重复的文件名。');
      requireValue((flags & ~0x80e)===0 && [0,8].includes(method),'仅支持普通存储或 Deflate 压缩的未加密 ZIP。');
      expanded+=raw;
      requireValue(raw<=(name==='changes.json'?maxJson:maxImage) && expanded<=maxArchive,'修改包解压后超出大小限制。');
      requireValue(name!=='assets/' || raw===0,'assets/ 目录项无效。');
      requireValue(pos+30<=offset && u32(pos)===0x04034b50 && u16(pos+6)===flags && u16(pos+8)===method,'ZIP 文件头与目录不一致。');
      const dataStart=pos+30+u16(pos+26)+u16(pos+28);
      requireValue(dataStart+size<=offset && utf8(bytes.subarray(pos+30,pos+30+u16(pos+26)))===name,'ZIP 文件位置无效。');
      if (!(flags & 8)) requireValue(u32(pos+14)===crc && u32(pos+18)===size && u32(pos+22)===raw,'ZIP 文件大小或校验信息不一致。');
      ranges.push([pos,dataStart+size]);
      entries.set(name,{method,raw,crc,start:dataStart,end:dataStart+size});
      cur=next;
    }
    ranges.sort((a,b)=>a[0]-b[0]);
    requireValue(cur===end && ranges.every((r,i)=>!i || r[0]>=ranges[i-1][1]),'ZIP 文件区域重叠或目录不完整。');
    async function get(name) {
      const entry=entries.get(name);
      requireValue(entry,'修改包缺少文件：'+name);
      const packed=bytes.subarray(entry.start,entry.end);
      const raw=entry.method===0?packed:await inflate(packed,entry.raw);
      requireValue(raw.length===entry.raw && crc32(raw)===entry.crc,'ZIP 文件校验失败：'+name);
      return raw;
    }
    return {entries,get};
  }
  const json = value => encoder.encode(JSON.stringify(value,null,2)+'\n');
  const clone = value => JSON.parse(JSON.stringify(value));
  const formats = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
  function dataURL(bytes,type) {
    let binary='';
    for (let pos=0;pos<bytes.length;pos+=16384) binary+=String.fromCharCode(...bytes.subarray(pos,pos+16384));
    return 'data:'+type+';base64,'+btoa(binary);
  }
  function imageBytes(src) {
    const match=/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+\/=]+)$/.exec(src);
    requireValue(match && match[2].length<=4*Math.ceil(maxImage/3),'海报格式或文件大小不符合导出条件。');
    const bytes=Uint8Array.from(atob(match[2]),letter=>letter.charCodeAt(0));
    return {suffix:match[1]==='jpeg'?'jpg':match[1],bytes};
  }
  const ascii=(bytes,pos,n)=>String.fromCharCode(...bytes.subarray(pos,pos+n));
  function dimensions(bytes,type) {
    const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(type==='image/png' && bytes.length>=33 && ascii(bytes,0,8)==='\x89PNG\r\n\x1a\n' && ascii(bytes,12,4)==='IHDR') return [d.getUint32(16),d.getUint32(20)];
    if(type==='image/jpeg' && bytes[0]===255 && bytes[1]===216) {
      let p=2;
      while(p+4<bytes.length && bytes[p]===255) {
        while(bytes[p]===255)p++;
        const marker=bytes[p++];
        if(marker===217 || marker===218 || p+2>bytes.length) break;
        const len=d.getUint16(p);
        if(len<2 || p+len>bytes.length) break;
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && len>=8) return [d.getUint16(p+5),d.getUint16(p+3)];
        p+=len;
      }
    }
    if(type==='image/webp' && bytes.length>=30 && ascii(bytes,0,4)==='RIFF' && ascii(bytes,8,4)==='WEBP') {
      const chunk=ascii(bytes,12,4), le24=i=>bytes[i]+256*bytes[i+1]+65536*bytes[i+2];
      if(chunk==='VP8X')return [1+le24(24),1+le24(27)];
      if(chunk==='VP8L' && bytes[20]===47){const bits=d.getUint32(21,true);return [(bits&16383)+1,((bits>>>14)&16383)+1];}
      if(chunk==='VP8 ' && ascii(bytes,23,3)==='\x9d\x01\x2a')return [d.getUint16(26,true)&16383,d.getUint16(28,true)&16383];
    }
    fail('海报扩展名与实际图片格式不一致，或图像已损坏。');
  }
  async function validatedCover(name,bytes) {
    requireValue(imagePath.test(name) && bytes.length>0 && bytes.length<=maxImage,'请选择 2 MiB 内的 PNG、JPEG 或 WebP 海报。');
    const type=formats[name.split('.').pop().toLowerCase()];
    const [width,height]=dimensions(bytes,type);
    requireValue(width>0 && height>0 && width<=8192 && height<=8192 && width*height<=16777216,'海报像素尺寸过大或无效。');
    const src=dataURL(bytes,type);
    try { const img=new Image(); img.src=src; await img.decode(); }
    catch {fail('无法解码海报图片。');}
    return src;
  }
  const templates={classic:'经典邀请',agenda:'议程导览',editorial:'海报特刊'};
  const blockNames={text:'正文',agenda:'议程',notice:'须知'};
  const labels={title:'活动标题',date:'活动日期',time:'开始时间',place:'活动地点',detail:'活动介绍',template:'内容模板'};
  function shape(obj,keys,where) {
    requireValue(obj && typeof obj==='object' && !Array.isArray(obj) &&
      keys.every(key=>Object.hasOwn(obj,key)) && Object.keys(obj).length===keys.length,
      where+'包含缺失或未支持的字段。');
  }
  function textValue(value,max,label,required=false) {
    requireValue(typeof value==='string' && value.length<=max && (!required || value.trim().length>0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),label+'内容为空、过长或含有无效字符。');
  }
  function identifier(id) {
    requireValue(typeof id==='string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id) &&
      !Object.hasOwn(Object.prototype,id) && !['prototype','elements','submit','reset','action','method','target','length'].includes(id),'字段或区块 ID 无效。');
  }
  function validField(field) {
    shape(field,['id','label','required'],'报名字段'); identifier(field.id); textValue(field.label,30,'字段名称',true);
    requireValue(typeof field.required==='boolean','报名字段 required 应为布尔值。');
  }
  function validBlock(block) {
    shape(block,['id','type','title','body'],'页面区块'); identifier(block.id);
    requireValue(typeof block.type==='string' && Object.hasOwn(blockNames,block.type),'不支持的页面区块类型。');
    textValue(block.title,100,'区块标题',true); textValue(block.body,2000,'区块正文');
  }
  function fieldDefinition(field) { return {id:field.key,label:field.label,required:field.required}; }
  function validScalar(field,value) {
    requireValue(typeof field==='string' && Object.hasOwn(labels,field),'不允许修改此活动属性。');
    if(field==='template') {requireValue(typeof value==='string' && Object.hasOwn(templates,value),'未知内容模板。');return;}
    if(field==='time') {
      requireValue(value==='' || (typeof value==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)),'开始时间应为 24 小时制 HH:mm。');
      return;
    }
    if(field==='date') {
      if(value==='')return;
      requireValue(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value),'日期应为 YYYY-MM-DD。');
      const t=new Date(value+'T00:00:00Z');
      requireValue(!Number.isNaN(+t) && t.toISOString().slice(0,10)===value,'日期无效。');return;
    }
    textValue(value,field==='detail'?2000:100,labels[field],field==='title');
  }
  function validate(event) {
    requireValue(Number.isSafeInteger(event.version) && event.version>=1,'草稿版本无效，请重新打开活动。');
    Object.keys(labels).forEach(key=>validScalar(key,event[key]));
    requireValue(Array.isArray(event.fields) && event.fields.length>0 && event.fields.length<=30,'活动须保留 1 至 30 个报名字段。');
    requireValue(Array.isArray(event.blocks) && event.blocks.length<=30,'页面最多支持 30 个区块。');
    event.fields.forEach(f=>validField(fieldDefinition(f))); event.blocks.forEach(validBlock);
    requireValue(new Set(event.fields.map(f=>f.key)).size===event.fields.length &&
      new Set(event.fields.map(f=>f.label.trim())).size===event.fields.length,'报名字段 ID 或名称重复。');
    requireValue(new Set(event.blocks.map(b=>b.id)).size===event.blocks.length,'区块 ID 重复。');
  }
  async function exportActivity(event) {
    event={time:'',...event};
    validate(event);
    let src=event.cover;
    if(!src) {
      const poster=document.createElement('template');
      poster.innerHTML=window.posterArt(event.theme);
      src=poster.content.querySelector('img')?.getAttribute('src');
    }
    const {suffix,bytes}=imageBytes(src);
    const asset='assets/'+(event.cover?'cover':'template-art')+'.'+suffix;
    const manifest={formatVersion:1,activityId:event.id,draftVersion:event.version};
    const {title,date,time,place,detail,theme,template,blocks}=event;
    const invitation={title,date,time,place,detail,theme,template,blocks,cover:{mode:event.cover?'image':'template',asset}};
    return archive([['manifest.json',json(manifest)],['invitation.json',json(invitation)],
      ['form.json',json({fields:event.fields.map(fieldDefinition)})],[asset,bytes]]);
  }
  function reorder(list,ids,key) {
    requireValue(Array.isArray(ids) && ids.length===list.length && new Set(ids).size===ids.length,'排序必须列出所有现有 ID，且每项只出现一次。');
    const byId=new Map(list.map(item=>[item[key],item]));
    requireValue(ids.every(id=>byId.has(id)),'排序引用了不存在的 ID。');
    return ids.map(id=>byId.get(id));
  }
  function collectionChange(event,op,unit) {
    const isField=unit==='Field', key=isField?'fields':'blocks', prop=isField?'field':'block', idKey=isField?'key':'id';
    const items=event[key];
    if(op.op==='reorder'+unit+'s') {
      shape(op,['op','ids'],'排序操作'); event[key]=reorder(items,op.ids,idKey); return;
    }
    if(op.op==='remove'+unit) {
      shape(op,['op','id'],'移除操作'); identifier(op.id);
      const index=items.findIndex(v=>v[idKey]===op.id);
      requireValue(index>=0,'要移除的 ID 不存在：'+op.id);
      items.splice(index,1);return;
    }
    shape(op,['op',prop],'修改操作');
    const value=op[prop];
    if(isField)validField(value);else validBlock(value);
    const entry=isField?{key:value.id,label:value.label,required:value.required}:clone(value);
    const index=items.findIndex(v=>v[idKey]===value.id);
    if(op.op==='add'+unit){requireValue(index===-1,'新增 ID 已经存在：'+value.id);items.push(entry);}
    else {requireValue(index>=0,'要修改的 ID 不存在：'+value.id);items[index]=entry;}
  }
  function differences(before,after) {
    const diffs=[];
    const diff=(label,from,to)=>diffs.push({label,before:from,after:to});
    for(const [key,label] of Object.entries(labels)) {
      if(before[key]!==after[key]) diff(label,key==='template'?templates[before[key]]:before[key],key==='template'?templates[after[key]]:after[key]);
    }
    if(before.cover!==after.cover) diff('封面已替换',before.cover?'原海报':'模板海报','新海报');
    function compareList(oldList,newList,idKey,name,describe) {
      const oldMap=new Map(oldList.map(o=>[o[idKey],o])), newMap=new Map(newList.map(o=>[o[idKey],o]));
      for(const o of oldList) if(!newMap.has(o[idKey]))diff('移除'+name,describe(o),'已移除');
      for(const n of newList) {
        const o=oldMap.get(n[idKey]);
        if(!o) diff('新增'+name,'无',describe(n));
        else if(describe(o)!==describe(n))diff('修改'+name,describe(o),describe(n));
      }
      // New items are appended by default. Show ordering when the resulting order also changed.
      const retained=oldList.filter(i=>newMap.has(i[idKey])), added=newList.filter(i=>!oldMap.has(i[idKey]));
      const expected=[...retained,...added];
      const order=list=>list.map(item=>item.label||item.title).join(' → ');
      if(expected.some((i,index)=>i[idKey]!==newList[index][idKey])) diff(name+'顺序',order(oldList),order(newList));
    }
    compareList(before.fields,after.fields,'key','报名字段',f=>f.label+'（'+(f.required?'必填':'选填')+'）');
    compareList(before.blocks,after.blocks,'id','页面区块',b=>'['+blockNames[b.type]+'] '+b.title+'\n'+b.body);
    return diffs;
  }
  async function inspect(file,event) {
    event={time:'',...event};
    validate(event);
    const files=await readArchive(file);
    const source=utf8(await files.get('changes.json'));
    let doc;
    try {doc=JSON.parse(source);} catch {fail('changes.json 不是有效的 JSON。');}
    shape(doc,['formatVersion','activityId','baseVersion','changes'],'changes.json');
    requireValue(doc.formatVersion===1,'不支持的修改包格式版本，请使用 v1。');
    requireValue(doc.activityId===event.id,'目标活动不匹配，请从当前活动重新导出。');
    requireValue(doc.baseVersion===event.version,'草稿版本冲突，请重新导出活动包，再让 AI 生成修改稿。');
    requireValue(Array.isArray(doc.changes) && doc.changes.length>=1 && doc.changes.length<=150,'修改稿须包含 1 至 150 项操作。');
    const candidate=clone(event), used=new Set(['changes.json','assets/']);
    for (const op of doc.changes) {
      requireValue(op && typeof op==='object' && typeof op.op==='string','修改操作格式错误。');
      if (op.op==='set') {
        shape(op,['op','field','value'],'set 操作'); validScalar(op.field,op.value); candidate[op.field]=op.value;
      } else if(op.op==='cover') {
        shape(op,['op','asset'],'cover 操作');
        requireValue(typeof op.asset==='string' && imagePath.test(op.asset),'封面路径须指向 assets/ 下的图片。');
        requireValue(used.size===2,'一次修改仅可替换一张封面。');
        candidate.cover=await validatedCover(op.asset,await files.get(op.asset));used.add(op.asset);
      } else if(['addBlock','updateBlock','removeBlock','reorderBlocks'].includes(op.op)) collectionChange(candidate,op,'Block');
      else if(['addField','updateField','removeField','reorderFields'].includes(op.op)) collectionChange(candidate,op,'Field');
      else fail('不支持的修改操作。');
    }
    requireValue([...files.entries.keys()].every(key=>used.has(key)),'修改包包含未被使用的文件，请只保留本次替换的素材。');
    validate(candidate);
    const diffs=differences(event,candidate);
    requireValue(diffs.length>0,'修改稿与当前草稿完全相同。');
    return {candidate,diffs};
  }
  window.EventPackages=Object.freeze({export:exportActivity,inspect});
})();
