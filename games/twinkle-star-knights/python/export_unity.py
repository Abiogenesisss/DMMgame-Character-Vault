"""Read cataloged Unity objects without executing the client or playing media."""
import hashlib
import io
import json
import pathlib
import re
import sys

import UnityPy
from images import sprite_image


def save(root, relative, data):
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Unsafe export path')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.read_bytes() != data:
        temporary = target.with_suffix(target.suffix + '.tmp')
        temporary.write_bytes(data)
        temporary.replace(target)
    return relative


def raw(value):
    return value.encode('utf8', errors='surrogateescape') if isinstance(value, str) else bytes(value)


def tables(grids):
    result = {}
    for grid in grids:
        rows = grid.get('rows', [])
        if not rows:
            continue
        header = rows[grid.get('headerRow', 0)].get('strings', [])
        result[grid['name'].split(':')[-1]] = [
            {key: row.get('strings', [])[i] if i < len(row.get('strings', [])) else '' for i, key in enumerate(header) if key}
            for row in rows[1:] if not row.get('isCommentOut') and not row.get('isEmpty')]
    return result


def image(root, obj):
    parsed = obj.parse_as_object()
    picture = sprite_image(parsed) if obj.type.name == 'Sprite' else parsed.image
    if picture.width * picture.height > 32 * 1024 * 1024:
        raise ValueError('Texture dimensions exceed limit')
    buffer = io.BytesIO()
    picture.save(buffer, format='PNG')
    data = buffer.getvalue()
    return {'file': save(root, 'images/' + hashlib.sha256(data).hexdigest() + '.png', data), 'width': picture.width, 'height': picture.height}


def export_spine(env, selected, request, root):
    objects = list(env.objects)
    def ref(owner, pointer):
        identifier = pointer.get('m_PathID', 0)
        if not identifier:
            raise ValueError('Missing Unity reference')
        if pointer.get('m_FileID', 0) == 0:
            return owner.assets_file.objects[identifier]
        matches = [o for o in objects if o.path_id == identifier]
        if len(matches) != 1:
            raise ValueError('Ambiguous external Unity reference')
        return matches[0]
    data = selected.parse_as_dict()
    skeleton = ref(selected, data['skeletonJSON']).parse_as_dict()
    name = skeleton['m_Name'].removesuffix('.skel')
    if not re.fullmatch(r'[A-Za-z0-9_ -]+', name):
        raise ValueError('Unsafe Spine name')
    folder = 'spine/' + request['fingerprint'] + '/' + name
    skeleton_file = save(root, folder + '/' + name + '.skel', raw(skeleton['m_Script']))
    atlases = data.get('atlasAssets', [])
    if len(atlases) != 1:
        raise ValueError('Expected one Spine atlas')
    atlas_object = ref(selected, atlases[0])
    atlas_data = atlas_object.parse_as_dict()
    atlas_text = raw(ref(atlas_object, atlas_data['atlasFile']).parse_as_dict()['m_Script']).decode('utf8')
    textures = {o.peek_name(): o for o in objects if o.type.name == 'Texture2D'}
    lines = atlas_text.replace('\r\n', '\n').splitlines()
    pages = [line.strip() for i, line in enumerate(lines) if line.strip() and (i == 0 or not lines[i - 1].strip()) and ':' not in line]
    files = [skeleton_file]
    for page in pages:
        if not re.fullmatch(r'[A-Za-z0-9_. -]+', page) or '..' in page or not page.lower().endswith('.png'):
            raise ValueError('Unsafe atlas page')
        texture = textures.get(pathlib.Path(page).stem)
        if texture is None:
            raise ValueError('Missing atlas texture: ' + page)
        picture = texture.parse_as_object().image
        if picture.width * picture.height > 32 * 1024 * 1024:
            raise ValueError('Texture dimensions exceed limit')
        buffer = io.BytesIO()
        picture.save(buffer, format='PNG')
        files.append(save(root, folder + '/' + page, buffer.getvalue()))
    # Alpha encoding belongs to each atlas page. Unity material defaults can
    # disagree with the packed image (including white RGB in transparent texels).
    # Preserve explicit pma flags and the format's straight-alpha default.
    files.append(save(root, folder + '/' + name + '.atlas', ('\n'.join(lines) + '\n').encode('utf8')))
    return {'model': {'file': skeleton_file, 'files': files, 'scale': data.get('scale', .01), 'fit': 'bounds'}}


def main(request):
    output = pathlib.Path(request['output']).resolve()
    if request['command'] == 'ui':
        from story_ui import export_ui
        return export_ui(UnityPy.load(*request['files']), output, save)
    if request['command'] == 'catalog':
        env = UnityPy.load(request['file'])
        texts = [o for o in env.objects if o.type.name == 'TextAsset']
        if len(texts) != 1:
            raise ValueError('Expected one catalog TextAsset')
        data = raw(texts[0].parse_as_dict()['m_Script'])
        json.loads(data)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        return {'file': str(output)}
    if request['command'] == 'settings':
        env = UnityPy.load(*request['files'])
        obj = next(o for o in env.objects if o.type.name == 'MonoBehaviour' and o.peek_name() == 'Master.chapter')
        data = tables(obj.parse_as_dict()['settingList'])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
        return {'file': str(output)}
    results, current_key, env = [], None, None
    for item in request['requests']:
        try:
            key = tuple(item['files'])
            if key != current_key:
                env, current_key = UnityPy.load(*key), key
            matches = [obj for name, obj in env.container.items() if name.lower() == item['internalId'].lower() and obj.type.name == item['type'].split('.')[-1]]
            # Custom MonoBehaviours are exposed under their Unity base type.
            if not matches and item['kind'] in ('spine', 'story'):
                matches = [obj for name, obj in env.container.items() if name.lower() == item['internalId'].lower() and obj.type.name == 'MonoBehaviour']
            if len(matches) != 1:
                raise ValueError('Catalog object missing or ambiguous')
            obj = matches[0].deref() if hasattr(matches[0], 'deref') else matches[0]
            if item['kind'] == 'spine':
                result = export_spine(env, obj, item, output)
            elif item['kind'] == 'effect':
                from effects import export_effect
                result = export_effect(env, obj, item, output, save, image)
            elif item['kind'] == 'image':
                result = {'image': image(output, obj)}
            elif item['kind'] == 'audio':
                samples = list(obj.parse_as_object().samples.items())
                if len(samples) != 1:
                    raise ValueError('Expected one audio clip')
                name, data = samples[0]
                suffix = pathlib.Path(name).suffix.lower()
                if suffix not in ('.wav', '.ogg', '.mp3', '.m4a'):
                    raise ValueError('Unsupported audio format')
                result = {'audio': {'file': save(output, 'audio/' + hashlib.sha256(data).hexdigest() + suffix, data)}}
            elif item['kind'] == 'story':
                name = pathlib.PurePosixPath(item['internalId']).stem.removesuffix('.chapter')
                book = next(o for o in env.objects if o.type.name == 'MonoBehaviour' and o.peek_name() == 'CharaScenario' + name + '.book')
                data = tables(book.parse_as_dict()['importGridList'])
                result = {'script': save(output, 'scripts/' + name + '.json', json.dumps(data, ensure_ascii=False).encode('utf8'))}
            else:
                raise ValueError('Unsupported export kind')
            results.append({'id': item['id'], **result})
        except Exception as error:
            results.append({'id': item['id'], 'error': str(error)})
    return results


if __name__ == '__main__':
    print(json.dumps(main(json.load(sys.stdin)), ensure_ascii=False))
