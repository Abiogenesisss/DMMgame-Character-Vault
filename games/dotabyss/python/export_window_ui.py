"""Extract the story UI once from downloaded game bundles and public client data."""
import hashlib
import io
import json
import math
import pathlib
import sys

import UnityPy
from PIL import Image, ImageChops
from export_unity import ref, components, transform, graph, helpers
from ui_export import ui_sprite_image, export_ui


class WindowExporter:
    def __init__(self, output, templates):
        self.output = pathlib.Path(output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.templates = templates
        self.fonts = {}

    def read(self, obj):
        try:
            return obj.parse_as_dict()
        except ValueError:
            data = obj.read_typetree(check_read=False)
            kind = ref(obj, data['m_Script']).parse_as_dict()['m_ClassName']
            if kind in self.templates:
                return obj.read_typetree(nodes=self.templates[kind])
            return data

    def save(self, name, data):
        target = self.output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return 'story-ui/dotabyss/' + name

    def png(self, image, prefix='image'):
        stream = io.BytesIO()
        image.save(stream, format='PNG')
        raw = stream.getvalue()
        return self.save('native/' + prefix + '-' + hashlib.sha256(raw).hexdigest()[:20] + '.png', raw)

    def font(self, obj):
        name = obj.peek_name()
        if name in self.fonts:
            return name
        data = self.read(obj)
        if not data.get('m_GlyphTable'):
            return None
        glyphs = {g['m_Index']: g for g in data['m_GlyphTable']}
        atlas = ref(obj, data['m_AtlasTextures'][0]).parse_as_object().image.convert('RGBA')
        alpha = atlas.getchannel('A')
        # Rasterize the original SDF contours. No replacement system font is
        # used for the Japanese UI or dialogue glyphs present in this atlas.
        def contour(center):
            mask = alpha.point(lambda value: max(0, min(255, round((value - center + 8) * 255 / 16))))
            result = Image.new('RGBA', atlas.size, (255, 255, 255, 0))
            result.putalpha(mask)
            return result
        face = data['m_FaceInfo']
        font = {'name': name, 'size': face['m_PointSize'], 'ascent': face['m_AscentLine'], 'descent': face['m_DescentLine'],
                'lineHeight': face['m_LineHeight'], 'padding': data['m_AtlasPadding'], 'width': atlas.width, 'height': atlas.height,
                'fill': self.png(contour(128), 'font'), 'outline': self.png(contour(99), 'font-outline'), 'glyphs': {}}
        for ch in data['m_CharacterTable']:
            glyph = glyphs[ch['m_GlyphIndex']]
            if glyph.get('m_AtlasIndex', 0) != 0:
                raise ValueError('Multi-atlas UI font requires export support')
            rect, metrics = glyph['m_GlyphRect'], glyph['m_Metrics']
            font['glyphs'][str(ch['m_Unicode'])] = [rect['m_X'], rect['m_Y'], rect['m_Width'], rect['m_Height'],
                                                  metrics['m_HorizontalBearingX'], metrics['m_HorizontalBearingY'], metrics['m_HorizontalAdvance']]
        self.fonts[name] = font
        return name

    def tree(self, game, paths=None):
        rows = []
        for obj, relative in graph(game):
            if paths is not None and relative not in paths:
                continue
            trans = transform(obj).parse_as_dict()
            if 'm_AnchorMin' not in trans:
                continue
            rot = trans['m_LocalRotation']
            row = {'path': relative, 'name': obj.peek_name(), 'active': bool(obj.parse_as_dict()['m_IsActive']),
                   'anchor': [trans['m_AnchorMin']['x'], trans['m_AnchorMin']['y'], trans['m_AnchorMax']['x'], trans['m_AnchorMax']['y']],
                   'pivot': [trans['m_Pivot']['x'], trans['m_Pivot']['y']],
                   'position': [trans['m_AnchoredPosition']['x'], trans['m_AnchoredPosition']['y']],
                   'size': [trans['m_SizeDelta']['x'], trans['m_SizeDelta']['y']],
                   'scale': [trans['m_LocalScale']['x'], trans['m_LocalScale']['y']],
                   'rotation': -math.degrees(2 * math.atan2(rot['z'], rot['w'])), 'classes': []}
            for component in components(obj):
                if component.type.name != 'MonoBehaviour':
                    continue
                props = self.read(component)
                kind = ref(component, props['m_Script']).parse_as_dict()['m_ClassName']
                row['classes'].append(kind)
                if kind in ['HorizontalLayoutGroup', 'VerticalLayoutGroup'] and 'm_Spacing' in props:
                    row['layout'] = {'axis': 'x' if kind.startswith('Horizontal') else 'y', 'spacing': props['m_Spacing'],
                                     'padding': props['m_Padding'], 'alignment': props['m_ChildAlignment'],
                                     'controlWidth': props.get('m_ChildControlWidth'), 'controlHeight': props.get('m_ChildControlHeight')}
                if kind == 'LayoutElement':
                    row['layoutSize'] = {k: props[k] for k in ['m_PreferredWidth', 'm_PreferredHeight', 'm_IgnoreLayout'] if k in props}
                if kind in ['RectMask2D', 'Mask']:
                    row['clip'] = True
                if props.get('m_Sprite', {}).get('m_PathID'):
                    sprite = ref(component, props['m_Sprite']).parse_as_object()
                    image = ui_sprite_image(sprite).convert('RGBA')
                    tint = props.get('m_Color', {'r': 1, 'g': 1, 'b': 1, 'a': 1})
                    rgba = tuple(round(255 * tint[k]) for k in ['r', 'g', 'b']) + (255,)
                    if rgba != (255, 255, 255, 255):
                        image = ImageChops.multiply(image, Image.new('RGBA', image.size, rgba))
                    row['image'] = {'file': self.png(image), 'name': sprite.m_Name, 'width': image.width, 'height': image.height,
                                    'sliced': props.get('m_Type') == 1,
                                    'border': [sprite.m_Border.w, sprite.m_Border.z, sprite.m_Border.y, sprite.m_Border.x],
                                    'preserveAspect': bool(props.get('m_PreserveAspect')), 'opacity': tint['a']}
                if 'm_fontSize' in props:
                    font = self.font(ref(component, props['m_fontAsset'])) if props.get('m_fontAsset', {}).get('m_PathID') else None
                    material_pointer = props.get('m_sharedMaterial', {})
                    outline = 0
                    color = props.get('m_fontColor', {'r': 1, 'g': 1, 'b': 1, 'a': 1})
                    if material_pointer.get('m_PathID'):
                        material = ref(component, material_pointer).parse_as_dict()
                        outline = dict(material['m_SavedProperties']['m_Floats']).get('_OutlineWidth', 0)
                        # TMP multiplies vertex tint by the material face tint.
                        # Log bubbles use white vertices with a dark-blue face.
                        face_color = dict(material['m_SavedProperties']['m_Colors']).get('_FaceColor', {'r': 1, 'g': 1, 'b': 1, 'a': 1})
                        color = {channel: color[channel] * face_color[channel] for channel in 'rgba'}
                    row['text'] = {'value': props.get('m_text', ''), 'font': font, 'size': props['m_fontSize'],
                                   'color': color,
                                   'horizontal': props.get('m_HorizontalAlignment', 1), 'vertical': props.get('m_VerticalAlignment', 512),
                                   'spacing': props.get('m_characterSpacing', 0), 'outline': outline}
            rows.append(row)
        return rows

    def click(self, player):
        selected = next(obj for obj in player.objects if obj.type.name == 'GameObject' and obj.peek_name() == 'TouchEffect' and obj.path_id == 6617)
        layers = []
        for game, _ in graph(selected):
            items = components(game)
            particles = next((obj for obj in items if obj.type.name == 'ParticleSystem'), None)
            if not particles:
                continue
            data = particles.parse_as_dict()
            renderer = next(obj for obj in items if obj.type.name == 'ParticleSystemRenderer')
            material = ref(renderer, renderer.parse_as_dict()['m_Materials'][0])
            props = material.parse_as_dict()['m_SavedProperties']
            textures = dict(props['m_TexEnvs'])
            tex = textures.get('_MainTex') or textures.get('_BaseMap')
            texture = ref(material, tex['m_Texture']).parse_as_object().image
            trans = transform(game).parse_as_dict()
            initial = data['InitialModule']
            layers.append({'name': game.peek_name(), 'file': self.png(texture, 'click'), 'delay': data['startDelay']['scalar'],
                           'lifetime': initial['startLifetime']['scalar'], 'size': initial['startSize']['scalar'],
                           'scale': trans['m_LocalScale']['x'], 'rotation': initial['startRotation']['scalar'],
                           'count': int(data['EmissionModule']['m_Bursts'][0]['countCurve']['scalar']),
                           'sizeCurve': data['SizeModule']['curve'], 'color': initial['startColor']['maxGradient'],
                           'fade': data['ColorModule']['gradient']['maxGradient'], 'shape': data['ShapeModule'],
                           'velocity': data['VelocityModule']})
        return {'duration': max(layer['delay'] + layer['lifetime'] for layer in layers), 'pixelsPerUnit': 108, 'layers': layers}


def main():
    request = json.load(sys.stdin)
    scene = UnityPy.load(*request['scene'])
    prefabs = [(item, UnityPy.load(*item['inputs'])) for item in request['prefabs']]
    templates = {}
    for env in [scene, *[env for _, env in prefabs]]:
        for obj in env.objects:
            if obj.type.name != 'MonoBehaviour':
                continue
            props = obj.parse_as_dict()
            if len(props) > 4:
                templates[ref(obj, props['m_Script']).parse_as_dict()['m_ClassName']] = obj.serialized_type.node
    output = pathlib.Path(request['output'])
    ui_root = output / 'story-ui/dotabyss'
    writer = WindowExporter(ui_root, templates)
    export_ui(scene, output, helpers, ref, components, transform)
    theme_file = ui_root / 'theme.json'
    theme = json.loads(theme_file.read_text(encoding='utf8'))
    # Keep every generated dependency under the UI cache, separate from CG.
    for part in ['normal', 'adult', 'marker']:
        source = output / theme[part]['file']
        name = 'native/' + source.name
        theme[part]['file'] = writer.save(name, source.read_bytes())
    theme['native'] = 'story-ui/dotabyss/native/window.json'
    theme_file.write_text(json.dumps(theme, ensure_ascii=False), encoding='utf8')
    result = {'version': 1, 'frame': {'width': 1920, 'height': 1080}, 'views': {}, 'fonts': {}}
    for name, key in [('MenuArea', 'menu'), ('MessageArea', 'message')]:
        root = next(obj for obj in scene.objects if obj.type.name == 'GameObject' and obj.peek_name() == name)
        result['views'][key] = writer.tree(root)
    # Story backgrounds retain this larger Image rectangle when panned by the
    # script. Fitting it to the viewport first discards the authored overscan.
    background = next(obj for obj in scene.objects if obj.type.name == 'GameObject' and obj.peek_name() == 'BgCanvas')
    view = next(comp for comp in components(background) if comp.type.name == 'MonoBehaviour' and '_imageBG' in writer.read(comp))
    image = ref(view, writer.read(view)['_imageBG'])
    rect = transform(ref(image, writer.read(image)['m_GameObject'])).parse_as_dict()
    result['background'] = {'size': [rect['m_SizeDelta']['x'], rect['m_SizeDelta']['y']]}
    title = next(obj for obj in scene.objects if obj.type.name == 'GameObject' and obj.peek_name() == 'NovelTitle')
    title_text = next(obj for obj, name in graph(title) if name == 'Text')
    size = transform(title).parse_as_dict()['m_SizeDelta']
    result['title'] = {'size': [size['x'], size['y']], 'text': writer.tree(title_text)[0]['text']}
    # NovelViewMessageWindow opens this bottom-anchored panel at y=0; the
    # serialized scene retains its hidden, off-screen y=-540 position.
    result['views']['message'][0]['position'][1] = 0
    for spec, env in prefabs:
        root = next(value.deref() for key, value in env.container.items() if key == spec['internalId'])
        result['views'][root.peek_name()] = writer.tree(root)
    player = UnityPy.load(request['player'])
    options = next(obj for obj in player.objects if obj.type.name == 'GameObject' and obj.peek_name() == 'Popup_Option')
    result['views']['options'] = writer.tree(options)
    result['click'] = writer.click(player)
    for key, value in writer.fonts.items():
        file = writer.save('native/font-' + hashlib.sha256(key.encode()).hexdigest()[:12] + '.json', json.dumps(value, ensure_ascii=False).encode())
        result['fonts'][key] = file
    writer.save('native/window.json', json.dumps(result, ensure_ascii=False).encode())
    print(json.dumps({'views': {name: len(rows) for name, rows in result['views'].items()}, 'fonts': len(writer.fonts), 'clickLayers': len(result['click']['layers'])}))


if __name__ == '__main__':
    main()
