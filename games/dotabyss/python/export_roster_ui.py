"""Export the original character card artwork and layout for the local roster."""
import json
import sys
import UnityPy
from export_unity import graph
from export_window_ui import WindowExporter


def main():
    request = json.load(sys.stdin)
    spec = request['prefab']
    env = UnityPy.load(*spec['inputs'])
    root = next(value.deref() for key, value in env.container.items() if key == spec['internalId'])
    prefix = 'Waiting/Button/RootUI/'
    leaves = [prefix + suffix for suffix in ['Fixed/Deco', 'Fixed/Sort/Text',
              'Fade/Base/Bg_CharaThumbnail_M', 'Fade/Base/SpriteCharaIcon', 'Fade/Base/Frame/R']]
    paths = {''}
    for leaf in leaves:
        parts = leaf.split('/')
        paths.update('/'.join(parts[:n]) for n in range(1, len(parts) + 1))
    writer = WindowExporter(request['output'], {})
    rows = writer.tree(root, paths)
    for row in rows:
        row['active'] = True
        if row.get('text'):
            row['text']['value'] = ''
    result = {'version': 1, 'size': rows[0]['size'], 'rows': rows,
              'namePath': prefix + 'Fixed/Sort/Text', 'iconPath': prefix + 'Fade/Base/SpriteCharaIcon',
              'source': spec['address']}
    top_spec = request['scene']
    top_env = UnityPy.load(*top_spec['inputs'])
    top = next(value.deref() for key, value in top_env.container.items() if key == top_spec['internalId'])
    favorite = next(obj for obj, name in graph(top) if name == 'List_Character/ButtonSet_Favorite/Button_Favorite/RootUI/Parts/Icom')
    result['favorite'] = writer.tree(favorite)[0]['image']['file']
    writer.save('native/roster.json', json.dumps(result, ensure_ascii=False).encode())
    print(json.dumps({'rows': len(rows), 'size': result['size'], 'fonts': list(writer.fonts)}))


if __name__ == '__main__':
    main()
