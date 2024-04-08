A wishlist of IRC networks to be bridged is being collected [in a github issue](https://github.com/matrix-org/matrix-appservice-irc/issues/208).

| Network Name | Room alias format                         | Appservice user                    | Room for Support               | Operator                                  |
|--------------|-------------------------------------------|------------------------------------|--------------------------------|-------------------------------------------|
| darkfasel    | `#channame:darkfasel.net`                 | [`@IRC-Darkfasel:darkfasel.net`]   | [`#darkfasel:darkfasel.net`]   | [darkfasel](https://www.darkfasel.net/)   |
| fc00         | `#fc00-irc_#channame:m.trnsz.com`         | [`@fc00ircmtx:m.trnsz.com`]        | None                           |                                           |
| GIMPNet[^1]  | `#_gimpnet_#channame:gnome.org`           | [`@gimpnet-irc:gnome.org`][^2]     | [`#irc:matrix.org`]            | [Matrix.org] / [Gnome.org]                |
| IRCnet       | `#_ircnet_#channame:irc.snt.utwente.nl`   | [`@ircnet:irc.snt.utwente.nl`]     | [`#ircnet:utwente.io`]         | [SNT]                                     |
| OFTC[^3]     | `#_oftc_#channame:matrix.org`             | [`@oftc-irc:matrix.org`]           | [`#irc:matrix.org`]            | [Matrix.org]                              |
| PirateIRC    | `#pirateirc_#channame:diasp.in`           | [`@pirateirc:diasp.in`]            | [`#diasp.in:diasp.in`]         | [Indian Pirates](https://pirates.org.in/) |
| Snoonet      | `#_snoonet_#channame:matrix.org`          | [`@snoonet-irc:matrix.org`]        | [`#irc:matrix.org`]            | [Matrix.org]                              |
| Tweakers.net | `#_tweakers_#channame:irc.snt.utwente.nl` | [`@tweakers:irc.snt.utwente.nl`]   | [`#tweakers-irc:utwente.io`]   | [SNT]                                     |
| irchighway   | `#irchighway_#channame:eggy.cc`           | [`@appservice-irc:eggy.cc`]        | [`#eggster:eggy.cc`]           | [Eggy](http://eggy.cc/)                   |
| W3C          | `#_w3c_#channame:matrix.org`              | [`@w3c-irc:matrix.org`]            | [`#irc:matrix.org`]            | [Matrix.org]                              |
| LibertaCasa  | `#channame:liberta.casa`                  | [`@lunatic:liberta.casa`]          | [`#help:liberta.casa`]         | [LibertaCasa](https://liberta.casa)
| hackint      | `#channame:hackint.org`                   | [`@appservice-irc:hackint.org`]    | [`#hackint:hackint.org`]       | [hackint](https://hackint.org/)

[`@IRC-Darkfasel:darkfasel.net`]: https://matrix.to/#/@IRC-Darkfasel:darkfasel.net
[`@fc00ircmtx:m.trnsz.com`]: https://matrix.to/#/@fc00ircmtx:m.trnsz.com
[`@appservice-irc:matrix.org`]: https://matrix.to/#/@appservice-irc:matrix.org
[`@gimpnet-irc:gnome.org`]: https://matrix.to/#/@gimpnet-irc:gnome.org
[`@ircnet:irc.snt.utwente.nl`]: https://matrix.to/#/@ircnet:irc.snt.utwente.nl
[`@oftc-irc:matrix.org`]: https://matrix.to/#/@oftc-irc:matrix.org
[`@pirateirc:diasp.in`]: https://matrix.to/#/@pirateirc:diasp.in
[`@snoonet-irc:matrix.org`]: https://matrix.to/#/@snoonet-irc:matrix.org
[`@tweakers:irc.snt.utwente.nl`]: https://matrix.to/#/@tweakers:irc.snt.utwente.nl
[`@appservice-irc:eggy.cc`]: https://matrix.to/#/@appservice-irc:eggy.cc
[`@w3c-irc:matrix.org`]: https://matrix.to/#/@w3c-irc:matrix.org
[`@appservice:libera.chat`]: https://matrix.to/#/@appservice:libera.chat
[`@lunatic:liberta.casa`]: https://matrix.to/#/@lunatic:liberta.casa
[`@appservice-irc:hackint.org`]: https://matrix.to/#/@appservice-irc:hackint.org

[`#irc:matrix.org`]: https://matrix.to/#/%23irc:matrix.org
[`#darkfasel:darkfasel.net`]: https://matrix.to/#/%23darkfasel:darkfasel.net
[`#ircnet:utwente.io`]: https://matrix.to/#/%23ircnet:utwente.io
[`#diasp.in:diasp.in`]: https://matrix.to/#/%23diasp.in:diasp.in
[`#tweakers-irc:utwente.io`]: https://matrix.to/#/%23tweakers-irc:utwente.io
[`#eggster:eggy.cc`]: https://matrix.to/#/%23eggster:eggy.cc
[`#libera-matrix:libera.chat`]: https://matrix.to/#/%23libera-matrix:libera.chat
[`#help:liberta.casa`]: https://matrix.to/#/%23help:liberta.casa
[`#hackint:hackint.org`]: https://matrix.to/#/%23hackint:hackint.org

[Matrix.org]: https://matrix.org/
[Gnome.org]: https://gnome.org/
[SNT]: https://snt.utwente.nl/en/

* Random.sh is no longer contactable. Status of the bridge is unknown.
* Foonetic IRC has shut down. #xkcd channels [moved to slashnet](https://web.archive.org/web/20190824061533/http://wiki.xkcd.com/irc/Main_Page#Channel_Migration).
* The Espernet bridge was shut down after the 2019 matrix.org network breach.
* The Moznet IRC network has been shut down. They now run their own Matrix homeserver at [chat.mozilla.org](https://chat.mozilla.org/) 🎉.
* The freenode IRC bridge offically was shut down on 2021-12-20.
* The Libera Chat IRC bridge [was shut down on 2023-11-28](https://matrix.org/blog/2023/11/28/shutting-down-bridge-to-libera-chat/).

### Footnotes

[^1]: This includes both irc.gimp.org and irc.gnome.org, as they are the same thing.

[^2]: The bridge has moved from matrix.org to gnome.org.

[^3]: OFTC does not support SASL at the time of writing, so after reconnects you need to manually REGAIN your nickname with NickServ. See https://github.com/matrix-org/matrix-appservice-irc/issues/1483 for details
