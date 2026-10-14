"""Convert bounded Unity Cubism parameter curves to portable motion3 data."""
import bisect
import math
import struct
import zlib


def streamed_curves(words, count):
    raw = struct.pack('<' + 'I' * len(words), *words)
    offset = 0
    curves = [[] for _ in range(count)]
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise ValueError('Incomplete streamed animation frame')
        time, keys = struct.unpack_from('<fi', raw, offset)
        offset += 8
        if keys < 0 or keys > count or offset + keys * 20 > len(raw):
            raise ValueError('Invalid streamed animation keys')
        for _ in range(keys):
            index, *coefficients = struct.unpack_from('<i4f', raw, offset)
            offset += 20
            if index < 0 or index >= count or not all(math.isfinite(value) for value in coefficients):
                raise ValueError('Invalid streamed animation curve')
            if time < 0:
                time_for_key = 0.0
            elif not math.isfinite(time) or time > 1e20:
                continue
            else:
                time_for_key = time
            curves[index].append((time_for_key, coefficients))
    return curves


def playback_curve(keys, rate, target):
    """Interpolate densely baked motion, retaining authored cuts and holds.

    Some DOTABYSS clips bake continuous movement as zero-slope step keys at
    the source frame rate. Keeping those steps on a faster display judders.
    Only dense, gradual, many-valued parameter curves qualify; opacity,
    sparse expression switches and genuine cubic curves retain their timing.
    """
    if target != 'Parameter' or not math.isfinite(rate) or rate <= 0:
        return keys
    sampled = [key for index, key in enumerate(keys) if index == len(keys) - 1 or key[0] != keys[index + 1][0]]
    if len(sampled) < 9 or any(any(coefficients[:3]) for _, coefficients in sampled):
        return keys
    values = [coefficients[3] for _, coefficients in sampled]
    if len(set(values)) < 8:
        return keys
    span = max(values) - min(values)
    dense = [abs((after[0] - before[0]) * rate - 1) < .05 for before, after in zip(sampled, sampled[1:])]
    if sum(dense) < .8 * len(dense) or any(abs(b - a) > span * .25 for a, b in zip(values, values[1:])):
        return keys
    result = []
    for index, (time, coefficients) in enumerate(sampled):
        if index < len(dense) and dense[index]:
            duration = sampled[index + 1][0] - time
            coefficients = [0.0, 0.0, (values[index + 1] - values[index]) / duration, values[index]]
        result.append((time, coefficients))
    return result


def motion3(data, targets, allow_partial=False):
    muscle = data.get('m_MuscleClip', {})
    clip = muscle.get('m_Clip', {}).get('data', {})
    streamed = clip.get('m_StreamedClip', {})
    dense = clip.get('m_DenseClip', {})
    constants = clip.get('m_ConstantClip', {}).get('data', [])
    bindings = data.get('m_ClipBindingConstant', {}).get('genericBindings', [])
    duration = muscle.get('m_StopTime', 0) - muscle.get('m_StartTime', 0)
    if not math.isfinite(duration) or duration <= 0 or duration > 600:
        raise ValueError('Invalid Cubism animation duration')
    stream_count = streamed.get('curveCount', 0)
    dense_count = dense.get('m_CurveCount', 0)
    if len(bindings) != stream_count + dense_count + len(constants) or len(bindings) > 2000:
        raise ValueError('Unsupported animation binding layout')
    curves = streamed_curves(streamed.get('data', []), stream_count)
    times = sorted(set([0.0, duration] + [min(duration, index / 30) for index in range(math.ceil(duration * 30))]
                       + [time for curve in curves for time, _ in curve if 0 <= time <= duration]))
    if len(times) * len(bindings) > 4000000:
        raise ValueError('Animation exceeds sample limit')
    output = []
    for index, binding in enumerate(bindings):
        target = targets.get(binding['path'])
        if target is None or target[0] == 'ModelOpacity' or binding.get('typeID') != 114 or binding.get('isPPtrCurve'):
            # Unity also ignores stale bindings to parameters removed from a rig.
            continue
        expected = zlib.crc32(b'Value' if target[0] == 'Parameter' else b'Opacity')
        if binding.get('attribute') != expected:
            continue
        if index < stream_count:
            keys = playback_curve(curves[index], data.get('m_SampleRate', 30), target[0])
            if not keys:
                raise ValueError('Streamed parameter has no keys')
            key_times = [time for time, _ in keys]
            def sample(time):
                at = max(0, bisect.bisect_right(key_times, time) - 1)
                start, coefficients = keys[at]
                delta = max(0.0, time - start)
                a, b, c, d = coefficients
                return ((a * delta + b) * delta + c) * delta + d
        elif index < stream_count + dense_count:
            channel = index - stream_count
            values = dense.get('m_SampleArray', [])
            frames, rate = dense.get('m_FrameCount', 0), dense.get('m_SampleRate', 0)
            if frames <= 0 or rate <= 0 or len(values) != frames * dense_count:
                raise ValueError('Invalid dense Cubism curve')
            def sample(time):
                frame = max(0, min(frames - 1, (time - dense.get('m_BeginTime', 0)) * rate))
                first = int(frame)
                a = values[first * dense_count + channel]
                b = values[min(first + 1, frames - 1) * dense_count + channel]
                return a + (b - a) * (frame - first)
        else:
            constant = constants[index - stream_count - dense_count]
            def sample(time):
                return constant
        values = [sample(time) for time in times]
        if not all(math.isfinite(value) for value in values):
            raise ValueError('Non-finite Cubism parameter')
        segments = [times[0], values[0]]
        for time, value in zip(times[1:], values[1:]):
            segments.extend([0, time, value])
        output.append({'Target': target[0], 'Id': target[1], 'Segments': segments})
    eligible = len(bindings) - sum(targets.get(binding['path'], (None,))[0] == 'ModelOpacity' for binding in bindings)
    if not output or not allow_partial and len(output) < eligible * 0.9:
        raise ValueError('Animation does not belong to this Cubism parameter rig')
    return {'Version': 3, 'Meta': {'Duration': duration, 'Fps': 30, 'Loop': bool(muscle.get('m_LoopTime')), 'FadeInTime': 0.0, 'FadeOutTime': 0.0,
            'AreBeziersRestricted': True, 'CurveCount': len(output), 'TotalSegmentCount': len(output) * (len(times) - 1),
            'TotalPointCount': len(output) * len(times), 'UserDataCount': 0, 'TotalUserDataSize': 0}, 'Curves': output, 'UserData': []}


def native_motion(data, targets, allow_partial=False):
    """Retain cubic curves and dense samples, interpolating baked step motion."""
    muscle = data.get('m_MuscleClip', {})
    clip = muscle.get('m_Clip', {}).get('data', {})
    streamed, dense = clip.get('m_StreamedClip', {}), clip.get('m_DenseClip', {})
    constants = clip.get('m_ConstantClip', {}).get('data', [])
    bindings = data.get('m_ClipBindingConstant', {}).get('genericBindings', [])
    duration = muscle.get('m_StopTime', 0) - muscle.get('m_StartTime', 0)
    stream_count, dense_count = streamed.get('curveCount', 0), dense.get('m_CurveCount', 0)
    if not math.isfinite(duration) or duration < 0 or duration > 600 or len(bindings) > 2000 or len(bindings) != stream_count + dense_count + len(constants):
        raise ValueError('Invalid native animation layout')
    curves = streamed_curves(streamed.get('data', []), stream_count)
    channels = []
    for index, binding in enumerate(bindings):
        target = targets.get(binding['path'])
        if target is None or binding.get('typeID') != 114 or binding.get('isPPtrCurve') or binding.get('attribute') != zlib.crc32(b'Value' if target[0] == 'Parameter' else b'Opacity'):
            continue
        channel = {'target': target[0], 'id': target[1]}
        if index < stream_count:
            if not curves[index]:
                raise ValueError('Native parameter has no keys')
            keys = playback_curve(curves[index], data.get('m_SampleRate', 30), target[0])
            channel.update({'kind': 'cubic', 'keys': keys})
            if keys is not curves[index]:
                channel['interpolation'] = 'baked-linear'
        elif index < stream_count + dense_count:
            values = dense.get('m_SampleArray', [])
            if dense_count * dense.get('m_FrameCount', 0) != len(values) or not math.isfinite(dense.get('m_SampleRate', 0)) or dense.get('m_SampleRate', 0) <= 0 or not all(math.isfinite(value) for value in values):
                raise ValueError('Invalid dense native curve')
            channel.update({'kind': 'dense', 'rate': dense['m_SampleRate'], 'begin': dense['m_BeginTime'], 'values': values[index - stream_count::dense_count]})
        else:
            value = constants[index - stream_count - dense_count]
            if not math.isfinite(value):
                raise ValueError('Non-finite native constant')
            channel.update({'kind': 'constant', 'value': value})
        channels.append(channel)
    # Unity also animates controller fields on the root object. They are not
    # Cubism parameter curves and do not count toward rig matching.
    parameter_bindings = [binding for binding in bindings if binding.get('typeID') == 114 and binding.get('attribute') in [zlib.crc32(b'Value'), zlib.crc32(b'Opacity')]]
    if not channels or not allow_partial and len(channels) < len(parameter_bindings) * 0.9:
        raise ValueError('Native animation belongs to a different rig')
    return {'duration': duration, 'loop': bool(muscle.get('m_LoopTime')), 'channels': channels}
