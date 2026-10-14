'use strict';
const fs=require('node:fs'),path=require('node:path');
const DIRECTORY='story-ui/muvluv';
function installStoryUi(output){
  const source=path.join(__dirname,'story-ui/native'),files=fs.readdirSync(source).filter(name=>/^[a-z0-9-]+\.(json|png)$/.test(name)).map(name=>'native/'+name);
  for(const file of files){const target=path.join(output,DIRECTORY,file),bytes=fs.readFileSync(path.join(__dirname,'story-ui',file));fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes))fs.writeFileSync(target,bytes);}
  return {file:DIRECTORY+'/native/window.json',source:'local',files:files.map(file=>DIRECTORY+'/'+file),exportVersion:1};
}
export { installStoryUi };
