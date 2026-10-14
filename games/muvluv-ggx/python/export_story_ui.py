"""Export Muv-Luv's original scenario, settings and log prefabs without rendering media."""
import hashlib
import json
import pathlib
import os
import sys
import warnings

from window_export import WindowExporter, ref, components, graph, transform
import UnityPy
from UnityPy.exceptions import UnityVersionFallbackWarning
from PIL import Image

UnityPy.config.FALLBACK_UNITY_VERSION = os.environ.get('MUVLUV_UNITY_VERSION', '6000.0.0f1')
warnings.filterwarnings('ignore', category=UnityVersionFallbackWarning)


class Exporter(WindowExporter):
    def font(self, obj):
        name = obj.peek_name()
        if name in self.fonts:
            return name
        data = self.read(obj)
        if not data.get('m_GlyphTable'):
            return None
        glyphs = {g['m_Index']: g for g in data['m_GlyphTable']}
        pages = []
        used_pages = max(g.get('m_AtlasIndex', 0) for g in glyphs.values()) + 1
        for pointer in data['m_AtlasTextures'][:used_pages]:
            atlas = ref(obj, pointer).parse_as_object().image.convert('RGBA')
            alpha = atlas.getchannel('A')
            def contour(center):
                image = Image.new('RGBA', atlas.size, (255, 255, 255, 0))
                image.putalpha(alpha.point(lambda value: max(0, min(255, round((value - center + 8) * 255 / 16)))))
                return image
            pages.append({'width': atlas.width, 'height': atlas.height, 'fill': self.png(contour(128), 'font'), 'outline': self.png(contour(99), 'font-outline')})
        face = data['m_FaceInfo']
        font = {'name': name, 'size': face['m_PointSize'], 'ascent': face['m_AscentLine'], 'descent': face['m_DescentLine'],
                'lineHeight': face['m_LineHeight'], 'padding': data['m_AtlasPadding'], **pages[0], 'pages': pages, 'glyphs': {}}
        for ch in data['m_CharacterTable']:
            glyph = glyphs[ch['m_GlyphIndex']]
            rect, metrics = glyph['m_GlyphRect'], glyph['m_Metrics']
            font['glyphs'][str(ch['m_Unicode'])] = [rect['m_X'], rect['m_Y'], rect['m_Width'], rect['m_Height'],
                                                  metrics['m_HorizontalBearingX'], metrics['m_HorizontalBearingY'], metrics['m_HorizontalAdvance'], glyph.get('m_AtlasIndex', 0)]
        self.fonts[name] = font
        return name

    def tree(self, game, paths=None):
        rows = super().tree(game, paths)
        objects = iter((obj, relative) for obj, relative in graph(game) if 'm_AnchorMin' in transform(obj).parse_as_dict())
        for row, (obj, _) in zip(rows, objects):
            for comp in components(obj):
                if comp.type.name == 'CanvasGroup':
                    row['opacity'] = comp.parse_as_dict()['m_Alpha']
                elif comp.type.name == 'MonoBehaviour':
                    data = comp.parse_as_dict()
                    if 'm_HorizontalFit' in data:
                        row['fit'] = [data['m_HorizontalFit'], data['m_VerticalFit']]
                    if 'm_ReverseArrangement' in data and row.get('layout'):
                        row['layout']['reverse'] = bool(data['m_ReverseArrangement'])
            if row['name'] == 'HoverImage':
                row['active'] = False
        rows[0]['active'] = True
        rows[0]['opacity'] = 1
        return rows


def main():
    request = json.load(sys.stdin)
    writer = Exporter(pathlib.Path(request['output']) / 'story-ui/muvluv', {})
    result = {'version': 1, 'game': 'muvluv-ggx', 'frame': {'width': 1920, 'height': 1080}, 'views': {}, 'fonts': {}}
    for item in request['assets']:
        name = item['address'].split('/')[-1]
        if name not in ['Scenario', 'SystemSettingWindow', 'TextModalWindow']:
            continue
        env = UnityPy.load(*item['inputs'])
        root = next(pointer.deref() for key, pointer in env.container.items() if key == item['internalId'])
        if name == 'Scenario':
            ui = next(obj for obj, relative in graph(root) if relative == 'UI')
            result['views']['menu'] = writer.tree(ui)
            scroll = next(obj for obj, relative in graph(root) if relative == 'UI/History/HistoryScrollView Variant')
            controller = next(comp for comp in components(scroll) if comp.type.name == 'MonoBehaviour' and 'prefab' in comp.parse_as_dict())
            prefab = ref(controller, controller.parse_as_dict()['prefab'])
            if prefab.type.name != 'GameObject':
                prefab = ref(prefab, prefab.parse_as_dict()['m_GameObject'])
            result['views']['logRow'] = writer.tree(prefab)
        else:
            result['views']['options' if name == 'SystemSettingWindow' else 'confirm'] = writer.tree(root)
    if not all(key in result['views'] for key in ['menu', 'options', 'confirm', 'logRow']):
        raise ValueError('Original scenario UI is incomplete')
    for name, font in writer.fonts.items():
        result['fonts'][name] = writer.save('native/font-' + hashlib.sha256(name.encode()).hexdigest()[:12] + '.json', json.dumps(font, ensure_ascii=False).encode())
    writer.save('native/window.json', json.dumps(result, ensure_ascii=False).encode())
    print(json.dumps({'views': {name: len(rows) for name, rows in result['views'].items()}, 'fonts': len(writer.fonts)}))


if __name__ == '__main__':
    main()
