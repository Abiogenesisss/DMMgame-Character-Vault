export const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const item = document.createElement(tag); if (className) item.className = className;
  if (text != null) item.textContent = text; return item;
};
export function place(item: HTMLElement, row) {
  for (const [property, value] of Object.entries({ left: row.x || 0, top: row.y || 0, width: row.w, height: row.h })) {
    item.style[property] = `calc(${value} * var(--flower-unit))`;
  }
}
export class NativeView {
  nodes = new Map<string, HTMLElement>();
  events = new AbortController();
  constructor(public host: HTMLElement, public rows: any[], theme, asset) {
    for (const row of rows) {
      const item = node(row.kind === 'button' ? 'button' : 'div', 'flower-native-node');
      item.dataset.nativeName = row.name; place(item, row);
      if (row.kind === 'button') { (item as HTMLButtonElement).type = 'button'; (item as HTMLButtonElement).disabled = true; item.classList.add('flower-native-button'); }
      if (row.kind === 'text') {
        item.classList.add('flower-native-text'); item.style.fontSize = `calc(${row.size} * var(--flower-unit))`;
        item.style.color = '#' + (row.color || 0).toString(16).padStart(6, '0');
      }
      for (const [key, property] of [['texture', '--flower-sprite'], ['textureon', '--flower-sprite-active']]) {
        if (row[key]) item.style.setProperty(property, `url("${asset(theme.sprites[row[key]])}")`);
      }
      item.hidden = !!row.hidden; this.nodes.set(row.name, item); host.append(item);
    }
  }
  get(name: string) { return this.nodes.get(name); }
  bind(name: string, label: string, action: () => void) {
    const button = this.get(name) as HTMLButtonElement;
    if (!button) throw new Error('花骑士界面控件缺失：' + name);
    button.disabled = false; button.setAttribute('aria-label', label); button.title = label;
    button.addEventListener('click', event => { event.stopPropagation(); action(); }, { signal: this.events.signal });
    return button;
  }
  active(name: string, value: boolean) { const item = this.get(name); item.dataset.active = String(value); item.setAttribute('aria-pressed', String(value)); }
  destroy() { this.events.abort(); this.host.replaceChildren(); this.nodes.clear(); }
}
