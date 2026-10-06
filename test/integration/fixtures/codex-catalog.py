#!/usr/bin/env python3
"""Protocol fixture only: no sign-in, network, inference or account permissions."""
import json
import sys
initialized = False
for line in sys.stdin:
    msg = json.loads(line)
    method = msg['method']
    if method == 'initialize':
        print(json.dumps({'id': msg['id'], 'result': {'userAgent': 'catalog-test'}}), flush=True)
    elif method == 'initialized':
        initialized = True
    elif method == 'model/list' and initialized:
        cursor = msg['params'].get('cursor')
        result = {'data': [{'id': 'fixture-second', 'model': 'fixture-second', 'displayName': 'Fixture Second'}], 'nextCursor': None} if cursor else {
            'data': [{'id': 'fixture-sol', 'model': 'fixture-sol', 'displayName': 'Fixture Sol', 'supportedReasoningEfforts': [{'reasoningEffort': 'max'}]}, {'id': 'fixture-hidden', 'model': 'fixture-hidden', 'hidden': True}], 'nextCursor': 'second-page'}
        print(json.dumps({'id': msg['id'], 'result': result}), flush=True)
    else:
        print(json.dumps({'id': msg.get('id'), 'error': {'message': 'Unexpected protocol message'}}), flush=True)
