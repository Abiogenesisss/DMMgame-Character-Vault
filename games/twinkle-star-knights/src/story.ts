import { aliasKey } from './catalog.ts';
import { createHash } from 'node:crypto';

/** Keep branching commands and authored positions; text is always plain text. */
export function storyProgram(rows: any[], catalog: any) {
  const resources = new Set<string>(), unsupported = new Set<string>(), unresolved = new Set<string>();
  const plain = value => String(value || '').replace(/<[^>]*>/g, '').replace(/\\n/g, '\n');
  const resolve = (file, optional = false) => {
    const id = file && (catalog.aliases[aliasKey(file)] || (catalog.assets[file] ? file : null));
    if (id) resources.add(id); else if (file) (optional ? unsupported : unresolved).add(file);
    return id;
  };
  const character = name => catalog.settings.Character.find(c => c.CharacterName === name);
  const texture = label => catalog.settings.Texture.find(t => t.Label === label);
  const sound = label => catalog.settings.Sound.find(s => s.Label === label);
  const voiceIndex = new Map(Object.values<any>(catalog.assets).filter(a => a.kind === 'audio').map(a => [a.id.split('/').at(-1).replace(/\.ogg$/, ''), a.id]));
  const voice = label => { const id = voiceIndex.get(label); if (id) resources.add(id); else if (label) unresolved.add('voice:' + label); return id || null; };
  const steps = [];
  for (const row of rows) {
    const command = row.Command || '', args = Array.from({ length: 6 }, (_, i) => row['Arg' + (i + 1)] || '');
    if (command.startsWith('*')) { steps.push({ op: 'label', name: command.slice(1) }); continue; }
    const base: any = { args, skin: row.Skin || '', animation: row.SpineAnim || '', subAnimation: row.SpineSubAnim || '',
      speed: row.AnimSpd === '' || row.AnimSpd == null ? null : Number(row.AnimSpd), completion: row.AnimCompType || '',
      noWait: row.WaitType === 'NoWait', page: row.PageCtrl || '', window: ['Full', 'Center'].includes(row.WindowType) ? row.WindowType : '' };
    if (!command || command === 'Character') {
      const cfg = character(args[0]);
      const actor = cfg ? { name: args[0], label: cfg.NameText, asset: resolve(cfg.FileName), layer: args[2] || '', x: args[3] === '' ? null : Number(args[3]),
        y: args[4] === '' ? null : Number(args[4]), defaultX: Number(cfg.X) || 0, defaultY: Number(cfg.Y) || 0, scale: Number(cfg.Scale) || 1 } : null;
      if (actor || row.Text) steps.push({ ...base, op: 'line', actor, actorOff: /<Off>/i.test(args[1]), speaker: cfg?.NameText || plain(args[0]), text: plain(row.Text), voice: voice(row.Voice) });
    } else if (['Bg', 'BgEvent', 'Sprite'].includes(command)) {
      const cfg = texture(args[0]); steps.push({ ...base, op: command === 'Sprite' ? 'sprite' : 'background', asset: resolve(cfg?.FileName, command === 'Sprite'),
        scale: Number(cfg?.Scale) || 1, x: args[3] === '' ? Number(cfg?.X) || 0 : Number(args[3]), y: args[4] === '' ? Number(cfg?.Y) || 0 : Number(args[4]),
        layer: args[2] || (command === 'BgEvent' ? 'Still1' : command === 'Bg' ? 'BackGround' : 'EffectF'), fileType: cfg?.FileType || '', text: plain(row.Text),
        title: cfg?.FileType === 'Title' ? plain(row.Text).split(',') : undefined, scene: command === 'BgEvent' ? 'cg' : undefined });
      if (!cfg && args[0]) (command === 'Sprite' ? unsupported : unresolved).add('texture:' + args[0]);
    } else if (['Bgm', 'Se', 'BgSe', 'BgVoice'].includes(command)) {
      const cfg = sound(args[0]); steps.push({ ...base, op: command, asset: cfg ? resolve(cfg.FileName) : voice(args[0]), loop: command === 'Bgm' || command === 'BgVoice' || command === 'BgSe' && args[1].toLowerCase() !== 'false' });
    } else if (command === 'Selection') steps.push({ op: 'choice', target: args[0].replace(/^\*/, ''), text: plain(row.Text || args[1]) });
    else if (['Jump', 'JumpRandom'].includes(command)) steps.push({ op: 'jump', target: args[0].replace(/^\*/, '') });
    else if (['CharacterOff', 'SpriteOff', 'BgOff', 'StopBgm', 'StopSe', 'StopBgSe', 'StopBgVoice', 'FadeIn', 'FadeOut', 'Wait', 'WaitCustom', 'Tween', 'Shake', 'ZoomCamera', 'HideMessageWindow', 'ShowMessageWindow', 'EndScenario'].includes(command)) steps.push({ ...base, op: command });
    else unsupported.add(command);
  }
  return { version: 4, revision: createHash('sha256').update(JSON.stringify(steps)).digest('hex').slice(0, 20), width: 1280, height: 720, layers: Object.fromEntries((catalog.settings.Layer || []).map(row => [row.LayerName, Number(row.Order) || 0])), steps, resources: [...resources], unsupported: [...unsupported], unresolved: [...unresolved] };
}
