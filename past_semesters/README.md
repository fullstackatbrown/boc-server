## Past Semester Backups
This folder holds backups of the production database for each semester, taken before the database is pruned of the trips and trip signups from that semester. In order to query these backups, you may  create a new database from them with the following commands:
```
mariadb -e "CREATE DATABASE archive;"
mariadb archive < [name_of_backup_file.sql]
```
**IMPORTANT:** Never run the second of these commands accidentally without the name "archive" (or whatever the name of your newly created database is); you could overwrite the production database!

When you've finished querying with the backup, keep the server clean by deleting the created database:
```
mariadb -e "DROP DATABASE archive;"
```