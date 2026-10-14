'use strict';
const fs=require('node:fs'),path=require('node:path');
const DIRECTORY='story-ui/dotabyss';
const FILES=['theme.json','window-gradient.png','continue.png','web-background.png','fullscreen.png'];
// These shared graphics and layout were exported from Novel.unity once. Story
// downloads must not depend on the game's large UI scene or its current catalog.
function installStoryUi(output){
  const destination=path.join(output,DIRECTORY);fs.mkdirSync(destination,{recursive:true});
  const files=[...FILES,...fs.readdirSync(path.join(__dirname,'../story-ui/native')).filter(file=>/^[a-z0-9-]+\.(png|json)$/.test(file)).map(file=>'native/'+file)];
  for(const file of files){
    const bytes=fs.readFileSync(path.join(__dirname,'../story-ui',file)),target=path.join(destination,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes))fs.writeFileSync(target,bytes);
  }
  return {file:DIRECTORY+'/theme.json',files:files.map(file=>DIRECTORY+'/'+file),exportVersion:5,source:'local'};
}
export { installStoryUi };
