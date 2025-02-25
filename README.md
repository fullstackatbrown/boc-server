This repository is the code that provides the backend functinonality to the new BOC website. It consists of an Express server capable of receiving HTTP requests from the internet at large and translating these requests into SQL actions that alter a local Mariadb database. 
# Local Set Up (Necessary even for Frontend Devs!)
1. Clone this repository
2. Install its dependencies:
```
npm install -i
```
3. Install Mariadb (https://mariadb.com/kb/en/binary-packages/). After installation, ensure that the Mariadb service is running and that you can access it by running `mariadb`.
4. (OPTIONAL) Complete your setup by running the `mariadb-secure-installation` script (may not be possible on Windows - I'm unsure). You can say yes to all options, but do not have to; Unix Sockets can be helpful if you want to be able to log into the server using a user account without needing a password, which might be nice if you think you might want to use this server outside of this project but has no impact on this project's functionality, and you might want to change your root password, but this is also not necessary.
5. Create the `boc` database in your `mariadb` shell:
```
CREATE DATABASE boc;
```
6. Create a 'service' user (also in this shell) (NOTE: you will need to enter the shell as root - `mariadb -u root` if you didn't set a root password, `mariadb -u root -p` if you did, and `sudo mariadb -u root` if these aren't working) (NOTE: you can change the 'test123' password if you want, but you will need to change the associated text in `sequelize.mjs` as well if you do):
```
CREATE USER 'service'@'localhost' IDENTIFIED BY 'test123';
GRANT ALL PRIVILEGES ON boc.* TO 'service'@'localhost';
FLUSH PRIVILEGES;
```
7. Run the `default_insts.mjs` script with `node` to intialize your database. If this runs without output, you have successfully set everything up!
8. Run the `server.mjs` file with `node` and visit `http://localhost:8080/` within a browser. You should receive a JSON message welcoming you to the server :)
# Usage
Once you've got the server set up locally and running, you can test out its various routes. Take a look at the `route_descs.txt` file for a description of each one. You can interact with the server via three main ways:
## Browser (GET requests - manual testing)
Simply visit `http://localhost:8080/<route>` in your browser to explore routes on the server. While quick and easy you will only be able (as far as I know) to send GET requests and thus, will be unable to interact with any of the many POST routes on the server.
## curl (Any requests - manual testing)
`curl` is a command line tool that allows you to send more complicated HTTP requests mannually. To use it:
1. Install `curl` if you do not already have it
2. To send GET requests, it is as simple as:
```
curl http://localhost:8080/<route>
```
3. To send post requests, use the following syntax. The structure and contents of `<data_json>` will vary based on the route; check `route_descs.txt` for details for each route. Additionally, if you would like to specify a file instead of typing out the data json each time, you can use `-d @<path_to_json_file>`.
```
curl -X POST -H "Content-Type: application/json" \
  -d "<data_json>" \
  http://localhost:8080/<route>
```
## Axios (Any requests - with JS)
You will want to use Axios to send requests within the Next app itself. Use this as a reference: https://axios-http.com/docs/intro.
# Server Resources
The three resources beyond this `README` that will help you use and interact with this server are as follows:
1. **`route_descs.txt`** - This file contains detailed information about each of the servers various routes. This is fully up to date and will serve as your primary guide to the server once you get to the nitty-gritty of development with the server.
2. **`pages_and_reqs.txt`** - This small file contains some details about what backend data each page will need. You largely don't need to worry about this file; it's not fully up to date and your intuition might just serve you better
3. **`database_diagram.sql`** - This file provides some insight into the organization of SQL the database within the Mariadb server. You can copy its code and paste it into the code editor on this site (https://dbdiagram.io/d) to visualize what the database looks like (you will need to delete all of the comments though, which is annoying). This file is not fully up to date though and won't be that useful in the development of frontend, seeing as you will be interacting with the routes to the Express server rather than the database itself, so there's no real reason to look at it unless you are curious.
4. (BONUS) Us (Alan and William)! - If you don't understand something about the server or you notice a bug (or something in this `README` is wrong), please let us know! 
