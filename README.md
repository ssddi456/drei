# Drei

[![](https://vsmarketplacebadge.apphb.com/version-short/ssddi456.drei.svg?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=ssddi456.drei)
[![](https://vsmarketplacebadge.apphb.com/installs-short/ssddi456.drei.svg?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=ssddi456.drei)
[![](https://vsmarketplacebadge.apphb.com/rating-short/ssddi456.drei.svg?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=ssddi456.drei)

San tooling for VS Code.

This is fork from [vetur](https://github.com/vuejs/vetur), which is vue's vscode extension, 

I make it support [san](https://github.com/baidu/san)'s language features.

Search `drei` in vs market to install.

## Features

- Syntax-highlighting
- Snippet
- Emmet
- Formatting
- Auto Completion

## Features in Plan

- data path intelligence
- Lint & Error checking

## Requirements

develop and test on vscode >= 1.23.1

## Extension Settings

basicly the same as vetur's setting

## Known Issues

at this time

- doesn't validate all interpolation properly, treat interpollation as full functional js but it isn't.
- doesn't support type check and intellisense for filter function type which in interpolation
- doesn't support type check and intellisense for variables which in scoped slot 
- doesn't support type check and intellisense for sanData's data path and params

## Release Notes
0.0.9
-----
* improve type suggestions

0.0.7
-----
* support basic interpolation validation

0.0.4
-----
* support interpolation hover info and goto definition.

0.0.2
-----
* first release
