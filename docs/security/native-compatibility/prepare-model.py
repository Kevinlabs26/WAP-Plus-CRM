"""Extract only bounded regular model files into the isolated compatibility fixture."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import tarfile

root = Path(__file__).resolve().parents[3]
fixture = root / '.audit-cache/speech-model-candidate'
archive_path = fixture / 'tiny.tar.bz2'
with tarfile.open(archive_path, 'r:bz2') as archive:
    members = archive.getmembers()
    assert len(members) <= 1000 and sum(m.size for m in members) <= 1024 ** 3
    for member in members:
        assert member.isdir() or member.isfile()
        assert not PurePosixPath(member.name).is_absolute() and '..' not in PurePosixPath(member.name).parts
        assert '\\' not in member.name and ':' not in member.name
    archive.extractall(fixture, members=members, filter='data')
evidence = {'source': 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2',
            'sha256': hashlib.file_digest(archive_path.open('rb'), 'sha256').hexdigest(),
            'publisherDigestAvailable': False, 'files': [m.name for m in members]}
(root / 'docs/security/speech-model-candidate.json').write_text(json.dumps(evidence, indent=2) + '\n')
print('\n'.join(evidence['files']))
