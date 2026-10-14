"""Export Muv-Luv UI trees, sprites and font geometry."""
import hashlib
import io
import math
import pathlib

from PIL import Image, ImageChops
from unity_graph import ref, components, transform, graph
from ui_export import ui_sprite_image


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
        return 'story-ui/muvluv/' + name

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
