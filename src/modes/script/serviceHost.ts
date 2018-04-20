import * as path from 'path';
import * as ts from 'typescript';
import Uri from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-types';
import * as parseGitIgnore from 'parse-gitignore';

import { LanguageModelCache } from '../languageModelCache';
import { createUpdater, parseSan, isSan, isSanInterpolation, parseSanInterpolation, getInterpolationOriginName, forceReverseSlash, LanguageserverInfo } from './preprocess';
import { getFileFsPath, getFilePath } from '../../utils/paths';
import * as bridge from './bridge';
import * as chokidar from 'chokidar';
import { SanDocumentRegions } from '../embeddedSupport';


const languageServiceInfo: LanguageserverInfo = {
    program: undefined,
    documentRegions: undefined,
};
// Patch typescript functions to insert `import San from 'san'` and `San.createComponent` around export default.
// NOTE: this is a global hack that all ts instances after is changed
const { createLanguageServiceSourceFile, updateLanguageServiceSourceFile } = createUpdater(languageServiceInfo);
(ts as any).createLanguageServiceSourceFile = createLanguageServiceSourceFile;
(ts as any).updateLanguageServiceSourceFile = updateLanguageServiceSourceFile;

const sanSys: ts.System = {
    ...ts.sys,
    fileExists(path: string) {
        if (isSanProject(path)) {
            return ts.sys.fileExists(path.slice(0, -3));
        }
        if (isSanInterpolation(path)) {
            return ts.sys.fileExists(getInterpolationOriginName(path));
        }
        return ts.sys.fileExists(path);
    },
    readFile(path, encoding) {
        if (isSanProject(path)) {
            const fileText = ts.sys.readFile(path.slice(0, -3), encoding);
            console.log('parse san when readfile', path);
            if (isSan(path)) {
                return fileText ? parseSan(fileText) : fileText;
            } else if (isSanInterpolation(path)) {
                // the part of  interpolation;
                return fileText ? parseSanInterpolation(fileText) : fileText;
            }
            return fileText;
        } else {
            const fileText = ts.sys.readFile(path, encoding);
            return fileText;
        }
    }
};

if (ts.sys.realpath) {
    const realpath = ts.sys.realpath;
    sanSys.realpath = function (path) {
        if (isSanProject(path)) {
            return realpath(path.slice(0, -3)) + '.ts';
        }
        return realpath(path);
    };
}

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
    console.log('bridgeFilePath', bridgeFilePath);
    const parsedConfig = getParsedConfig(workspacePath);

    const files = parsedConfig.fileNames;

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

        if (isSanInterpolation(fileFsPath)) {
            // so lets try update san file first...
            updateCurrentTextDocument(TextDocument.create(
                getInterpolationOriginName(doc.uri),
                'san',
                doc.version,
                doc.getText()
            ));
            languageServiceInfo.program = jsLanguageService.getProgram();

            // console.log('should got origin source file here',
            //     fileFsPath,
            //     getInterpolationOriginName(fileFsPath),
            //     !!LanguageServiceInfo.program.getSourceFile(getInterpolationOriginName(fileFsPath)));

        }

        // When file is not in language service, add it
        if (!scriptDocs.has(fileFsPath)) {
            if (isSan(fileFsPath) || isSanInterpolation(fileFsPath)) {
                console.assert(!files.includes(filePath), 'wtf');
                // console.log('add filePath', filePath);
                files.push(filePath);
            }
        }
        // console.log('file lock checked', fileFsPath);

        if (!currentScriptDoc
            || doc.uri !== currentScriptDoc.uri
            || doc.version !== currentScriptDoc.version
        ) {
            console.log(`why we need to change this? 
doc.uri ${doc.uri}
doc.uri !== currentScriptDoc.uri ${currentScriptDoc && doc.uri !== currentScriptDoc.uri},
doc.version !== currentScriptDoc.version ${currentScriptDoc && doc.version !== currentScriptDoc.version},
versions.has(fileFsPath)  ${versions.has(fileFsPath)}`);

            currentScriptDoc = jsDocuments.get(doc);
            const lastDoc = scriptDocs.get(fileFsPath);
            console.log(`!!lastDoc ${!!lastDoc}
lastDoc && lastDoc.languageId ${lastDoc && lastDoc.languageId}
currentScriptDoc.languageId ${currentScriptDoc.languageId}`);

            if (lastDoc && currentScriptDoc.languageId !== lastDoc.languageId) {
                console.log('languageId change', fileFsPath, currentScriptDoc.languageId, lastDoc.languageId)
                // if languageId changed, restart the language service; 
                // it can't handle file type changes
                updateLanguageService();
            }

            console.log('add or update file to script doc cache', fileFsPath);
            scriptDocs.set(fileFsPath, currentScriptDoc);

            versions.set(fileFsPath, (versions.get(fileFsPath) || 0) + 1);
            console.log('increase version of file', fileFsPath,
                currentScriptDoc.version,
                versions.get(fileFsPath));
        }

        console.log('file version diff checked', fileFsPath);

        return {
            service: jsLanguageService,
            scriptDoc: currentScriptDoc
        };
    }

    function getScriptDocByFsPath(fsPath: string) {
        return scriptDocs.get(fsPath);
    }


    function getLanguageId(fileName: string): string {
        if (isSan(fileName)) {
            const uri = Uri.file(fileName);
            fileName = uri.fsPath;
            const doc =
                scriptDocs.get(fileName) ||
                jsDocuments.get(TextDocument.create(uri.toString(), 'san', 0, ts.sys.readFile(fileName) || ''));

            // console.log('get file languageId',
            //     fileName,
            //     doc.languageId,
            //     !!scriptDocs.get(fileName),
            //     doc.getText()
            // );
            return doc.languageId
        } else {
            return 'typescript';
        }
    };

    const host: ts.LanguageServiceHost = {
        getCompilationSettings: () => compilerOptions,
        getScriptFileNames: () => files,
        getScriptVersion(fileName) {
            if (fileName === bridge.fileName) {
                return '0';
            }
            const normalizedFileFsPath = getNormalizedFileFsPath(fileName);
            const version = versions.get(normalizedFileFsPath);

            // console.log('getScriptVersion -- ', fileName, normalizedFileFsPath, version);
            return version ? version.toString() : '0';
        },

        getScriptKind(fileName) {
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
            return moduleNames.map(name => {
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
        },
        getScriptSnapshot: (fileName: string) => {
            // console.log('getScriptSnapshot --', fileName);

            const normalizedFileFsPath = fileName === bridge.fileName
                ? bridgeFilePath
                : getNormalizedFileFsPath(fileName);
            const originNomalizedFilePath = isSanInterpolation(normalizedFileFsPath)
                ? getInterpolationOriginName(normalizedFileFsPath)
                : normalizedFileFsPath

            let fileText = '';
            let doc = scriptDocs.get(normalizedFileFsPath) as TextDocument;
            // temp file should got a different path;
            const uri = Uri.file(normalizedFileFsPath).toString();
            const originalUri = Uri.file(originNomalizedFilePath).toString();
            if (!doc) {
                console.log('couldnt find the script doc', uri);
                if (fileName === bridge.fileName) {
                    fileText = bridge.content;
                } else {
                    fileText = ts.sys.readFile(originNomalizedFilePath) || '';

                    if (isSan(fileName) || isSanInterpolation(fileName)) {


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

                        console.log(
                            `fileName ${fileName}
uri ${uri}
originUri ${originalUri}`);
                    }
                }

                console.log('add file to script doc cache',
                    normalizedFileFsPath,
                    (ts as any).getScriptKindFromFileName(normalizedFileFsPath));
                // we need to add this file to files;
                scriptDocs.set(normalizedFileFsPath,
                    TextDocument.create(
                        uri,
                        getLanguageId(normalizedFileFsPath),
                        0,
                        fileText));
            } else {
                fileText = doc.getText();
                console.log('get file hitted cache', normalizedFileFsPath, !!fileText);
            }

            if (!isSanInterpolation(fileName)) {
                if (!doc) {
                    files.push(forceReverseSlash(normalizedFileFsPath));
                    versions.set(normalizedFileFsPath, 0);
                    // console.log('added', normalizedFileFsPath);
                }
            }

            return {
                getText(start, end) {
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

    function updateLanguageService() {
        console.log('so there is something make a language server reload');
        if (jsLanguageService) {
            jsLanguageService.dispose();
        }

        jsLanguageService = ts.createLanguageService(host);
        languageServiceInfo.program = jsLanguageService.getProgram();
    }

    updateLanguageService();

    return {
        updateCurrentTextDocument,
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

function isSanProject(path: string) {
    return path.endsWith('.san.ts') && !path.includes('node_modules');
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
    return ts.parseJsonConfigFileContent(
        configJson,
        ts.sys,
        workspacePath,
    /*existingOptions*/ {},
        configFilename,
    /*resolutionStack*/ undefined,
        [{ extension: 'san', isMixedContent: true }]
    );
}

function filterNonScript(func: (path: string) => void) {
    return (path: string) => {
        if (!/(tsx?|san|jsx?)$/.test(path)) {
            return;
        }
        func(path);
    };
}
