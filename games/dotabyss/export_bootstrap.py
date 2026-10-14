"""Read the encrypted public version configuration only; never inspect media."""
import base64
import json
import sys
import UnityPy

request = json.load(sys.stdin)
env = UnityPy.load(request['input'])
for obj in env.objects:
    if obj.type.name != 'TextAsset':
        continue
    data = obj.parse_as_dict()
    if data.get('m_Name') != 'production':
        continue
    raw = data['m_Script']
    if isinstance(raw, str):
        raw = raw.encode('utf8', errors='surrogateescape')
    if not raw or len(raw) > 1024 * 1024:
        raise ValueError('Public client configuration is invalid')
    print(json.dumps({'production': base64.b64encode(raw).decode('ascii')}))
    break
else:
    raise ValueError('Public client configuration is missing')
