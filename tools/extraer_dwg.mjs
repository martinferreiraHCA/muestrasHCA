import fs from 'fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const buf = fs.readFileSync(process.argv[2]);
const lib = await LibreDwg.create();
const dwg = lib.dwg_read_data(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength), Dwg_File_Type.DWG);
const db = lib.convert(dwg);
const rep=(k,v)=>typeof v==='bigint'?v.toString():v;
const w = fs.createWriteStream(process.argv[3]);
const keep=new Set(['handle','ownerDictionaryHardId','ownerBlockRecordSoftId','colorName','lineType','lineweight','lineTypeScale','isVisible','transparency','transparencyType','xdata','extrusionDirection']);
function slim(e){const o={};for(const k in e){if(!keep.has(k))o[k]=e[k];} if(e.extrusionDirection&&e.extrusionDirection.z<0)o.ez=-1; return o;}
for(const e of db.entities){ if(e.type==='HATCH')continue; w.write(JSON.stringify(slim(e),rep)+'\n'); }
w.end();
const blocks={};
for(const b of db.tables.BLOCK_RECORD.entries){ if(b.name.startsWith('*Model')||b.name.startsWith('*Paper'))continue; blocks[b.name]={base:b.basePoint,entities:(b.entities||[]).filter(e=>e.type!=='HATCH').map(slim)}; }
fs.writeFileSync(process.argv[4], JSON.stringify(blocks,rep));
fs.writeFileSync(process.argv[5], JSON.stringify({layers:db.tables.LAYER.entries.map(l=>({name:l.name,color:l.colorIndex,off:l.off,frozen:l.frozen, flags:l.standardFlag})), layouts:db.objects.LAYOUT, vports:db.tables.VPORT},rep));
// sample of each type
const seen={};for(const e of db.entities){if(!seen[e.type]){seen[e.type]=1;console.log(JSON.stringify(slim(e),rep).slice(0,700));}}
