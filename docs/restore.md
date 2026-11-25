# Backup and restore

Agentic Dasher keeps everything in one SQLite file on the `data` volume (`/data/agentic-dasher.db` in the container), plus one key file beside it (`/data/secret.key`) that encrypts stored secrets such as channel tokens.

## What the app backs up

Once a day the app writes a complete copy of the database with SQLite's `VACUUM INTO`, while it keeps running. The copies land in `/data/backups/` as `agentic-dasher-<UTC date>T<UTC time>Z.db`, and the seven newest are kept. A copy is written under a `.partial` name and renamed when it is complete, so a file with the final name is always a whole database.

These copies protect you from a bad write or a failed upgrade. They sit on the same volume as the live database, so they do not protect you from losing the volume. Copy them somewhere else on your own schedule:

```sh
docker compose cp core:/data/backups ./agentic-dasher-backups
docker compose cp core:/data/secret.key ./agentic-dasher-backups/secret.key
```

Keep `secret.key` with the backups and treat it like a password. Without it the database still opens and your watches and price history are intact, but stored channel tokens cannot be read and have to be entered again. If you set `SECRET_KEY` in the environment instead, there is no key file: keep that value safe.

## Never open the live database from the host

Do not run `sqlite3`, a database browser or a copy command against `agentic-dasher.db` while the container is running. The app holds the file in WAL mode, and a second program on the host can corrupt it or copy a torn file. Take a backup from `/data/backups/`, or stop the app first.

## Restore

1. Stop the app.

   ```sh
   docker compose down
   ```

2. Put the backup in place of the live database and remove the old write-ahead files. Replace the file name with the backup you want.

   ```sh
   docker compose run --rm --no-deps --entrypoint sh core -c '
     cd /data &&
     mv agentic-dasher.db agentic-dasher.db.before-restore &&
     rm -f agentic-dasher.db-wal agentic-dasher.db-shm &&
     cp backups/agentic-dasher-20261125T031500Z.db agentic-dasher.db
   '
   ```

   To restore from a copy on the host, copy it into the volume first with `docker compose cp <file> core:/data/backups/`. If you are restoring onto a new volume, put `secret.key` back into `/data` as well.

3. Start the app.

   ```sh
   docker compose up -d
   ```

4. Check `http://localhost:8080/api/health`. `db` should be `ok`, and `migrationLevel` shows the schema level. A backup made by an older build is upgraded at start-up; a backup made by a newer build than the one you are running is refused, and the log says so.

When the restored app looks right, delete `agentic-dasher.db.before-restore`.

## What a restore does not bring back

Anything that happened after the backup was made: price observations, alerts and settings changed since then. Pending notifications that were already sent before the backup will not be sent again; ones recorded but not yet accepted by a channel at backup time will be retried.
