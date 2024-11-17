Matrix IRC Bridge
----------------------

![Docker Image Version (latest semver)](https://img.shields.io/docker/v/matrixdotorg/matrix-appservice-irc)
[![Build Status](https://badge.buildkite.com/f33ff3f5e59aed3057cec0215a84e26747581e0fcb09b4b699.svg?branch=master)](https://buildkite.com/matrix-dot-org/matrix-appservice-irc)
[![#irc:matrix.org](https://img.shields.io/matrix/irc:matrix.org.svg?server_fqdn=matrix.org&label=%23irc:matrix.org&logo=matrix)](https://matrix.to/#/#irc:matrix.org)

This is an IRC bridge for [Matrix](https://matrix.org). If you're upgrading from an
old release, be sure to read the [CHANGELOG](./CHANGELOG.md) as there may be breaking changes between releases.

This bridge will pass all IRC messages through to Matrix, and all Matrix messages through to IRC. It is highly
configurable and is currently used on the matrix.org homeserver to bridge a number of popular IRC networks.

We maintain a list of bridged IRC networks [here](https://matrix-org.github.io/matrix-appservice-irc/latest/bridged_networks).


## What does it do?

On startup, the bridge will join Matrix clients to the IRC channels specified in the configuration file. It
will then listen for incoming IRC messages and forward them through to Matrix rooms
Each real Matrix user is represented by an IRC client, and each real IRC client is represented by a Matrix user. Full
two-way communication in channels and PMs are supported, along with a huge array of customisation options.

## Usage

To learn how to use the bridge, see our [usage guide](https://matrix-org.github.io/matrix-appservice-irc/latest/usage).

## Setting up your own bridge

You will need a Matrix homeserver to run this bridge. Any homeserver that supports the AS API
should work.

See [the getting started docs](https://matrix-org.github.io/matrix-appservice-irc/latest/bridge_setup)
for instructions on how to set up the bridge.

### Configuration

See [the sample config file](./config.sample.yaml) for an explanation of the
configuration options available.


### Documentation

Documentation can be found on [GitHub Pages](https://matrix-org.github.io/matrix-appservice-irc).

You can build the documentation yourself by:
```
# Ensure that Rust is installed on your system.
# cargo install mdbook
mdbook build
sensible-browser book/index.html
```

## Contributing
Please see the [CONTRIBUTING](./CONTRIBUTING.md) file for information on contributing.
