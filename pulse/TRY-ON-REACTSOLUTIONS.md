# Try the Pulse version on reactsolutions.com

These steps set up Pulse with the Trip Board at **pulse.reactsolutions.com**. The React version keeps running at reactsolutions.com.

Nothing here pushes to the drawbox repository. The server only reads from drawbox, using a read-only deploy key, and step 5 turns off pushing from the server's copy.

Run every command as the `reactsolutions` cPanel user, in cPanel > Terminal or after `su - reactsolutions`, not as root.

## 1. Subdomain
In cPanel > Domains > Create A New Domain:
- **Domain:** `pulse.reactsolutions.com`
- **Document root:** `pulse/public`

Then run cPanel > SSL/TLS Status > **Run AutoSSL**.

> The document root must be `pulse/public`, not `pulse`. Otherwise the `.env` file and its passwords can be downloaded from the web.

## 2. PHP 8.3
In WHM > MultiPHP Manager, set `pulse.reactsolutions.com` to **PHP 8.3** or newer.

In WHM > EasyApache 4, make sure these extensions are on for that PHP version: `pdo_mysql`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `fileinfo` and `bcmath`.

## 3. Database
1. In cPanel > MySQL Databases, create a database named `pulse`. cPanel will name it `reactsolutions_pulse`.
2. Create a user named `pulse` with a strong password.
3. Add the user to the database with **All Privileges**.

## 4. Read-only key for the drawbox repository
```sh
ssh-keygen -t ed25519 -f ~/.ssh/drawbox_deploy -N "" -C "pulse trial on reactsolutions"
cat ~/.ssh/drawbox_deploy.pub
```
Copy the line this prints. On GitHub, open **JHStaffo/drawbox > Settings > Deploy keys > Add deploy key**, paste the line, and leave **Allow write access unchecked**.

Then add these lines to the end of `~/.ssh/config`:
```
Host github-drawbox
  HostName github.com
  User git
  IdentityFile ~/.ssh/drawbox_deploy
  IdentitiesOnly yes
```

## 5. Code: Pulse plus the Trip Board patch
```sh
cd ~
git clone git@github-drawbox:JHStaffo/drawbox.git pulse
cd pulse
git remote set-url --push origin no-pushing-from-this-server
git checkout -b trips-trial e0d69aa

# The patch comes from the dispatch repo that's already on this server.
git -C ~/reactsolutions-dispatch fetch origin pulse-module
git -C ~/reactsolutions-dispatch show FETCH_HEAD:pulse/trips-module.patch > ~/trips-module.patch
git -c user.name="Pulse trial" -c user.email="trial@reactsolutions.com" am ~/trips-module.patch
```

## 6. Install
```sh
cd ~/pulse
php -v    # must say 8.3 or newer. If it doesn't, use /opt/cpanel/ea-php83/root/usr/bin/php in place of php everywhere below.
curl -sS https://getcomposer.org/installer | php
php composer.phar install --no-dev --optimize-autoloader
cp .env.example .env
php artisan key:generate
nano .env
```

In `.env`, change these lines and leave the rest as they are:
```ini
APP_ENV=production
APP_DEBUG=false
APP_URL=https://pulse.reactsolutions.com

DB_CONNECTION=mysql
DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=reactsolutions_pulse
DB_USERNAME=reactsolutions_pulse
DB_PASSWORD=the password from step 3

MAIL_MAILER=sendmail
MAIL_FROM_ADDRESS=pulse@reactsolutions.com
```

Then:
```sh
php artisan migrate --force --seed
php artisan drawbox:ssn-key
php artisan drawbox:make-admin you@example.com "Your Name"
php artisan trips:sample you@example.com --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
```
Use your own email address in both commands.

- `trips:sample` loads the made-up patients, trucks and trips, and puts you on the first truck so that My Trips has something to show.
- `drawbox:ssn-key` makes the key Pulse uses to encrypt Social Security numbers. Pulse needs it even though this trial doesn't use SSNs.

## 7. Cron
In cPanel > Cron Jobs, add a job that runs **every minute**:
```
cd ~/pulse && php artisan schedule:run >> /dev/null 2>&1
```

## 8. Sign in
1. Open https://pulse.reactsolutions.com and enter your email.
2. Pulse emails you a 6-digit code.
3. Go to **Dispatch > Trip Board**.

If the code email doesn't arrive, the server can't send mail yet. You can still sign in:
1. In `.env`, set `MAIL_MAILER=log`.
2. Run `php artisan config:cache`.
3. Ask for a new code, then read it with:
   ```sh
   grep -o '[0-9]\{6\}' ~/pulse/storage/logs/laravel.log | tail -1
   ```

## Pages to try
- **Trip Board.** Drag a trip onto a truck. Open the same board in a second browser to watch live updates.
- **+ New trip.** Book a round trip.
- **Patients.** Search for "sample".
- **Trip Map.** The simulator moves the trucks.
- **My Trips.** Open it on your phone.
- **Trip Reports.**
- **Run sheet.** The link is under each truck on the board.
- **Trip Settings.**

## Updating after a new patch
```sh
cd ~/pulse
git checkout -B trips-trial e0d69aa
git -C ~/reactsolutions-dispatch fetch origin pulse-module
git -C ~/reactsolutions-dispatch show FETCH_HEAD:pulse/trips-module.patch > ~/trips-module.patch
git -c user.name="Pulse trial" -c user.email="trial@reactsolutions.com" am ~/trips-module.patch
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
```
