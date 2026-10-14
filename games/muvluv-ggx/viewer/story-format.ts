'use strict';
// ScenarioAdultStillAnimationTypes / CharacterFacialType from this client's
// IL2CPP metadata, not the ordinal order of exported Spine animations.
const MOTIONS=['Animation_1_In','Animation_2_In','Animation_2_Loop','Animation_3_In','Animation_3_Loop','Animation_4_In','Animation_4_Loop','Animation_5_In','Animation_6_In'];
const FACES=['Normal','Shy','Delighted','Angry','Sad','Surprised','Confused','Scared','Custom'];
function animation(type,names){const wanted=MOTIONS[type??0];if(!wanted)throw new Error('未知的 CG 动作编号：'+type);const loop=wanted.replace(/_In$/,'_Loop');if(names.includes(wanted))return {name:wanted,loop:wanted.endsWith('_Loop'),next:wanted.endsWith('_In')&&names.includes(loop)?loop:null};if(names.includes(loop))return {name:loop,loop:true,next:null};throw new Error('CG 缺少原版动作：'+wanted);}
const plain=value=>String(value??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/\\n/g,'\n');
const seconds=value=>Math.max(0,Number(value)||0)/1000;
export { MOTIONS, FACES, animation, plain, seconds };
