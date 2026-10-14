"""Read the prefab's own Animator states, clip references and layer settings."""


def animator_program(nodes, components, ref):
    clips, states, actions, initial, transitions, any_transitions = {}, {}, {}, [], {}, {}
    for game, _ in nodes:
        for component in components(game):
            if component.type.name != 'Animator':
                continue
            value = component.parse_as_dict().get('m_Controller', {})
            if not value.get('m_PathID'):
                continue
            owner = ref(component, value)
            data = owner.parse_as_dict()
            replacements = {}
            if owner.type.name == 'AnimatorOverrideController':
                for item in data['m_Clips']:
                    if item['m_OverrideClip'].get('m_PathID'):
                        replacements[ref(owner, item['m_OriginalClip']).peek_name()] = ref(owner, item['m_OverrideClip'])
                owner = ref(owner, data['m_Controller'])
                data = owner.parse_as_dict()
            names = dict(data['m_TOS'])
            animation_clips = [ref(owner, pointer) for pointer in data['m_AnimationClips']]
            animation_clips = [replacements.get(clip.peek_name(), clip) for clip in animation_clips]
            clips.update({clip.peek_name(): clip for clip in animation_clips})
            controller = data['m_Controller']
            for order, layer in enumerate(controller['m_LayerArray']):
                layer = layer['data']
                machine = controller['m_StateMachineArray'][layer['m_StateMachineIndex']]['data']
                layer_name = names.get(layer['m_Binding'], str(order))
                constants = [entry['data'] for entry in machine['m_StateConstantArray']]
                keys = [layer_name + '.' + names.get(state['m_NameID'], str(index)) for index, state in enumerate(constants)]
                if len(constants) > 2000:
                    raise ValueError('Animator state limit exceeded')
                for index, state in enumerate(constants):
                    nodes = [node['data'] for tree in state['m_BlendTreeConstantArray'] for node in tree['data']['m_NodeArray']]
                    leaf = next((node for node in nodes if not node.get('m_ChildIndices') and node['m_ClipID'] < len(animation_clips)), None)
                    name = names.get(state['m_NameID'], str(index))
                    entry = {'name': name, 'layer': layer_name, 'order': order,
                             'clip': animation_clips[leaf['m_ClipID']].peek_name() if leaf else None,
                             'weight': 1 if order == 0 else layer['m_DefaultWeight'],
                             'additive': bool(layer['(int&)m_LayerBlendingMode']),
                             'speed': state['m_Speed'], 'loop': bool(state['m_Loop'])}
                    states[keys[index]] = entry
                    if entry['clip'] or name.endswith('Reset'):
                        actions[name.lower()] = keys[index]
                    for transition in state['m_TransitionConstantArray']:
                        transition = transition['data']
                        destination = transition['m_DestinationState']
                        if destination >= len(keys):
                            continue
                        duration = {'duration': transition['m_TransitionDuration'], 'fixed': transition['m_HasFixedDuration']}
                        transitions[keys[index] + '>' + keys[destination]] = duration
                        conditions = transition['m_ConditionConstantArray']
                        if transition['m_HasExitTime'] and not conditions:
                            entry['next'] = {'state': keys[destination], 'exit': transition['m_ExitTime'], **duration}
                        for condition in conditions:
                            trigger = names.get(condition['data']['m_EventID'])
                            if trigger:
                                actions[trigger.lower()] = keys[destination]
                for transition in machine.get('m_AnyStateTransitionConstantArray', []):
                    transition = transition['data']
                    destination = transition['m_DestinationState']
                    if destination >= len(keys):
                        continue
                    any_transitions[keys[destination]] = {'duration': transition['m_TransitionDuration'], 'fixed': transition['m_HasFixedDuration']}
                    for condition in transition['m_ConditionConstantArray']:
                        trigger = names.get(condition['data']['m_EventID'])
                        if trigger:
                            actions[trigger.lower()] = keys[destination]
                default = machine.get('m_DefaultState', 0)
                if default < len(keys):
                    initial.append(keys[default])
    if not states or not clips:
        raise ValueError('Live2D prefab has no Animator program')
    return clips, {'states': states, 'actions': actions, 'initial': initial, 'transitions': transitions, 'anyTransitions': any_transitions}
