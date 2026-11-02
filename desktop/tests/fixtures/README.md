# SQLite upgrade fixture

`sqlite-3.46.0.bz2` contains a synthetic 28,672-byte SQLite database written by
SQLite **3.46.0** (`rusqlite = 0.32.1`, `bundled`), compressed with bzip2.
It contains only the initial `contacts`, `chats` and `messages` schemas, one
synthetic contact and one synthetic incoming message. No real user data or
credentials are included. The database header at bytes 96–99 records 3,046,000.

The application test decompresses it into a unique temporary directory, runs the
actual migrations, searches its original English/Chinese message, saves a note,
reopens the database and checks its integrity. It never opens a user's database.
