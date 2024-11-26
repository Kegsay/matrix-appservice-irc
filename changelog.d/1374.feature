Add ability to specify realname by template.

This deprecates the old mxid/reverse-mxid format (though it's still available).
Behaves similar to nickTemplate. Available templating variables:

* `$DISPLAY`: Matrix user display name
* `$USERID`:User mxid
* `$LOCALPART`: Matrix user localpart
* `$REVERSEID`: User mxid with host and localpart swapped
* `$IRCUSER`: IRC username

