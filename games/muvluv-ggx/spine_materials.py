"""The Spine Unity shader's blend state describes OUTPUT, not texture storage."""


def texture_is_pma(material, shader):
    floats = dict(material.get('m_SavedProperties', {}).get('m_Floats', []))
    keywords = list(material.get('m_ValidKeywords', []))
    keywords += material.get('m_ShaderKeywords', '').split()
    if '_STRAIGHT_ALPHA_INPUT' in keywords or floats.get('_StraightAlphaInput', 0) > 0.5:
        return False
    state = shader['m_SubShaders'][0]['m_Passes'][0]['m_State']['rtBlend0']
    return state['srcBlend']['val'] == 1 and state['destBlend']['val'] == 10


def atlas_material_modes(objects):
    by_id = {obj.path_id: obj for obj in objects}
    modes = {}
    for obj in objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        data = obj.parse_as_dict()
        atlas = data.get('atlasFile', {}).get('m_PathID')
        if not atlas or not data.get('materials'):
            continue
        pages = []
        for pointer in data['materials']:
            material = by_id[pointer['m_PathID']].parse_as_dict()
            shader = by_id[material['m_Shader']['m_PathID']].parse_as_dict()['m_ParsedForm']
            pages.append({'pma': texture_is_pma(material, shader), 'mosaic': 'Mosaic' in shader['m_Name']})
        if len({page['pma'] for page in pages}) != 1:
            raise ValueError('Spine atlas mixes incompatible texture alpha modes')
        modes[atlas] = {'pma': pages[0]['pma'], 'mosaic': any(page['mosaic'] for page in pages)}
    return modes
