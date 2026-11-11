# Synthetic SQLCipher upgrade fixture

`sqlcipher-4.19.db.bin` and `sqlcipher-4.19.wal.bin` contain only test strings.
The public test DPAPI key is 32 bytes of `07`. As in the product, SQLCipher
receives its hex encoding (`07` repeated 32 times) as the passphrase.
They were generated with rusqlite 0.41.1, libsqlite3-sys 0.39.1 and SQLCipher
4.19.0 / SQLite 3.53.4, using `bundled-sqlcipher-vendored-openssl`.

Generation SQL after setting that passphrase:

```sql
PRAGMA journal_mode=WAL;
PRAGMA wal_autocheckpoint=0;
CREATE TABLE private_data(body TEXT);
INSERT INTO private_data VALUES('LEGACY_SQLCIPHER_ROW');
PRAGMA wal_checkpoint(TRUNCATE);
INSERT INTO private_data VALUES('LEGACY_SQLCIPHER_WAL_ROW');
```

Copy both files while that connection is still open, before its closing checkpoint.
The second row exists only in the WAL. The integration test must read both rows
with the upgraded library, add another row, reopen, and restore a checkpointed
copy with the same synthetic key protected for the current test user by DPAPI.
No production database or credential is used.
