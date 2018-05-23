import * as path from 'path';
import * as ts from 'typescript';
import Uri from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-types';
import * as parseGitIgnore from 'parse-gitignore';

import { LanguageModelCache } from '../languageModelCache';
import { createUpdater, isSan, isSanInterpolation, getInterpolationOriginName, forceReverseSlash, LanguageserverInfo, isSanShadowTs, getShadowTsOriginName, createShadowTsFileName } from './preprocess';
import { getFileFsPath, getFilePath } from '../../utils/paths';
import * as bridge from './bridge';
import * as chokidar from 'chokidar';
import { SanDocumentRegions } from '../embeddedSupport';
import { logger } from '../../utils/logger';
import { sanSys } from './sanSys';


export const languageServiceInfo: LanguageserverInfo = {
    program: undefined,
    documentRegions: undefined,
    getLanguageId: undefined,
    updateCurrentTextDocument: undefined,
};
// Patch typescript functions to insert `import San from 'san'` and `San.createComponent` around export default.
// NOTE: this is a global hack that all ts instances after is changed
const { createLanguageServiceSourceFile, updateLanguageServiceSourceFile } = createUpdater(languageServiceInfo);
(ts as any).createLanguageServiceSourceFile = createLanguageServiceSourceFile;
(ts as any).updateLanguageServiceSourceFile = updateLanguageServiceSourceFile;


const defaultCompilerOptions: ts.CompilerOptions = {
    allowNonTsExtensions: true,
    allowJs: true,
    lib: ['lib.dom.d.ts', 'lib.es2017.d.ts'],
    target: ts.ScriptTarget.Latest,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.Preserve,
    allowSyntheticDefaultImports: true
};

export function getServiceHost(
    workspacePath: string,
    jsDocuments: LanguageModelCache<TextDocument>,
    documentRegions: LanguageModelCache<SanDocumentRegions>,
) {
    // setup the ref
    languageServiceInfo.documentRegions = documentRegions;

    let currentScriptDoc: TextDocument;
    const versions = new Map<string, number>();
    const scriptDocs = new Map<string, TextDocument>();

    const bridgeFilePath = getNormalizedFileFsPath(path.join(workspacePath, bridge.fileName));

    const parsedConfig = getParsedConfig(workspacePath);

    const files = parsedConfig.fileNames;
    logger.log(() => ['parsedConfig.options', parsedConfig.options]);
    logger.log(() => ['parsedConfig.fileNames', parsedConfig.fileNames]);
    const compilerOptions = {
        ...defaultCompilerOptions,
        ...parsedConfig.options
    };
    compilerOptions.allowNonTsExtensions = true;
    const watcher = chokidar.watch(workspacePath, {
        ignoreInitial: true,
        ignored: defaultIgnorePatterns(workspacePath)
    });

    watcher
        .on('change', filterNonScript(path => {
            const ver = versions.get(path) || 0;
            versions.set(path, ver + 1);
        }))
        .on('add', filterNonScript(path => {
            files.push(path);
        }))
        .on('unlink', filterNonScript(path => {
            files.splice(files.indexOf(path), 1);
            versions.delete(path);
            scriptDocs.delete(path);
        }));

    function updateCurrentTextDocument(doc: TextDocument) {
        const fileFsPath = getFileFsPath(doc.uri);
        const filePath = getFilePath(doc.uri);
        logger.log(() => ['updateCurrentTextDocument ', fileFsPath]);

        const ifIsSanInterpolation = isSanInterpolation(fileFsPath);
        const ifIsSanShadowTs = isSanShadowTs(filePath);
        if (ifIsSanInterpolation || ifIsSanShadowTs) {

            languageServiceInfo.program = jsLanguageService.getProgram();
        }

        // When file is not in language service, add it
        if (!scriptDocs.has(fileFsPath)) {
            if (isSan(fileFsPath) || ifIsSanInterpolation || ifIsSanShadowTs) {
                console.assert(!files.includes(filePath), 'wtf');
                logger.log(() => ['add filePath', filePath]);
                files.push(filePath);
            }
        }
        // to prevent inner update loop
        // we make a cache here.
        // so why we need to use this kind of dirty check 
        let localCurrentScriptDoc = currentScriptDoc;
        if (!currentScriptDoc
            || doc.uri !== currentScriptDoc.uri
            || doc.version !== currentScriptDoc.version
        ) {
            logger.log(() => `why we need to change this? 
doc.uri ${doc.uri}
doc.uri !== currentScriptDoc.uri ${currentScriptDoc && doc.uri !== currentScriptDoc.uri},
doc.version !== currentScriptDoc.version ${currentScriptDoc && doc.version !== currentScriptDoc.version},
versions.has(fileFsPath)  ${versions.has(fileFsPath)}`);

            currentScriptDoc = jsDocuments.get(doc);
            localCurrentScriptDoc = currentScriptDoc;
            const lastDoc = scriptDocs.get(fileFsPath);
            logger.log(() => `${fileFsPath} !!lastDoc ${!!lastDoc}
lastDoc && lastDoc.languageId ${lastDoc && lastDoc.languageId}
currentScriptDoc.languageId ${localCurrentScriptDoc.languageId}`);

            if (lastDoc) {
                if (localCurrentScriptDoc.languageId !== lastDoc.languageId) {
                    logger.log(() => ['languageId change', fileFsPath, localCurrentScriptDoc.languageId, lastDoc.languageId]);
                    // if languageId changed, restart the language service; 
                    // it can't handle file type changes
                    updateLanguageService();
                }
            } else {
                updateLanguageService();
            }

            logger.log(() => ['add or update file to script doc cache', fileFsPath, localCurrentScriptDoc.uri]);
            logger.log(() => ['add file to scriptDocs 1', fileFsPath, localCurrentScriptDoc.languageId]);
            scriptDocs.set(fileFsPath, localCurrentScriptDoc);

            const oldVersion = versions.get(fileFsPath) || 0;
            const newVersion = localCurrentScriptDoc.version;

            if (oldVersion < newVersion) {
                versions.set(fileFsPath, newVersion);
                logger.log(() => ['increase version of file', fileFsPath,
                    localCurrentScriptDoc.version,
                    versions.get(fileFsPath)]);
            }

        }

        logger.log(() => ['file version diff checked', fileFsPath]);

        return {
            service: jsLanguageService,
            scriptDoc: localCurrentScriptDoc
        };
    }

    function getScriptDocByFsPath(fsPath: string) {
        return scriptDocs.get(fsPath);
    }


    function getLanguageId(fileName: string): string {
        if (isSan(fileName)) {
            const uri = Uri.file(fileName);
            fileName = uri.fsPath;
            const scriptDoc = scriptDocs.get(fileName);
            const doc = scriptDoc ||
                jsDocuments.get(TextDocument.create(uri.toString(), 'san', 0, ts.sys.readFile(fileName) || ''));

            // logger.log(() => ['get file languageId',
            //     fileName,
            //     uri.toString(),
            //     doc.languageId,
            //     !!scriptDoc,
            //     /* doc.getText() */
            // ]);

            if (!scriptDoc) {
                // we need to add this file to files;
                logger.log(() => ['add file to scriptDocs 2', fileName, doc.languageId]);
                scriptDocs.set(fileName,
                    TextDocument.create(
                        uri.toString(),
                        doc.languageId,
                        0,
                        doc.getText()));
                files.push(forceReverseSlash(fileName));
            }
            return doc.languageId;
        } else {
            return 'typescript';
        }
    };

    languageServiceInfo.getLanguageId = getLanguageId;
    languageServiceInfo.updateCurrentTextDocument = updateCurrentTextDocument;

    const host: ts.LanguageServiceHost = {
        getCompilationSettings() {
            return compilerOptions;
        },
        getScriptFileNames() { return files },
        getScriptVersion(fileName: string) {
            if (fileName === bridge.fileName) {
                return '0';
            }
            const normalizedFileFsPath = getNormalizedFileFsPath(fileName);
            const version = versions.get(normalizedFileFsPath);

            logger.log(() => ['getScriptVersion -- ', fileName, normalizedFileFsPath, version]);
            return version ? version.toString() : '0';
        },

        getScriptKind(fileName: string) {
            // logger.log(() => ['getScriptKind -- ', fileName]);
            if (isSan(fileName)) {
                return getScriptKind(getLanguageId(fileName));
            } else {
                if (fileName === bridge.fileName
                    || fileName === bridgeFilePath
                ) {
                    return (ts as any).getScriptKindFromFileName(bridgeFilePath);
                }
                // NOTE: Typescript 2.3 should export getScriptKindFromFileName. Then this cast should be removed.
                return (ts as any).getScriptKindFromFileName(fileName);
            }
        },

        // resolve @types, see https://github.com/Microsoft/TypeScript/issues/16772
        getDirectories: sanSys.getDirectories,
        directoryExists: sanSys.directoryExists,
        fileExists: sanSys.fileExists,
        readFile: sanSys.readFile,
        readDirectory: sanSys.readDirectory,

        resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {
            // in the normal case, delegate to ts.resolveModuleName
            // in the relative-imported.san case, manually build a resolved filename
            // this host is which provide service

            const ret = moduleNames.map(name => {
                if (name === bridge.moduleName) {
                    return {
                        resolvedFileName: bridge.fileName,
                        extension: ts.Extension.Ts
                    };
                }

                // if (path.extname(name) == bridge.shadowTsSurfix) {
                //     logger.log(() => ['this is a shadow ts file', name, containingFile])
                //     return {
                //         resolvedFileName: createShadowTsFileName(
                //             path.join(path.dirname(containingFile), path.dirname(name), path.basename(name, bridge.shadowTsSurfix) + '.san')
                //         ),
                //         extension: ts.Extension.Ts
                //     };
                // }
                if (isSan(containingFile)) {
                    if (isSan(name)) {
                        // san file will check import file info
                        // if it is a san js imports, trans it to a shadow ts import
                        const sanFileName = path.resolve(path.dirname(containingFile), name);
                        logger.log(() => ['this should check if a shadow ts file', name, containingFile, sanFileName]);
                        if (getLanguageId(sanFileName) === 'javascript') {
                            logger.log(() => ['this is a shadow ts file', createShadowTsFileName(sanFileName)]);
                            return {
                                resolvedFileName: createShadowTsFileName(sanFileName),
                                extension: ts.Extension.Ts
                            };
                        }
                    }
                }

                if (path.isAbsolute(name) || !isSan(name)) {
                    return ts.resolveModuleName(name, containingFile, compilerOptions, ts.sys).resolvedModule;
                }
                const resolved = ts.resolveModuleName(name, containingFile, compilerOptions, sanSys).resolvedModule;
                if (!resolved) {
                    return undefined as any;
                }
                if (!resolved.resolvedFileName.endsWith('.san.ts')) {
                    return resolved;
                }
                const resolvedFileName = resolved.resolvedFileName.slice(0, -3);
                const uri = Uri.file(resolvedFileName);
                const doc =
                    scriptDocs.get(resolvedFileName) ||
                    jsDocuments.get(TextDocument.create(uri.toString(), 'san', 0, ts.sys.readFile(resolvedFileName) || ''));
                const extension =
                    doc.languageId === 'typescript'
                        ? ts.Extension.Ts
                        : doc.languageId === 'tsx' ? ts.Extension.Tsx : ts.Extension.Js;

                return { resolvedFileName, extension };
            });

            logger.log(() => ['resolveModuleNames for service --', containingFile, moduleNames, ret]);

            return ret;
        },
        getScriptSnapshot: (fileName: string) => {
            logger.log(() => ['getScriptSnapshot --', fileName]);

            const normalizedFileFsPath = fileName === bridge.fileName
                ? bridgeFilePath
                : getNormalizedFileFsPath(fileName);
            const originNomalizedFilePath = isSanInterpolation(normalizedFileFsPath)
                ? getInterpolationOriginName(normalizedFileFsPath)
                : isSanShadowTs(normalizedFileFsPath)
                    ? getShadowTsOriginName(normalizedFileFsPath)
                    : normalizedFileFsPath

            let fileText = '';
            let doc = scriptDocs.get(normalizedFileFsPath) as TextDocument;
            // temp file should got a different path;
            const uri = Uri.file(normalizedFileFsPath).toString();
            const originalUri = Uri.file(originNomalizedFilePath).toString();
            if (!doc) {
                logger.log(() => ['couldnt find the script doc', uri]);
                if (fileName === bridge.fileName) {
                    fileText = bridge.content;
                } else {
                    fileText = ts.sys.readFile(originNomalizedFilePath) || '';

                    if (isSan(fileName)
                        || isSanInterpolation(fileName)
                        || isSanShadowTs(fileName)
                    ) {

                        documentRegions.get(TextDocument.create(
                            originalUri,
                            'san',
                            parseInt(host.getScriptVersion(fileName)),
                            fileText
                        ));

                        // Note: This is required in addition to the parsing in embeddedSupport because
                        // this works for .san files that aren't even loaded by VS Code yet.
                        fileText = jsDocuments.get(TextDocument.create(
                            uri,
                            'san',
                            parseInt(host.getScriptVersion(fileName)),
                            fileText
                        )).getText();

                        logger.log(() => `fileName ${fileName}
uri ${uri}
originUri ${originalUri}`);
                    }
                }

                logger.log(() => ['add file to script doc cache',
                    normalizedFileFsPath,
                    (ts as any).getScriptKindFromFileName(normalizedFileFsPath)]);

                // we need to add this file to files;
                const targetLanguageId = getLanguageId(normalizedFileFsPath)

                if (!scriptDocs.get(normalizedFileFsPath)) {
                    logger.log(() => ['add file to scriptDocs 3', normalizedFileFsPath, targetLanguageId]);
                    scriptDocs.set(normalizedFileFsPath,
                        TextDocument.create(
                            uri,
                            targetLanguageId,
                            0,
                            fileText));
                } else {
                    logger.log(() => ['the file already added to scriptDoc', normalizedFileFsPath]);
                }
            } else {
                fileText = doc.getText();
                logger.log(() => ['get file hitted cache', normalizedFileFsPath, !!fileText]);
            }

            if (!isSanInterpolation(fileName) && !isSanShadowTs(fileName)) {
                if (!doc) {
                    files.push(forceReverseSlash(normalizedFileFsPath));
                    versions.set(normalizedFileFsPath, 0);
                    logger.log(() => ['added', normalizedFileFsPath]);
                }
            }

            // logger.log(() => ['getScriptSnapshot --', fileName, fileText.length]);

            return {
                getText(start: number, end: number) {
                    return fileText.substring(start, end);
                },
                getLength() {
                    return fileText.length;
                },
                getChangeRange() {
                    return void 0;
                }
            };
        },
        getCurrentDirectory: () => workspacePath,
        getDefaultLibFileName: ts.getDefaultLibFilePath,
        getNewLine: () => '\n'
    };


    let jsLanguageService: ts.LanguageService;
    let sourceOnlyHost: typeof host = {
        ...host,
        resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {

            // in the normal case, delegate to ts.resolveModuleName
            // in the relative-imported.san case, manually build a resolved filename
            // this is  which provide component info
            const ret = moduleNames.map(name => {
                if (name === bridge.moduleName) {
                    return {
                        resolvedFileName: bridge.fileName,
                        extension: ts.Extension.Ts
                    };
                }

                if (path.isAbsolute(name) || !isSan(name)) {
                    return ts.resolveModuleName(name, containingFile, compilerOptions, ts.sys).resolvedModule;
                }
                const resolved = ts.resolveModuleName(name, containingFile, compilerOptions, sanSys).resolvedModule;
                if (!resolved) {
                    return undefined as any;
                }
                if (!resolved.resolvedFileName.endsWith('.san.ts')) {
                    return resolved;
                }
                const resolvedFileName = resolved.resolvedFileName.slice(0, -3);
                const uri = Uri.file(resolvedFileName);
                const doc =
                    scriptDocs.get(resolvedFileName) ||
                    jsDocuments.get(TextDocument.create(uri.toString(), 'san', 0, ts.sys.readFile(resolvedFileName) || ''));
                const extension =
                    doc.languageId === 'typescript'
                        ? ts.Extension.Ts
                        : doc.languageId === 'tsx' ? ts.Extension.Tsx : ts.Extension.Js;

                return { resolvedFileName, extension };
            });
            logger.log(() => ['resolveModuleNames for componentInfo --', containingFile, moduleNames, ret]);
            return ret;
        }
    }

    let sourceOnlyLanguageService: ts.LanguageService;


    function updateLanguageService() {
        logger.log(() => 'so there is something make a language server reload');

        if (jsLanguageService) {
            jsLanguageService.dispose();
            sourceOnlyLanguageService.dispose();
        }

        sourceOnlyLanguageService = ts.createLanguageService(sourceOnlyHost);
        languageServiceInfo.program = sourceOnlyLanguageService.getProgram();

        jsLanguageService = ts.createLanguageService(host);
    }

    updateLanguageService();

    return {
        updateCurrentTextDocument,
        getLanguageId,
        getScriptDocByFsPath,
        dispose: () => {
            watcher.close();
            jsLanguageService.dispose();
        },
    };
}

function getNormalizedFileFsPath(fileName: string): string {
    let ret: string = Uri.file(fileName).fsPath;

    return path.normalize(ret);
}


function defaultIgnorePatterns(workspacePath: string) {
    const nodeModules = ['node_modules', '**/node_modules/*'];
    const gitignore = ts.findConfigFile(workspacePath, ts.sys.fileExists, '.gitignore');
    if (!gitignore) {
        return nodeModules;
    }
    const parsed: string[] = parseGitIgnore(gitignore);
    const filtered = parsed.filter(s => !s.startsWith('!'));
    return nodeModules.concat(filtered);
}

function getScriptKind(langId: string): ts.ScriptKind {
    return langId === 'typescript' ? ts.ScriptKind.TS : langId === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
}



function getParsedConfig(workspacePath: string) {
    const configFilename =
        ts.findConfigFile(workspacePath, ts.sys.fileExists, 'tsconfig.json') ||
        ts.findConfigFile(workspacePath, ts.sys.fileExists, 'jsconfig.json');
    const configJson = (configFilename && ts.readConfigFile(configFilename, ts.sys.readFile).config) || {
        exclude: defaultIgnorePatterns(workspacePath)
    };
    // existingOptions should be empty since it always takes priority
    const ret = ts.parseJsonConfigFileContent(
        configJson,
        ts.sys,
        workspacePath,
    /*existingOptions*/ {
            // why wetuer miss this....
            allowJs: true
        },
        configFilename,
    /*resolutionStack*/ undefined,
        [{ extension: '.san', isMixedContent: true }]
    );
    return ret;
}

function filterNonScript(func: (path: string) => void) {
    return (path: string) => {
        if (!/(tsx?|san|jsx?)$/.test(path)) {
            return;
        }
        func(path);
    };
}
