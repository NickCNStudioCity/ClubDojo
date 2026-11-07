// Usage: npm run set-role -w server -- <username> <ninja|sensei|grandmaster>
// Run on the host while the server is stopped (or running; the change applies at next login).
const path = require('path');
const P = require('../../shared/protocol');
const DB = require('./db');

const [username, role] = process.argv.slice(2);
if (!username || !P.ROLES.includes(role)) {
  console.log(`Usage: npm run set-role -w server -- <username> <${P.ROLES.join('|')}>`);
  process.exit(1);
}
const db = DB.open(process.env.CLUBDOJO_DATA || path.join(__dirname, '..', 'data'));
const account = db.findAccount(username);
if (!account) {
  console.log(`No account named ${username}.`);
  process.exit(1);
}
db.updateAccount(account.id, { role });
db.logAdmin(null, 'host console', 'setRole', account.id, { role });
console.log(`${account.username} is now ${role}.`);
db.close();
