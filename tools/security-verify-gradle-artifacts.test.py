"""Small offline check: correct bytes pass; modified bytes/unsafe redirects fail."""
import hashlib
import importlib.util
import io
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("verify_gradle", Path(__file__).with_name("security-verify-gradle-artifacts.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
record = {"group": "test", "name": "sample", "version": "1.0", "artifact": "sample-1.0.jar", "expected": [hashlib.sha256(b"trusted").hexdigest()]}
for body, url, expected in [(b"trusted", "https://repo.maven.apache.org/maven2/sample", True),
                            (b"changed", "https://repo.maven.apache.org/maven2/sample", False),
                            (b"trusted", "http://repo.maven.apache.org/maven2/sample", False),
                            (b"trusted", "https://attacker.example/sample", False)]:
    response = io.BytesIO(body)
    response.url = url
    with patch("urllib.request.urlopen", return_value=response):
        assert module.verify(record)["verified"] is expected
print("official artifact verification checks passed")
