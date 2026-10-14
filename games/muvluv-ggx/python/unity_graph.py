from UnityPy.classes.PPtr import PPtr

def ref(owner, value):
    return PPtr(m_FileID=value['m_FileID'], m_PathID=value['m_PathID'], assetsfile=owner.assets_file).deref()


def components(game):
    return [ref(game, value['component']) for value in game.parse_as_dict()['m_Component']]


def transform(game):
    return next(item for item in components(game) if item.type.name in ['Transform', 'RectTransform'])


def graph(game):
    result = []
    def walk(item, path, depth=0):
        if depth > 64 or len(result) > 10000:
            raise ValueError('Prefab hierarchy exceeds limit')
        result.append((item, path))
        trans = transform(item)
        for pointer in trans.parse_as_dict()['m_Children']:
            child_transform = ref(trans, pointer)
            child = ref(child_transform, child_transform.parse_as_dict()['m_GameObject'])
            name = child.parse_as_dict()['m_Name']
            walk(child, path + '/' + name if path else name, depth + 1)
    walk(game, '')
    return result
