import importlib.util
"""Export captured Unity resources without executing game scripts or playing media."""
import hashlib
import base64
import json
import pathlib
import re
import sys
import UnityPy

helper_spec = importlib.util.spec_from_file_location('local_unity_assets', pathlib.Path(__file__).with_name('unity_assets.py'))
helpers = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helpers)
from atlas_metadata import mark_pma
from movie import export_movies


def raw(value):
    return value.encode('utf8', 'surrogateescape') if isinstance(value, str) else value


def export(item, root):
    env = UnityPy.load(item['input'])
    objects = list(env.objects)
    texts = {o.peek_name(): o.parse_as_dict() for o in objects if o.type.name == 'TextAsset'}
    if item['kind'] == 'config':
        return {'config': base64.b64encode(raw(texts['BaseSystemConfig']['m_Script'])).decode('ascii')}
    if item['kind'] == 'master':
        return {'tables': {name: raw(texts[name]['m_Script']).decode('utf8') for name in item['tables']}}
    if item['kind'] == 'movies':
        return export_movies(texts, item, root, raw)
    if item['kind'] == 'model':
        stem = pathlib.PurePosixPath(item['name']).stem
        if not re.fullmatch(r'st\d{7}', stem):
            raise ValueError('Invalid stand name')
        skeleton, atlas = raw(texts[stem + '.skel']['m_Script']), raw(texts[stem + '.atlas']['m_Script']).decode('utf8')
        behaviours = [o.parse_as_dict() for o in objects if o.type.name == 'MonoBehaviour']
        skeleton_data = next(d for d in behaviours if d.get('m_Name') == stem + '_SkeletonData')
        renderer = next(d for d in behaviours if 'skeletonDataAsset' in d and 'initialSkinName' in d)
        transforms = {o.path_id: o.parse_as_dict() for o in objects if o.type.name in ('Transform', 'RectTransform')}
        transform = next(d for d in transforms.values() if d['m_GameObject'] == renderer['m_GameObject'])
        sx = sy = float(skeleton_data['scale'])
        # SkeletonData's 0.01 and the prefab's 80x transform both affect the
        # actual scene. The CSV multiplier alone is not the on-screen scale.
        visited = set()
        while transform:
            sx *= transform['m_LocalScale']['x']
            sy *= transform['m_LocalScale']['y']
            parent = transform['m_Father']['m_PathID']
            if parent in visited:
                raise ValueError('Cyclic standing transform')
            visited.add(parent)
            transform = transforms.get(parent)
        if not (0 < abs(sx) < 10 and 0 < abs(sy) < 10):
            raise ValueError('Invalid standing scale')
        material = next(o.parse_as_dict() for o in objects if o.type.name == 'Material' and o.peek_name() == stem + '_Material')
        floats = dict(material.get('m_SavedProperties', {}).get('m_Floats', []))
        if '_StraightAlphaInput' not in floats:
            raise ValueError('Unrecognized stand texture alpha mode')
        atlas = mark_pma(atlas, floats['_StraightAlphaInput'] < 0.5)
        folder = 'spine/gc-v1-' + item['fingerprint']
        files = []
        textures = {o.peek_name(): o for o in objects if o.type.name == 'Texture2D'}
        for page in [line.strip() for line in atlas.splitlines() if line.strip().endswith('.png')]:
            if not re.fullmatch(r'[A-Za-z0-9_.-]+\.png', page):
                raise ValueError('Invalid atlas path')
            image = textures[pathlib.Path(page).stem].parse_as_object().image
            if image.width * image.height > 32 * 1024 * 1024:
                raise ValueError('Texture too large')
            target = root / folder / page
            target.parent.mkdir(parents=True, exist_ok=True)
            image.save(target, format='PNG')
            files.append(folder + '/' + page)
        file, atlas_file = folder + '/' + stem + '.skel', folder + '/' + stem + '.atlas'
        helpers.save_bytes(root, file, skeleton)
        helpers.save_bytes(root, atlas_file, atlas.encode('utf8'))
        return {'model': {'file': file, 'atlas': atlas_file, 'files': files + [file, atlas_file], 'exportVersion': 2, 'nativeScale': {'x': round(sx, 6), 'y': round(sy, 6)}, 'fit': 'bounds'}}
    if item['kind'] in ('script', 'bank'):
        suffix = '.acb' if item['kind'] == 'bank' else ''
        target = pathlib.PurePosixPath(item['name']).stem
        data = next((value for name, value in texts.items() if name == target + suffix or name == target), None)
        if data is None:
            raise ValueError('Text asset is missing')
        content = raw(data['m_Script'])
        if item['kind'] == 'script':
            content.decode('utf-8-sig')
        extension = '.acb' if item['kind'] == 'bank' else '.txt'
        folder = 'banks/' if item['kind'] == 'bank' else 'scripts/'
        file = helpers.save_bytes(root, folder + hashlib.sha256(content).hexdigest() + extension, content)
        return {item['kind']: {'file': file}}
    textures = [o for o in objects if o.type.name == 'Texture2D']
    if len(textures) != 1:
        raise ValueError('Expected one complete illustration or icon texture')
    if textures[0].peek_name() != pathlib.PurePosixPath(item['name']).stem:
        raise ValueError('Texture identity does not match its resource')
    image = textures[0].parse_as_object().image
    if image.width * image.height > 32 * 1024 * 1024:
        raise ValueError('Image too large')
    return {'image': helpers.image_file(root, image)}


def main():
    request = json.load(sys.stdin)
    root = pathlib.Path(request['output']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    result = {'resources': [], 'issues': []}
    for item in request['assets']:
        try:
            result['resources'].append({'name': item['name'], 'fingerprint': item['fingerprint'], **export(item, root)})
        except Exception as error:
            result['issues'].append({'resource': item['name'], 'error': str(error)[:180]})
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
