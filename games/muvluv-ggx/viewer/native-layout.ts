import {layoutText} from './native-ui.ts';
// Unity recalculates LayoutGroup/ContentSizeFitter when opening a prefab. The
// serialized zero-size containers are not the final on-screen rectangles.
export function solveNativeLayout(view){
  const nodes=[...view.nodes.values()],children=new Map(),sizes=new Map();
  for(const n of nodes){const parent=n.row.parent;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(n);sizes.set(n.row.key,[n.rect.width,n.rect.height]);}
  const active=n=>!n.el.hidden&&!n.row.layoutSize?.m_IgnoreLayout;
  for(const n of [...nodes].reverse()){
    const r=n.row,size=[...sizes.get(r.key)],items=(children.get(r.key)||[]).filter(active),preferred=[...size];
    if(r.text?.value){const font=view.fonts[r.text.font]||Object.values<any>(view.fonts)[0],text=font&&layoutText(r.text.value,font,{size:r.text.size,width:size[0]>0?size[0]:1800});if(text){preferred[0]=text.width;preferred[1]=text.height;}}
    if(r.image){if(!(preferred[0]>0))preferred[0]=r.image.width;if(!(preferred[1]>0))preferred[1]=r.image.height;}
    if(r.layout&&items.length){const axis=r.layout.axis==='x'?0:1,p=r.layout.padding;preferred[axis]=items.reduce((sum,c)=>sum+sizes.get(c.row.key)[axis],0)+r.layout.spacing*(items.length-1);preferred[1-axis]=Math.max(...items.map(c=>sizes.get(c.row.key)[1-axis]));preferred[0]+=(p.m_Left||0)+(p.m_Right||0);preferred[1]+=(p.m_Top||0)+(p.m_Bottom||0);}
    for(let axis=0;axis<2;axis++){const configured=r.layoutSize?.[axis?'m_PreferredHeight':'m_PreferredWidth'];if(configured>0)preferred[axis]=configured;if(r.fit?.[axis]===2||!(size[axis]>0))size[axis]=Math.max(0,preferred[axis]);}
    sizes.set(r.key,size);
  }
  for(const n of nodes){const r=n.row,parent=sizes.get(r.parent)||[view.width,view.height],size=sizes.get(r.key);r.size=[size[0]-parent[0]*(r.anchor[2]-r.anchor[0]),size[1]-parent[1]*(r.anchor[3]-r.anchor[1])];
    if(!r.layout)continue;const group=r.layout,p=group.padding,items=(children.get(r.key)||[]).filter(active);if(group.reverse)items.reverse();const axis=group.axis==='x'?0:1,pad=[p.m_Left||0,p.m_Top||0],available=[size[0]-(p.m_Left||0)-(p.m_Right||0),size[1]-(p.m_Top||0)-(p.m_Bottom||0)],align=[group.alignment%3,Math.floor(group.alignment/3)];
    const total=items.reduce((sum,c)=>sum+sizes.get(c.row.key)[axis],0)+Math.max(0,items.length-1)*group.spacing;let cursor=pad[axis]+Math.max(0,available[axis]-total)*align[axis]/2;
    for(const child of items){const dim=sizes.get(child.row.key),pos=[0,0];pos[axis]=cursor;pos[1-axis]=pad[1-axis]+Math.max(0,available[1-axis]-dim[1-axis])*align[1-axis]/2;Object.assign(child.row,{anchor:[0,1,0,1],pivot:[0,1],position:[pos[0],-pos[1]],size:dim});cursor+=dim[axis]+group.spacing;}
  }
  view.layout();
}
