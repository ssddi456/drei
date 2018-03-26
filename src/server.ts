/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    IPCMessageReader, IPCMessageWriter, createConnection, IConnection, TextDocuments, TextDocument,
    Diagnostic, InitializeResult
} from 'vscode-languageserver';

import {
    Range, Position,
} from 'vscode-languageserver-types';

import Uri from 'vscode-uri';
import { DocumentContext, getSanLS } from './service/';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';


function getLogger(...args: any[]) {
    const tempLogFile = 'D:/temp/test.log';
    return {
        info(...args:any[]) {
            return;
            fs.appendFileSync(tempLogFile, `\n[${new Date}] server ${args.map( x=> typeof x == 'string' ? x: util.inspect(x)).join(' ')}`);
        },
        clear() {
            return;
            fs.unlinkSync(tempLogFile)
        },
        trace(msg: string) {
            return;
            this.info(`${msg}
            ${new Error().stack.split('\n').slice(3, 10).join('\n')}`);
        }
    }
}


// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
// make a log file here
console.log = getLogger().info;
console.error = getLogger().trace;
process.on('uncaughtException', function( e: Error ){
    console.log(e);
});
console.log('yes i startup!');

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events

let workspacePath: string | null | undefined;
let config: any = {};
const sls = getSanLS();


documents.listen(connection);

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
connection.onInitialize((_params): InitializeResult => {
    console.log(_params);
    const initializationOptions = _params.initializationOptions;

    workspacePath = _params.rootPath;
    sls.initialize(workspacePath);

    documents.onDidClose(e => {
        sls.removeDocument(e.document);
    });
    connection.onShutdown(() => {
        sls.dispose();
    });

    if (initializationOptions) {
        config = initializationOptions.config;
    }
    return {
        capabilities: {
            textDocumentSync: documents.syncKind,
            completionProvider: { resolveProvider: true, triggerCharacters: ['.', '<', '"', '/', '*'] },
            signatureHelpProvider: { triggerCharacters: ['('] },
            documentFormattingProvider: true,
            hoverProvider: true,
            documentHighlightProvider: true,
            documentSymbolProvider: true,
            definitionProvider: true,
            referencesProvider: true,
        }
    }
});

// The settings have changed. Is send on server activation as well.
connection.onDidChangeConfiguration(change => {
    config = change.settings;
    sls.configure(config);

    // Update formatting setting
    documents.all().forEach(triggerValidation);
});

const pendingValidationRequests: { [uri: string]: NodeJS.Timer } = {};
const validationDelayMs = 200;

// When the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    triggerValidation(change.document);
});

// A document has closed: clear all diagnostics
documents.onDidClose(event => {
    cleanPendingValidation(event.document);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function cleanPendingValidation(textDocument: TextDocument): void {
    const request = pendingValidationRequests[textDocument.uri];
    if (request) {
        clearTimeout(request);
        delete pendingValidationRequests[textDocument.uri];
    }
}

function triggerValidation(textDocument: TextDocument): void {
    cleanPendingValidation(textDocument);
    pendingValidationRequests[textDocument.uri] = setTimeout(() => {
        delete pendingValidationRequests[textDocument.uri];
        validateTextDocument(textDocument);
    }, validationDelayMs);
}

function validateTextDocument(textDocument: TextDocument): void {
    const diagnostics: Diagnostic[] = sls.validate(textDocument);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onCompletion(textDocumentPosition => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    return sls.doComplete(document, textDocumentPosition.position);
});

connection.onCompletionResolve(item => {
    const data = item.data;
    if (data && data.languageId && data.uri) {
        const document = documents.get(data.uri);
        return sls.doResolve(document, data.languageId, item);
    }
    return item;
});

connection.onHover(textDocumentPosition => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    return sls.doHover(document, textDocumentPosition.position);
});

connection.onDocumentHighlight(documentHighlightParams => {
    const document = documents.get(documentHighlightParams.textDocument.uri);
    return sls.findDocumentHighlight(document, documentHighlightParams.position);
});

connection.onDefinition(definitionParams => {
    const document = documents.get(definitionParams.textDocument.uri);
    return sls.findDefinition(document, definitionParams.position);
});

connection.onReferences(referenceParams => {
    const document = documents.get(referenceParams.textDocument.uri);
    return sls.findReferences(document, referenceParams.position);
});

connection.onSignatureHelp(signatureHelpParms => {
    const document = documents.get(signatureHelpParms.textDocument.uri);
    return sls.doSignatureHelp(document, signatureHelpParms.position);
});

connection.onDocumentFormatting(formatParams => {
    const document = documents.get(formatParams.textDocument.uri);
    const fullDocRange = Range.create(Position.create(0, 0), document.positionAt(document.getText().length));
    return sls.format(document, fullDocRange, formatParams.options);
});

connection.onDocumentLinks(documentLinkParam => {
    const document = documents.get(documentLinkParam.textDocument.uri);
    const documentContext: DocumentContext = {
        resolveReference: ref => {
            if (workspacePath && ref[0] === '/') {
                return Uri.file(path.join(workspacePath, ref)).toString();
            }
            return url.resolve(document.uri, ref);
        }
    };
    return sls.findDocumentLinks(document, documentContext);
});

connection.onDocumentSymbol(documentSymbolParms => {
    const document = documents.get(documentSymbolParms.textDocument.uri);
    return sls.findDocumentSymbols(document);
});

// Listen on the connection
connection.listen();
