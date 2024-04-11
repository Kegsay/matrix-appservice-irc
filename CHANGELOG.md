2.0.0 (2024-04-08)
==================

**Note**: This release drops support for Node 18. The minimum required version is now 20+.

Bugfixes
--------

- Fix Redis <=6.2 failing to clear the command queue in pooling mode. ([\#1763](https://github.com/matrix-org/matrix-appservice-irc/issues/1763))
- Fix GitHub CI docker builds failing for community PRs. ([\#1767](https://github.com/matrix-org/matrix-appservice-irc/issues/1767))


Improved Documentation
----------------------

- Mention that the libera.chat bridge has since been shut down. ([\#1784](https://github.com/matrix-org/matrix-appservice-irc/issues/1784))


Deprecations and Removals
-------------------------

- Drop `dynamicChannels.groupId` config option. Groups were unstable and are no longer supported by any Matrix implementations. ([\#1772](https://github.com/matrix-org/matrix-appservice-irc/issues/1772))


Internal Changes
----------------

- Remove some build-time dependencies from the runtime dependency list. ([\#1758](https://github.com/matrix-org/matrix-appservice-irc/issues/1758))
- Add option to ignore "functional members" when checking if an admin room contains two users. ([\#1782](https://github.com/matrix-org/matrix-appservice-irc/issues/1782))
- Fixup types for Timers so the bridge works with newer node versions. ([\#1788](https://github.com/matrix-org/matrix-appservice-irc/issues/1788))
- Update dependencies. ([\#1798](https://github.com/matrix-org/matrix-appservice-irc/issues/1798))
- Add tests for various forms of rich replies. ([\#1799](https://github.com/matrix-org/matrix-appservice-irc/issues/1799))


1.0.1 (2023-07-31)
==================

It is **strongly** reccomended you upgrade your bridge, as this release contains security fixes.

🔒 Security
-----------

- Fixes for GHSA-vc7j-h8xg-fv5x.
- Fixes for GHSA-3pmj-jqqp-2mj3.
- Fixes for GHSA-c7hh-3v6c-fj4q

Bugfixes
--------

- Improve processing speed of commands sent to and from the proxy when the bridge is configured in pooling mode. ([\#1751](https://github.com/matrix-org/matrix-appservice-irc/issues/1751))
- Ensure QUIT messages are always sent. ([\#1752](https://github.com/matrix-org/matrix-appservice-irc/issues/1752))
- Ensure we don't bloat irc supported state. ([\#1753](https://github.com/matrix-org/matrix-appservice-irc/issues/1753))
- Fix a case where the bridge would not listen for and apply bans for legacy/unspec'd `m.room.rule.*` types in use by Mjolnir. ([\#1755](https://github.com/matrix-org/matrix-appservice-irc/issues/1755), [\#1759](https://github.com/matrix-org/matrix-appservice-irc/issues/1759))
- Refactor the command parser for admin and room commands, ensuring we correctly trim the command. ([\#1756](https://github.com/matrix-org/matrix-appservice-irc/issues/1756))


Internal Changes
----------------

- Update matrix-appservice-bridge to 9.0.1. ([\#1760](https://github.com/matrix-org/matrix-appservice-irc/issues/1760))


1.0.0 (2023-06-09)
==================

**Note**: This release drops support for Node 16. The minimum required version is now 18+.

Several changes were made since the previous RC, mostly fixes around our incoming [connection pooling](https://matrix-org.github.io/matrix-appservice-irc/latest/connection_pooling.html) feature. The feature is
*still* considered unstable for the time being, so please be careful when trying it out.

Features
--------

-  New PM rooms are configured to disable calls, reactions, redactions, and stickers;
    as they could not be bridged anyway. ([\#1663](https://github.com/matrix-org/matrix-appservice-irc/issues/1663))
- The bridge now logs the user performing plumb/unplumb operations for easy auditing. ([\#1738](https://github.com/matrix-org/matrix-appservice-irc/issues/1738))


Bugfixes
--------

- Fix the bridge pooling so it supports TLS. ([\#1709](https://github.com/matrix-org/matrix-appservice-irc/issues/1709))
- Fix setup widget failing to authenticate. ([\#1711](https://github.com/matrix-org/matrix-appservice-irc/issues/1711))
- Sort the list of channels in !listrooms output. ([\#1715](https://github.com/matrix-org/matrix-appservice-irc/issues/1715))
- Fix cases where the IRC bridge may erronously believe a user is not joined to a channel in pooling mode. ([\#1717](https://github.com/matrix-org/matrix-appservice-irc/issues/1717))
- Allow usernames to include more characters when using the `!username` command. ([\#1719](https://github.com/matrix-org/matrix-appservice-irc/issues/1719))
- Ensure that all passwords can be decrypted on startup, to detect any issues with the provided passkey. ([\#1720](https://github.com/matrix-org/matrix-appservice-irc/issues/1720))
- Fixes cases where powerlevel changes may not be correctly applied upon mode change. ([\#1732](https://github.com/matrix-org/matrix-appservice-irc/issues/1732))
- Fix a case where a proxied client connection may get missed until they use the bridge on startup, leading to missed
  messages and logspam. ([\#1737](https://github.com/matrix-org/matrix-appservice-irc/issues/1737))


1.0.0-rc1 (2023-04-28)
======================

**Note**: This release drops support for Node 16. The minimum required version is now 18+.

Features
--------

- IRC connections can now be run via an external process using "connection pooling", allowing the bridge to be restarted without IRC connection loss. ([\#1669](https://github.com/matrix-org/matrix-appservice-irc/issues/1669))
- Make bridgeInfoState configuration reloadable. ([\#1681](https://github.com/matrix-org/matrix-appservice-irc/issues/1681))
- Bridge logging can now be hot-reloaded. ([\#1704](https://github.com/matrix-org/matrix-appservice-irc/issues/1704))


Bugfixes
--------

- Fix not handling thread fallbacks as replies. ([\#1697](https://github.com/matrix-org/matrix-appservice-irc/issues/1697))
- Show a helpful error for !link/!unlink admin failures, rather than "Check the logs for details", in more cases. ([\#1702](https://github.com/matrix-org/matrix-appservice-irc/issues/1702))
- Fix documentation not being built and uploaded to GitHub pages on release. ([\#1703](https://github.com/matrix-org/matrix-appservice-irc/issues/1703))
- Fix linking rooms from setup widget when a `networkId` is configured. ([\#1706](https://github.com/matrix-org/matrix-appservice-irc/issues/1706))


Deprecations and Removals
-------------------------

- Add support for Node 20, and drop support for Node 16. ([\#1701](https://github.com/matrix-org/matrix-appservice-irc/issues/1701))


Internal Changes
----------------

- Rename internal variable infoMapping to initialEvent. ([\#1672](https://github.com/matrix-org/matrix-appservice-irc/issues/1672))


0.38.0 (2023-04-12)
===================

Bugfixes
--------

- Fix leak of secret channels (name, topic, and member count) to the public room directory due to a regressive refactor in a previous release. ([\#1660](https://github.com/matrix-org/matrix-appservice-irc/issues/1660), [\#1698](https://github.com/matrix-org/matrix-appservice-irc/issues/1698))
- Fix unlink command showing an error. ([\#1692](https://github.com/matrix-org/matrix-appservice-irc/issues/1692))


Internal Changes
----------------

- RoomAccessSyncer: Await processing of cached channel modes that changed. ([\#1620](https://github.com/matrix-org/matrix-appservice-irc/issues/1620))
- Fix tests when running with 'yarnpkg link matrix-appservice-bridge'. ([\#1679](https://github.com/matrix-org/matrix-appservice-irc/issues/1679))
- Add tests that cover publicity syncing behaviour. ([\#1698](https://github.com/matrix-org/matrix-appservice-irc/issues/1698))


0.37.1 (2023-03-07)
====================

Bugfixes
--------

- Fix provisioning API base URL in setup widgets. ([\#1677](https://github.com/matrix-org/matrix-appservice-irc/issues/1677))


Internal Changes
----------------

- Update matrix-appservice-bridge to `8.1.1`. ([\#1676](https://github.com/matrix-org/matrix-appservice-irc/issues/1676))

0.37.0 (2023-02-08)
===================

Features
--------

- Add support for Node.JS 19. ([\#1646](https://github.com/matrix-org/matrix-appservice-irc/issues/1646))
- Refactor provisioning API to use `matrix-appservice-bridge`, adding support for OpenID token auth among other improvements. ([\#1655](https://github.com/matrix-org/matrix-appservice-irc/issues/1655))
- Add a UI in the form of a Matrix widget for linking and unlinking channels from a Matrix room. ([\#1656](https://github.com/matrix-org/matrix-appservice-irc/issues/1656))


Bugfixes
--------

- Document 8090 to be the default port, to match the code's behaviour. ([\#1427](https://github.com/matrix-org/matrix-appservice-irc/issues/1427))
- Fix the configured bind port being overridden in Docker. ([\#1654](https://github.com/matrix-org/matrix-appservice-irc/issues/1654))


Internal Changes
----------------

- Update builder image for Freebind from Stretch (EOL) to Buster. ([\#1653](https://github.com/matrix-org/matrix-appservice-irc/issues/1653))

0.36.0 (2022-10-25)
===================

Features
--------

* Support monospace formatting. ([\#1555](https://github.com/matrix-org/matrix-appservice-irc/issues/1555))


Bugfixes
--------

- Disable metrics by default. ([\#1596](https://github.com/matrix-org/matrix-appservice-irc/issues/1596))
- Fix distribution of IrcServer.randomDomain() which tended to pick domains with a lower index when there are a lot of addresses for a server. ([\#1612](https://github.com/matrix-org/matrix-appservice-irc/issues/1612))
- Prevent runtime errors by provisisioning a room with a specific roomID. ([\#1614](https://github.com/matrix-org/matrix-appservice-irc/issues/1614))


Improved Documentation
----------------------

- Fix typos in the documentation. ([\#1599](https://github.com/matrix-org/matrix-appservice-irc/issues/1599))
- Update bridged networks doc to point towards GitHub issue [#1483](https://github.com/matrix-org/matrix-appservice-irc/issues/1483). ([\#1626](https://github.com/matrix-org/matrix-appservice-irc/issues/1626))


Deprecations and Removals
-------------------------

- Breaking change: Raises the required NodeJS version to 16.
  Fixes Room visibility setting being broken for appservice directories. ([\#1616](https://github.com/matrix-org/matrix-appservice-irc/issues/1616))
- User activity tracking is now disabled by default, unless `userActivity` is enabled in the config. ([\#1638](https://github.com/matrix-org/matrix-appservice-irc/issues/1638))


Internal Changes
----------------

- docker: prune dev dependencies from node_modules. ([\#1541](https://github.com/matrix-org/matrix-appservice-irc/issues/1541))
- Logging: Use Map instead of object. ([\#1608](https://github.com/matrix-org/matrix-appservice-irc/issues/1608))
- Refactor Logging: Increase explicit TypeScript types and safer loops. ([\#1609](https://github.com/matrix-org/matrix-appservice-irc/issues/1609))
- Refactors: Reduce use of Bluebird, increase explicit types, use safer loops. ([\#1611](https://github.com/matrix-org/matrix-appservice-irc/issues/1611))
- Replace uses of the deprecated String.prototype.substr(). ([\#1615](https://github.com/matrix-org/matrix-appservice-irc/issues/1615))
- Add support for running tests against a real IRCd and Matrix homeserver in CI. ([\#1622](https://github.com/matrix-org/matrix-appservice-irc/issues/1622))
- Update to matrix-appservice-bridge 6.0.0. ([\#1631](https://github.com/matrix-org/matrix-appservice-irc/issues/1631))


0.35.1 (2022-09-26)
===================

Bugfixes
--------

- Prevent possible attack by provisisioning a room with a specific roomID. ([\#1619](https://github.com/matrix-org/matrix-appservice-irc/issues/1619))

0.35.0 (2022-09-13)
===================

Features
--------

- Add new Debug API `/warnReapUsers` which allows bridges to send a warning to users when they are going to be idle reaped. ([\#1571](https://github.com/matrix-org/matrix-appservice-irc/issues/1571))


Bugfixes
--------

- Truncated messages now default to wrapping URLs in angle brackets. ([\#1573](https://github.com/matrix-org/matrix-appservice-irc/issues/1573))


Internal Changes
----------------

- Include the bridge version and homeserver in the `CTCP VERSION` response body. ([\#1559](https://github.com/matrix-org/matrix-appservice-irc/issues/1559))
- BREAKING: Remove (IRC) as a default displayName suffix. ([\#1567](https://github.com/matrix-org/matrix-appservice-irc/issues/1567))
- Update CONTRIBUTING.md ([\#1570](https://github.com/matrix-org/matrix-appservice-irc/issues/1570))
- Add new CI workflow to check for signoffs. ([\#1585](https://github.com/matrix-org/matrix-appservice-irc/issues/1585))
- Strongly type emitted events from the IRC client. ([\#1604](https://github.com/matrix-org/matrix-appservice-irc/issues/1604))


0.34.0 (2022-05-04)
===================

This release fixes a High severity security vulnerability. See [the matrix blog](https://matrix.org/blog/2022/05/04/0-34-0-security-release-for-matrix-appservice-irc-high-severity) for more details.

Internal Changes
----------------

- Updated node-irc to 1.2.1

0.33.1 (2022-03-30)
===================

This release fixes a critical bug which would cause bans across the bridge when using the new ban list feature.

Bugfixes
--------

- Fix an issue where synchronising a ban list would cause all users to get banned. ([\#1551](https://github.com/matrix-org/matrix-appservice-irc/issues/1551))


Deprecations and Removals
-------------------------

- Remove several scripts in `scripts/` which were unmaintained and obsolete. ([\#1531](https://github.com/matrix-org/matrix-appservice-irc/issues/1531))


Internal Changes
----------------

- Fix towncrier script for summarising the newsfiles. ([\#1549](https://github.com/matrix-org/matrix-appservice-irc/issues/1549))

0.33.0 (2022-03-02)
===================

No significant changes.


0.33.0-rc2 (2022-02-18)
=======================

Bugfixes
--------

- Fix a duplicate metric that would prevent the bridge from starting. ([\#1534](https://github.com/matrix-org/matrix-appservice-irc/issues/1534))


0.33.0-rc1 (2022-02-17)
=======================

Features
--------

- Support splitting users from different homeservers into different IPv6 blocks. ([\#1514](https://github.com/matrix-org/matrix-appservice-irc/issues/1514))
- Added a new metric `clientpool_by_homeserver` which lists the states of IRC clients, by the top 25 homeservers. ([\#1517](https://github.com/matrix-org/matrix-appservice-irc/issues/1517))
- Add support for subscribing to moderation policy. See http://matrix-org.github.io/matrix-appservice-irc/administrators_guide.html#subscribing-to-moderation-policies for more information. ([\#1532](https://github.com/matrix-org/matrix-appservice-irc/issues/1532))


Bugfixes
--------

- Matrix message edits no longer bridge as a diff if it's longer than the new message ([\#1477](https://github.com/matrix-org/matrix-appservice-irc/issues/1477))


Improved Documentation
----------------------

- Update the list of bridged networks after hackint started offering a bridge once again. ([\#1501](https://github.com/matrix-org/matrix-appservice-irc/issues/1501))
- Removed freenode from bridged networks. ([\#1523](https://github.com/matrix-org/matrix-appservice-irc/issues/1523))


Deprecations and Removals
-------------------------

- The bridge will no longer treat invites without a `is_direct: true` as DM invites (and will henceforth reject group room invites). This may break some Matrix
  clients that do not supply this metadata when creating a room. ([\#1506](https://github.com/matrix-org/matrix-appservice-irc/issues/1506))
- **Minimum required Node version is now 14**. Users on Node 12 are advised to update to newer versions. ([\#1515](https://github.com/matrix-org/matrix-appservice-irc/issues/1515))


Internal Changes
----------------

- Check changelog.d entries in CI. ([\#1527](https://github.com/matrix-org/matrix-appservice-irc/issues/1527))
- Update various packages that were out of date. ([\#1530](https://github.com/matrix-org/matrix-appservice-irc/issues/1530))


0.32.1 (2021-10-25)
====================

Bugfixes
--------

- Fix a regression that prevented the bridge to run for multiple networks ([\#1491](https://github.com/matrix-org/matrix-appservice-irc/issues/1491))


0.32.0 (2021-10-18)
====================

No significant changes.


0.32.0-rc2 (2021-10-15)
========================

Bugfixes
--------

- Fix an issue where the bridge would excessively log state event content ([\#1487](https://github.com/matrix-org/matrix-appservice-irc/issues/1487))


0.32.0-rc1 (2021-10-08)
========================

Features
--------

- Add optional bridge blocking upon exceeding a monthly active user limit ([\#1472](https://github.com/matrix-org/matrix-appservice-irc/issues/1472))
- **Breaking**: Upgrade to `matrix-appservice-bridge` 3.1.0.

  This change removes the `ruleFile` option from the config, and replaces it with `rules`. See `config.sample.yaml` for an example. ([\#1485](https://github.com/matrix-org/matrix-appservice-irc/issues/1485))


0.31.0 (2021-09-20)
========================

Bugfixes
--------

- Fixed an issue where bridges using the NEdB datastore would still erroneously require IRC usernames to be unique. ([\#1471](https://github.com/matrix-org/matrix-appservice-irc/issues/1471))
- Fixed a bug where `!help` in an admin room would not show admin commands. ([\#1478](https://github.com/matrix-org/matrix-appservice-irc/issues/1478))
- Fix an edgecase where an nickname was not always set right for matrix users in PMs ([\#1479](https://github.com/matrix-org/matrix-appservice-irc/issues/1479))


0.31.0-rc1 (2021-08-23)
========================

Features
--------

- Render Matrix message edits as sed-like diff statements, falling back to asterisk formatted messages ([\#1465](https://github.com/matrix-org/matrix-appservice-irc/issues/1465))


Bugfixes
--------

- Make sure we don't exceed the line limit when trimming long messages ([\#1459](https://github.com/matrix-org/matrix-appservice-irc/issues/1459))
- Make sure Matrix notice messages are also pastebinned when they exceed the line limit for IRC. ([\#1461](https://github.com/matrix-org/matrix-appservice-irc/issues/1461))
- Fallback to sending an invite as a bot if the regular invite fails ([\#1467](https://github.com/matrix-org/matrix-appservice-irc/issues/1467))


Improved Documentation
----------------------

- Replace HOWTO.md with a link to our hosted documentation, and generally improve documentation wording. ([\#1458](https://github.com/matrix-org/matrix-appservice-irc/issues/1458))


Internal Changes
----------------

- Remove extra `encodingFallback` from sample config. ([\#1468](https://github.com/matrix-org/matrix-appservice-irc/issues/1468))


0.30.0 (2021-08-18)
====================

No significant changes.


0.30.0-rc1 (2021-08-17)
========================

Features
--------

- Show message previews for uploaded long messages ([\#1430](https://github.com/matrix-org/matrix-appservice-irc/issues/1430))
- Export the `ircClients.maxClients` config value as a metric (`bridge_remote_ghosts_max`) ([\#1448](https://github.com/matrix-org/matrix-appservice-irc/issues/1448))


Bugfixes
--------

- Make sure that admin commands that don't need a server (like !help) don't require it ([\#1433](https://github.com/matrix-org/matrix-appservice-irc/issues/1433))
- Remove `client_config_domain_username_idx` which would have required a unique username for IPv6 users. ([\#1455](https://github.com/matrix-org/matrix-appservice-irc/issues/1455))


Improved Documentation
----------------------

- Expand documentation for irc_modes.md ([\#1429](https://github.com/matrix-org/matrix-appservice-irc/issues/1429))
- docs/usage.md: point to bridged networks in-tree ([\#1450](https://github.com/matrix-org/matrix-appservice-irc/issues/1450))
- Adding LibertaCasa to network bridges. Thanks @Mikaela. ([\#1454](https://github.com/matrix-org/matrix-appservice-irc/issues/1454))


Internal Changes
----------------

- Do not generate a unique username for users on a IPv6 bridge, as it's unnessacery. ([\#1446](https://github.com/matrix-org/matrix-appservice-irc/issues/1446))
- Docker images are now automatically build and published via GitHub Actions, replacing DockerHub Autobuilds. ([\#1456](https://github.com/matrix-org/matrix-appservice-irc/issues/1456))


0.29.0 (2021-08-02)
====================

Bugfixes
--------

- Add prometheus metrics for IRC connection times ([\#1442](https://github.com/matrix-org/matrix-appservice-irc/issues/1442))


0.29.0-rc2 (2021-07-27)
========================

Internal Changes
----------------

- Update node-irc to 1.1.1 (see https://github.com/matrix-org/node-irc/blob/master/CHANGELOG.md) ([\#1434](https://github.com/matrix-org/matrix-appservice-irc/issues/1434))


0.29.0-rc1 (2021-07-21)
========================

**Please note:** `0.28.0(-rc1)` is abandoned as more features became ready to ship before we reached the end of the release candidate stage. Users of `0.28.0-rc1` should upgrade
to this release. Some changelog entries below will be duplicated from `0.28.0-rc1`.

Features
--------

- Add prometheus metrics for IRC connection times ([\#1418](https://github.com/matrix-org/matrix-appservice-irc/issues/1418))
- Change the reply rendering to something more IRCish (and configurable) ([\#1424](https://github.com/matrix-org/matrix-appservice-irc/issues/1424))
- Truncate original messages more gently when replying ([\#1428](https://github.com/matrix-org/matrix-appservice-irc/issues/1428))


Bugfixes
--------

- Require explicit server selection for !storepass when more than one possibility exists.
  This makes the command a bit more verbose, but avoids the situation where a password could've been accidentally specified for the wrong server. ([\#1363](https://github.com/matrix-org/matrix-appservice-irc/issues/1363))

- Fix an issue where a hot reload would fail if `advanced` was not defined in the original config. ([\#1383](https://github.com/matrix-org/matrix-appservice-irc/issues/1383))
- Update `matrix-org-irc` to `1.0.0` to fix a bug where the bridge can crash. ([\#1388](https://github.com/matrix-org/matrix-appservice-irc/issues/1388))
- Fix an issue where a Matrix user's IRC connection is stuck and unable to join some channels. ([\#1394](https://github.com/matrix-org/matrix-appservice-irc/issues/1394))
- Fix multiline replies having only one line sent to IRC ([\#1425](https://github.com/matrix-org/matrix-appservice-irc/issues/1425))
- Ensure the `irc_connection_time_ms` histrogram metric uses sensible bucket sizes. ([\#1426](https://github.com/matrix-org/matrix-appservice-irc/issues/1426))


Improved Documentation
----------------------

- Fix typo regarding examples of hostname and port in Bridge Setup documentation (4. Registration) ([\#1405](https://github.com/matrix-org/matrix-appservice-irc/issues/1405))
- Migrate the list of bridged IRC networks from the deprecated github wiki to the hosted documentation (https://matrix-org.github.io/matrix-appservice-irc/latest/).
  Add libera.chat to the list. ([\#1416](https://github.com/matrix-org/matrix-appservice-irc/issues/1416))

- The Debug API is now documented in the hosted documentation, replacing the wiki page. ([\#1420](https://github.com/matrix-org/matrix-appservice-irc/issues/1420))


Internal Changes
----------------

- Handle known error-codes when OPER command fails instead of disconnecting. ([\#1385](https://github.com/matrix-org/matrix-appservice-irc/issues/1385))
- Add a link referring to the in-tree documentation to the admin room help text. ([\#1402](https://github.com/matrix-org/matrix-appservice-irc/issues/1402))
- Add linting for test files ([\#1403](https://github.com/matrix-org/matrix-appservice-irc/issues/1403))
- Fix a bug where messages from IRC would be blocked by the privacy filter when `allowUnconnectedMatrixUsers` set to `true` in a room config event. ([\#1406](https://github.com/matrix-org/matrix-appservice-irc/issues/1406))


0.28.0-rc1 (2021-07-19)
====================

Features
--------

- Add Prometheus metrics for IRC connection times ([\#1418](https://github.com/matrix-org/matrix-appservice-irc/issues/1418))


Bugfixes
--------

- Fix an issue where a hot reload would fail if `advanced` was not defined in the original config. ([\#1383](https://github.com/matrix-org/matrix-appservice-irc/issues/1383))
- Update `matrix-org-irc` to `1.0.0` to fix a bug where the bridge can crash. ([\#1388](https://github.com/matrix-org/matrix-appservice-irc/issues/1388))
- Fix an issue where a Matrix user's IRC connection is stuck and unable to join some channels. ([\#1394](https://github.com/matrix-org/matrix-appservice-irc/issues/1394))


Improved Documentation
----------------------

- Migrate the list of bridged IRC networks from the deprecated GitHub wiki to the hosted documentation (https://matrix-org.github.io/matrix-appservice-irc/latest/). Add libera.chat to the list. ([\#1416](https://github.com/matrix-org/matrix-appservice-irc/issues/1416))


Internal Changes
----------------

- Handle known error-codes when OPER command fails instead of disconnecting. ([\#1385](https://github.com/matrix-org/matrix-appservice-irc/issues/1385))
- Add a link referring to the in-tree documentation to the admin room help text. ([\#1402](https://github.com/matrix-org/matrix-appservice-irc/issues/1402))
- Fix a bug where messages from IRC would be blocked by the privacy filter when `allowUnconnectedMatrixUsers` set to `true` in a room config event. ([\#1406](https://github.com/matrix-org/matrix-appservice-irc/issues/1406))


0.27.0 (2021-06-16)
====================

Bugfixes
--------

- Fix an issue where a hot reload would fail if `advanced` was not defined in the original config. ([\#1383](https://github.com/matrix-org/matrix-appservice-irc/issues/1383))
- Update `matrix-org-irc` to `1.0.0` to fix a bug where the bridge can crash. ([\#1388](https://github.com/matrix-org/matrix-appservice-irc/issues/1388))
- Fix an issue where a Matrix user's IRC connection is stuck and unable to join some channels. ([\#1394](https://github.com/matrix-org/matrix-appservice-irc/issues/1394))


Internal Changes
----------------

- Handle known error-codes when OPER command fails instead of disconnecting. ([\#1385](https://github.com/matrix-org/matrix-appservice-irc/issues/1385))


0.27.0-rc3 (2021-06-11)
=======================

Bugfixes
--------

- Update `matrix-org-irc` to `1.0.0` to fix a bug where the bridge can crash. ([\#1388](https://github.com/matrix-org/matrix-appservice-irc/issues/1388))


0.27.0-rc2 (2021-06-10)
========================

Bugfixes
--------

- Fix an issue introduced in 0.27.0-rc1 where the SSL option would not work without also providing a `tlsOptions` value. ([\#1384](https://github.com/matrix-org/matrix-appservice-irc/issues/1384))


0.27.0-rc1 (2021-06-10)
========================

This release contains many more changes and features than normal, so please be extra careful when testing this RC and please
report any issues to us as always.

Features
--------

- Add support for setting a username, and reconnecting through the admin room. This change also changes `!storepass` to no longer reconnect you by default. ([\#1331](https://github.com/matrix-org/matrix-appservice-irc/issues/1331))
- Add `requireMatrixJoined` membership option to block IRC messages until all Matrix users are joined to the channel. ([\#1337](https://github.com/matrix-org/matrix-appservice-irc/issues/1337))
- Add config option `useHomeserverDirectory` to allow rooms to be published to the homeserver room directory, rather than just the appservice directory. ([\#1344](https://github.com/matrix-org/matrix-appservice-irc/issues/1344))
- Add `tlsOptions` key to the config to override the IRC connection parameters. ([\#1375](https://github.com/matrix-org/matrix-appservice-irc/issues/1375))
- Allow only using the `additionalAddresses` field when connecting to IRC. ([\#1376](https://github.com/matrix-org/matrix-appservice-irc/issues/1376))


Bugfixes
--------

- Detect IRC username mentions bounded by ',<,> or & ([\#1303](https://github.com/matrix-org/matrix-appservice-irc/issues/1303))
- Comment out `permissions` from the sample config. ([\#1315](https://github.com/matrix-org/matrix-appservice-irc/issues/1315))
- Fix an issue where invites to DM rooms are not marked as direct message invites. ([\#1329](https://github.com/matrix-org/matrix-appservice-irc/issues/1329))
- Validate that the nickname is provided to `!irc nick` before trying to change nick. ([\#1330](https://github.com/matrix-org/matrix-appservice-irc/issues/1330))
- Fix "CLI undefined" being spit out from cli on generic errors ([\#1333](https://github.com/matrix-org/matrix-appservice-irc/issues/1333))
- Fix an issue where the IRC username was incorrectly required to be 10 characters or less. ([\#1345](https://github.com/matrix-org/matrix-appservice-irc/issues/1345))
- Update a number of packages to latest versions, including `matrix-appservice-bridge@2.6.1` containing a security fix. ([\#1365](https://github.com/matrix-org/matrix-appservice-irc/issues/1365))
- Fix zero width spaces (ZWSPs) being filtered out of messages from IRC. ([\#1366](https://github.com/matrix-org/matrix-appservice-irc/issues/1366))
- Admin rooms are now correctly created as DMs, and only one will be created per-user. ([\#1372](https://github.com/matrix-org/matrix-appservice-irc/issues/1372))
- Fix the bridge never syncing membership if it cannot get the joined users for a room on startup. ([\#1373](https://github.com/matrix-org/matrix-appservice-irc/issues/1373))
- Do not attempt to fetch per-room config for a PM. ([\#1379](https://github.com/matrix-org/matrix-appservice-irc/issues/1379))
- Fix a bug where the bridge user would rejoin shortly after unbridging a room. ([\#1382](https://github.com/matrix-org/matrix-appservice-irc/issues/1382))


Improved Documentation
----------------------

- Document release process in CONTRIBUTING.md ([\#1308](https://github.com/matrix-org/matrix-appservice-irc/issues/1308))
- Update documentation for SASL support, and safety net features. ([\#1352](https://github.com/matrix-org/matrix-appservice-irc/issues/1352))


Internal Changes
----------------

- Use latest version of matrix-org/node-irc which was rewritten in Typescript. ([\#1319](https://github.com/matrix-org/matrix-appservice-irc/issues/1319))
- Fix validation of the config to allow for a single hash in the alias template. ([\#1339](https://github.com/matrix-org/matrix-appservice-irc/issues/1339))
- Improve blocked room feature (such as kicking users who cannot get connected to the channel), and add metrics to track. ([\#1369](https://github.com/matrix-org/matrix-appservice-irc/issues/1369))
- Show an error in the PM room when the IRC user has blocked unregistered users from messaging. ([\#1380](https://github.com/matrix-org/matrix-appservice-irc/issues/1380))
- Add headers to the admin room help text. ([\#1381](https://github.com/matrix-org/matrix-appservice-irc/issues/1381))

0.26.1 (2021-06-03)
===================

This update features a **security** fix for a bug in `matrix-appservice-bridge`. Server administrators are encouraged to update the bridge. See https://github.com/matrix-org/matrix-appservice-bridge/releases/tag/2.6.1 for details. If you have any questions, please contact [security@matrix.org](security@matrix.org).

Bugfixes
--------

- Update a number of packages to latest versions, including `matrix-appservice-bridge@2.6.1` containing a security fix. ([\#1365](https://github.com/matrix-org/matrix-appservice-irc/issues/1365))


0.26.0 (2021-05-13)
===================

No significant changes.


0.26.0-rc2 (2021-05-10)
========================

Internal Changes
----------------

- For NPM 7 to properly fetch the irc dependency, we switch to a git+https:// url. Before it defaulted to SSH which needs some authentication. ([\#1311](https://github.com/matrix-org/matrix-appservice-irc/issues/1311))


0.26.0-rc1 (2021-05-07)
========================

Features
--------

- Allow changing nickname in any room ([\#1217](https://github.com/matrix-org/matrix-appservice-irc/issues/1217))
- The bridge will now retry creating a room for a PM if the initial attempt fails. ([\#1282](https://github.com/matrix-org/matrix-appservice-irc/issues/1282))
- Decouple invite from the creation of a PM room ([\#1290](https://github.com/matrix-org/matrix-appservice-irc/issues/1290))
- Add new `kickOn` config option to disable kicking Matrix users under certain conditions ([\#1294](https://github.com/matrix-org/matrix-appservice-irc/issues/1294))
- Added an !unlink command for Matrix users to unbridge a channel from Matrix ([\#1298](https://github.com/matrix-org/matrix-appservice-irc/issues/1298))
- Add support for specifying the paste bin limit in room state with the `org.matrix.appservice-irc.config` event type. ([\#1301](https://github.com/matrix-org/matrix-appservice-irc/issues/1301))


Bugfixes
--------

- [M->I]: Trim Markdown code block syntax ([\#1275](https://github.com/matrix-org/matrix-appservice-irc/issues/1275))


Internal Changes
----------------

- Doc changes: Unify use of port 9999, the registration file name, and other minor changes ([\#1274](https://github.com/matrix-org/matrix-appservice-irc/issues/1274))
- Fixed a bug where our linter would miss several files ([\#1288](https://github.com/matrix-org/matrix-appservice-irc/issues/1288))
- Fix linter warnings ([\#1289](https://github.com/matrix-org/matrix-appservice-irc/issues/1289))
- Docker image: Upgrade to NodeJS 14 ([\#1299](https://github.com/matrix-org/matrix-appservice-irc/issues/1299))
- Add GitHub action to push documentation upon release ([\#1306](https://github.com/matrix-org/matrix-appservice-irc/issues/1306))


0.25.0 (2021-03-16)
====================

No significant changes.


0.25.0-rc1 (2021-03-05)
========================

Bugfixes
--------

- MXC urls are now properly URL encoded when sent to IRC. ([\#1237](https://github.com/matrix-org/matrix-appservice-irc/issues/1237))
- Fixed an issue where users would not be rejoined to some channels on reconnect if they failed to rejoin any channel. ([\#1255](https://github.com/matrix-org/matrix-appservice-irc/issues/1255))
- Fix an issue where IRC membership would not be bridged to new rooms when `botConfig.enabled` is `true`. ([\#1256](https://github.com/matrix-org/matrix-appservice-irc/issues/1256))
- Update powerlevels immediately when unbridging to avoid rejoining the bridge bot to the room. ([\#1257](https://github.com/matrix-org/matrix-appservice-irc/issues/1257))
- Fix Docker `start.sh` script to use port `9999` instead of `9995` ([\#1259](https://github.com/matrix-org/matrix-appservice-irc/issues/1259))
- Fix invalid JSON schema for `ircService.permissions` ([\#1261](https://github.com/matrix-org/matrix-appservice-irc/issues/1261))


Improved Documentation
----------------------

- Add new bridge documentation under /docs. This can be viewed by visiting https://matrix-org.github.io/matrix-appservice-irc/ ([\#1235](https://github.com/matrix-org/matrix-appservice-irc/issues/1235))
- Add documentation on IRC bridge mode handling. ([\#1251](https://github.com/matrix-org/matrix-appservice-irc/issues/1251))


Internal Changes
----------------

- Leave DM rooms and admin rooms if the Matrix user leaves so that a homeserver may clear them up later. ([\#1258](https://github.com/matrix-org/matrix-appservice-irc/issues/1258))
- Update to matrix-appservice-bridge 2.6.0-rc1 and use it's implementation of the BridgeInfoStateSyncer ([\#1262](https://github.com/matrix-org/matrix-appservice-irc/issues/1262))

0.24.0 (2021-02-12)
====================

No significant changes.


0.24.0-rc1 (2021-02-02)
========================

Features
--------

- Warn Matrix users if they are unable to speak in a channel. ([\#1204](https://github.com/matrix-org/matrix-appservice-irc/issues/1204))
- Add `!plumb` admin command to bridge rooms ([\#1211](https://github.com/matrix-org/matrix-appservice-irc/issues/1211))
- Use replies when responding to admin commands. ([\#1215](https://github.com/matrix-org/matrix-appservice-irc/issues/1215))
- Add `ircClients.realnameFormat` option in the config to show mxid in reverse in the realname field of IRC clients. ([\#1229](https://github.com/matrix-org/matrix-appservice-irc/issues/1229))
- Add `pingTimeoutMs` and `pingRateMs` as options to the config ([\#1232](https://github.com/matrix-org/matrix-appservice-irc/issues/1232))


Bugfixes
--------

- Fix potential error when using killUser debug endpoint ([\#1206](https://github.com/matrix-org/matrix-appservice-irc/issues/1206))
- Fix an issue that would cause `!bridgeversion` to report `Unknown` when running inside a Docker container. ([\#1212](https://github.com/matrix-org/matrix-appservice-irc/issues/1212))
- Fix an issue where the QuitDebouncer would reprocess old QUITs, and process QUITs too early during the debouncing process. ([\#1228](https://github.com/matrix-org/matrix-appservice-irc/issues/1228), [\#1230](https://github.com/matrix-org/matrix-appservice-irc/issues/1230), [\#1231](https://github.com/matrix-org/matrix-appservice-irc/issues/1231))


Internal Changes
----------------

- Update `matrix-appservice-bridge` to `2.5.0-rc1` ([\#1233](https://github.com/matrix-org/matrix-appservice-irc/issues/1233))


0.23.0 (2020-12-01)
====================

No significant changes.


0.23.0-rc1 (2020-11-24)
====================

Features
--------

- Add membership queue Prometheus metrics under the prefix `bridge_membershipqueue_`. ([\#1185](https://github.com/matrix-org/matrix-appservice-irc/issues/1185))
- Fix a performance issue where many mode changes in quick succession for a channel would cause many m.room.power_level events to be created. ([\#1186](https://github.com/matrix-org/matrix-appservice-irc/issues/1186))
- When multiple users leave the room at the same time, batch together powerlevel removals ([\#1196](https://github.com/matrix-org/matrix-appservice-irc/issues/1196))


Bugfixes
--------

- Reduce verbosity of some log lines from INFO to DEBUG ([\#1168](https://github.com/matrix-org/matrix-appservice-irc/issues/1168))
- Drop IRC messages directed towards invalid nicks early. ([\#1189](https://github.com/matrix-org/matrix-appservice-irc/issues/1189))
- Improve the performance of sending messages by speeding up some function calls ([\#1192](https://github.com/matrix-org/matrix-appservice-irc/issues/1192))


Internal Changes
----------------

- Improve the handling speed of IRC joins. ([\#1187](https://github.com/matrix-org/matrix-appservice-irc/issues/1187))


0.22.0 (2020-11-06)
====================

No significant changes.


0.22.0-rc1 (2020-10-28)
====================

**Breaking Change**: We've renamed the `/killPortal` DebugAPI endpoint to `/killRoom`, and it will now unbridge all types of rooms rather than just portal rooms.

Features
--------

- Pre-emptively ignore users who are already idle when starting up the bridge ([\#1156](https://github.com/matrix-org/matrix-appservice-irc/issues/1156))
- Propagate a reason all the way through killing the bridge ([\#1159](https://github.com/matrix-org/matrix-appservice-irc/issues/1159))
- Add startup check to ensure the homeserver can send the bridge events. ([\#1160](https://github.com/matrix-org/matrix-appservice-irc/issues/1160))
- Replace `/killPortal` debug API with `/killRoom` API, which works for all bridge mapping types ([\#1169](https://github.com/matrix-org/matrix-appservice-irc/issues/1169))


Bugfixes
--------

- Don't wait for leaves to complete when running the reaping script ([\#1147](https://github.com/matrix-org/matrix-appservice-irc/issues/1147))
- Fix bug where m.audio files would not be forwarded to IRC ([\#1150](https://github.com/matrix-org/matrix-appservice-irc/issues/1150))
- Do not change a Matrix user's IRC nickname unless their profile has also changed ([\#1157](https://github.com/matrix-org/matrix-appservice-irc/issues/1157))
- Fixed an issue where the bridge would kick users from rooms they never joined ([\#1165](https://github.com/matrix-org/matrix-appservice-irc/issues/1165))


Internal Changes
----------------

- Determine user activeness based off presence, typing and read receipts when kicking idle users. ([\#1152](https://github.com/matrix-org/matrix-appservice-irc/issues/1152))
- Bridge IRC `reason`s when users QUIT or PART ([\#1161](https://github.com/matrix-org/matrix-appservice-irc/issues/1161))
- Remove hacks around reconnections on startup ([\#1162](https://github.com/matrix-org/matrix-appservice-irc/issues/1162))


0.21.0 (2020-10-15)
====================

No significant changes.


0.21.0-rc3 (2020-10-13)
========================

Features
--------

- Add support for reconfiguring the bridge at runtime by sending a `SIGHUP` ([\#1145](https://github.com/matrix-org/matrix-appservice-irc/issues/1145))


Bugfixes
--------

- Fix a bug where the bridge would leave a user after joining ([\#1143](https://github.com/matrix-org/matrix-appservice-irc/issues/1143))
- Fix more cases of double bridged users ([\#1146](https://github.com/matrix-org/matrix-appservice-irc/issues/1146))
- Fix a bug where a user leaving with a reason would cause them to join then leave ([\#1151](https://github.com/matrix-org/matrix-appservice-irc/issues/1151))


Internal Changes
----------------

- Add index to client_config for `config->>username` to speed up username lookups ([\#1148](https://github.com/matrix-org/matrix-appservice-irc/issues/1148))


0.21.0-rc2 (2020-10-13)
========================

Features
--------

- Add support for reconfiguring the bridge at runtime by sending a `SIGHUP` ([\#1145](https://github.com/matrix-org/matrix-appservice-irc/issues/1145))


Bugfixes
--------

- Fix a bug where the bridge would leave a user after joining ([\#1143](https://github.com/matrix-org/matrix-appservice-irc/issues/1143))
- Fix more cases of double bridged users ([\#1146](https://github.com/matrix-org/matrix-appservice-irc/issues/1146))
- Fix a bug where a user leaving with a reason would cause them to join then leave ([\#1151](https://github.com/matrix-org/matrix-appservice-irc/issues/1151))


Internal Changes
----------------

- Add index to client_config for `config->>username` to speed up username lookups ([\#1148](https://github.com/matrix-org/matrix-appservice-irc/issues/1148))


0.21.0-rc2 (2020-10-09)
========================

Bugfixes
--------

- Fix a bug where the bridge would leave a user after joining ([\#1143](https://github.com/matrix-org/matrix-appservice-irc/issues/1143))


0.21.0-rc1 (2020-10-07)
========================

Features
--------

- Implement mechanisms to fix powerlevels in rooms if messages fail to bridge ([\#1054](https://github.com/matrix-org/matrix-appservice-irc/issues/1054))


Bugfixes
--------

- Fix a bug where connection reaping would not work sometimes if the bridge could not use the synapse whois admin endpoint ([\#1131](https://github.com/matrix-org/matrix-appservice-irc/issues/1131))
- Fixes Matrix displayName not being updated properly. Thanks to @BernardZhao ([\#1137](https://github.com/matrix-org/matrix-appservice-irc/issues/1137))


Internal Changes
----------------

- Use types from `matrix-appservice-bridge` rather than local definitions. ([\#1101](https://github.com/matrix-org/matrix-appservice-irc/issues/1101))
- Fix attribution link in CONTRIBUTING.md ([\#1132](https://github.com/matrix-org/matrix-appservice-irc/issues/1132))
- The deprecated remove-idle-users.py has been removed. Bridge admins should use the /reapUsers Debug API endpoint instead ([\#1139](https://github.com/matrix-org/matrix-appservice-irc/issues/1139))


0.20.2 (2020-08-21)
====================

Features
--------

- Add Grafana dashboard sample ([\#1122](https://github.com/matrix-org/matrix-appservice-irc/issues/1122))


Bugfixes
--------

- Reconnect to the correct domain on passsword changes. Thanks to @palmer-dabbelt ([\#1000](https://github.com/matrix-org/matrix-appservice-irc/issues/1000))
- Improve performance of generating a username ([\#1121](https://github.com/matrix-org/matrix-appservice-irc/issues/1121))


0.20.1 (2020-08-17)
========================

*There were enough changes during the RC period to warrant a new release, so `0.20.0`  was dropped in favour of `0.20.1`.*

Features
--------

- The quit debouncer has been rewritten to be more performant, dropping QUITs entirely until the bridge is able to cope with them. ([\#1091](https://github.com/matrix-org/matrix-appservice-irc/issues/1091))
- Track connection state in metrics ([\#1110](https://github.com/matrix-org/matrix-appservice-irc/issues/1110))


Bugfixes
--------

- Fix metrics worker dying and crashing after high load ([\#1109](https://github.com/matrix-org/matrix-appservice-irc/issues/1109))
- Speed up operations on the publicity syncer for IRC -> Matrix ([\#1111](https://github.com/matrix-org/matrix-appservice-irc/issues/1111))
- Fix issue where all irc bridged rooms would be marked as public ([\#1113](https://github.com/matrix-org/matrix-appservice-irc/issues/1113))
- Allow nicknames to start with a special character or number according to RFC 2812 § 2.3.1 ([\#1114](https://github.com/matrix-org/matrix-appservice-irc/issues/1114))


Internal Changes
----------------

- Improve logging around ClientPool ([\#1112](https://github.com/matrix-org/matrix-appservice-irc/issues/1112))


0.20.0-rc2 (2020-08-12)
========================

Features
--------

- Add metrics for tracking user activeness for matrix and irc users ([\#1105](https://github.com/matrix-org/matrix-appservice-irc/issues/1105))


Bugfixes
--------

- Fix issue where /metrics would respond with no data ([\#1107](https://github.com/matrix-org/matrix-appservice-irc/issues/1107))


0.20.0-rc1 (2020-08-11)
========================

Features
--------

- Media URLs now include the filename when sent to IRC. ([\#1087](https://github.com/matrix-org/matrix-appservice-irc/issues/1087))


Bugfixes
--------

- Fix duplicate messages appearing if an IRC message is poorly decoded. ([\#1081](https://github.com/matrix-org/matrix-appservice-irc/issues/1081))
- Make sure a killed BridgedClient is dead, even if connect was never called ([\#1098](https://github.com/matrix-org/matrix-appservice-irc/issues/1098))


Internal Changes
----------------

- Enable many recommended ESLint rules to catch errors ([\#1078](https://github.com/matrix-org/matrix-appservice-irc/issues/1078))
- Replace .indexOf with more specific methods ([\#1097](https://github.com/matrix-org/matrix-appservice-irc/issues/1097))


0.19.0 (2020-07-06)
====================

No significant changes.


0.19.0-rc2 (2020-06-29)
========================

Features
--------

- Add `bridge_app_version` metric to report the bridge version. ([\#1071](https://github.com/matrix-org/matrix-appservice-irc/issues/1071))


Bugfixes
--------

- Fix issue where some metrics would not be reported,
  and a bug in `inspectUsers` which would return an empty list. ([\#1075](https://github.com/matrix-org/matrix-appservice-irc/issues/1075))


Internal Changes
----------------

- Refactor room creation code to use one function for tracking and creation of rooms ([\#1074](https://github.com/matrix-org/matrix-appservice-irc/issues/1074))
- Code improvements: Simplify use of Map and RegEx methods ([\#1076](https://github.com/matrix-org/matrix-appservice-irc/issues/1076))


0.19.0-rc1 (2020-06-26)
========================

**0.19 introduces a minimum reqirement of NodeJS 12.x**

Features
--------

- Split out metrics endpoint to a seperate worker ([\#1069](https://github.com/matrix-org/matrix-appservice-irc/issues/1069))
- Add ability to limit the number of kicked users, and order by inactive time when using the reapUsers Debug API command. ([\#1072](https://github.com/matrix-org/matrix-appservice-irc/issues/1072))


Internal Changes
----------------

- **BREAKING CHANGE**: The bridge now requires a minimum of `NodeJS` v12.x ([\#1070](https://github.com/matrix-org/matrix-appservice-irc/issues/1070))


0.18.0 (2020-06-26)
====================

No significant changes.


0.18.0-rc1 (2020-06-22)
========================

Bugfixes
--------

- Update `pg` dependency to `8.1.0` to fix NodeJS 14 compatibility.
  **Be aware** that this means that unauthorized SSL connections are now rejected as of [pg@8.0.0](https://github.com/brianc/node-postgres/blob/master/CHANGELOG.md#pg800) ([\#1050](https://github.com/matrix-org/matrix-appservice-irc/issues/1050))
- Fixed a crash related to an invalid `ctcp-version` request ([\#1053](https://github.com/matrix-org/matrix-appservice-irc/issues/1053))
- Add ability to limit the number of rooms that an instance can be bridged. ([\#1060](https://github.com/matrix-org/matrix-appservice-irc/issues/1060))
- Fixed issue where setting initial sync to true for `membershipLists.room` entries would not work if syncing is off globally. ([\#1065](https://github.com/matrix-org/matrix-appservice-irc/issues/1065))


Improved Documentation
----------------------

- Corrects tutorial port numbers for docker so that copying/pasting will properly run with default port numbers. ([\#1048](https://github.com/matrix-org/matrix-appservice-irc/issues/1048))


Internal Changes
----------------

- Update `sanitizeHtml` package. ([\#1066](https://github.com/matrix-org/matrix-appservice-irc/issues/1066))


0.17.1 (2020-05-06)
====================

Features
--------

- Add ability to set fallback text encoding for non-UTF-8 messages. ([\#580](https://github.com/matrix-org/matrix-appservice-irc/issues/580))


Bugfixes
--------

- Fixed an issue where installing the bridge from NPM would cause `tsc` to fail and the operation would fail. ([\#1045](https://github.com/matrix-org/matrix-appservice-irc/issues/1045))
- Ensure we don't kick the bot user on connectionReap ([\#1046](https://github.com/matrix-org/matrix-appservice-irc/issues/1046))


Internal Changes
----------------

- Use `prepare` rather than `prepublish` in `package.json` ([\#1047](https://github.com/matrix-org/matrix-appservice-irc/issues/1047))


0.17.0 (2020-05-01)
====================

No changes since 0.17.0-rc4 


0.17.0-rc4 (2020-04-29)
========================

Bugfixes
--------

- Will no longer try retry a kick for connection failure if the bot lacks permission ([\#1040](https://github.com/matrix-org/matrix-appservice-irc/issues/1040))


Internal Changes
----------------

- Update matrix-appservice-bridge to 1.12.2 to fix a header bug ([\#1036](https://github.com/matrix-org/matrix-appservice-irc/issues/1036))


0.17.0-rc3 (2020-04-17)
========================

Bugfixes
--------

- **SECURITY FIX** The bridge now authenticatess the /_matrix/provision set of endpoints. It now requires either a `access_token` query parameter or a `Authorization` header containing the `hs_token` provided in the registration file. ([\#1035](https://github.com/matrix-org/matrix-appservice-irc/issues/1035))


Internal Changes
----------------

- Simplify ClientPool logic using Maps ([\#1034](https://github.com/matrix-org/matrix-appservice-irc/issues/1034))


0.17.0-rc2 (2020-04-15)
========================

Bugfixes
--------

- Ensure `err.args` is defined when checking errors in `ConnectionInstance` ([\#1030](https://github.com/matrix-org/matrix-appservice-irc/issues/1030))


0.17.0-rc1 (2020-04-09)
========================

Features
--------

- On name change, inform Matrix users, if their preferred IRC name is taken ([\#1018](https://github.com/matrix-org/matrix-appservice-irc/issues/1018))
- Add ability to deactivate users permanently via the DebugAPI. ([\#1021](https://github.com/matrix-org/matrix-appservice-irc/issues/1021))


Bugfixes
--------

- Disconnect a PM room from IRC when another user is invited, and disallow invites to PM rooms. ([\#1010](https://github.com/matrix-org/matrix-appservice-irc/issues/1010))
- Fix issue where users with stored passwords but no config settings (IPv6 address, nickname) would not be able to get connected. Fixes #1014. ([\#1015](https://github.com/matrix-org/matrix-appservice-irc/issues/1015))
- Kick users who have been X:lined ([\#1023](https://github.com/matrix-org/matrix-appservice-irc/issues/1023))
- Fix issue where users who used !storepass are never reconnected and cannot send messages through the bridge. ([\#1024](https://github.com/matrix-org/matrix-appservice-irc/issues/1024))


Improved Documentation
----------------------

- Add instructions for registering IRC bot's nickname. Thanks to @DylanVanAssche ([\#1004](https://github.com/matrix-org/matrix-appservice-irc/issues/1004))
- Improve documentation for changelog entries ([\#1020](https://github.com/matrix-org/matrix-appservice-irc/issues/1020))


Internal Changes
----------------

- Replace deprecated new Buffer("a") ([\#1019](https://github.com/matrix-org/matrix-appservice-irc/issues/1019))
- Test !nick when the user already has the nick ([\#1020](https://github.com/matrix-org/matrix-appservice-irc/issues/1020))
- Update dependencies to fix vulnerabilities. ([\#1025](https://github.com/matrix-org/matrix-appservice-irc/issues/1025))


0.16.0 (2020-03-03)
====================

Features
--------

- Kicks from one IRC user to another will now be shown as kicks on Matrix. ([\#994](https://github.com/matrix-org/matrix-appservice-irc/issues/994))


Bugfixes
--------

- Fix issue where bridged channel(s) would not be carried across on room upgrade. ([\#989](https://github.com/matrix-org/matrix-appservice-irc/issues/989))
- IRC users will now join the new room on a room upgrade ([\#993](https://github.com/matrix-org/matrix-appservice-irc/issues/993))
- Fix a bug where users with high numbers of channels would flood the ircd and be stuck trying to connect forever. ([\#995](https://github.com/matrix-org/matrix-appservice-irc/issues/995))
- Matrix users who change nicks will no longer cause ghosts to appear in rooms with their new nick. ([\#996](https://github.com/matrix-org/matrix-appservice-irc/issues/996))
- Fix bug where failing to start the bridge would not report any useful information ([\#997](https://github.com/matrix-org/matrix-appservice-irc/issues/997))
- Fix missing logline arguments for BridgedClient ([\#1004](https://github.com/matrix-org/matrix-appservice-irc/issues/1004))


Internal Changes
----------------

- Add `scripts/changelog-check.sh` and `scripts/changelog-release.sh` ([\#990](https://github.com/matrix-org/matrix-appservice-irc/issues/990))
- Add `.npmignore` ([\#991](https://github.com/matrix-org/matrix-appservice-irc/issues/991))
- Ensure the room upgrades test passes with Postgres ([\#992](https://github.com/matrix-org/matrix-appservice-irc/issues/992))
- Upgrade `winston` logging library to 3.2.1 ([\#1002](https://github.com/matrix-org/matrix-appservice-irc/issues/1002))


0.15.2 (2020-02-13)
====================

Features
--------

- The bridge will now notify you if a DM recipient is offline. ([\#978](https://github.com/matrix-org/matrix-appservice-irc/issues/978))


Bugfixes
--------

- Fix "User did not rejoin" error when bridge debounces QUITs ([\#977](https://github.com/matrix-org/matrix-appservice-irc/issues/977))
- Fix an issue where users were not rejoined to channels on netsplit/password change. ([\#979](https://github.com/matrix-org/matrix-appservice-irc/issues/979))


0.15.1 (2020-02-06)
====================

Bugfixes
--------

- Fix an issue where legacy mappings would cause the bridge to not start. ([\#971](https://github.com/matrix-org/matrix-appservice-irc/issues/971))


0.15.0 (2020-02-05)
====================

Features
--------

- **Breaking Change** - Static mappings can now set a channel key:
   - This changes the config schema, even if you do not make use of this feature. You MUST update your existing `mappings` to use the new `roomIds`:
     ```yaml
     old:
       mappings:
         "#thepub": ["!kieouiJuedJoxtVdaG:localhost"]

     new:
       mappings:
         "#thepub":
           roomIds: ["!kieouiJuedJoxtVdaG:localhost"]
     ```
   - The key is automatically used to join Matrix users to the mapped channel. They do not need to know the key. For example, you can bridge password-protected IRC channels to invite-only Matrix rooms:
     ```yaml
     mappings:
       "#viplounge":
         roomIds: ["!xKtieojhareASOokdc:localhost"]
         key: "vip-pass"
     ``` ([\#591](https://github.com/matrix-org/matrix-appservice-irc/issues/591))
- Add 'defaultOnline' and 'excludeRegex' parameters to /reapUsers. ([\#930](https://github.com/matrix-org/matrix-appservice-irc/issues/930))
- Add support for MSC2346; adding information about the bridged channel into room state. ([\#941](https://github.com/matrix-org/matrix-appservice-irc/issues/941))
- Added `!listrooms` command to list which channels you are connected to. ([\#965](https://github.com/matrix-org/matrix-appservice-irc/issues/965))


Bugfixes
--------

- Fix issue where bridges using NeDB would not start. ([\#955](https://github.com/matrix-org/matrix-appservice-irc/issues/955))
- Substitute `$SERVER` in `ircService.servers.*.dynamicChannels.aliasTemplate`
  when generating a room alias from channel (fixes thirdparty lookups and joining
  by IRC channel name from Riot). ([\#958](https://github.com/matrix-org/matrix-appservice-irc/issues/958))
- Fix an issue where the postgres migration script does not translate '_' => '.' ([\#962](https://github.com/matrix-org/matrix-appservice-irc/issues/962))
- Fix issue where migrating users from NeDB to Postgres would fail if they had a password. ([\#968](https://github.com/matrix-org/matrix-appservice-irc/issues/968))
- Fix bug where users would not be able to join a channel via `!join`. ([\#970](https://github.com/matrix-org/matrix-appservice-irc/issues/970))


Deprecations and Removals
-------------------------

- Removed `upgrade-db-0.*.js` scripts which were used to upgrade old versions of the NeDB database. If you are upgrading from <=0.9.1 then you can find the upgrade scripts [here](https://github.com/matrix-org/matrix-appservice-irc/tree/0.14.0/scripts). ([\#947](https://github.com/matrix-org/matrix-appservice-irc/issues/947))
- Remove `statsd` support as per https://github.com/matrix-org/matrix-appservice-irc/issues/818 ([\#949](https://github.com/matrix-org/matrix-appservice-irc/issues/949))
- Remove githooks, since they are unused. ([\#951](https://github.com/matrix-org/matrix-appservice-irc/issues/951))


Internal Changes
----------------

- Queue more membership operations inside a retry queue ([\#932](https://github.com/matrix-org/matrix-appservice-irc/issues/932))
- Queue IRC messages inbound to Matrix for a maximum of 5 seconds. ([\#953](https://github.com/matrix-org/matrix-appservice-irc/issues/953))


0.14.1 (2020-01-21)
====================

Bugfixes
--------

- Fix issue where bridges using NeDB would not start. ([\#955](https://github.com/matrix-org/matrix-appservice-irc/issues/955))


0.14.0 (2020-01-20)
====================

Bugfixes
--------

- If a new DM room is created for a IRC user, discard the old room. ([\#919](https://github.com/matrix-org/matrix-appservice-irc/issues/919))
- Fix missig config.schema.yml in the Docker image ([\#920](https://github.com/matrix-org/matrix-appservice-irc/issues/920))
- Stop trying to use sentry when config.sentry.enabled is false ([\#921](https://github.com/matrix-org/matrix-appservice-irc/issues/921))
- Improve reply matching logic for Matrix messages. ([\#925](https://github.com/matrix-org/matrix-appservice-irc/issues/925))


Internal Changes
----------------

- Use Typescript 3.7 and fix build issues. ([\#931](https://github.com/matrix-org/matrix-appservice-irc/issues/931))


0.14.0-rc4 (2019-12-18)
========================

Bugfixes
--------

- Massively speed up connection reaper by not syncing all rooms ([\#914](https://github.com/matrix-org/matrix-appservice-irc/issues/914))
- Tweak DB migration script to handle duplicate PMs and DB inconsistencies ([\#917](https://github.com/matrix-org/matrix-appservice-irc/issues/917))
- Handle replies that contain a displayname rather than a userid. ([\#918](https://github.com/matrix-org/matrix-appservice-irc/issues/918))


0.14.0-rc3 (2019-12-06)
========================

Features
--------

- Maximum AS transaction size has been raised from 5MB to 10MB. You may also now specify this limit in the config. ([\#907](https://github.com/matrix-org/matrix-appservice-irc/issues/907))


0.14.0-rc2 (2019-12-05)
========================

Internal Changes
----------------

- Ensure that joins and leaves are performed linearly per-room. ([\#905](https://github.com/matrix-org/matrix-appservice-irc/issues/905))


0.14.0-rc1 (2019-11-29)
========================

Features
--------

- The project now uses Typescript for it's source code. ([\#808](https://github.com/matrix-org/matrix-appservice-irc/issues/808))
- Add support for PostgreSQL ([\#815](https://github.com/matrix-org/matrix-appservice-irc/issues/815))
- Add migration script for migrating NeDB databases to PostgreSQL. ([\#816](https://github.com/matrix-org/matrix-appservice-irc/issues/816))
- Add config option `excludedUsers` to exclude users from bridging by regex. ([\#820](https://github.com/matrix-org/matrix-appservice-irc/issues/820))
- Support room upgrades on PostgreSQL. ([\#824](https://github.com/matrix-org/matrix-appservice-irc/issues/824))
- Delay ident responses until pending clients have connected. Thanks to @heftig for the initial PR. ([\#825](https://github.com/matrix-org/matrix-appservice-irc/issues/825))
- Allow admins to specify a bind port and/or hostname in the config. ([\#857](https://github.com/matrix-org/matrix-appservice-irc/issues/857))
- When !storepass is called, reconnect the user to ensure the password is set. ([\#864](https://github.com/matrix-org/matrix-appservice-irc/issues/864))
- Track last seen times of users between restarts ([\#876](https://github.com/matrix-org/matrix-appservice-irc/issues/876))
- Add dry run mode to the debugApi /reapUsers command. ([\#879](https://github.com/matrix-org/matrix-appservice-irc/issues/879))
- The bridge now supports error tracing via sentry ([\#897](https://github.com/matrix-org/matrix-appservice-irc/issues/897))


Bugfixes
--------

- Inviting the bridge bot to an existing bridged room will no longer cause the room to be bridged as an admin room. Invites must also use `is_direct`. ([\#846](https://github.com/matrix-org/matrix-appservice-irc/issues/846))
- Fix counter for leaving users. ([\#855](https://github.com/matrix-org/matrix-appservice-irc/issues/855))
- Replace calls to `/state` with more efficient calls, where possible. ([\#865](https://github.com/matrix-org/matrix-appservice-irc/issues/865))
- Topic changes from Matrix no longer cause a ghost user to join the room. ([\#866](https://github.com/matrix-org/matrix-appservice-irc/issues/866))
- Ensure bot clients stay connected after being disconnected. ([\#867](https://github.com/matrix-org/matrix-appservice-irc/issues/867))
- Fix issue where the internal ipv6 counter would not be correctly set ([\#873](https://github.com/matrix-org/matrix-appservice-irc/issues/873))
- Fix bug where users could not store or remove their password ([\#874](https://github.com/matrix-org/matrix-appservice-irc/issues/874))
- Fix a bug where users could not generate registration files ([\#875](https://github.com/matrix-org/matrix-appservice-irc/issues/875))
- Fix uploaded long message URL's not sent to IRC side. ([\#889](https://github.com/matrix-org/matrix-appservice-irc/issues/889))
- Debug API is now correctly enabled on startup ([\#893](https://github.com/matrix-org/matrix-appservice-irc/issues/893))
- Quit the app with exitcode 1 if it fails to start ([\#894](https://github.com/matrix-org/matrix-appservice-irc/issues/894))
- The !storepass command now reconnects users with their new password. ([\#900](https://github.com/matrix-org/matrix-appservice-irc/issues/900))


Deprecations and Removals
-------------------------

- Statsd is deprecated in this release, and will be removed in the next. Users are encouraged to use prometheus instead, which has richer logging capabilites. ([\#837](https://github.com/matrix-org/matrix-appservice-irc/issues/837))
- Remove warnings/hacks around `config.appservice`. Users should have upgraded to the new format by now. ([\#849](https://github.com/matrix-org/matrix-appservice-irc/issues/849))


Internal Changes
----------------

- Refactor Datastore for Typescript ([\#809](https://github.com/matrix-org/matrix-appservice-irc/issues/809))
- Add linting support for Typescript files. ([\#810](https://github.com/matrix-org/matrix-appservice-irc/issues/810))
- Fatal exceptions are now logged to stdout in addition to logs. ([\#812](https://github.com/matrix-org/matrix-appservice-irc/issues/812))
- Refactor Datastore code to be more generic. ([\#814](https://github.com/matrix-org/matrix-appservice-irc/issues/814))
- Move schema.yml from /lib/config to / ([\#819](https://github.com/matrix-org/matrix-appservice-irc/issues/819))
- Use [Towncrier](https://pypi.org/project/towncrier/) for changelog management ([\#821](https://github.com/matrix-org/matrix-appservice-irc/issues/821))
- Internal conversions of model classes to Typescript ([\#822](https://github.com/matrix-org/matrix-appservice-irc/issues/822))
- Convert ClientPool and associated dependencies to Typescript ([\#826](https://github.com/matrix-org/matrix-appservice-irc/issues/826))
- Convert logging to Typescript ([\#827](https://github.com/matrix-org/matrix-appservice-irc/issues/827))
- Convert DebugApi to Typescript ([\#829](https://github.com/matrix-org/matrix-appservice-irc/issues/829))
- Typescriptify QuitDebouncer ([\#830](https://github.com/matrix-org/matrix-appservice-irc/issues/830))
- Typescriptify BridgedClient and dependencies ([\#831](https://github.com/matrix-org/matrix-appservice-irc/issues/831))
- Convert generator and formatter functions to Typescript ([\#832](https://github.com/matrix-org/matrix-appservice-irc/issues/832))
- Typescriptify IrcEventBroker ([\#833](https://github.com/matrix-org/matrix-appservice-irc/issues/833))
- Use seperate DBs for each integration test. ([\#834](https://github.com/matrix-org/matrix-appservice-irc/issues/834))
- Typescriptify IrcBridge ([\#836](https://github.com/matrix-org/matrix-appservice-irc/issues/836))
- Typescriptify irc syncer classes ([\#839](https://github.com/matrix-org/matrix-appservice-irc/issues/839))
- Do not call keepalive() callbacks if the user doesn't need to be kept alive. ([\#844](https://github.com/matrix-org/matrix-appservice-irc/issues/844))
- Typescriptify matrix handler class ([\#845](https://github.com/matrix-org/matrix-appservice-irc/issues/845))
- Remove `crc` and `prom-client` packages. ([\#846](https://github.com/matrix-org/matrix-appservice-irc/issues/846))
- Swap to using promises over timers for queuing messages on IRC connections. ([\#848](https://github.com/matrix-org/matrix-appservice-irc/issues/848))
- Typescriptify irc handler class ([\#850](https://github.com/matrix-org/matrix-appservice-irc/issues/850))
- Updates to Dockerfile to add multiple stages and support Typescript ([\#853](https://github.com/matrix-org/matrix-appservice-irc/issues/853))
- Rewrite provisioner/* in Typescript ([\#861](https://github.com/matrix-org/matrix-appservice-irc/issues/861))
- Refactor bot command handling into own class. ([\#863](https://github.com/matrix-org/matrix-appservice-irc/issues/863))
- Move some IRC specific functions from IrcBridge to ClientPool ([\#877](https://github.com/matrix-org/matrix-appservice-irc/issues/877))
- Use the DB to prefill some membership caches, reducing the number of HTTP calls made and speeding up bridge startup. ([\#881](https://github.com/matrix-org/matrix-appservice-irc/issues/881))
- Room directory visibility state for bridged rooms is now cached in the database ([\#882](https://github.com/matrix-org/matrix-appservice-irc/issues/882))
- Gracefully close irc connections on SIGTERM ([\#895](https://github.com/matrix-org/matrix-appservice-irc/issues/895))
- Log when a newly discovered irc user's profile is updated. ([\#896](https://github.com/matrix-org/matrix-appservice-irc/issues/896))

Changes in 0.13.1 (2019-11-07)
==============================

* Pin `node-irc` dependency to avoid new changes bleeding into old releases.

Changes in 0.13.0 (2019-09-25)
==============================

* Fatal logging will now emit to stdout directly first, and exit with a unique error code #812

Changes in 0.13.0-rc2 (2019-09-11)
==============================

* Users who are banned from an IRC network must be QUIT locally #790
* Pending nicknames should be stored before they are confirmed to help dedupe #796
* Clarify storepass response #799. Thanks @auscompgeek
* Fix issue where room upgrades would not upgrade the room entry ID #797

Changes in 0.13.0-rc1 (2019-08-06)
==============================

**NOTE:** This release requires Node.js 10 or greater.

* Require Node 10 (and use Buildkite for CI) #764
* Handle PARTs for Matrix users #754
* Configurable room versions #763
* Passwords stored by the bridge can now contain spaces #738. Thanks @14mRh14mRh4X0r!
* Audit packages and update for security #779
* Fix call to _incrementMetric #780
* Disable escaping of userids for now #768
* Reduce memory consumption of tests #766
* Add a debug API endpoint to quit users who have been idle for a while #772
* DebugApi endpoint to inspect connected users #781
* Refactor powerlevel (mode) handling #785
* Bump appservice sdk version #788

Please also note that `CONTRIBUTING.md` has been updated with new guidelines.

Changes in 0.12.0 (2019-06-06)
==============================

No changes since previous RC, see below for full list of changes

Changes in 0.12.0-rc2 (2019-03-18)
==============================

* Fix issue where the bridge would conflict with other bridges when transforming a nick into a user id

Changes in 0.12.0-rc1 (2019-03-15)
==============================

* The bridge now supports upgrading rooms, and will follow room upgrades to the new room.
* Added support for the RoomLinkValidator, which allows admins to manually configure rules about plumbing rooms.
* A dockerfile is now included.
* Add support for "feature flags", allowing users to dynamically enable/disable bridge features for their account.
* Add command "!bridgeversion"


Changes in 0.11.2 (2018-10-05)
==============================

* Fixed bugs where a user may issue a !quit and break metrics reporting for a bridge.
* Added a config option 'advanced.maxHttpSockets' to allow you to increase the limit
  for high traffic bridges.

Changes in 0.11.1 (2018-08-30)
==============================

* Bumped matrix-appservice-bridge to 1.6.1
* Fixed a bug where metrics would crash after the first scrape
  with remote user reporting option set

Changes in 0.11.0 (2018-08-28)
==============================

No changes since previous RC, see below for full list of changes

Changes in 0.11.0-rc4 (2018-08-24)
==============================

Bug Fixes:

* Fixed a bug where content of events the bridge hadn't cached
  were not being used in replies.

Changes in 0.11.0-rc3 (2018-08-24)
==============================

- The bridge now depends on matrix-appservice-bridge 1.6.0c

Bug Fixes:

* We were calling authedRequest but the request was not mocked out.

Changes in 0.11.0-rc2 (2018-08-24)
==============================

- The bridge now depends on matrix-appservice-bridge 1.6.0b

Bug Fixes:

* There was a bug involving intents in m-a-b so it was bumped

Changes in 0.11.0-rc1 (2018-08-23)
==============================

- The bridge now depends on matrix-appservice-bridge 1.6.0a

New features & improvements:
* Cache modes internally #630
* Replace nicks with user pill mentions #650 #658
* Kick users if we fail to create an IRC client for them on join (aka ILINE kicks) #639
* SASL support #643
* Add err_nononreg so we can announce PMs that failed #645
* Formatting of replies #647

Bug Fixes:
* Fix invalidchar nick #655
* Don't answer any msgtypes other than text in an admin room. #642
* Fix provisoner leaving users on unlink #649

Metrics:
* Metrics for MatrixHandler - Iline Kicks #644
* Idle connection metrics #651
* QueuePool.waitingItems should use it's internal queue size #656

Misc:
* Section out tests, linting and coverage into seperate stages for Travis #657

Changes in 0.10.1 (2018-07-30)
==============================
	
 - Missed a few changes from master

Changes in 0.10.0 (2018-07-30)
==============================

No changes since rc1

Changes in 0.10.0-rc1 (2018-07-25)
==============================
- The bridge now depends on matrix-appservice-bridge 1.5.0a

New features & improvements:
* Migrate to ESLint 4. Thanks Aidan Gauland
* Don't rejoin virtual users we know are in the room.
* Added unbridging API for bridge operators to unbridge portal rooms.
* Add option to allow expired certificates.
* Add option to show group flare in new portal rooms.
* Joins are now (optionally) retried when they fail on I->M.
* No more warnings about rawResponse when uploading media.
* Add option to disable presence.

Changes in 0.9.1 (2018-07-12)
=============================

Some changes were not included in 0.9.0 and have now been included in this release:
* Don't rejoin mapped rooms #594 
* Announce and leave DM rooms if we don't support it #600 


Changes in 0.9.0 (2018-07-02)
=============================

No changes since 0.9.0-rc1

Changes in 0.9.0-rc1 (2018-06-29)
=============================
**BREAKING CHANGES:**
 - The bridge now requires a minimum of Node 6.

New features & improvements:

* **Breaking Change** - Minimum supported version is now Node 6.X #589 
* Updated winston logger dependency to 2.4.2 #587
* Refined colours to match mIRC colours - #483 Thanks @silkeh 
* Displayname changes now appear as nick changes - #486 Thanks @silkeh 
* New ``migrate-users`` script to remove suffixes from displaynames - #495 Thanks @SohumB
* Rewritten IRC to HTML parsing - #485 Thanks @silkeh 
* Add m.audio as a valid file type - #504 Thanks @t3chguy 
* Don't rejoin mapped rooms #594 
* Announce and leave DM rooms if we don't support it #600 


Changes in 0.8.0 (2017-07-26)
=============================

**BREAKING CHANGES:**
 - Logs are now rotated based on time rather than size. `maxFileSizeBytes` has been removed from the configuration file.

New features:
 - The bridge will now mirror IRC chanops to Matrix, so Matrix users can see who is a chanop.
 - The bridge will now handle `+m` (moderated) channels by setting the `events_default` value to `1` when `+m` is set.
   Only Matrix users with a power level >0 can send events in this room whilst this is set.
 - The debug API has been expanded to include `/killUser` which accepts a JSON object like:
   ```json
   {
     "user_id": "@usertoremove:localhost",
     "reason": "reason in quit message and kick message"
   }
   ```

Improvements:
 - Reduced CPU and memory usage during normal operation. The bridge will now share internal data structures for representing Matrix rooms. Previously, each user in a room would have its own copy of the Matrix room which would need to be updated for power levels / membership changes N times (where N is the number of bridged users in the room). This now only needs to be updated once.
 - The format for uploaded content has changed to: (thanks @t3chguy!)
   ```
   Person has uploaded an image: filename.gif (55KB) <https://homeserver/_matrix/media/v1/download/foo/bar>
   ```

 - The bridge will now respond to CTCP VERSION with: (thanks @t3chguy!)
   ```
   matrix-appservice-irc, part of the Matrix.org Network
   ```

 - The ident server can now bind to any address via the config option `ident.address`. Thanks @silkeh!
 - The ident server will now respond with the formal syntax in RFC1413. Thanks @silkeh!
 - The bridge will now set `protocols: ["irc"]` in the generated registration file. Thanks @ansiwen!

Bug fixes:
 - `dropMatrixMessagesAfterSecs` now re-checks the time just prior to sending to IRC. Previously, it was possible for events to arrive a few seconds before the cut-off period and then take minutes to be processed in the bridge, resulting in the message being sent *after* the cut-off period.
 - The `unbridge.js` script has been fixed when not sending a message. Thanks @aperezdc!
 - Pastebinned long messages are now uploaded with UTF8 encoding.
 - The bridge will now wait between reconnection attempts for a given client. Previously, a bug would cause it to tight-loop trying to reconnect.
 - Fixed an issue which could cause an IRC message to make the bridge tight-loop.
 - Capped the `depth` value when introspecting clients in the debug API. Long-running bridges could cause this to error out as idle timers exceeded the stack depth.

Changes in 0.7.2 (2017-04-05)
=============================

New features:
 - Invites from IRC are now forwarded to Matrix. (Thanks @erdnaxeli!)

Improvements:
 - There have been substantial improvements to CPU usage at both startup and normal usage.
 - There have been substantial improvements to RAM usage at both startup and normal usage.
 - Initial Matrix-to-IRC membership list syncing times have been reduced.
 - Trying to join a `+r` channel will now result in being kicked from the corresponding Matrix room.
 - The config option `userModes` is no longer applied to the bridge bot. This allows provisioning requests to continue whilst still having PM guards enabled.
 - Additional IRC domains can now be added. This allows more randomisation than DNS lookups alone. See `config,sample.yaml`.
 - An HTTP(S) socket limit of 1000 has been added to prevent slow Synapse servers from causing the bridge to consume thousands of FDs.
 - Logging has become less verbose and more informative.
 - Metrics will now monitor the number of dropped requests due to `dropMatrixMessagesAfterSecs`.

Bug fixes:
 - Fixed a bug which caused IPv6 DNS rotations to not be honoured when using TLS.
 - Fixed a bug in node-irc which caused `modePowerMap` to not work correctly.
 - Fixed a race condition when creating a dynamic channel which is `+i`, which could cause the resulting Matrix room to not be invite-only.
 - Fixed a race condition which could cause M->I join events to fail if the connection was not yet established.
 - Fixed a bug which caused new public channels which were `+s` to be published to the global directory listing.

Changes in 0.7.1 (2017-01-18)
=============================

Scripts:
 - Added a script which allows bridge operators to remove idle Matrix users from bridged rooms.

New features:
 - IRC operator levels (voice/op/etc) can now be automatically mapped to corresponding Matrix power levels. This mapping is imperfect, but can be used as a coarse guideline for users who want to set room names/topics/etc on Matrix without having to go via the Provisioning API or asking the IRC bridge administrator. See `config.sample.yaml`.
 - `!whois` can now additionally be called with a Matrix user ID which will return the nick of that user ID on the IRC network.

Improvements:
 - Changed the text which is sent when a file/image/video/long text is sent from Matrix to IRC.
 - Concurrently perform `/joined_members` HTTP calls on startup to speed up the process of gathering Matrix users to connect to IRC.
 - Redo the `!help` message.
 - Reduce the amount of debug logging. Redo some log messages to be more informative.
 - IPv6 connections can now be force-enabled without the need for an IPv6 prefix by the `ipv6.only` flag in the config file. (Thanks Oleg Girko <ol@infoserver.lv>)

Bug fixes:
 - Fixed multiple bugs which could cause specific IRC users in specific rooms to not be bridged through to Matrix.
 - Fixed a bug when formatting IRC codes to HTML which would incorrectly treat bold/italics/underline as "enabled" flags rather than "toggle" flags. Previously, the text `hello 0x20x2 world` would incorrectly boldify "world" instead of toggling bold on and off again.
 - Fixed a bug which caused TLS connections over IPv6 to not use DNS rotation.


Changes in 0.7.0 (2016-12-19)
=============================

**BREAKING CHANGES:**
 - The `appService` config value which was deprecated in 0.3.0 has now been removed.
 - This version of the IRC bridge requires Synapse v0.18.5-rc3 or above.
 - Statsd metrics are now deprecated and will be removed in a future release.

Scripts:
 - A script to grant increased power level to a Matrix user in a dynamically bridged IRC room has been added.
 - A script to remove a user from all known bridged IRC rooms has been added.

New features:
 - Storing IRC Passwords:
   - Matrix users can now specify a [server password](https://en.wikipedia.org/wiki/List_of_Internet_Relay_Chat_commands#PASS) to authenticate with the IRC server on startup. On most IRC servers, this is an alternative mechanism to authenticate with NickServ.
   - To enable this functionality in the bridge, a private key needs to be generated. Passwords are stored encrypted at rest.
   - WARNING: the bridge is forced to send plaintext passwords to IRC, _not_ the hash of passwords. Matrix users are trusting the bridge with their actual, plaintext, non-hashed password.
   - Sending `!storepass [server.name]` to the admin room will encrypt and store a password for a Matrix user.
   - Sending `!removepass [server.name]` to the admin room will remove the encrypted password that the user has set from the database.
 - Default user modes:
   - The default user modes for every Matrix user's IRC client can now be set in the config via `ircClients.userModes`.
 - Dropping old Matrix messages:
   - Messages that the bridge receives will be dropped if they are more than _N_ seconds old.
   - This can be configured using the `homeserver.dropMatrixMessagesAfterSecs`.
 - Prometheus metrics:
   - The bridge can now run a `/metrics` listener for Prometheus-based metrics reporting.
   - Metrics can be enabled by setting `metrics.enabled`.
   - Statsd metrics are now **deprecated** and will be removed in a future release.

Improvements:
 - `!quit [server.name]` now attempts to kick the Matrix user that issues the command from the rooms in which they are being briged. This is done before the user's respective IRC client is disconnected.
 - The bridge now randomly jitters quit debounce delays between a minimum and maximum amount of time. This is in order to prevent the HS being sent many leave requests all at once following a net-split that lasts a very long time. (See `quitDebounce` in `config.sample.yaml`)
 - Initial IRC -> Matrix leave syncing is now implemented.
 - Errors received by the bridge when _joining_ an IRC client to a channel can now be seen in the admin room at startup.
 - Provisioning logs are now more detailed.
 - Bridge `m.video` uploads as files.
 - The bridge now uses the AS-specific room publication API. This requires Synapse v0.18.5-rc3 or above.
 - The bridge now uses new Homeserver membership list APIs: `/joined_rooms` and `/rooms/$room_id/joined_members`. This is required in order to sync membership lists. This requires Synapse v0.18.5-rc3 or above.

Bug fixes:
 - Fixed a rare bug which could cause the bridge to tightloop when Matrix users leave a bridged channel.
 - Prevent multiple PM rooms being created when PMs are sent from IRC to Matrix in rapid succession.
 - The namespace that the bridge uses to claim user names and aliases has been restricted to the HS to which it is connected, rather than any HS which might also have an IRC bridge running.
 - Bumped the minimum supported Node.js version from 4.0 to 4.5 to fix a bug which caused TLS and IPv6 to not work together: https://github.com/nodejs/node/pull/6654
 - Ident usernames will now always begin with A-z. Previously, the bridge abided by RFC 2812, but on some networks this was treated as an invalid username.
 - Fixed a regression which prevented banned connections from waiting BANNED_TIME_MS between connection attempts.

Changes in 0.6.0 (2016-10-26)
=============================

New features:
 - Presence Syncing / Quit Debouncing / Net Split Handling: When a net split occurs on IRC and incremental membership list syncing was set to true in previous versions, a lot of spam would be sent to the HS despite the possibility of the same clients reconnecting shortly afterwards. With this new update, QUITs received from IRC are debounced if a net split is considered ongoing. This uses the heuristic of QUITs per second being greater than a certain threshold. If the threshold is reached, debouncing kicks in, delaying the bridging QUITs to the HS for `delayMs`. If the clients reconnect during this grace period, the QUIT is not bridged. In the meantime, Matrix presence is used to indicate that the user is offline. The associated configuration for this can be found in `config.sample.yaml` as `quitDebounce`.
 - Topic Bridging: Topics are now bridged from IRC to Matrix in aliased rooms or rooms created via `!join` in the admin room.
 - Custom CA: A custom Certificate Authority certificate can now be given in the config file for using SSL to connect to IRC servers. (Thanks, @Waldteufel!)
 - Custom Media Repo: `media_url` in the bridge config file can now be set for setups where media uploaded on the Matrix side is not stored at the connected HS.

Improvements:
 - Add `!quit server.name` admin room command to disconnect an associated virtual IRC user from a given IRC server.
 - Turn of AS rate limiting when generating registration files.
 - `!join` admin room command now creates rooms with the join rule set to `dynamicChannels.joinRule` instead of always being private.

Bug fixes:
 - !help command no longer requires server name
 - The bridge now ignores NickServ and ChanServ PMs that previously it was trying to bridge erroneously.
 - Fix plumbing channels with capital letters in them.
 - Fix flaky tests(!) due to not killing bridged client instances between tests.
 - Fix the bridge taking forever calling `/initialSync` on the HS when a user leaves a room bridged into >1 channel. It instead uses `/$room_id/state` for each bridged room.

Changes in 0.5.0 (2016-10-06)
=============================

New features:
 - A new server config item, ```reconnectIntervalMs``` has been added and is used to throttle reconnections to an IRC server in a queue, where one reconnection is serviced per interval.
 - Added Third Party Lookup - for mapping IRC user/channel names into Matrix user IDs or room aliases.
 - Added config ```floodDelayMs``` which is used to drip feed membership entries at the specified rate when syncing membership.

Improvements:
 - Provisioning:
   - Provisioning of mappings has been improved by requiring that an IRC channel operator (or admin) in the plumbed channel respond with 'yes'/'y' before the mapping can be created to prevent abuse.
   - During provisioning, matrix room state ```m.room.bridging``` is used in the room in the new mapping to signal whether the status of the bridging is 'pending', 'success', or 'failure':
    ```JS
    {
        content: {
            bridger: 'nick',
            status: 'pending'
        }
    }
    ```
   - Route loops are now prevented using ```m.room.bridging``` as an indication that bridging exists.
   - The ```queryLink``` endpoint for asking for a list of operators in a given channel has been added. This list is acquired through the bot joining a channel, but they are cached temporarily to reduce join/part spam.
   - The ```queryNetworks``` endpoint was added and can be used to query the available networks on the bridge.
   - The IRC bot will leave a channel if it is no longer mapped to any other upon unlinking. The matrix bot will also leave an totally unlinked room.
   - Better error message are given when linking.
   - Only moderators in a matrix room can unlink.
 - The wording of messages sent to admin rooms has been improved, as well as a helpful message to get things started.
 - Sync +s mode in channels with room visibility. +s = 'hidden from published room directory', -s = 'listed on the published room directory'.

Bug fixes:
 - Room alias requests can only be done for channels that start with ```#``` to avoid confusion with people not being able to join ```#ircnetwork_somechannel:domain.com```. The important thing being the missing ```#``` before ```somechannel```.
 - Prevent admin room from being created when plumbing. Previously, the bot would treat a linked room as an admin room, and so allow users to issue commands in it (but only after unlinking again).
 - If the bot is enabled, join a channel when linked.
 - Part IRC clients which should no longer be in a channel due to unlinking.
 - When an IPv6 prefix is provided, assume outgoing IRC connections will be IPv6, instead of relying on the specified IRC domain only resolving to IPv6 addresses. Previously, this would cause issues with IPv6 bound outgoing connections attempting to connect to IPv4 addresses.
 - Do not cache stale clients in the client pool. Previously, stale BridgedClients would be left in the client pool if the bot was disconnected and then reconnected. This resulted in the bot being unable to respond or join/leave channels when requested to by provisioning request.


Changes in 0.4.0
================

New features:
 - Kicks to and from Matrix will now be mirrored. This does not alter the
   ops/power level of any user, and hence may not always succeed.
 - PM rooms now have a `federate` flag to control whether they can be federated
   or not (via the `m.federate` option on the room creation).
 - Long messages sent from Matrix will now be uploaded to Matrix as `.txt` files
   before being sent to IRC. The number of lines allowed before uploading can
   be configured by a new `lineLimit` option in `config.yaml`.
 - Add a dynamic provisioning API to create/delete Matrix<-->IRC links on a
   running bridge instance. These links do NOT have preference over config-specified
   mappings.
 - Allow arbitrary IRC commands to be sent to an IRC network via the Matrix
   admin room.

Improvements:
 - Connection notices will now only be sent to Matrix users after receiving
   `RPL_WELCOME` rather than establishing a TCP connection. This reduces message
   spam when connections fail to register (due to throttling, etc).
 - User and Alias regexes generated by the bridge will now be scoped to the
   homeserver rather than set as a wildcard (which would result in traffic from
   federated servers being sent to the bridge).
 - When an IRC connection receives an error that means they failed to join the
   channel (e.g. `err_bannedfromchan`), the bridge will now kick the corresponding
   Matrix user from the room.

Bug fixes:
 - Fixed a bug whereby a metric was not sent to update the connected client count
   when reconnecting.
 - Fixed a bug whereby a nick set via `!nick` would not be persisted through
   reconnections.
 - Fixed a bug which caused the static config mappings to be preserved even when
   they were changed in `config.yaml`.

Changes in 0.3.1
================
New Features:
 - A "debug API" has been added and can be enabled via `ircService.debugApi.enabled: true`.
   See `config.sample.yaml` for the exposed REST API.
 - A new command `!whois Nick` has been added.
 - IRC channels with `+k` (a password is required) can now be accessed via the bridge using
   the `!join` command, which now has an optional `key` parameter.

Improvements:
 - Nickname validation logic now more accurately tracks RFC 2812 - in particular the allowed
   *first* character of a nick. The max nickname length (9) in RFC 2812 is ignored, as most
   servers have a higher limit (30) and connecting with a shortened form and then expanding
   it based on the `RPL_ISUPPORT NICKLEN` is needlessly tedious given most IRC servers
   automatically truncate long nicknames.
 - If a Matrix user leaves a PM room with an IRC user and the IRC user sends a message to
   them, the bridge will now automatically re-invite the Matrix user back into the room
   they left.
 - Issuing a `!join` command will now make the connected IRC client send a `JOIN` under
   the following circumstances:
     * The `!join` has a `key` - This is necessary because the bridge does not store channel keys.
     * The bridge is mirroring Matrix-to-IRC joins.

Bug fixes:
 - Fixed various issues with responses to the `!nick` command. It will now time out after
   10 seconds, rather than listen indefinitely for the next `NICK` reply. It will also
   listen for a wide variety of `NICK` error replies, including some server-specific error
   codes, in order to fail faster. In addition, the `|` character is now correctly allowed
   as part of a nickname for `!nick` commands.
 - Fixed a bug whereby starting the bridge pointed to an inactive Homeserver would cause
   the bridge to fail to start up and not terminate the process. The bridge will now retry
   `/initialSync` indefinitely so it can start up as soon as the Homeserver becomes active
   again.
 - Fixed a bug which caused the bridge to terminate due to `ECONNRESET`.
 - Fixed a bug which caused the bridge to attempt to set the `TOPIC` of an IRC channel
   based on an `m.room.topic` which did not have a `state_key` of `""`.
 - Fixed a bug which caused initial IRC-to-Matrix membership list syncing to not occur,
   even if it was enabled in `config.yaml`.

Changes in 0.3.0
================
This update implements full `matrix-appservice-bridge` support in the IRC bridge and adds a number of smaller features.

**BREAKING CHANGES:**
 - The structure of the NEDB databases has changed. You must run the [the upgrade script](https://github.com/matrix-org/matrix-appservice-irc/blob/develop/scripts/upgrade-db-0.1-to-0.2.js) in order to continue running the bridge. This must then be followed by [another upgrade script](https://github.com/matrix-org/matrix-appservice-irc/blob/develop/scripts/upgrade-db-0.2-to-0.3.js).
 - The CLI args have changed in this version to bring them in-line with [the bridge library](https://github.com/matrix-org/matrix-appservice-bridge):
    * To generate a registration file:

        ```
        node app.js -r [-f /path/to/save/registration.yaml] -u 'http://localhost:6789/appservice' -c CONFIG_FILE [-l my-app-service]
        ```
    * To run the bridge:

      ```
      node -c CONFIG_FILE [-f /path/to/load/registration.yaml] [-p NUMBER]
      ```

New Features:
 - Nicks set via `!nick` will now be preserved across bridge restarts.
 - EXPERIMENTAL: IRC clients created by the bridge can be assigned their own IPv6 address.
 - The bridge will now send connection status information to real Matrix users via the admin room (the same room `!nick` commands are issued).
 - Added `!help`.
 - The bridge will now fallback to `body` if the HTML content contains *any* unrecognised tags. This makes passing Markdown from Matrix to IRC much nicer.
 - The bridge will now send more metrics to the statsd server, including the join/part rate to and from IRC.
 - The config option `matrixClients.displayName` is now implemented.

Bug fixes:
 - Escape HTML entities when sending from IRC to Matrix. This prevents munging occurring between IRC formatting and textual < element > references, whereby if you sent a tag and some colour codes from IRC it would not escape the tag and therefore send invalid HTML to Matrix.
 - User IDs starting with `-` are temporarily filtered out from being bridged.
 - Deterministically generate the configuration file.
 - Recognise more IRC error codes as non-fatal to avoid IRC clients reconnecting unecessarily.
 - Add a 10 second timeout to join events injected via the `MemberListSyncer` to avoid HOL blocking.
 - 'Frontier' Matrix users will be forcibly joined to IRC channels even if membership list syncing I->M is disabled. This ensures that there is always a Matrix user in the channel being bridged to avoid losing traffic.
 - Cache the `/initialSync` request to avoid hitting this endpoint more than once, as it may be very slow.
 - Indexes have been added to the NeDB .db files to improve lookup times.
 - Do not recheck if the bridge bot should part the channel if a virtual user leaves the channel: we know it shouldn't.
 - Refine what counts as a "request" for metrics, reducing the amount of double-counting as requests echo back from the remote side.
 - Fixed a bug which caused users to be provisioned off their `user_id` even if they had a display name set.

Changes in 0.1.1
================
**Requires Node v4+**

Features:
 - `app.js` is now added to `.bin` so can be invoked directly.
 - Added config option `ircClients.idleTimeout` to allow virtual IRC clients to
   timeout after a specified amount of time.
 - **Deprecate** `dynamicChannels.visibility` in favour of
   `dynamicChannels.createAlias`, `dynamicChannels.published` and
   `dynamicChannels.joinRule` which gives more control over how the AS creates
   dynamic rooms.
 - Added `matrixClients.mirrorJoinPart` to make virtual IRC users join and part
   as their real Matrix counterparts join and leave rooms (the other way around
   to the existing `ircClients.mirrorJoinPart`).
 - Added a `membershipLists` section to control syncing of membership lists.

Improvements:
 - Replaced `check.sh` with `npm run lint` and `npm run check`.
 - Listen for `+k` and `+i` modes and change the `join_rules` of the Matrix
   room to `invite` when they are set. Revert back to the YAML configured
   `join_rules` when these modes are removed.

Bug fixes:
 - Make channels case-insensitive when joining via room aliases and when mapping
   to rooms.
 - Strip unknown HTML tags from Matrix messages before sending to IRC.
 - Don't try to leave Matrix rooms if the IRC user who left is a virtual user.
 - And more..
