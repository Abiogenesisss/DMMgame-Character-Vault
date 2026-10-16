"""Decode captured GC Movie/USM containers and transcode without playing them."""
import hashlib
import pathlib
import re
import subprocess
import tempfile


def movie_bytes(data, name):
    if data.startswith(b'CRID'):
        return data
    if not data.startswith(b'GC Movie') or len(data) < 12:
        raise ValueError('Unrecognized GC movie container')
    count = int.from_bytes(data[8:12], 'little')
    if count > len(data) - 12 or count > 1024 * 1024:
        raise ValueError('GC movie header exceeds its container')
    body = bytearray(data[12:])
    if body.startswith(b'CRID'):
        return bytes(body)
    # MovieCrypt uses the TextAsset name, UTF-8 byte sum, Unity's xorshift128,
    # and Random.Range(0, 255). Only the header span is transformed.
    state = [sum(name.encode('utf8'))]
    for _ in range(3):
        state.append((1812433253 * state[-1] + 1) & 0xffffffff)
    for i in range(count):
        t = state[0] ^ ((state[0] << 11) & 0xffffffff)
        value = (state[3] ^ (state[3] >> 19) ^ t ^ (t >> 8)) & 0xffffffff
        state = state[1:] + [value]
        body[i] ^= value % 255
    if not body.startswith(b'CRID'):
        raise ValueError('GC movie identity/header verification failed')
    return bytes(body)


def video_stream(data):
    """Keep the authored MPEG frames, excluding USM tables and end markers."""
    at, parts = 0, []
    while at < len(data):
        if at + 32 > len(data):
            raise ValueError('Truncated USM chunk')
        tag = data[at:at + 4]
        size = int.from_bytes(data[at + 4:at + 8], 'big') + 8
        offset = data[at + 9] + 8
        padding = int.from_bytes(data[at + 10:at + 12], 'big')
        if size < 32 or at + size > len(data) or offset < 32 or offset > size - padding:
            raise ValueError('USM chunk exceeds its container')
        if tag == b'@SFV' and data[at + 15] == 0:
            if data[at + 12] != 0:
                raise ValueError('Multiple USM video channels are not supported')
            parts.append(data[at + offset:at + size - padding])
        at += size
    stream = b''.join(parts)
    if not stream.startswith(b'\x00\x00\x01\xb3') or len(stream) < 8:
        raise ValueError('Unsupported USM video codec')
    width = (stream[4] << 4) | (stream[5] >> 4)
    height = ((stream[5] & 15) << 8) | stream[6]
    rate = {1: 24000 / 1001, 2: 24, 3: 25, 4: 30000 / 1001, 5: 30, 6: 50, 7: 60000 / 1001, 8: 60}.get(stream[7] & 15)
    frames = stream.count(b'\x00\x00\x01\x00')
    if not rate or not width or not height or width * height > 4096 * 4096 or not frames:
        raise ValueError('Invalid USM video dimensions or frame rate')
    return stream, {'width': width, 'height': height, 'frames': frames, 'duration': frames / rate}


def export_movies(texts, item, root, raw):
    import imageio_ffmpeg
    chapter = re.fullmatch(r'h[ms]r_(\d{8})_image', pathlib.PurePosixPath(item['name']).stem)
    if not chapter:
        raise ValueError('Invalid movie bundle identity')
    movies = []
    for name, asset in sorted(texts.items()):
        match = re.fullmatch(r'(e[sm]m_' + chapter[1] + r'_\d+)\.usm', name)
        if not match:
            continue
        content = raw(asset['m_Script'])
        stream, metadata = video_stream(movie_bytes(content, name))
        file = 'videos/gc-v1-' + hashlib.sha256(content).hexdigest() + '.mp4'
        target = root / file
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            with tempfile.TemporaryDirectory(prefix='girlscreation-movie-') as folder:
                source = pathlib.Path(folder) / 'clip.m1v'
                output = pathlib.Path(folder) / 'clip.mp4'
                source.write_bytes(stream)
                result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-hide_banner', '-loglevel', 'error',
                                         '-f', 'mpegvideo', '-i', str(source), '-map', '0:v:0', '-an', '-c:v', 'libx264',
                                         '-threads', '2', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
                                         '-movflags', '+faststart', str(output)], capture_output=True, timeout=180,
                                        creationflags=0x08000000 if __import__('os').name == 'nt' else 0)
                if result.returncode or not output.exists() or output.stat().st_size < 48:
                    raise ValueError('Offline movie conversion failed')
                staged = target.with_suffix('.mp4.tmp')
                staged.write_bytes(output.read_bytes())
                staged.replace(target)
        movies.append({'name': match[1], 'file': file, **metadata})
    if not movies:
        raise ValueError('Movie bundle contains no matching clips')
    return {'movies': movies, 'exportVersion': 1}
