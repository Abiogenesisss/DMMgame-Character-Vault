'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const readline=require('node:readline/promises');
const {createRegistry}=require('../app/index.ts');
async function main(){
  const choices=createRegistry().list().filter(game=>fs.existsSync(path.join(game.root,'requirements.txt')));
  if(!choices.length)throw new Error('此版本没有需要 Python 的游戏。');
  let id=process.argv[2];
  if(!id){choices.forEach((game,index)=>console.log((index+1)+'. '+game.label));const input=readline.createInterface({input:process.stdin,output:process.stdout});const selected=await input.question('输入要安装依赖的游戏序号：');input.close();id=choices[Number(selected)-1]?.id;}
  const game=choices.find(game=>game.id===id);if(!game)throw new Error('请选择列表中的游戏。');
  const root=path.resolve(__dirname,'..'),environment=path.join(root,'.tools/python',id);
  const python=path.join(environment,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  function run(command,args){const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});if(result.error||result.status!==0)throw new Error(result.error?.message||'安装未完成，请检查 Python 安装与网络连接。');}
  if(!fs.existsSync(python))run(process.platform==='win32'?'py':'python3',process.platform==='win32'?['-3','-m','venv',environment]:['-m','venv',environment]);
  run(python,['-m','pip','install','-r',path.join(game.root,'requirements.txt')]);
  console.log(game.label+' 的 Python 依赖已安装。');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
