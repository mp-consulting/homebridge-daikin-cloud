# Manual scripts

Ad-hoc scripts that hit the **live** Daikin Cloud endpoints (Gigya login, mobile OAuth,
WebSocket). They need real Daikin credentials/tokens, spend API quota, and are not run by
`npm test` or CI. Run them by hand with `node scripts/manual/<script>.js`; tokens are read
from / written to the git-ignored `test/hbConfig/`.
