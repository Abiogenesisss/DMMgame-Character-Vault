'use strict';
function parseUtf(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.toString('ascii',0,4) !== '@UTF') throw new Error('CRI 表头无效。');
  const size=bytes.readUInt32BE(4)+8, rowsAt=bytes.readUInt16BE(10)+8, stringsAt=bytes.readUInt32BE(12)+8, dataAt=bytes.readUInt32BE(16)+8;
  const columns=bytes.readUInt16BE(24), width=bytes.readUInt16BE(26), count=bytes.readUInt32BE(28);
  if (size>bytes.length || rowsAt<32 || stringsAt<rowsAt || dataAt<stringsAt || dataAt>size || !columns || columns>256 || count>128000 || count*width>stringsAt-rowsAt) throw new Error('CRI 表偏移无效。');
  const bounds=(offset,length,end=size)=>{if(offset<0||length<0||offset+length>end)throw new Error('CRI 数据越界。');};
  function string(offset) { const start=stringsAt+offset; bounds(start,1,dataAt); const end=bytes.indexOf(0,start); if(end<start||end>=dataAt)throw new Error('CRI 字符串不完整。'); return bytes.toString('utf8',start,end); }
  const sizes=[1,1,2,2,4,4,8,8,4,8,4,8,16], schema=[]; let cursor=32,rowOffset=0;
  function value(type,offset) {
    bounds(offset,sizes[type]);
    if(type===10)return string(bytes.readUInt32BE(offset));
    if(type===11){const start=dataAt+bytes.readUInt32BE(offset),length=bytes.readUInt32BE(offset+4);bounds(start,length);return bytes.subarray(start,start+length);}
    if(type===8)return bytes.readFloatBE(offset); if(type===9)return bytes.readDoubleBE(offset);
    if(type===12)return bytes.subarray(offset,offset+16);
    if(type===6)return bytes.readBigUInt64BE(offset);if(type===7)return bytes.readBigInt64BE(offset);
    return type%2 ? bytes.readIntBE(offset,sizes[type]) : bytes.readUIntBE(offset,sizes[type]);
  }
  for(let i=0;i<columns;i++){
    bounds(cursor,5,rowsAt);const flag=bytes[cursor]>>4,type=bytes[cursor]&15,name=string(bytes.readUInt32BE(cursor+1));cursor+=5;
    if(!(flag&1)||(flag&8)||!sizes[type])throw new Error('不支持的 CRI 列。');
    let offset=null,constant=null;
    if(flag&2){bounds(cursor,sizes[type],rowsAt);constant=value(type,cursor);cursor+=sizes[type];}
    // Newer ACB headers append fields to their single metadata row without
    // updating its declared width. Bound these by the actual string-table start;
    // multi-row tables must still honor the declared stride exactly.
    else if(flag&4){offset=rowOffset;rowOffset+=sizes[type];if(rowOffset>width&&(count!==1||rowsAt+rowOffset>stringsAt))throw new Error('CRI 行宽不符。');}
    if(schema.some(item=>item.name===name))throw new Error('CRI 列名重复。');
    schema.push({name,type,offset,constant});
  }
  const rows=Array.from({length:count},(_,row)=>Object.fromEntries(schema.map(column=>[column.name,column.offset==null?column.constant:value(column.type,rowsAt+row*width+column.offset)])));
  return {name:string(bytes.readUInt32BE(20)),rows};
}
function parseAwb(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.toString('ascii',0,4)!=='AFS2')throw new Error('CRI 音频包无效。');
  const offsetSize=bytes[5],idSize=bytes.readUInt16LE(6),count=bytes.readUInt32LE(8),alignment=bytes.readUInt16LE(12);
  if(![2,4].includes(offsetSize)||![2,4].includes(idSize)||!alignment||count>10000||16+count*idSize+(count+1)*offsetSize>bytes.length)throw new Error('CRI 音频目录无效。');
  const offsets=16+count*idSize,align=offset=>Math.ceil(offset/alignment)*alignment,clips=[];
  for(let i=0;i<count;i++){
    const start=align(bytes.readUIntLE(offsets+i*offsetSize,offsetSize)),rawEnd=bytes.readUIntLE(offsets+(i+1)*offsetSize,offsetSize),end=rawEnd<bytes.length?align(rawEnd):rawEnd;
    if(start>end||end>bytes.length||start<offsets+(count+1)*offsetSize)throw new Error('CRI 音频偏移无效。');
    const data=bytes.subarray(start,end);if(!data.length)continue;
    let extension;
    if(data.toString('ascii',4,8)==='ftyp')extension='m4a';else if(data.toString('ascii',0,4)==='OggS')extension='ogg';else if(data.toString('ascii',0,4)==='RIFF')extension='wav';
    if(!extension)throw new Error('不支持的 CRI 音频编码。');
    clips.push({waveId:bytes.readUIntLE(16+i*idSize,idSize),data,extension});
  }
  return clips;
}
function acbAudio(bytes, externalAwb) {
  const header=parseUtf(bytes).rows[0];if(!header)throw new Error('CRI 头部缺失。');
  const table=name=>Buffer.isBuffer(header[name])&&header[name].length?parseUtf(header[name]).rows:[];
  const names=table('CueNameTable'),cues=table('CueTable'),synths=table('SynthTable'),waves=table('WaveformTable'),mapping=new Map();
  const sequences=table('SequenceTable'),blocks=table('BlockTable'),blockSequences=table('BlockSequenceTable'),tracks=table('TrackTable'),events=table('TrackEventTable');
  function trackWaves(owner,seen){
    const refs=owner?.TrackIndex;if(!Buffer.isBuffer(refs)||owner.NumTracks*2>refs.length)return [];const values=[];
    for(let i=0;i<owner.NumTracks;i++){const commands=events[tracks[refs.readUInt16BE(i*2)]?.EventIndex]?.Command;if(!Buffer.isBuffer(commands))continue;
      for(let at=0;at+3<=commands.length;){const code=commands.readUInt16BE(at),length=commands[at+2];at+=3;if(at+length>commands.length)throw new Error('CRI 事件越界。');
        if([2000,2003].includes(code)&&length>=4)values.push(...resolve(commands.readUInt16BE(at),commands.readUInt16BE(at+2),new Set<string>(seen)));at+=length;}}
    return values;
  }
  function resolve(type,index,seen=new Set<string>()) {
    const key=type+':'+index;if(seen.has(key)||seen.size>32)return [];seen.add(key);
    if(type===1)return [index];
    if(type===2){const refs=synths[index]?.ReferenceItems;if(!Buffer.isBuffer(refs)||refs.length%4)return [];const values=[];
      for(let i=0;i<refs.length;i+=4)values.push(...resolve(refs.readUInt16BE(i),refs.readUInt16BE(i+2),new Set<string>(seen)));return values;}
    if(type===3)return trackWaves(sequences[index],seen);
    // Background voices use block sequences instead of ordinary sequences.
    if(type===8){const sequence=blockSequences[index],values=trackWaves(sequence,seen),refs=sequence?.BlockIndex;
      if(Buffer.isBuffer(refs)&&sequence.NumBlocks*2<=refs.length)for(let i=0;i<sequence.NumBlocks;i++)values.push(...trackWaves(blocks[refs.readUInt16BE(i*2)],seen));
      return values;
    }
    return [];
  }
  for(const name of names){
    const cue=cues[name.CueIndex];if(!cue)continue;
    for(const waveIndex of resolve(cue.ReferenceType,cue.ReferenceIndex)){
      const wave=waves[waveIndex];if(!wave)continue;
      const waveId=wave.Streaming?wave.StreamAwbId:wave.MemoryAwbId;
      if(waveId!=null&&typeof name.CueName==='string')mapping.set(waveId,{code:name.CueName,loop:!!wave.LoopFlag,duration:wave.SamplingRate>0?wave.NumSamples/wave.SamplingRate:null});
    }
  }
  const bank=Buffer.isBuffer(header.AwbFile)&&header.AwbFile.length?header.AwbFile:externalAwb;
  if(!bank)throw new Error('CRI 音频正文缺失。');
  return parseAwb(bank).map(clip=>({...clip,...(mapping.get(clip.waveId)||{code:'wave_'+clip.waveId})}));
}
export { parseUtf, parseAwb, acbAudio };
