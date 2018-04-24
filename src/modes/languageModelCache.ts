import { TextDocument } from 'vscode-languageserver';
import { logger } from '../utils/logger';

export interface LanguageModelCache<T> {
    get(document: TextDocument): T;
    onDocumentRemoved(document: TextDocument): void;
    dispose(): void;
}

export function getLanguageModelCache<T>(
    maxEntries: number,
    cleanupIntervalTimeInSec: number,
    parse: (document: TextDocument) => T
): LanguageModelCache<T> {
    let languageModels: { [uri: string]: { version: number; languageId: string; cTime: number; languageModel: T } } = {};
    let nModels = 0;

    let cleanupInterval: NodeJS.Timer;
    if (cleanupIntervalTimeInSec > 0) {
        cleanupInterval = setInterval(() => {
            const cutoffTime = Date.now() - cleanupIntervalTimeInSec * 1000;
            const uris = Object.keys(languageModels);
            for (const uri of uris) {
                const languageModelInfo = languageModels[uri];
                if (languageModelInfo.cTime < cutoffTime) {
                    delete languageModels[uri];
                    nModels--;
                }
            }
        }, cleanupIntervalTimeInSec * 1000);
    }

    return {
        get(document: TextDocument): T {
            const version = document.version;
            const languageId = document.languageId;
            const languageModelInfo = languageModels[document.uri];

            logger.log(() => `get or set cache
document.uri ${document.uri}
version ${version}
languageId ${languageId}`);

            if (languageModelInfo && languageModelInfo.version >= version && languageModelInfo.languageId === languageId) {
                languageModelInfo.cTime = Date.now();

                logger.log(() => `get cache
document.uri ${document.uri}
version ${version} ${languageModelInfo && languageModelInfo.version}
languageId ${languageId} ${languageModelInfo && languageModelInfo.languageId}
content ${ TextDocument.is(languageModelInfo.languageModel) ? languageModelInfo.languageModel.getText() : ''}`);

                return languageModelInfo.languageModel;
            }

            const languageModel = parse(document);

            logger.log(() => `set cache
document.uri ${document.uri}
version ${version} ${languageModelInfo && languageModelInfo.version}
languageId ${languageId} ${languageModelInfo && languageModelInfo.languageId}
content ${TextDocument.is(languageModel) ? languageModel.getText() : ''}`);

            languageModels[document.uri] = { languageModel, version, languageId, cTime: Date.now() };
            if (!languageModelInfo) {
                nModels++;
            }

            if (nModels === maxEntries) {
                let oldestTime = Number.MAX_VALUE;
                let oldestUri = null;
                for (const uri in languageModels) {
                    const languageModelInfo = languageModels[uri];
                    if (languageModelInfo.cTime < oldestTime) {
                        oldestUri = uri;
                        oldestTime = languageModelInfo.cTime;
                    }
                }
                if (oldestUri) {
                    delete languageModels[oldestUri];
                    nModels--;
                }
            }
            return languageModel;
        },
        onDocumentRemoved(document: TextDocument) {
            const uri = document.uri;
            if (languageModels[uri]) {
                delete languageModels[uri];
                nModels--;
            }
        },
        dispose() {
            if (typeof cleanupInterval !== 'undefined') {
                clearInterval(cleanupInterval);
                cleanupInterval = null as any;
                languageModels = {};
                nModels = 0;
            }
        }
    };
}
