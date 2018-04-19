import { LanguageModelCache, getLanguageModelCache } from '../languageModelCache';
import { DocumentContext } from '../../service';
import { TextDocument, Position, Range, FormattingOptions } from 'vscode-languageserver-types';
import { LanguageMode } from '../languageModes';
import { SanDocumentRegions } from '../embeddedSupport';

import { HTMLDocument } from './parser/htmlParser';
import { doComplete } from './services/htmlCompletion';
import { doHover } from './services/htmlHover';
import { findDocumentHighlights } from './services/htmlHighlighting';
import { findDocumentLinks } from './services/htmlLinks';
import { findDocumentSymbols } from './services/htmlSymbolsProvider';
import { htmlFormat } from './services/htmlFormat';
import { parseHTMLDocument } from './parser/htmlParser';
import { doValidation, createLintEngine } from './services/htmlValidation';
import { findDefinition } from './services/htmlDefinition';
import { getTagProviderSettings } from './tagProviders';
import { ScriptMode } from '../script/javascript';
import { getComponentTags, getEnabledTagProviders } from './tagProviders';

import * as _ from 'lodash';
import { createInterpolationFileName } from '../script/preprocess';
import { NULL_HOVER, NULL_COMPLETION } from '../nullMode';

type DocumentRegionCache = LanguageModelCache<SanDocumentRegions>;

export function getSanHTMLMode(
    documentRegions: DocumentRegionCache,
    workspacePath: string | null | undefined,
    scriptMode: ScriptMode
): LanguageMode {
    let tagProviderSettings = getTagProviderSettings(workspacePath);
    let enabledTagProviders = getEnabledTagProviders(tagProviderSettings);
    const embeddedDocuments = getLanguageModelCache<TextDocument>(10, 60, document =>
        documentRegions.get(document).getEmbeddedDocument('san-html')
    );
    const sanDocuments = getLanguageModelCache<HTMLDocument>(10, 60, document => parseHTMLDocument(document));
    const lintEngine = createLintEngine();
    let config: any = {};

    function hookdCallScriptMode<T>(
        hookedMethod: (document: TextDocument, position: Position) => T,
        replaceWith: (document: TextDocument, position: Position) => T,
        nullValue: T) {
        return function (document: TextDocument, position: Position) {
            const embedded = embeddedDocuments.get(document);
            const htmlDocument = sanDocuments.get(embedded);
            const offset = document.offsetAt(position);
            const node = htmlDocument.findNodeAt(offset);
            if (!node) {
                console.log('nothing todo  return nullval');
                return nullValue;
            }
            console.log('find html node', node);
            if (node.isInterpolation) {
                const insertedDocument = TextDocument.create(
                    createInterpolationFileName(document.uri, node.pos),
                    'typescript',
                    document.version,
                    '');
                return replaceWith(insertedDocument, position);
            }
            return hookedMethod(document, position);
        }
    }


    const htmlLanguageServer: LanguageMode = {
        getId() {
            return 'san-html';
        },
        configure(c) {
            tagProviderSettings = _.assign(tagProviderSettings, c.html.suggest);
            enabledTagProviders = getEnabledTagProviders(tagProviderSettings);
            config = c;
        },
        doValidation(document) {
            console.log('start html do doValidation', document.uri);
            const embedded = embeddedDocuments.get(document);
            return doValidation(embedded, lintEngine);
        },
        doComplete(document: TextDocument, position: Position) {
            console.log('start html do doComplete', document.uri);
            const embedded = embeddedDocuments.get(document);
            const components = scriptMode.findComponents(document);
            const tagProviders = enabledTagProviders.concat(getComponentTags(components));
            return doComplete(embedded, position, sanDocuments.get(embedded), tagProviders, config.emmet);
        },
        doHover(document: TextDocument, position: Position) {
            console.log('start html do doHover', document.uri);
            const embedded = embeddedDocuments.get(document);
            const components = scriptMode.findComponents(document);
            const tagProviders = enabledTagProviders.concat(getComponentTags(components));
            return doHover(embedded, position, sanDocuments.get(embedded), tagProviders, scriptMode);
        },
        findDocumentHighlight(document: TextDocument, position: Position) {
            console.log('start html do findDocumentHighlight', document.uri);
            return findDocumentHighlights(document, position, sanDocuments.get(document));
        },
        findDocumentLinks(document: TextDocument, documentContext: DocumentContext) {
            return findDocumentLinks(document, documentContext);
        },
        findDocumentSymbols(document: TextDocument) {
            return findDocumentSymbols(document, sanDocuments.get(document));
        },
        format(document: TextDocument, range: Range, formattingOptions: FormattingOptions) {
            if (config.drei.format.defaultFormatter.html === 'none') {
                return [];
            }
            return htmlFormat(document, range, formattingOptions, config);
        },
        findDefinition(document: TextDocument, position: Position) {
            console.log('start html do findDefinition', document.uri);
            const embedded = embeddedDocuments.get(document);
            const components = scriptMode.findComponents(document);
            return findDefinition(embedded, position, sanDocuments.get(embedded), components);
        },
        onDocumentRemoved(document: TextDocument) {
            sanDocuments.onDocumentRemoved(document);
        },
        dispose() {
            console.log('start html do dispose');
            sanDocuments.dispose();
        }
    };

    htmlLanguageServer.doHover = hookdCallScriptMode(htmlLanguageServer.doHover, scriptMode.doHover, NULL_HOVER);
    htmlLanguageServer.findDefinition = hookdCallScriptMode(htmlLanguageServer.findDefinition, scriptMode.findDefinition, []);
    htmlLanguageServer.doComplete = hookdCallScriptMode(htmlLanguageServer.doComplete, scriptMode.doComplete, NULL_COMPLETION);


    return htmlLanguageServer;
}
