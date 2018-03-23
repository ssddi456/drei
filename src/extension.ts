/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

function getLogger(..._args: any[]) {
    const tempLogFile = 'D:/temp/test.log';
    return {
        info(...args: any[]) {
            fs.appendFileSync(tempLogFile, `\n[${new Date}] client ${args.map((x) => { 
                if (typeof x == 'string'){
                    return x;
                }
                try {
                    return util.inspect(x);
                } catch(e){
                    return Object.prototype.toString.call(x);
                }
            }).join(' ')}`);
        },
        clear() {
            fs.unlinkSync(tempLogFile)
        },
        trace(msg: string) {
            this.info(`${msg}
            ${new Error().stack.split('\n').slice(3, 10).join('\n')}`);
        }
    }
}

getLogger().info('wtf?????');
process.on('uncaughtException', function (e: Error) {
    getLogger().info(e);
});

import { workspace, ExtensionContext, languages, IndentAction } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, RevealOutputChannelOn } from 'vscode-languageclient';
import { EMPTY_ELEMENTS } from './modes/template/tagProviders/htmlTags';

export function activate(context: ExtensionContext) {
    getLogger().info('activate');

    // The server is implemented in node
    let serverModule = context.asAbsolutePath(path.join('out', 'src', 'server.js'));
    // The debug options for the server
    let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    }
    const config = workspace.getConfiguration();
    getLogger().info('config =', config);

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [
            { scheme: 'file', language: 'san' },
        ],
        synchronize: {
            // the settings to synchronize
            configurationSection: ['drei', 'emmet', 'html', 'javascript', 'typescript', 'prettier', 'stylusSupremacy'],
        },
        initializationOptions: {
            config
        },
        revealOutputChannelOn: RevealOutputChannelOn.Never
    }

    // Create the language client and start the client.
    let disposable = new LanguageClient('drei', 'San component file language intelligence', serverOptions, clientOptions).start();

    // Push the disposable to the context's subscriptions so that the 
    // client can be deactivated on extension deactivation
    context.subscriptions.push(disposable);
    getLogger().info('subscriptions push');

    languages.setLanguageConfiguration('san-html', {
        wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
        onEnterRules: [
            {
                beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
                afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
                action: { indentAction: IndentAction.IndentOutdent }
            },
            {
                beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
                action: { indentAction: IndentAction.Indent }
            }
        ]
    });
}
